from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from . import main as core
from .returns import ReturnSelection, ReturnPayload, quote_return, create_return

router = APIRouter(prefix='/api/services/appointments')


class CheckoutPayload(BaseModel):
    idempotencyKey: str = Field(min_length=8, max_length=100)
    cashSessionId: str
    items: list[core.SaleItemPayload] = Field(default_factory=list, max_length=100)
    payments: list[core.PaymentPartPayload] = Field(min_length=1, max_length=4)
    globalDiscountPercent: float = Field(default=0, ge=0, le=100, allow_inf_nan=False)
    customerId: str | None = None


@router.post('/{appointment_id}/checkout', status_code=201)
def checkout(appointment_id: str, payload: CheckoutPayload):
    if not core.has_permission('cash.manage'):
        raise HTTPException(403, 'Necesitas permiso de caja para cobrar la cita.')
    return core.create_sale(core.SalePayload(**payload.model_dump(), appointmentId=appointment_id,
                                           paymentMethod=payload.payments[0].method if len(payload.payments) == 1 else 'split'))


@router.get('/{appointment_id}/receipt')
def receipt(appointment_id: str):
    with core.connection() as conn:
        row = conn.execute('SELECT sale_id FROM service_appointments WHERE id=? AND business_id=?', (appointment_id, core.current_business_id())).fetchone()
        if not row:
            raise HTTPException(404, 'Cita no encontrada.')
        return core.get_sale(conn, row['sale_id']) if row['sale_id'] else None


def sale_for_appointment(appointment_id):
    with core.connection() as conn:
        row = conn.execute('SELECT sale_id FROM service_appointments WHERE id=? AND business_id=?', (appointment_id, core.current_business_id())).fetchone()
        if not row or not row['sale_id']:
            raise HTTPException(404, 'La cita no tiene una venta vinculada.')
        return row['sale_id']


@router.post('/{appointment_id}/returns/quote')
def quote_appointment_return(appointment_id: str, payload: ReturnSelection):
    return quote_return(sale_for_appointment(appointment_id), payload)


@router.post('/{appointment_id}/returns', status_code=201)
def return_appointment(appointment_id: str, payload: ReturnPayload):
    return create_return(sale_for_appointment(appointment_id), payload)
