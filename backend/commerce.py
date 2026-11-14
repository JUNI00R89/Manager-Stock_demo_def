"""Tenant-scoped customers and immutable preparation documents for Colombian billing.

This module never emits fiscal documents or invents a CUFE/DIAN response. A draft
is an internal snapshot; the provider adapter and tax classification are separate
release gates, documented in docs/facturacion-colombia.md.
"""
import hashlib
import json
import re
import sqlite3
import uuid
from typing import Literal
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator
from . import main as core
from backend.services.sales import get_sales

router = APIRouter(prefix="/api")


class CustomerPayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    documentType: Literal['CC', 'NIT', 'CE', 'TI', 'PP', 'FOREIGN'] = 'CC'
    documentNumber: str = Field(default='', max_length=30)
    email: str = Field(default='', max_length=160)
    phone: str = Field(default='', max_length=40)
    address: str = Field(default='', max_length=240)
    municipalityCode: str = Field(default='', pattern=r'^([0-9]{5})?$')
    personType: Literal['natural', 'legal'] = 'natural'
    taxResponsibilities: str = Field(default='', max_length=200)
    active: bool = True
    revision: int = Field(default=1, ge=1)

    @field_validator('name', 'email', 'phone', 'address', 'taxResponsibilities', mode='before')
    @classmethod
    def trim(cls, value):
        return ' '.join(value.split()) if isinstance(value, str) else value

    @field_validator('email')
    @classmethod
    def valid_email(cls, value):
        if value and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
            raise ValueError('Ingresa un correo válido.')
        return value.lower()

    @field_validator('documentNumber')
    @classmethod
    def clean_document(cls, value):
        value = value.strip().upper()
        if value and not re.fullmatch(r'[A-Z0-9-]+', value):
            raise ValueError('Usa el documento sin puntos ni espacios; el NIT se registra sin dígito de verificación.')
        return value

    @model_validator(mode='after')
    def valid_nit(self):
        if self.documentType == 'NIT' and self.documentNumber and not re.fullmatch(r'[0-9]{1,15}', self.documentNumber):
            raise ValueError('Ingresa el NIT sin dígito de verificación, puntos ni espacios.')
        return self


def customer_out(row):
    return {'id': row['id'], 'name': row['name'], 'documentType': row['document_type'],
            'documentNumber': row['document_number'], 'email': row['email'], 'phone': row['phone'],
            'address': row['address'], 'municipalityCode': row['municipality_code'],
            'personType': row['person_type'], 'taxResponsibilities': row['tax_responsibilities'],
            'active': bool(row['active']), 'revision': row['revision']}


def resolve_customer(conn, customer_id, *, active=True):
    row = conn.execute('SELECT * FROM customers WHERE id=? AND business_id=?', (customer_id, core.current_business_id())).fetchone()
    if not row or (active and not row['active']):
        raise HTTPException(404, 'Cliente no encontrado o inactivo.')
    return customer_out(row)


def link_customer(conn, source_type, source_id, customer_id):
    customer = resolve_customer(conn, customer_id)
    conn.execute('INSERT INTO customer_operations VALUES (?,?,?,?,?)',
                 (core.current_business_id(), source_type, source_id, customer_id, json.dumps(customer, ensure_ascii=False)))
    return customer


@router.get('/customers')
def customers(search: str = Query(default='', max_length=160), include_inactive: bool = False,
              limit: int = Query(default=100, ge=1, le=200), offset: int = Query(default=0, ge=0)):
    with core.connection() as conn:
        term = '%' + search.strip().replace('!', '!!').replace('%', '!%').replace('_', '!_') + '%'
        rows = conn.execute("""SELECT * FROM customers WHERE business_id=? AND (active=1 OR ?)
          AND (name LIKE ? ESCAPE '!' OR document_number LIKE ? ESCAPE '!' OR phone LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!')
          ORDER BY name COLLATE NOCASE,id LIMIT ? OFFSET ?""", (core.current_business_id(), include_inactive, term, term, term, term, limit, offset)).fetchall()
        return [customer_out(r) for r in rows]


@router.post('/customers', status_code=201)
def create_customer(payload: CustomerPayload):
    return save_customer(payload)


@router.put('/customers/{customer_id}')
def update_customer(customer_id: str, payload: CustomerPayload):
    return save_customer(payload, customer_id)


def save_customer(payload, customer_id=None):
    with core.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        try:
            if customer_id:
                old = resolve_customer(conn, customer_id, active=False)
                if old['revision'] != payload.revision:
                    raise HTTPException(409, 'El cliente cambió en otra pantalla. Actualiza antes de guardar.')
                identity = core.current_identity()
                if identity['role'] == 'cashier' and not identity.get('custom_role_id'):
                    # A base cashier fixes contact data only; the tax document and the active flag feed billing.
                    payload = payload.model_copy(update={'documentType': old['documentType'], 'documentNumber': old['documentNumber'], 'active': old['active']})
            else:
                customer_id = 'CLI-' + uuid.uuid4().hex[:16]
                conn.execute('INSERT INTO customers (id,business_id,name) VALUES (?,?,?)', (customer_id, core.current_business_id(), payload.name))
            conn.execute('''UPDATE customers SET name=?,document_type=?,document_number=?,email=?,phone=?,address=?,
                municipality_code=?,person_type=?,tax_responsibilities=?,active=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?''',
                (payload.name, payload.documentType, payload.documentNumber, payload.email, payload.phone, payload.address,
                 payload.municipalityCode, payload.personType, payload.taxResponsibilities, payload.active, customer_id))
            core.audit(conn, 'save', 'customer', customer_id)  # Do not copy personal data to the audit log.
            conn.commit()
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, 'Ya existe un cliente con ese tipo y número de documento.') from exc
        return resolve_customer(conn, customer_id, active=False)


@router.get('/customers/{customer_id}/history')
def customer_history(customer_id: str):
    with core.connection() as conn:
        customer = resolve_customer(conn, customer_id, active=False)
        # Each domain's own read permission remains necessary.
        sales = []
        if core.has_permission('sales.view') or (core.current_identity()['role'] == 'cashier' and not core.current_identity().get('custom_role_id')):
            rows = conn.execute('''SELECT s.* FROM sales s JOIN customer_operations c ON c.source_id=s.id AND c.source_type='sale'
                AND c.business_id=s.business_id WHERE c.customer_id=? AND s.business_id=? ORDER BY s.created_at DESC LIMIT 100''',
                (customer_id, core.current_business_id())).fetchall()
            sales = get_sales(conn, rows)  # one batch instead of ~7 queries per sale
            if core.current_identity()['role'] == 'cashier':
                sales = [s for s in sales if s['createdBy'] == core.current_identity()['id']]
        return {'customer': customer, 'sales': sales, 'limit': 100}


class BillingProfile(BaseModel):
    legalName: str = Field(default='', max_length=160)
    nit: str = Field(default='', pattern=r'^[0-9]{0,15}$')
    address: str = Field(default='', max_length=240)
    municipalityCode: str = Field(default='', pattern=r'^([0-9]{5})?$')
    taxResponsibilities: str = Field(default='', max_length=200)
    provider: Literal['undecided', 'factus', 'alegra', 'siigo'] = 'undecided'
    revision: int = Field(default=0, ge=0)


@router.get('/billing/profile')
def billing_profile():
    with core.connection() as conn:
        row = conn.execute('SELECT * FROM billing_profiles WHERE business_id=?', (core.current_business_id(),)).fetchone()
        return {**(json.loads(row['profile_json']) if row else BillingProfile().model_dump()), 'revision': row['revision'] if row else 0,
                'environment': 'preparation', 'emissionEnabled': False}


@router.put('/billing/profile')
def save_billing_profile(payload: BillingProfile):
    with core.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT revision FROM billing_profiles WHERE business_id=?', (core.current_business_id(),)).fetchone()
        if payload.revision != (row['revision'] if row else 0):
            raise HTTPException(409, 'La configuración cambió. Actualiza antes de guardar.')
        conn.execute('''INSERT INTO billing_profiles(business_id,profile_json) VALUES (?,?)
            ON CONFLICT(business_id) DO UPDATE SET profile_json=excluded.profile_json,revision=revision+1,updated_at=CURRENT_TIMESTAMP''',
            (core.current_business_id(), payload.model_dump_json(exclude={'revision'})))
        core.audit(conn, 'configure', 'billing_profile', core.current_business_id(), {'provider': payload.provider})
        conn.commit()
    return billing_profile()


class DraftPayload(BaseModel):
    sourceType: Literal['sale', 'hotel']
    sourceId: str = Field(min_length=1, max_length=100)
    customerId: str = Field(min_length=1, max_length=100)


def draft_out(row):
    return {'id': row['id'], 'sourceType': row['source_type'], 'sourceId': row['source_id'],
            'status': 'draft', 'createdAt': core.timestamp_iso(row['created_at']),
            'snapshotHash': row['snapshot_hash'], 'snapshot': json.loads(row['snapshot_json']), 'emissionEnabled': False}


@router.get('/billing/drafts')
def billing_drafts(limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0)):
    with core.connection() as conn:
        sources, params = [], [core.current_business_id()]
        if core.has_permission('sales.view'):
            sales_scope = "source_type='sale'"
            if core.current_identity()['role'] == 'cashier':
                sales_scope += ' AND EXISTS (SELECT 1 FROM sales s WHERE s.id=source_id AND s.created_by=?)'
                params.append(core.current_identity()['id'])
            sources.append('(' + sales_scope + ')')
        if core.has_permission('hotel.view'):
            sources.append("source_type='hotel'")
        if not sources:
            return []
        rows = conn.execute('SELECT * FROM billing_drafts WHERE business_id=? AND (' + ' OR '.join(sources) + ') ORDER BY created_at DESC,id LIMIT ? OFFSET ?', (*params, limit, offset)).fetchall()
        return [draft_out(r) for r in rows]


@router.post('/billing/drafts', status_code=201)
def prepare_draft(payload: DraftPayload):
    required = 'sales.view' if payload.sourceType == 'sale' else 'hotel.view'
    if not core.has_permission(required):
        raise HTTPException(403, 'Necesitas permiso para consultar la operación de origen.')
    with core.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        if payload.sourceType == 'sale' and core.current_identity()['role'] == 'cashier':
            if not conn.execute('SELECT 1 FROM sales WHERE business_id=? AND id=? AND created_by=?', (core.current_business_id(), payload.sourceId, core.current_identity()['id'])).fetchone():
                raise HTTPException(404, 'Venta no encontrada.')
        previous = conn.execute('SELECT * FROM billing_drafts WHERE business_id=? AND source_type=? AND source_id=?',
                                (core.current_business_id(), payload.sourceType, payload.sourceId)).fetchone()
        if previous:
            if previous['customer_id'] != payload.customerId:
                raise HTTPException(409, 'Esta operación ya tiene un borrador con otro cliente.')
            return draft_out(previous)
        customer = resolve_customer(conn, payload.customerId)
        if payload.sourceType == 'sale':
            operation = core.get_sale(conn, payload.sourceId)
            if not operation:
                raise HTTPException(404, 'Venta no encontrada.')
            if operation['status'] != 'completed':
                raise HTTPException(409, 'Solo se preparan ventas completadas.')
            linked = conn.execute("SELECT customer_id FROM customer_operations WHERE business_id=? AND source_type='sale' AND source_id=?", (core.current_business_id(), payload.sourceId)).fetchone()
            if linked and linked['customer_id'] != payload.customerId:
                raise HTTPException(409, 'El cliente debe coincidir con el registrado en la venta.')
        else:
            closure = conn.execute('SELECT receipt_json FROM hotel_account_closures WHERE reservation_id=? AND business_id=?', (payload.sourceId, core.current_business_id())).fetchone()
            if not closure:
                raise HTTPException(409, 'Cierra la cuenta del hotel antes de preparar el documento.')
            operation = json.loads(closure['receipt_json'])
        profile = conn.execute('SELECT profile_json FROM billing_profiles WHERE business_id=?', (core.current_business_id(),)).fetchone()
        issuer = json.loads(profile['profile_json']) if profile else {}
        checks = ['Configurar proveedor, habilitación DIAN y resolución de numeración vigente.',
                  'Clasificar impuestos por artículo o servicio; el impuesto general histórico no basta.',
                  'Probar envío, consulta de estado, XML, representación gráfica y notas crédito en sandbox.']
        for key, label in [('legalName', 'razón social'), ('nit', 'NIT'), ('address', 'dirección'), ('municipalityCode', 'municipio'), ('taxResponsibilities', 'responsabilidades tributarias')]:
            if not str(issuer.get(key, '')).strip():
                checks.append('Completar ' + label + ' del emisor.')
        for key, label in [('documentNumber', 'documento')]:
            if not customer.get(key):
                checks.append('Revisar ' + label + ' del adquirente para el flujo elegido.')
        if not customer.get('email'):
            checks.append('Planificar entrega impresa si el comprador no desea dar correo. No exigir datos adicionales para facturar.')
        snapshot = {'version': 1, 'country': 'CO', 'currency': 'COP', 'documentKind': 'internal_preparation',
                    'issuer': issuer, 'customer': customer, 'operation': operation, 'pendingChecks': checks,
                    'notice': 'Borrador interno. No es una factura electrónica ni acredita validación de la DIAN.'}
        serialized = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
        draft_id = 'BOR-' + uuid.uuid4().hex[:16]
        conn.execute('''INSERT INTO billing_drafts(id,business_id,source_type,source_id,customer_id,snapshot_json,snapshot_hash,created_by)
                        VALUES (?,?,?,?,?,?,?,?)''', (draft_id, core.current_business_id(), payload.sourceType, payload.sourceId,
                        payload.customerId, serialized, hashlib.sha256(serialized.encode()).hexdigest(), core.current_identity()['id']))
        core.audit(conn, 'prepare', 'billing_draft', draft_id, {'sourceType': payload.sourceType, 'sourceId': payload.sourceId})
        conn.commit()
        return draft_out(conn.execute('SELECT * FROM billing_drafts WHERE id=?', (draft_id,)).fetchone())
