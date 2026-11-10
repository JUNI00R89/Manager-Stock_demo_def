from __future__ import annotations

import sqlite3

from backend.core.db import timestamp_iso


def support_case_out(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    unread = conn.execute("SELECT COUNT(*) FROM support_messages WHERE case_id=? AND read_at IS NULL AND sender_role='owner'", (row["id"],)).fetchone()[0]
    return {"id": row["id"], "businessId": row["business_id"], "businessName": row["business_name"] if "business_name" in row.keys() else None,
        "reason": row["reason"], "description": row["description"], "status": row["status"], "createdAt": timestamp_iso(row["created_at"]),
        "updatedAt": timestamp_iso(row["updated_at"]), "unreadCount": int(unread or 0)}


def support_messages_out(conn: sqlite3.Connection, case_id: str, mark_read_for: str | None = None) -> list[dict]:
    if mark_read_for:
        conn.execute("UPDATE support_messages SET read_at=CURRENT_TIMESTAMP WHERE case_id=? AND sender_id<>? AND read_at IS NULL", (case_id, mark_read_for))
    rows = conn.execute("""SELECT m.id,m.sender_id,m.sender_role,m.message,m.created_at,m.read_at,u.full_name
        FROM support_messages m JOIN auth_users u ON u.id=m.sender_id WHERE m.case_id=? ORDER BY m.id""", (case_id,)).fetchall()
    return [{"id": r["id"], "senderId": r["sender_id"], "senderRole": r["sender_role"], "senderName": r["full_name"],
        "message": r["message"], "createdAt": timestamp_iso(r["created_at"]), "readAt": timestamp_iso(r["read_at"])} for r in rows]
