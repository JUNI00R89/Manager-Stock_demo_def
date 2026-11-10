from __future__ import annotations

import sqlite3

from backend.core.db import timestamp_iso


def cash_session_out(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    cash_sales = conn.execute("""SELECT COALESCE(SUM(CASE
        WHEN EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id=s.id) THEN
          (SELECT COALESCE(SUM(sp2.amount),0) FROM sale_payments sp2 WHERE sp2.sale_id=s.id AND sp2.method='cash')
        WHEN s.payment_method='cash' THEN s.total ELSE 0 END),0)
        FROM sales s WHERE s.cash_session_id=? AND s.status='completed'""", (row["id"],)).fetchone()[0]
    hotel_cash = conn.execute("SELECT COALESCE(SUM(amount),0) FROM hotel_payments WHERE cash_session_id=? AND method='cash'", (row["id"],)).fetchone()[0]
    hotel_refunds = conn.execute("SELECT COALESCE(SUM(amount),0) FROM hotel_refunds WHERE cash_session_id=? AND method='cash'", (row["id"],)).fetchone()[0]
    expected = round(row["opening_amount"] + cash_sales + hotel_cash - hotel_refunds, 2)
    return {"id": row["id"], "openedBy": row["opened_by"], "openingAmount": row["opening_amount"],
            "closingAmount": row["closing_amount"], "expectedAmount": row["expected_amount"] if row["status"] == "closed" else expected,
            "difference": row["difference"], "status": row["status"], "openedAt": timestamp_iso(row["opened_at"]), "closedAt": timestamp_iso(row["closed_at"])}
