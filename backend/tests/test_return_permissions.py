"""Refunds need the 'sales.cancel' permission whether they start from a sale or from an appointment."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.core.middleware import required_permission_for_request  # noqa: E402


def run() -> None:
    for path in ("/api/sales/VTA-1/returns", "/api/sales/VTA-1/returns/quote",
                 "/api/services/appointments/CITA-1/returns", "/api/services/appointments/CITA-1/returns/quote"):
        assert required_permission_for_request(path, "POST") == "sales.cancel", path
    # Appointments themselves keep their own permission.
    assert required_permission_for_request("/api/services/appointments/CITA-1", "PUT") == "services.manage"
    print("OK: refunds from sales and appointments require sales.cancel.")


if __name__ == "__main__":
    run()
