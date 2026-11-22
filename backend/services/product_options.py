"""Add-ons for menu products: validate a line's chosen options and turn them into price and ingredient usage.

Orders and sales store a snapshot of each choice (names, price, ingredient), so later menu edits never
change what was already ordered or charged.
"""
from __future__ import annotations

import sqlite3

from fastapi import HTTPException

from backend.core.context import current_business_id

SNAPSHOT_COLUMNS = "option_id, group_name, option_name, price_delta, ingredient_id, ingredient_quantity"


def resolve_line_options(conn: sqlite3.Connection, product: sqlite3.Row, option_ids: list[str]) -> list[dict]:
    """Checks the chosen options against the groups linked to the product; returns the snapshot rows."""
    if len(set(option_ids)) != len(option_ids):
        raise HTTPException(422, "Cada opción se elige una sola vez por línea.")
    groups = conn.execute(
        """SELECT g.* FROM product_option_links l JOIN product_option_groups g ON g.id=l.group_id
           WHERE l.product_id=? AND l.business_id=? AND g.active=1 ORDER BY l.position, g.name""",
        (product["id"], current_business_id()),
    ).fetchall()
    chosen: dict[str, sqlite3.Row] = {}
    if option_ids:
        marks = ",".join("?" for _ in option_ids)
        for row in conn.execute(
            f"SELECT * FROM product_options WHERE id IN ({marks}) AND business_id=? AND active=1",
            (*option_ids, current_business_id()),
        ):
            chosen[row["id"]] = row
    group_ids = {g["id"] for g in groups}
    if len(chosen) != len(option_ids) or any(o["group_id"] not in group_ids for o in chosen.values()):
        raise HTTPException(422, f"Hay opciones que no aplican a {product['name']}. Actualiza el menú e inténtalo de nuevo.")
    snapshot = []
    for group in groups:
        picked = [chosen[i] for i in option_ids if chosen[i]["group_id"] == group["id"]]
        if len(picked) < group["min_select"]:
            raise HTTPException(422, f"Elige {group['min_select']} en «{group['name']}» para {product['name']}.")
        if len(picked) > group["max_select"]:
            raise HTTPException(422, f"Puedes elegir máximo {group['max_select']} en «{group['name']}».")
        snapshot += [{"option_id": o["id"], "group_name": group["name"], "option_name": o["name"],
                      "price_delta": float(o["price_delta"]), "ingredient_id": o["ingredient_id"],
                      "ingredient_quantity": float(o["ingredient_quantity"] or 0)} for o in picked]
    return snapshot


def options_price(snapshot: list[dict]) -> float:
    return round(sum(o["price_delta"] for o in snapshot), 2)


def add_option_ingredients(requirements: dict[str, float], snapshot: list[dict], line_quantity: float) -> None:
    """Adds what the chosen options consume (per unit) for the whole line into an ingredient requirements map."""
    for option in snapshot:
        if option["ingredient_id"] and option["ingredient_quantity"] > 0:
            key = option["ingredient_id"]
            requirements[key] = round(requirements.get(key, 0.0) + option["ingredient_quantity"] * line_quantity, 6)


def store_snapshot(conn: sqlite3.Connection, table: str, column: str, line_id: int, snapshot: list[dict]) -> None:
    for o in snapshot:
        conn.execute(
            f"INSERT INTO {table} ({column}, {SNAPSHOT_COLUMNS}) VALUES (?,?,?,?,?,?,?)",
            (line_id, o["option_id"], o["group_name"], o["option_name"], o["price_delta"], o["ingredient_id"], o["ingredient_quantity"]),
        )


def load_snapshots(conn: sqlite3.Connection, table: str, column: str, line_ids: list[int]) -> dict[int, list[dict]]:
    """Snapshot rows grouped by line id, in the order they were chosen."""
    if not line_ids:
        return {}
    marks = ",".join("?" for _ in line_ids)
    grouped: dict[int, list[dict]] = {}
    for row in conn.execute(f"SELECT {column} AS line_id, {SNAPSHOT_COLUMNS} FROM {table} WHERE {column} IN ({marks}) ORDER BY rowid", line_ids):
        grouped.setdefault(row["line_id"], []).append({k: row[k] for k in row.keys() if k != "line_id"})
    return grouped


def public_options(snapshot: list[dict]) -> list[dict]:
    return [{"id": o["option_id"], "group": o["group_name"], "name": o["option_name"], "priceDelta": o["price_delta"]} for o in snapshot]
