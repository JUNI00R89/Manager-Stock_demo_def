from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from backend.core.context import current_business_id, current_identity
from backend.core.db import audit, connection, timestamp_iso
from backend.core.security import has_permission
from backend.schemas import HotelReservationPayload, HotelReservationStatusPayload, HotelRoomPayload
from backend.services.cash import cash_session_out
from backend.services.catalog import product_out
from backend.services.inventory import consume_product_stock, reverse_movements, validate_product_quantity


router = APIRouter()


def hotel_room_out(row: sqlite3.Row) -> dict:
    try:
        amenities = json.loads(row["amenities_json"] or "[]")
    except json.JSONDecodeError:
        amenities = []
    return {"id": row["id"], "number": row["room_number"], "roomNumber": row["room_number"],
            "type": row["room_type"], "roomType": row["room_type"], "floor": row["floor"],
            "capacity": row["capacity"], "pricePerNight": row["price_per_night"], "status": row["status"],
            "cleaningStatus": row["cleaning_status"], "cleaningAssignee": row["cleaning_assignee"],
            "amenities": amenities, "createdAt": timestamp_iso(row["created_at"]), "updatedAt": timestamp_iso(row["updated_at"])}


def hotel_reservation_out(row: sqlite3.Row) -> dict:
    check_in = datetime.strptime(row["check_in"], "%Y-%m-%d").date()
    check_out = datetime.strptime(row["check_out"], "%Y-%m-%d").date()
    return {"id": row["id"], "roomId": row["room_id"], "roomNumber": row["room_number"],
            "guestName": row["guest_name"], "guestEmail": row["guest_email"], "guestPhone": row["guest_phone"],
            "checkIn": row["check_in"], "checkOut": row["check_out"], "status": row["status"],
            "advance": row["advance"], "totalCharges": row["total_charges"], "nights": max((check_out-check_in).days, 0),
            "createdAt": timestamp_iso(row["created_at"])}


@router.get("/api/hotel/rooms")
def list_hotel_rooms():
    business_id = current_business_id()
    with connection() as conn:
        rows = conn.execute("SELECT * FROM hotel_rooms WHERE business_id=? ORDER BY floor,room_number", (business_id,)).fetchall()
        return [hotel_room_out(row) for row in rows]


@router.post("/api/hotel/rooms", status_code=201)
def create_hotel_room(payload: HotelRoomPayload):
    if current_identity()["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede crear habitaciones.")
    business_id = current_business_id()
    room_id = f"ROOM-{uuid.uuid4().hex[:12].upper()}"
    with connection() as conn:
        try:
            conn.execute("INSERT INTO hotel_rooms (id,business_id,room_number,room_type,floor,capacity,price_per_night,status,amenities_json) VALUES (?,?,?,?,?,?,?,?,?)",
                         (room_id, business_id, payload.roomNumber, payload.roomType, payload.floor, payload.capacity,
                          payload.pricePerNight, payload.status, json.dumps(payload.amenities, ensure_ascii=False)))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Ya existe una habitación con ese número en este hotel.") from exc
        if payload.status == "cleaning":
            conn.execute("UPDATE hotel_rooms SET cleaning_status='sucia' WHERE id=?", (room_id,))
        audit(conn, "create", "hotel_room", room_id, {"roomNumber": payload.roomNumber})
        row = conn.execute("SELECT * FROM hotel_rooms WHERE id=? AND business_id=?", (room_id, business_id)).fetchone()
        return hotel_room_out(row)


@router.put("/api/hotel/rooms/{room_id}")
def update_hotel_room(room_id: str, payload: HotelRoomPayload):
    if current_identity()["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede editar habitaciones.")
    business_id = current_business_id()
    with connection() as conn:
        try:
            # Occupancy (status) is driven by reservations and housekeeping, never by editing the room's data.
            cursor = conn.execute("UPDATE hotel_rooms SET room_number=?,room_type=?,floor=?,capacity=?,price_per_night=?,amenities_json=? WHERE id=? AND business_id=?",
                                  (payload.roomNumber, payload.roomType, payload.floor, payload.capacity, payload.pricePerNight,
                                   json.dumps(payload.amenities, ensure_ascii=False), room_id, business_id))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Ya existe una habitación con ese número en este hotel.") from exc
        if cursor.rowcount == 0:
            raise HTTPException(404, "Habitación no encontrada.")
        audit(conn, "update", "hotel_room", room_id, {"roomNumber": payload.roomNumber})
        return hotel_room_out(conn.execute("SELECT * FROM hotel_rooms WHERE id=? AND business_id=?", (room_id, business_id)).fetchone())


class HousekeepingPayload(BaseModel):
    cleaningStatus: Literal["sucia", "en_limpieza", "lista", "inspeccionada"]
    cleaningAssignee: str = Field(default="", max_length=120)
    expectedStatus: str | None = None


@router.patch("/api/hotel/rooms/{room_id}/housekeeping")
def update_housekeeping(room_id: str, payload: HousekeepingPayload):
    if not has_permission("hotel.manage"):
        raise HTTPException(403, "No tienes permiso para gestionar la limpieza.")
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        room = conn.execute("SELECT * FROM hotel_rooms WHERE id=? AND business_id=?", (room_id, current_business_id())).fetchone()
        if not room:
            raise HTTPException(404, "Habitación no encontrada.")
        if payload.expectedStatus is not None and room["cleaning_status"] != payload.expectedStatus:
            raise HTTPException(409, "La limpieza cambió. Actualiza el tablero.")
        conn.execute("UPDATE hotel_rooms SET cleaning_status=?,cleaning_assignee=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", (payload.cleaningStatus, payload.cleaningAssignee.strip(), room_id))
        # Cleaning cannot release an occupied or maintenance room.
        if room["status"] not in {"occupied", "maintenance"}:
            reserved = conn.execute("SELECT 1 FROM hotel_reservations WHERE room_id=? AND business_id=? AND status='confirmed' AND check_out>date('now','-5 hours')", (room_id, current_business_id())).fetchone()
            status = ("reserved" if reserved else "available") if payload.cleaningStatus == "inspeccionada" else "cleaning"
            conn.execute("UPDATE hotel_rooms SET status=? WHERE id=?", (status, room_id))
        audit(conn, "housekeeping", "hotel_room", room_id, payload.model_dump())
        conn.commit()
        return hotel_room_out(conn.execute("SELECT * FROM hotel_rooms WHERE id=?", (room_id,)).fetchone())


@router.get("/api/hotel/reservations")
def list_hotel_reservations(status: str | None = Query(default=None, max_length=30)):
    business_id = current_business_id()
    query = "SELECT r.*,h.room_number FROM hotel_reservations r JOIN hotel_rooms h ON h.id=r.room_id AND h.business_id=r.business_id WHERE r.business_id=?"
    params: list = [business_id]
    if status:
        if status not in {"confirmed", "checkin", "checkout", "cancelled"}:
            raise HTTPException(422, "Estado de reserva no válido.")
        query += " AND r.status=?"
        params.append(status)
    query += " ORDER BY r.check_in,r.room_id"
    with connection() as conn:
        return [hotel_reservation_out(row) for row in conn.execute(query, params).fetchall()]


def compute_hotel_stay_charge(room_row, check_in: str, check_out: str) -> float:
    """Calcula el cargo de la habitación consumida: noches x precio por noche."""
    start = datetime.strptime(check_in, "%Y-%m-%d").date()
    end = datetime.strptime(check_out, "%Y-%m-%d").date()
    nights = max((end - start).days, 1)
    return float(room_row["price_per_night"] or 0) * nights


@router.post("/api/hotel/reservations", status_code=201)
def create_hotel_reservation(payload: HotelReservationPayload):
    identity = current_identity()
    if identity["role"] not in {"owner", "business_admin"} and "hotel.manage" not in set(identity.get("permissions", [])):
        custom_id = identity.get("custom_role_id")
        if not custom_id:
            raise HTTPException(403, "Tu rol no puede crear reservas.")
        with connection() as conn:
            role = conn.execute("SELECT permissions_json FROM custom_roles WHERE id=? AND business_id=?", (custom_id, current_business_id())).fetchone()
        if not role or "hotel.manage" not in set(json.loads(role["permissions_json"] or "[]")):
            raise HTTPException(403, "Tu rol no puede crear reservas.")
    business_id = current_business_id()
    reservation_id = f"RES-{uuid.uuid4().hex[:12].upper()}"
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        room = conn.execute("SELECT * FROM hotel_rooms WHERE id=? AND business_id=?", (payload.roomId, business_id)).fetchone()
        if not room:
            conn.rollback()
            raise HTTPException(404, "La habitación no existe en este hotel.")
        if room["status"] in {"maintenance", "cleaning"}:
            conn.rollback()
            raise HTTPException(409, "La habitación no está habilitada para reservas.")
        overlap = conn.execute("SELECT id FROM hotel_reservations WHERE business_id=? AND room_id=? AND status IN ('confirmed','checkin') AND check_in<? AND check_out>? LIMIT 1",
                               (business_id, payload.roomId, payload.checkOut, payload.checkIn)).fetchone()
        if overlap:
            conn.rollback()
            raise HTTPException(409, "La habitación ya tiene una reserva para parte de ese periodo.")
        total = compute_hotel_stay_charge(room, payload.checkIn, payload.checkOut)
        if payload.advance > total:
            conn.rollback()
            raise HTTPException(422, "El anticipo no puede superar el valor total de la reserva.")
        conn.execute("INSERT INTO hotel_reservations (id,business_id,room_id,guest_name,guest_email,guest_phone,check_in,check_out,status,advance,total_charges) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                     (reservation_id,business_id,payload.roomId,payload.guestName,payload.guestEmail.strip(),payload.guestPhone.strip(),payload.checkIn,payload.checkOut,"confirmed",payload.advance,total))
        conn.execute("UPDATE hotel_rooms SET status='reserved',updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=? AND status='available'", (payload.roomId,business_id))
        audit(conn, "create", "hotel_reservation", reservation_id, {"roomId": payload.roomId, "checkIn": payload.checkIn, "checkOut": payload.checkOut})
        row = conn.execute("SELECT r.*,h.room_number FROM hotel_reservations r JOIN hotel_rooms h ON h.id=r.room_id AND h.business_id=r.business_id WHERE r.id=? AND r.business_id=?", (reservation_id,business_id)).fetchone()
        conn.commit()
        return hotel_reservation_out(row)


class HotelSchedulePayload(BaseModel):
    roomId: str = Field(min_length=1, max_length=80)
    checkIn: date
    expectedRoomId: str = Field(min_length=1, max_length=80)
    expectedCheckIn: date
    expectedCheckOut: date


@router.patch("/api/hotel/reservations/{reservation_id}/schedule")
def move_hotel_reservation(reservation_id: str, payload: HotelSchedulePayload):
    if not has_permission("hotel.manage"):
        raise HTTPException(403, "No tienes permiso para mover reservas.")
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM hotel_reservations WHERE id=? AND business_id=?", (reservation_id,current_business_id())).fetchone()
        if not row:
            raise HTTPException(404, "Reserva no encontrada.")
        if row["status"] != "confirmed" or conn.execute("SELECT 1 FROM hotel_account_closures WHERE reservation_id=?", (reservation_id,)).fetchone():
            raise HTTPException(409, "Solo se pueden mover reservas confirmadas antes del check-in.")
        nights = (payload.expectedCheckOut-payload.expectedCheckIn).days
        if nights <= 0:
            raise HTTPException(422, "La estancia debe tener al menos una noche.")
        try:
            check_out = (payload.checkIn+timedelta(days=nights)).isoformat()
        except OverflowError:
            raise HTTPException(422, "Fecha fuera de rango.")
        check_in = payload.checkIn.isoformat()
        # Retry of a committed move with a lost response is harmless.
        if (row["room_id"],row["check_in"],row["check_out"]) == (payload.roomId,check_in,check_out):
            return hotel_account(conn,reservation_id)["reservation"]
        if (row["room_id"],row["check_in"],row["check_out"]) != (payload.expectedRoomId,payload.expectedCheckIn.isoformat(),payload.expectedCheckOut.isoformat()):
            raise HTTPException(409, "La reserva cambió en otra pantalla. Actualiza el calendario.")
        room = conn.execute("SELECT * FROM hotel_rooms WHERE id=? AND business_id=?", (payload.roomId,current_business_id())).fetchone()
        if not room:
            raise HTTPException(404, "Habitación no encontrada en este hotel.")
        if room["status"] in {"maintenance","cleaning"}:
            raise HTTPException(409, "La habitación está en mantenimiento o limpieza.")
        overlap = conn.execute("SELECT 1 FROM hotel_reservations WHERE business_id=? AND room_id=? AND id<>? AND status IN ('confirmed','checkin') AND check_in<? AND check_out>?", (current_business_id(),payload.roomId,reservation_id,check_out,check_in)).fetchone()
        if overlap:
            raise HTTPException(409, "Ya existe una reserva en esa habitación durante ese periodo.")
        conn.execute("UPDATE hotel_reservations SET room_id=?,check_in=?,check_out=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", (payload.roomId,check_in,check_out,reservation_id))
        for room_id in {row["room_id"],payload.roomId}:
            occupied = conn.execute("SELECT 1 FROM hotel_reservations WHERE room_id=? AND status='checkin'", (room_id,)).fetchone()
            reserved = conn.execute("SELECT 1 FROM hotel_reservations WHERE room_id=? AND status='confirmed' AND check_out>date('now','-5 hours')", (room_id,)).fetchone()
            conn.execute("UPDATE hotel_rooms SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('maintenance','cleaning')", ("occupied" if occupied else "reserved" if reserved else "available",room_id))
        audit(conn,"move","hotel_reservation",reservation_id,{"from":{"roomId":row["room_id"],"checkIn":row["check_in"],"checkOut":row["check_out"]},"to":{"roomId":payload.roomId,"checkIn":check_in,"checkOut":check_out}})
        result = hotel_account(conn,reservation_id)["reservation"]
        conn.commit()
        return result


@router.patch("/api/hotel/reservations/{reservation_id}/status")
def update_hotel_reservation_status(reservation_id: str, payload: HotelReservationStatusPayload):
    identity = current_identity()
    if identity["role"] not in {"owner", "business_admin"} and "hotel.manage" not in set(identity.get("permissions", [])):
        custom_id = identity.get("custom_role_id")
        if not custom_id:
            raise HTTPException(403, "Tu rol no puede actualizar reservas.")
        with connection() as conn:
            role = conn.execute("SELECT permissions_json FROM custom_roles WHERE id=? AND business_id=?", (custom_id, current_business_id())).fetchone()
        if not role or "hotel.manage" not in set(json.loads(role["permissions_json"] or "[]")):
            raise HTTPException(403, "Tu rol no puede actualizar reservas.")
    business_id = current_business_id()
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        reservation = conn.execute("SELECT * FROM hotel_reservations WHERE id=? AND business_id=?", (reservation_id,business_id)).fetchone()
        if not reservation:
            conn.rollback()
            raise HTTPException(404, "Reserva no encontrada.")
        if conn.execute("SELECT 1 FROM hotel_account_closures WHERE reservation_id=?", (reservation_id,)).fetchone() and payload.status != "checkout":
            raise HTTPException(409, "La cuenta está cerrada; la estancia no se puede reabrir.")
        if payload.status == "cancelled" and conn.execute("SELECT 1 FROM hotel_payments WHERE reservation_id=?", (reservation_id,)).fetchone():
            raise HTTPException(409, "La reserva tiene pagos registrados y no se puede cancelar.")
        conn.execute("UPDATE hotel_reservations SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=?", (payload.status,reservation_id,business_id))
        # Recalculate occupancy for this room after the reservation status changes.
        # A checkout/cancellation must not make a room available if another booking is active.
        room = conn.execute("SELECT * FROM hotel_rooms WHERE id=? AND business_id=?", (reservation["room_id"], business_id)).fetchone()
        if room and room["status"] not in {"maintenance", "cleaning"}:
            has_checkin = conn.execute("SELECT 1 FROM hotel_reservations WHERE business_id=? AND room_id=? AND status='checkin' LIMIT 1", (business_id, reservation["room_id"])).fetchone()
            has_upcoming = conn.execute("SELECT 1 FROM hotel_reservations WHERE business_id=? AND room_id=? AND status='confirmed' AND check_out>date('now','-5 hours') LIMIT 1", (business_id, reservation["room_id"])).fetchone()
            next_room_status = "occupied" if has_checkin else "reserved" if has_upcoming else "available"
            conn.execute("UPDATE hotel_rooms SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=?", (next_room_status, reservation["room_id"], business_id))
        if payload.status == "checkout" and reservation["status"] == "checkin":
            conn.execute("UPDATE hotel_rooms SET cleaning_status='sucia',cleaning_assignee='',status=CASE WHEN status='available' THEN 'cleaning' ELSE status END WHERE id=? AND business_id=?", (reservation["room_id"], business_id))
        # Keep the agreed accommodation price and posted consumptions on checkout.
        audit(conn, payload.status, "hotel_reservation", reservation_id, {"status": payload.status})
        row = conn.execute("SELECT r.*,h.room_number FROM hotel_reservations r JOIN hotel_rooms h ON h.id=r.room_id AND h.business_id=r.business_id WHERE r.id=? AND r.business_id=?", (reservation_id,business_id)).fetchone()
        conn.commit()
        return hotel_reservation_out(row)


class HotelChargePayload(BaseModel):
    productId: str
    quantity: float = Field(gt=0, le=100000, allow_inf_nan=False)
    idempotencyKey: str = Field(min_length=8, max_length=100)
    note: str = Field(default="", max_length=500)


def hotel_account(conn: sqlite3.Connection, reservation_id: str) -> dict:
    reservation = conn.execute("SELECT r.*,h.room_number FROM hotel_reservations r JOIN hotel_rooms h ON h.id=r.room_id WHERE r.id=? AND r.business_id=?", (reservation_id, current_business_id())).fetchone()
    if not reservation:
        raise HTTPException(404, "Reserva no encontrada.")
    rows = conn.execute("SELECT * FROM hotel_charges WHERE business_id=? AND reservation_id=? ORDER BY created_at,id", (current_business_id(), reservation_id)).fetchall()
    consumed = round(sum(row["total"] for row in rows if row["status"] == "active"), 2)
    charges = [{"id": row["id"], "reservationId": row["reservation_id"], "productId": row["product_id"], "productName": row["product_name"], "quantity": row["quantity"], "unitPrice": row["unit_price"], "total": row["total"], "status": row["status"], "note": row["note"], "createdAt": timestamp_iso(row["created_at"]), "cancelledAt": timestamp_iso(row["cancelled_at"]), "idempotencyKey": row["idempotency_key"]} for row in rows]
    total = round(reservation["total_charges"], 2)
    payments = [{"id": row["id"], "amount": row["amount"], "method": row["method"], "reference": row["reference"], "cashSessionId": row["cash_session_id"], "createdAt": timestamp_iso(row["created_at"]), "idempotencyKey": row["idempotency_key"]} for row in conn.execute("SELECT * FROM hotel_payments WHERE reservation_id=? AND business_id=? ORDER BY created_at,id", (reservation_id,current_business_id()))]
    paid = round(sum(payment["amount"] for payment in payments), 2)
    refunds = [hotel_refund_out(row) for row in conn.execute("SELECT * FROM hotel_refunds WHERE reservation_id=? AND business_id=? ORDER BY created_at,id", (reservation_id,current_business_id()))]
    refunded = round(sum(row["amount"] for row in refunds), 2)
    closure = conn.execute("SELECT * FROM hotel_account_closures WHERE reservation_id=? AND business_id=?", (reservation_id,current_business_id())).fetchone()
    return {"reservation": hotel_reservation_out(reservation), "charges": charges, "accommodationTotal": round(total-consumed, 2), "consumptionTotal": consumed, "total": total, "advance": reservation["advance"], "payments": payments, "paidTotal": paid, "refunds": refunds, "refundedTotal": refunded, "netPaidTotal": round(paid-refunded, 2), "balance": 0 if closure else round(max(0, total-reservation["advance"]-paid+refunded), 2), "closedAt": closure["closed_at"] if closure else None, "receiptId": closure["receipt_id"] if closure else None, "receipt": json.loads(closure["receipt_json"]) if closure else None}


@router.get("/api/hotel/products")
def hotel_products():
    with connection() as conn:
        return [product_out(row) for row in conn.execute("SELECT * FROM products WHERE business_id=? AND active=1 AND product_type='sale_item' ORDER BY name", (current_business_id(),))]


@router.get("/api/hotel/reservations/{reservation_id}/account")
def get_hotel_account(reservation_id: str):
    with connection() as conn:
        return hotel_account(conn, reservation_id)


@router.post("/api/hotel/reservations/{reservation_id}/charges", status_code=201)
def add_hotel_charge(reservation_id: str, payload: HotelChargePayload):
    if not has_permission("hotel.manage"):
        raise HTTPException(403, "No tienes permiso para cargar consumos.")
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        account = hotel_account(conn, reservation_id)
        existing = conn.execute("SELECT * FROM hotel_charges WHERE business_id=? AND reservation_id=? AND idempotency_key=?", (current_business_id(), reservation_id, payload.idempotencyKey)).fetchone()
        if existing:
            if existing["product_id"] != payload.productId or existing["quantity"] != payload.quantity or existing["note"] != payload.note.strip():
                raise HTTPException(409, "La solicitud ya se utilizó para otro consumo.")
            return account
        if account["closedAt"]:
            raise HTTPException(409, "La cuenta ya está cerrada.")
        if account["reservation"]["status"] != "checkin":
            raise HTTPException(409, "Solo puedes cargar consumos a una estancia con check-in activo.")
        product = conn.execute("SELECT * FROM products WHERE id=? AND business_id=? AND active=1 AND product_type='sale_item'", (payload.productId, current_business_id())).fetchone()
        if not product:
            raise HTTPException(404, "Producto no disponible en este hotel.")
        validate_product_quantity(product, payload.quantity)
        charge_id = f"HC-{uuid.uuid4().hex}"
        total = round(float(product["price"]) * payload.quantity, 2)
        consume_product_stock(conn, product, payload.quantity, movement_type="consumption", note=f"Consumo habitación {account['reservation']['roomNumber']} · {reservation_id}", reference_type="hotel_charge", reference_id=charge_id, allow_negative=False)
        conn.execute("INSERT INTO hotel_charges (id,business_id,reservation_id,product_id,product_name,quantity,unit_price,total,idempotency_key,note,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)", (charge_id,current_business_id(),reservation_id,product["id"],product["name"],payload.quantity,product["price"],total,payload.idempotencyKey,payload.note.strip(),current_identity()["id"]))
        conn.execute("UPDATE hotel_reservations SET total_charges=ROUND(total_charges+?,2),updated_at=CURRENT_TIMESTAMP WHERE id=?", (total,reservation_id))
        audit(conn, "create", "hotel_charge", charge_id, {"reservationId": reservation_id, "quantity": payload.quantity, "total": total})
        result = hotel_account(conn, reservation_id)
        conn.commit()
        return result


@router.post("/api/hotel/reservations/{reservation_id}/charges/{charge_id}/cancel")
def cancel_hotel_charge(reservation_id: str, charge_id: str):
    if not has_permission("hotel.manage"):
        raise HTTPException(403, "No tienes permiso para anular consumos.")
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        account = hotel_account(conn, reservation_id)
        charge = conn.execute("SELECT * FROM hotel_charges WHERE id=? AND reservation_id=? AND business_id=?", (charge_id,reservation_id,current_business_id())).fetchone()
        if not charge:
            raise HTTPException(404, "Consumo no encontrado.")
        if charge["status"] == "cancelled":
            return account
        if account["closedAt"]:
            raise HTTPException(409, "La cuenta ya está cerrada.")
        if account["reservation"]["status"] != "checkin":
            raise HTTPException(409, "La estancia está cerrada; no puedes modificar sus consumos.")
        if account["total"] - charge["total"] < account["advance"] + account["netPaidTotal"]:
            raise HTTPException(409, "La anulación dejaría un saldo a favor. Primero requiere gestionar una devolución.")
        movements = conn.execute("SELECT * FROM inventory_movements WHERE business_id=? AND reference_type='hotel_charge' AND reference_id=? AND movement_type='consumption' ORDER BY id", (current_business_id(), charge_id)).fetchall()
        reverse_movements(conn, movements, f"Anulación de consumo {charge_id}", "adjustment")
        conn.execute("UPDATE hotel_charges SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP WHERE id=?", (charge_id,))
        conn.execute("UPDATE hotel_reservations SET total_charges=ROUND(total_charges-?,2),updated_at=CURRENT_TIMESTAMP WHERE id=?", (charge["total"],reservation_id))
        audit(conn, "cancel", "hotel_charge", charge_id, {"reservationId": reservation_id})
        result = hotel_account(conn, reservation_id)
        conn.commit()
        return result


class HotelPaymentPayload(BaseModel):
    amount: float = Field(gt=0, le=1000000000, allow_inf_nan=False)
    method: Literal["cash", "card", "transfer", "digital"]
    cashSessionId: str
    idempotencyKey: str = Field(min_length=8, max_length=100)
    reference: str = Field(default="", max_length=200)

    @field_validator("amount")
    @classmethod
    def cents(cls, value):
        if abs(value - round(value, 2)) > 0.000001:
            raise ValueError("El importe admite máximo dos decimales.")
        return round(value, 2)


def require_hotel_payment_permission():
    if not has_permission("hotel.manage") or not has_permission("cash.manage"):
        raise HTTPException(403, "Necesitas permisos de gestión de hotel y caja para cobrar.")


@router.post("/api/hotel/reservations/{reservation_id}/payments", status_code=201)
def add_hotel_payment(reservation_id: str, payload: HotelPaymentPayload):
    require_hotel_payment_permission()
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        account = hotel_account(conn, reservation_id)
        existing = conn.execute("SELECT * FROM hotel_payments WHERE reservation_id=? AND business_id=? AND idempotency_key=?", (reservation_id,current_business_id(),payload.idempotencyKey)).fetchone()
        if existing:
            if existing["amount"] != payload.amount or existing["method"] != payload.method or existing["reference"] != payload.reference.strip() or existing["cash_session_id"] != payload.cashSessionId:
                raise HTTPException(409, "Esta solicitud ya corresponde a otro pago.")
            return account
        if account["closedAt"] or account["reservation"]["status"] == "cancelled":
            raise HTTPException(409, "No puedes cobrar una cuenta cerrada o cancelada.")
        if payload.amount > account["balance"]:
            raise HTTPException(422, "El pago supera el saldo pendiente.")
        session = conn.execute("SELECT id FROM cash_sessions WHERE id=? AND business_id=? AND opened_by_user_id=? AND status='open'", (payload.cashSessionId,current_business_id(),current_identity()["id"])).fetchone()
        if not session:
            raise HTTPException(409, "Abre tu propio turno de caja antes de registrar un pago.")
        payment_id = f"HP-{uuid.uuid4().hex}"
        conn.execute("INSERT INTO hotel_payments (id,business_id,reservation_id,cash_session_id,amount,method,reference,idempotency_key,created_by) VALUES (?,?,?,?,?,?,?,?,?)", (payment_id,current_business_id(),reservation_id,payload.cashSessionId,payload.amount,payload.method,payload.reference.strip(),payload.idempotencyKey,current_identity()["id"]))
        audit(conn,"payment","hotel_reservation",reservation_id,{"paymentId":payment_id,"amount":payload.amount,"method":payload.method,"cashSessionId":payload.cashSessionId})
        result = hotel_account(conn,reservation_id)
        conn.commit()
        return result


@router.post("/api/hotel/reservations/{reservation_id}/close")
def close_hotel_account(reservation_id: str):
    require_hotel_payment_permission()
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        account = hotel_account(conn,reservation_id)
        if account["closedAt"]:
            return account
        reservation = account["reservation"]
        if reservation["status"] not in {"checkin","checkout"}:
            raise HTTPException(409, "Solo puedes cerrar la cuenta de una estancia iniciada.")
        if account["balance"] > 0:
            raise HTTPException(409, "La cuenta todavía tiene saldo pendiente.")
        receipt_id = f"HOT-{uuid.uuid4().hex[:16].upper()}"
        closed_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        business = conn.execute("SELECT name FROM businesses WHERE id=?", (current_business_id(),)).fetchone()
        receipt = {**account,"receiptId":receipt_id,"closedAt":closed_at,"businessName":business["name"],"currency":"COP"}
        conn.execute("INSERT INTO hotel_account_closures VALUES (?,?,?,?,?)", (reservation_id,current_business_id(),receipt_id,closed_at,json.dumps(receipt,ensure_ascii=False)))
        conn.execute("UPDATE hotel_reservations SET status='checkout',updated_at=CURRENT_TIMESTAMP WHERE id=?", (reservation_id,))
        if reservation["status"] == "checkin":
            room_id = reservation["roomId"]
            occupied = conn.execute("SELECT 1 FROM hotel_reservations WHERE room_id=? AND status='checkin'", (room_id,)).fetchone()
            reserved = conn.execute("SELECT 1 FROM hotel_reservations WHERE room_id=? AND status='confirmed' AND check_out>date('now','-5 hours')", (room_id,)).fetchone()
            status = "occupied" if occupied else "reserved" if reserved else "cleaning"
            conn.execute("UPDATE hotel_rooms SET cleaning_status='sucia',cleaning_assignee='',status=CASE WHEN status='maintenance' THEN status ELSE ? END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=?", (status,room_id,current_business_id()))
        audit(conn,"close_account","hotel_reservation",reservation_id,{"receiptId":receipt_id,"total":account["total"]})
        result = hotel_account(conn,reservation_id)
        conn.commit()
        return result


def hotel_refund_out(row):
    return {"id":row["id"],"reservationId":row["reservation_id"],"paymentId":row["payment_id"],"cashSessionId":row["cash_session_id"],"amount":row["amount"],"method":row["method"],"reason":row["reason"],"idempotencyKey":row["idempotency_key"],"createdAt":timestamp_iso(row["created_at"])}


class HotelRefundPayload(BaseModel):
    paymentId: str = Field(min_length=1, max_length=100)
    cashSessionId: str = Field(min_length=1, max_length=100)
    amount: float = Field(gt=0, le=1000000000, allow_inf_nan=False)
    reason: str = Field(min_length=3, max_length=500)
    idempotencyKey: str = Field(min_length=8, max_length=100)

    @field_validator("reason")
    @classmethod
    def reason_required(cls, value):
        if len(value.strip()) < 3:
            raise ValueError("Indica el motivo de la devolución.")
        return value.strip()

    @field_validator("amount")
    @classmethod
    def cents(cls, value):
        if abs(value-round(value,2)) > 0.000001:
            raise ValueError("El importe admite máximo dos decimales.")
        return round(value,2)


@router.post("/api/hotel/reservations/{reservation_id}/refunds", status_code=201)
def refund_hotel_payment(reservation_id: str, payload: HotelRefundPayload):
    require_hotel_payment_permission()
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        account = hotel_account(conn,reservation_id)
        existing = conn.execute("SELECT * FROM hotel_refunds WHERE business_id=? AND reservation_id=? AND idempotency_key=?", (current_business_id(),reservation_id,payload.idempotencyKey)).fetchone()
        if existing:
            if (existing["payment_id"],existing["cash_session_id"],existing["amount"],existing["reason"]) != (payload.paymentId,payload.cashSessionId,payload.amount,payload.reason):
                raise HTTPException(409, "Esta solicitud ya corresponde a otra devolución.")
            return account
        payment = conn.execute("SELECT * FROM hotel_payments WHERE id=? AND reservation_id=? AND business_id=?", (payload.paymentId,reservation_id,current_business_id())).fetchone()
        if not payment:
            raise HTTPException(404, "Pago no encontrado en esta cuenta.")
        returned = conn.execute("SELECT COALESCE(SUM(amount),0) FROM hotel_refunds WHERE payment_id=?", (payment["id"],)).fetchone()[0]
        if payload.amount > round(payment["amount"]-returned,2):
            raise HTTPException(422, "La devolución supera el importe disponible de ese pago.")
        session = conn.execute("SELECT * FROM cash_sessions WHERE id=? AND business_id=? AND opened_by_user_id=? AND status='open'", (payload.cashSessionId,current_business_id(),current_identity()["id"])).fetchone()
        if not session:
            raise HTTPException(409, "Abre tu propio turno de caja antes de devolver un pago.")
        if payment["method"] == "cash" and payload.amount > cash_session_out(conn,session)["expectedAmount"]:
            raise HTTPException(409, "El turno no tiene suficiente efectivo esperado para esta devolución.")
        refund_id = f"HR-{uuid.uuid4().hex}"
        conn.execute("INSERT INTO hotel_refunds (id,business_id,reservation_id,payment_id,cash_session_id,amount,method,reason,idempotency_key,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)", (refund_id,current_business_id(),reservation_id,payment["id"],session["id"],payload.amount,payment["method"],payload.reason,payload.idempotencyKey,current_identity()["id"]))
        audit(conn,"refund","hotel_payment",payment["id"],{"refundId":refund_id,"amount":payload.amount,"reason":payload.reason,"cashSessionId":session["id"]})
        result = hotel_account(conn,reservation_id)
        conn.commit()
        return result


@router.get("/api/hotel/reports/income")
def hotel_income_report(start: date, end: date):
    if not has_permission("hotel.view") or not has_permission("reports.view"):
        raise HTTPException(403, "Necesitas permisos de hotel y reportes.")
    if end < start or (end-start).days > 365:
        raise HTTPException(422, "Selecciona un periodo de hasta 366 días.")
    transactions = []
    with connection() as conn:
        for table,kind in [("hotel_payments","payment"),("hotel_refunds","refund")]:
            rows = conn.execute(f"SELECT p.*,r.guest_name,h.room_number FROM {table} p JOIN hotel_reservations r ON r.id=p.reservation_id JOIN hotel_rooms h ON h.id=r.room_id WHERE p.business_id=? AND date(p.created_at,'-5 hours')>=? AND date(p.created_at,'-5 hours')<=? ORDER BY p.created_at,p.id", (current_business_id(),start.isoformat(),end.isoformat())).fetchall()
            transactions.extend({"id":row["id"],"reservationId":row["reservation_id"],"guestName":row["guest_name"],"roomNumber":row["room_number"],"kind":kind,"method":row["method"],"amount":row["amount"],"createdAt":timestamp_iso(row["created_at"]),"reference":row["reason"] if kind=="refund" else row["reference"]} for row in rows)
    methods = []
    for method in ["cash","card","transfer","digital"]:
        gross = round(sum(row["amount"] for row in transactions if row["method"]==method and row["kind"]=="payment"),2)
        refunded = round(sum(row["amount"] for row in transactions if row["method"]==method and row["kind"]=="refund"),2)
        methods.append({"method":method,"gross":gross,"refunded":refunded,"net":round(gross-refunded,2)})
    gross = round(sum(row["gross"] for row in methods),2)
    refunded = round(sum(row["refunded"] for row in methods),2)
    return {"start":start.isoformat(),"end":end.isoformat(),"gross":gross,"refunded":refunded,"net":round(gross-refunded,2),"methods":methods,"transactions":sorted(transactions,key=lambda row:(row["createdAt"],row["id"]),reverse=True)}
