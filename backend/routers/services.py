from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Query

from backend.core.context import current_business_id, current_identity
from backend.core.db import audit, connection, timestamp_iso
from backend.schemas import AppointmentPayload, AppointmentStatusPayload, ProfessionalPayload, ServicePayload


router = APIRouter()


def service_out(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "nombre": row["name"], "name": row["name"], "duracion": row["duration_minutes"],
            "durationMinutes": row["duration_minutes"], "precio": row["price"], "price": row["price"], "categoria": row["category"],
            "category": row["category"], "color": row["color"], "active": bool(row["active"])}


def professional_out(row: sqlite3.Row) -> dict:
    try:
        availability = json.loads(row["availability_json"] or "[]")
    except json.JSONDecodeError:
        availability = []
    return {"id": row["id"], "nombre": row["name"], "name": row["name"], "especialidad": row["specialty"],
            "bufferMinutes": row["buffer_minutes"], "daysOff": json.loads(row["days_off_json"] or "[]"), "scheduleRevision": row["schedule_revision"],
            "specialty": row["specialty"], "color": row["color"], "horario": availability, "availability": availability,
            "active": bool(row["active"])}


def outside_schedule(professional: sqlite3.Row, start_dt: datetime, end_time: str) -> bool:
    """True when the professional has a schedule and [start, end] fits in no block of that day.

    `dia` follows JavaScript getDay() (0=domingo, 1=lunes), as the agenda saves it.
    A professional without schedule stays unrestricted, as before.
    """
    blocks = professional_out(professional)["availability"]
    if not blocks:
        return False
    day, start = start_dt.isoweekday() % 7, start_dt.strftime("%H:%M")
    return not any(isinstance(b, dict) and b.get("dia") == day and str(b.get("inicio", "")) <= start and end_time <= str(b.get("fin", ""))
                   for b in blocks)


def appointment_out(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "clienteId": row["client_id"] if "client_id" in row.keys() else None,
            "clienteNombre": row["client_name"], "clienteTelefono": row["client_phone"], "clienteEmail": row["client_email"],
            "servicioId": row["service_id"], "servicioNombre": row["service_name_snapshot"],
            "profesionalId": row["professional_id"], "profesionalNombre": row["professional_name_snapshot"],
            "fecha": row["appointment_date"], "horaInicio": row["start_time"], "horaFin": row["end_time"],
            "estado": row["status"], "notes": row["notes"], "durationMinutes": row["duration_minutes"],
            "saleId": row["sale_id"], "price": row["price_snapshot"], "createdAt": timestamp_iso(row["created_at"])}


@router.get("/api/services/catalog")
def list_services_catalog():
    with connection() as conn:
        rows = conn.execute("SELECT * FROM service_catalog WHERE business_id=? AND active=1 ORDER BY name COLLATE NOCASE", (current_business_id(),)).fetchall()
        return [service_out(row) for row in rows]


@router.post("/api/services/catalog", status_code=201)
def create_service_catalog_item(payload: ServicePayload):
    if current_identity()["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede administrar los servicios.")
    business_id = current_business_id()
    service_id = f"SVC-{uuid.uuid4().hex[:12].upper()}"
    with connection() as conn:
        try:
            conn.execute("INSERT INTO service_catalog (id,business_id,name,duration_minutes,price,category,color,active) VALUES (?,?,?,?,?,?,?,1)", (service_id,business_id,payload.name.strip(),payload.durationMinutes,payload.price,payload.category.strip(),payload.color))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Ya existe un servicio con ese nombre.") from exc
        audit(conn, "create", "service", service_id, {"name": payload.name})
        row = conn.execute("SELECT * FROM service_catalog WHERE id=? AND business_id=?", (service_id,business_id)).fetchone()
        return service_out(row)


@router.get("/api/services/professionals")
def list_service_professionals():
    with connection() as conn:
        rows = conn.execute("SELECT * FROM service_professionals WHERE business_id=? AND active=1 ORDER BY name COLLATE NOCASE", (current_business_id(),)).fetchall()
        return [professional_out(row) for row in rows]


@router.post("/api/services/professionals", status_code=201)
def create_service_professional(payload: ProfessionalPayload):
    if current_identity()["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede administrar profesionales.")
    business_id = current_business_id()
    professional_id = f"PRO-{uuid.uuid4().hex[:12].upper()}"
    with connection() as conn:
        try:
            conn.execute("INSERT INTO service_professionals (id,business_id,name,specialty,color,availability_json,active) VALUES (?,?,?,?,?,?,1)", (professional_id,business_id,payload.name.strip(),payload.specialty.strip(),payload.color,json.dumps(payload.availability,ensure_ascii=False)))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Ya existe un profesional con ese nombre.") from exc
        audit(conn, "create", "service_professional", professional_id, {"name": payload.name})
        row = conn.execute("SELECT * FROM service_professionals WHERE id=? AND business_id=?", (professional_id,business_id)).fetchone()
        return professional_out(row)


@router.get("/api/services/appointments")
def list_service_appointments(date_from: str | None = Query(default=None, alias="from"), date_to: str | None = Query(default=None, alias="to")):
    business_id = current_business_id()
    query = "SELECT * FROM service_appointments WHERE business_id=?"
    params: list = [business_id]
    for date_value in (date_from, date_to):
        if date_value:
            try:
                datetime.strptime(date_value, "%Y-%m-%d")
            except ValueError as exc:
                raise HTTPException(422, "Los filtros de fecha deben usar AAAA-MM-DD.") from exc
    if date_from:
        query += " AND appointment_date>=?"
        params.append(date_from)
    if date_to:
        query += " AND appointment_date<=?"
        params.append(date_to)
    query += " ORDER BY appointment_date,start_time"
    with connection() as conn:
        return [appointment_out(row) for row in conn.execute(query,params).fetchall()]


@router.post("/api/services/appointments", status_code=201)
def create_service_appointment(payload: AppointmentPayload):
    identity = current_identity()
    if identity["role"] not in {"owner", "business_admin"} and "services.manage" not in set(identity.get("permissions", [])):
        custom_id = identity.get("custom_role_id")
        if not custom_id:
            raise HTTPException(403, "Tu rol no puede crear citas.")
        with connection() as conn:
            role = conn.execute("SELECT permissions_json FROM custom_roles WHERE id=? AND business_id=?", (custom_id,current_business_id())).fetchone()
        if not role or "services.manage" not in set(json.loads(role["permissions_json"] or "[]")):
            raise HTTPException(403, "Tu rol no puede crear citas.")
    business_id = current_business_id()
    appointment_id = f"APT-{uuid.uuid4().hex[:12].upper()}"
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        service = conn.execute("SELECT * FROM service_catalog WHERE id=? AND business_id=? AND active=1", (payload.serviceId,business_id)).fetchone()
        professional = conn.execute("SELECT * FROM service_professionals WHERE id=? AND business_id=? AND active=1", (payload.professionalId,business_id)).fetchone()
        if not service or not professional:
            conn.rollback()
            raise HTTPException(404, "Selecciona un servicio y un profesional activos de este negocio.")
        start_dt = datetime.strptime(f"{payload.appointmentDate} {payload.startTime}", "%Y-%m-%d %H:%M")
        end_dt = start_dt + timedelta(minutes=service["duration_minutes"])
        end_time = end_dt.strftime("%H:%M")
        if end_dt.date().isoformat() != payload.appointmentDate:
            conn.rollback()
            raise HTTPException(422, "La cita no puede terminar después de la medianoche.")
        from backend.scheduling import check_slot
        check_slot(conn, professional, start_dt, end_dt, "")
        conflict = conn.execute("SELECT id FROM service_appointments WHERE business_id=? AND professional_id=? AND appointment_date=? AND status IN ('reserved','confirmed') AND start_time<? AND end_time>? LIMIT 1", (business_id,payload.professionalId,payload.appointmentDate,end_time,payload.startTime)).fetchone()
        if conflict:
            conn.rollback()
            raise HTTPException(409, "El profesional ya tiene una cita en ese horario.")
        conn.execute("INSERT INTO service_appointments (id,business_id,service_id,professional_id,client_name,client_email,client_phone,service_name_snapshot,professional_name_snapshot,duration_minutes,price_snapshot,appointment_date,start_time,end_time,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     (appointment_id,business_id,service["id"],professional["id"],payload.clientName,payload.clientEmail.strip(),payload.clientPhone.strip(),service["name"],professional["name"],service["duration_minutes"],service["price"],payload.appointmentDate,payload.startTime,end_time,"reserved",payload.notes.strip()))
        audit(conn, "create", "service_appointment", appointment_id, {"serviceId": service["id"], "professionalId": professional["id"]})
        row = conn.execute("SELECT * FROM service_appointments WHERE id=? AND business_id=?",(appointment_id,business_id)).fetchone()
        conn.commit()
        return appointment_out(row)


@router.patch("/api/services/appointments/{appointment_id}/status")
def update_service_appointment_status(appointment_id: str, payload: AppointmentStatusPayload):
    identity = current_identity()
    if identity["role"] not in {"owner", "business_admin"} and "services.manage" not in set(identity.get("permissions", [])):
        custom_id = identity.get("custom_role_id")
        if not custom_id:
            raise HTTPException(403, "Tu rol no puede actualizar citas.")
        with connection() as conn:
            role = conn.execute("SELECT permissions_json FROM custom_roles WHERE id=? AND business_id=?", (custom_id,current_business_id())).fetchone()
        if not role or "services.manage" not in set(json.loads(role["permissions_json"] or "[]")):
            raise HTTPException(403, "Tu rol no puede actualizar citas.")
    business_id = current_business_id()
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        current = conn.execute("SELECT * FROM service_appointments WHERE id=? AND business_id=?", (appointment_id, business_id)).fetchone()
        if current and current["sale_id"] and payload.status != 'attended':
            raise HTTPException(409, "La cita ya fue cobrada. Conserva el estado y usa su comprobante.")
        # Only a cancelled/no-show appointment coming back takes a slot again; confirming an active one must not
        # fail because the break or the schedule changed after it was booked.
        if current and payload.status in {'reserved', 'confirmed'} and current['status'] in {'cancelled', 'no_show'}:
            professional = conn.execute("SELECT * FROM service_professionals WHERE id=? AND business_id=?", (current['professional_id'], business_id)).fetchone()
            from backend.scheduling import check_slot
            check_slot(conn, professional, datetime.fromisoformat(current['appointment_date'] + 'T' + current['start_time']), datetime.fromisoformat(current['appointment_date'] + 'T' + current['end_time']), appointment_id)
        cursor = conn.execute("UPDATE service_appointments SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=?", (payload.status,appointment_id,business_id))
        if cursor.rowcount == 0:
            raise HTTPException(404, "Cita no encontrada.")
        audit(conn, payload.status, "service_appointment", appointment_id, {"status": payload.status})
        row = conn.execute("SELECT * FROM service_appointments WHERE id=? AND business_id=?",(appointment_id,business_id)).fetchone()
        conn.commit()
        return appointment_out(row)


@router.put("/api/services/appointments/{appointment_id}")
def edit_service_appointment(appointment_id: str, payload: AppointmentPayload):
    identity = current_identity()
    business_id = current_business_id()
    if identity["role"] not in {"owner", "business_admin"}:
        custom_id = identity.get("custom_role_id")
        if not custom_id:
            raise HTTPException(403, "Tu rol no puede editar citas.")
        with connection() as conn:
            role = conn.execute("SELECT permissions_json FROM custom_roles WHERE id=? AND business_id=?", (custom_id, business_id)).fetchone()
        if not role or "services.manage" not in set(json.loads(role["permissions_json"] or "[]")):
            raise HTTPException(403, "Tu rol no puede editar citas.")
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        paid = conn.execute("SELECT sale_id FROM service_appointments WHERE id=? AND business_id=?", (appointment_id, business_id)).fetchone()
        if paid and paid['sale_id']:
            raise HTTPException(409, "No se puede modificar ni eliminar una cita cobrada.")
        existing = conn.execute("SELECT * FROM service_appointments WHERE id=? AND business_id=?", (appointment_id, business_id)).fetchone()
        service = conn.execute("SELECT * FROM service_catalog WHERE id=? AND business_id=? AND active=1", (payload.serviceId, business_id)).fetchone()
        professional = conn.execute("SELECT * FROM service_professionals WHERE id=? AND business_id=? AND active=1", (payload.professionalId, business_id)).fetchone()
        if not existing:
            conn.rollback(); raise HTTPException(404, "Cita no encontrada.")
        if not service or not professional:
            conn.rollback(); raise HTTPException(404, "Selecciona un servicio y un profesional activos de este negocio.")
        start_dt = datetime.strptime(f"{payload.appointmentDate} {payload.startTime}", "%Y-%m-%d %H:%M")
        same_service = existing["service_id"] == service["id"]
        duration = existing["duration_minutes"] if same_service else service["duration_minutes"]
        price = existing["price_snapshot"] if same_service else service["price"]
        end_dt = start_dt + timedelta(minutes=duration)
        end_time = end_dt.strftime("%H:%M")
        if end_dt.date().isoformat() != payload.appointmentDate:
            conn.rollback(); raise HTTPException(422, "La cita no puede terminar después de la medianoche.")
        from backend.scheduling import check_slot
        check_slot(conn, professional, start_dt, end_dt, appointment_id)
        conflict = conn.execute("SELECT id FROM service_appointments WHERE business_id=? AND professional_id=? AND appointment_date=? AND status IN ('reserved','confirmed') AND id<>? AND start_time<? AND end_time>? LIMIT 1", (business_id, payload.professionalId, payload.appointmentDate, appointment_id, end_time, payload.startTime)).fetchone()
        if conflict:
            conn.rollback(); raise HTTPException(409, "El profesional ya tiene una cita en ese horario.")
        conn.execute("UPDATE service_appointments SET service_id=?,professional_id=?,client_name=?,client_email=?,client_phone=?,service_name_snapshot=?,professional_name_snapshot=?,duration_minutes=?,price_snapshot=?,appointment_date=?,start_time=?,end_time=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=?", (service["id"], professional["id"], payload.clientName, payload.clientEmail.strip(), payload.clientPhone.strip(), service["name"], professional["name"], duration, price, payload.appointmentDate, payload.startTime, end_time, payload.notes.strip(), appointment_id, business_id))
        audit(conn, "edit", "service_appointment", appointment_id, {"serviceId": service["id"], "professionalId": professional["id"], "date": payload.appointmentDate, "startTime": payload.startTime})
        row = conn.execute("SELECT * FROM service_appointments WHERE id=? AND business_id=?", (appointment_id, business_id)).fetchone()
        conn.commit()
        return appointment_out(row)


@router.delete("/api/services/appointments/{appointment_id}", status_code=204)
def delete_service_appointment(appointment_id: str):
    identity = current_identity()
    business_id = current_business_id()
    if identity["role"] not in {"owner", "business_admin"}:
        custom_id = identity.get("custom_role_id")
        if not custom_id:
            raise HTTPException(403, "Tu rol no puede eliminar citas.")
        with connection() as conn:
            role = conn.execute("SELECT permissions_json FROM custom_roles WHERE id=? AND business_id=?", (custom_id, business_id)).fetchone()
        if not role or "services.manage" not in set(json.loads(role["permissions_json"] or "[]")):
            raise HTTPException(403, "Tu rol no puede eliminar citas.")
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        paid = conn.execute("SELECT sale_id FROM service_appointments WHERE id=? AND business_id=?", (appointment_id, business_id)).fetchone()
        if paid and paid['sale_id']:
            raise HTTPException(409, "No se puede modificar ni eliminar una cita cobrada.")
        row = conn.execute("SELECT id FROM service_appointments WHERE id=? AND business_id=?", (appointment_id, business_id)).fetchone()
        if not row:
            raise HTTPException(404, "Cita no encontrada.")
        conn.execute("DELETE FROM service_appointments WHERE id=? AND business_id=?", (appointment_id, business_id))
        audit(conn, "delete", "service_appointment", appointment_id, {})
        conn.commit()
    return None
