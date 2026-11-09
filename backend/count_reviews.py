"""Blind entry, manager approval and movement-version checks for physical counts."""
import hashlib
import json
import uuid
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from . import main as core

router = APIRouter(prefix='/api/inventory')


def movement_version(conn, product_id):
    return conn.execute('SELECT COALESCE(MAX(id),0) FROM inventory_movements WHERE product_id=?', (product_id,)).fetchone()[0]


def review_out(conn, row):
    result = core.physical_count_out(conn, row)
    result['canApprove'] = core.has_permission('inventory.adjust')
    if not result['canApprove']:
        result['totalDifference'] = None
        result['differenceCount'] = None
        for item in result['items']:
            item['systemQuantity'] = None
            item['difference'] = None
    return result


@router.get('/count-products')
def count_products(search: str = Query(default='', max_length=120)):
    with core.connection() as conn:
        rows = conn.execute('SELECT id,name,sku,unit FROM products WHERE business_id=? AND active=1 AND (name LIKE ? OR sku LIKE ?) ORDER BY name LIMIT 500', (core.current_business_id(), '%' + search + '%', '%' + search + '%')).fetchall()
        return [{**dict(r), 'movementId': movement_version(conn, r['id'])} for r in rows]


@router.get('/count-reviews')
def count_reviews():
    with core.connection() as conn:
        rows = conn.execute('SELECT * FROM physical_counts WHERE business_id=? ORDER BY created_at DESC,id LIMIT 100', (core.current_business_id(),)).fetchall()
        return [review_out(conn, row) for row in rows]


class CountItem(BaseModel):
    productId: str
    countedQuantity: float = Field(ge=0, le=100000000, allow_inf_nan=False)
    expectedMovementId: int = Field(ge=0)


class ReviewPayload(BaseModel):
    idempotencyKey: str = Field(min_length=8, max_length=100)
    notes: str = Field(default='', max_length=1000)
    items: list[CountItem] = Field(min_length=1, max_length=1000)


@router.post('/count-reviews', status_code=201)
def create_review(payload: ReviewPayload):
    fingerprint = hashlib.sha256(payload.model_dump_json().encode()).hexdigest()
    with core.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        previous = conn.execute('SELECT * FROM physical_counts WHERE business_id=? AND idempotency_key=?', (core.current_business_id(), payload.idempotencyKey)).fetchone()
        if previous:
            if previous['request_hash'] != fingerprint:
                raise HTTPException(409, 'La clave ya corresponde a otro conteo.')
            return review_out(conn, previous)
        count_id = 'CON-' + uuid.uuid4().hex[:16]
        user_id, name = core.current_operator()
        conn.execute("INSERT INTO physical_counts(id,business_id,status,notes,created_by,created_by_name,idempotency_key,request_hash) VALUES (?,?,'open',?,?,?,?,?)", (count_id, core.current_business_id(), payload.notes.strip(), user_id, name, payload.idempotencyKey, fingerprint))
        seen = set()
        for item in payload.items:
            if item.productId in seen:
                raise HTTPException(422, 'No repitas productos en un conteo.')
            seen.add(item.productId)
            if round(item.countedQuantity, 6) != item.countedQuantity:
                raise HTTPException(422, 'La cantidad contada admite hasta seis decimales.')
            product = core.fetch_inventory_product(conn, item.productId)
            core.validate_product_quantity(product, item.countedQuantity)
            version = movement_version(conn, product['id'])
            if version != item.expectedMovementId:
                raise HTTPException(409, 'Hubo movimientos durante el conteo. Actualiza y vuelve a contar los productos.')
            conn.execute('''INSERT INTO physical_count_items(count_id,product_id,system_quantity,counted_quantity,difference,observed_movement_id)
                            VALUES (?,?,?,?,?,?)''', (count_id, product['id'], product['stock'], item.countedQuantity, round(item.countedQuantity - product['stock'], 6), version))
        core.audit(conn, 'submit', 'physical_count', count_id, {'items': len(payload.items)})
        conn.commit()
        return review_out(conn, conn.execute('SELECT * FROM physical_counts WHERE id=?', (count_id,)).fetchone())


@router.post('/count-reviews/{count_id}/approve')
def approve_count(count_id: str):
    with core.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT * FROM physical_counts WHERE id=? AND business_id=?', (count_id, core.current_business_id())).fetchone()
        if not row:
            raise HTTPException(404, 'Conteo no encontrado.')
        if row['status'] == 'closed':
            return review_out(conn, row)
        if row['status'] != 'open':
            raise HTTPException(409, 'El conteo está cancelado.')
        items = conn.execute('SELECT * FROM physical_count_items WHERE count_id=?', (count_id,)).fetchall()
        for item in items:
            if movement_version(conn, item['product_id']) != item['observed_movement_id']:
                raise HTTPException(409, 'Hubo movimientos después del conteo. Cancélalo y vuelve a contar antes de ajustar.')
        operation = core.new_inventory_operation(conn, 'count', reason='Conteo aprobado', reference=count_id, notes=row['notes'])
        for item in items:
            product = core.fetch_inventory_product(conn, item['product_id'])
            difference = item['difference']
            kwargs = {'movement_type': 'count_adjustment', 'note': 'Conteo aprobado ' + count_id, 'reason': 'Conteo aprobado', 'operation_id': operation, 'reference_type': 'physical_count', 'reference_id': count_id}
            movement_id = None
            if difference > 0:
                movement_id = core.add_product_stock(conn, product, difference, **kwargs)['movementId']
            elif difference < 0:
                movements = core.consume_product_stock(conn, product, -difference, **kwargs, allow_negative=False)
                movement_id = movements[0]['movementId'] if movements else None
            conn.execute('UPDATE physical_count_items SET adjustment_movement_id=? WHERE id=?', (movement_id, item['id']))
        conn.execute("UPDATE physical_counts SET status='closed',approved_by=?,closed_at=CURRENT_TIMESTAMP WHERE id=?", (core.current_identity()['id'], count_id))
        core.audit(conn, 'approve', 'physical_count', count_id, {'operationId': operation})
        conn.commit()
        return review_out(conn, conn.execute('SELECT * FROM physical_counts WHERE id=?', (count_id,)).fetchone())


@router.post('/count-reviews/{count_id}/cancel')
def cancel_count(count_id: str):
    with core.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT * FROM physical_counts WHERE id=? AND business_id=?', (count_id, core.current_business_id())).fetchone()
        if not row:
            raise HTTPException(404, 'Conteo no encontrado.')
        if row['status'] == 'closed':
            raise HTTPException(409, 'El conteo ya fue aplicado.')
        conn.execute("UPDATE physical_counts SET status='cancelled' WHERE id=?", (count_id,))
        core.audit(conn, 'cancel', 'physical_count', count_id)
        conn.commit()
        return review_out(conn, conn.execute('SELECT * FROM physical_counts WHERE id=?', (count_id,)).fetchone())
