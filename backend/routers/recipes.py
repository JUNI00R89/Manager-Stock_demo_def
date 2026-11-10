from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core.context import current_business_id
from backend.core.db import audit, connection


router = APIRouter()


class RecipeIngredientPayload(BaseModel):
    ingredientId: str
    quantity: float = Field(gt=0, le=100000)
    unit: str = Field(default="", max_length=32)


class RecipePayload(BaseModel):
    productId: str
    yieldQuantity: float = Field(default=1, gt=0, le=100000)
    instructions: str = Field(default="", max_length=2000)
    ingredients: list[RecipeIngredientPayload] = Field(min_length=1, max_length=100)


@router.get("/api/recipes")
def list_recipes():
    with connection() as conn:
        rows = conn.execute("""SELECT r.*, p.name AS product_name FROM recipes r
            JOIN products p ON p.id=r.product_id WHERE r.business_id=? ORDER BY p.name COLLATE NOCASE""", (current_business_id(),)).fetchall()
        result = []
        for row in rows:
            ingredients = conn.execute("""SELECT ri.ingredient_id, ri.quantity, ri.unit AS recipe_unit, p.name, p.unit AS product_unit, p.stock
                FROM recipe_items ri JOIN products p ON p.id=ri.ingredient_id WHERE ri.recipe_id=? ORDER BY p.name""", (row["id"],)).fetchall()
            result.append({"id": row["id"], "productId": row["product_id"], "productName": row["product_name"], "yieldQuantity": row["yield_quantity"], "instructions": row["instructions"], "ingredients": [{"ingredientId": i["ingredient_id"], "name": i["name"], "quantity": i["quantity"], "unit": i["recipe_unit"] or i["product_unit"], "productUnit": i["product_unit"], "stock": i["stock"]} for i in ingredients]})
        return result


@router.post("/api/recipes", status_code=201)
def save_recipe(payload: RecipePayload):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        product = conn.execute("SELECT id,name,product_type FROM products WHERE id=? AND business_id=? AND active=1", (payload.productId, current_business_id())).fetchone()
        if not product or product["product_type"] != "sale_item":
            conn.rollback()
            raise HTTPException(400, "Selecciona un producto activo que se pueda vender.")
        if len({i.ingredientId for i in payload.ingredients}) != len(payload.ingredients):
            conn.rollback()
            raise HTTPException(400, "No repitas el mismo ingrediente en una receta.")
        for item in payload.ingredients:
            ingredient = conn.execute("SELECT id,product_type FROM products WHERE id=? AND business_id=? AND active=1", (item.ingredientId, current_business_id())).fetchone()
            if not ingredient or ingredient["product_type"] != "ingredient":
                conn.rollback()
                raise HTTPException(400, f"El producto {item.ingredientId} no está configurado como ingrediente.")
        existing = conn.execute("SELECT id FROM recipes WHERE product_id=?", (payload.productId,)).fetchone()
        recipe_id = existing["id"] if existing else f"REC-{uuid.uuid4().hex[:10].upper()}"
        if existing:
            conn.execute("UPDATE recipes SET yield_quantity=?, instructions=? WHERE id=?", (payload.yieldQuantity, payload.instructions, recipe_id))
            conn.execute("DELETE FROM recipe_items WHERE recipe_id=?", (recipe_id,))
        else:
            conn.execute("INSERT INTO recipes (id,business_id,product_id,yield_quantity,instructions) VALUES (?,?,?,?,?)", (recipe_id, current_business_id(), payload.productId, payload.yieldQuantity, payload.instructions))
        conn.executemany("INSERT INTO recipe_items (recipe_id,ingredient_id,quantity,unit) VALUES (?,?,?,?)", [(recipe_id, i.ingredientId, i.quantity, i.unit) for i in payload.ingredients])
        audit(conn, "upsert", "recipe", recipe_id, {"productId": payload.productId, "ingredients": len(payload.ingredients)})
        conn.commit()
    return next(r for r in list_recipes() if r["id"] == recipe_id)


@router.delete("/api/recipes/{recipe_id}")
def delete_recipe(recipe_id: str):
    with connection() as conn:
        row = conn.execute("SELECT id FROM recipes WHERE id=? AND business_id=?", (recipe_id, current_business_id())).fetchone()
        if not row:
            raise HTTPException(404, "Receta no encontrada.")
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM recipe_items WHERE recipe_id=?", (recipe_id,))
        conn.execute("DELETE FROM recipes WHERE id=?", (recipe_id,))
        audit(conn, "delete", "recipe", recipe_id)
        conn.commit()
        return {"ok": True, "id": recipe_id}
