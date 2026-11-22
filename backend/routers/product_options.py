"""Configure menu add-ons: option groups with their options, and which products use each group."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from backend.core.context import current_business_id
from backend.core.db import audit, connection

router = APIRouter()


class OptionPayload(BaseModel):
    id: str | None = Field(default=None, max_length=60)
    name: str = Field(min_length=1, max_length=80)
    priceDelta: float = Field(default=0, ge=0, le=10_000_000, allow_inf_nan=False)
    ingredientId: str | None = Field(default=None, max_length=60)
    ingredientQuantity: float = Field(default=0, ge=0, le=1_000_000, allow_inf_nan=False)


class OptionGroupPayload(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    minSelect: int = Field(default=0, ge=0, le=20)
    maxSelect: int = Field(default=1, ge=1, le=20)
    options: list[OptionPayload] = Field(min_length=1, max_length=40)

    @model_validator(mode="after")
    def consistent_limits(self):
        if self.minSelect > self.maxSelect:
            raise ValueError("El mínimo no puede ser mayor que el máximo.")
        if self.minSelect > len(self.options):
            raise ValueError("El mínimo no puede ser mayor que la cantidad de opciones.")
        return self


class LinksPayload(BaseModel):
    groupIds: list[str] = Field(default_factory=list, max_length=20)


def group_out(conn, group) -> dict:
    options = conn.execute("SELECT * FROM product_options WHERE group_id=? AND active=1 ORDER BY position, name", (group["id"],)).fetchall()
    products = [r["product_id"] for r in conn.execute("SELECT product_id FROM product_option_links WHERE group_id=? ORDER BY position", (group["id"],))]
    return {
        "id": group["id"], "name": group["name"], "minSelect": group["min_select"], "maxSelect": group["max_select"],
        "options": [{"id": o["id"], "name": o["name"], "priceDelta": o["price_delta"], "ingredientId": o["ingredient_id"],
                     "ingredientQuantity": o["ingredient_quantity"]} for o in options],
        "productIds": products,
    }


def owned_group(conn, group_id: str):
    group = conn.execute("SELECT * FROM product_option_groups WHERE id=? AND business_id=? AND active=1", (group_id, current_business_id())).fetchone()
    if not group:
        raise HTTPException(404, "Grupo de opciones no encontrado.")
    return group


def save_options(conn, group_id: str, options: list[OptionPayload]) -> None:
    existing = {r["id"] for r in conn.execute("SELECT id FROM product_options WHERE group_id=? AND active=1", (group_id,))}
    kept = set()
    for position, option in enumerate(options):
        if option.ingredientId:
            ingredient = conn.execute("SELECT id FROM products WHERE id=? AND business_id=? AND active=1", (option.ingredientId, current_business_id())).fetchone()
            if not ingredient:
                raise HTTPException(422, f"El ingrediente de «{option.name}» no existe en el inventario.")
        values = (option.name.strip(), round(option.priceDelta, 2), option.ingredientId, option.ingredientQuantity if option.ingredientId else 0, position)
        if option.id and option.id in existing:
            conn.execute("UPDATE product_options SET name=?, price_delta=?, ingredient_id=?, ingredient_quantity=?, position=? WHERE id=?", (*values, option.id))
            kept.add(option.id)
        else:
            conn.execute("INSERT INTO product_options (id,business_id,group_id,name,price_delta,ingredient_id,ingredient_quantity,position) VALUES (?,?,?,?,?,?,?,?)",
                         ("OPC-" + uuid.uuid4().hex[:12], current_business_id(), group_id, *values))
    # Removed options are retired, not deleted: past orders and sales keep their own snapshot.
    for option_id in existing - kept:
        conn.execute("UPDATE product_options SET active=0 WHERE id=?", (option_id,))


@router.get("/api/product-options")
def list_option_groups():
    with connection() as conn:
        groups = conn.execute("SELECT * FROM product_option_groups WHERE business_id=? AND active=1 ORDER BY name", (current_business_id(),)).fetchall()
        return [group_out(conn, g) for g in groups]


@router.post("/api/product-options", status_code=201)
def create_option_group(payload: OptionGroupPayload):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        group_id = "GOP-" + uuid.uuid4().hex[:12]
        conn.execute("INSERT INTO product_option_groups (id,business_id,name,min_select,max_select) VALUES (?,?,?,?,?)",
                     (group_id, current_business_id(), payload.name.strip(), payload.minSelect, payload.maxSelect))
        save_options(conn, group_id, payload.options)
        audit(conn, "create", "product_option_group", group_id, {"name": payload.name, "options": len(payload.options)})
        conn.commit()
        return group_out(conn, owned_group(conn, group_id))


@router.put("/api/product-options/{group_id}")
def update_option_group(group_id: str, payload: OptionGroupPayload):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        owned_group(conn, group_id)
        conn.execute("UPDATE product_option_groups SET name=?, min_select=?, max_select=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                     (payload.name.strip(), payload.minSelect, payload.maxSelect, group_id))
        save_options(conn, group_id, payload.options)
        audit(conn, "update", "product_option_group", group_id, {"name": payload.name, "options": len(payload.options)})
        conn.commit()
        return group_out(conn, owned_group(conn, group_id))


@router.delete("/api/product-options/{group_id}")
def delete_option_group(group_id: str):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        owned_group(conn, group_id)
        conn.execute("UPDATE product_option_groups SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?", (group_id,))
        conn.execute("DELETE FROM product_option_links WHERE group_id=?", (group_id,))
        audit(conn, "archive", "product_option_group", group_id)
        conn.commit()
        return {"ok": True, "id": group_id}


@router.put("/api/product-options/links/{product_id}")
def set_product_option_groups(product_id: str, payload: LinksPayload):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if not conn.execute("SELECT id FROM products WHERE id=? AND business_id=? AND active=1", (product_id, current_business_id())).fetchone():
            raise HTTPException(404, "Producto no encontrado.")
        if len(set(payload.groupIds)) != len(payload.groupIds):
            raise HTTPException(422, "Cada grupo se asigna una sola vez.")
        for group_id in payload.groupIds:
            owned_group(conn, group_id)
        conn.execute("DELETE FROM product_option_links WHERE product_id=? AND business_id=?", (product_id, current_business_id()))
        for position, group_id in enumerate(payload.groupIds):
            conn.execute("INSERT INTO product_option_links (business_id,product_id,group_id,position) VALUES (?,?,?,?)",
                         (current_business_id(), product_id, group_id, position))
        audit(conn, "update_option_groups", "product", product_id, {"groupIds": payload.groupIds})
        conn.commit()
        return {"productId": product_id, "groupIds": payload.groupIds}
