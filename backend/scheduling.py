import json
from datetime import date, datetime, timedelta
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator
from . import main as core

router = APIRouter(prefix='/api/services/professionals')


class Period(BaseModel):
    dia: int = Field(ge=0, le=6)
    inicio: str = Field(pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    fin: str = Field(pattern=r'^([01]\d|2[0-3]):[0-5]\d$')


class Schedule(BaseModel):
    availability: list[Period] = Field(default_factory=list, max_length=50)
    daysOff: list[date] = Field(default_factory=list, max_length=366)
    bufferMinutes: int = Field(default=0, ge=0, le=120)
    revision: int = Field(default=1, ge=1)

    @model_validator(mode='after')
    def valid_intervals(self):
        by_day = {}
        for period in self.availability:
            if period.fin <= period.inicio:
                raise ValueError('La jornada debe terminar después de su inicio.')
            for start, end in by_day.get(period.dia, []):
                if period.inicio < end and period.fin > start:
                    raise ValueError('Las franjas del mismo día no pueden cruzarse.')
            by_day.setdefault(period.dia, []).append((period.inicio, period.fin))
        return self


class AppointmentMove(BaseModel):
    professionalId: str
    appointmentDate: date
    startTime: str = Field(pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    expectedProfessionalId: str
    expectedDate: date
    expectedStartTime: str
    expectedEndTime: str


appointment_router = APIRouter(prefix='/api/services/appointments')


@appointment_router.patch('/{appointment_id}/schedule')
def move_appointment(appointment_id: str, payload: AppointmentMove):
    with core.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        old = conn.execute('SELECT * FROM service_appointments WHERE id=? AND business_id=?', (appointment_id, core.current_business_id())).fetchone()
        if not old:
            raise HTTPException(404, 'Cita no encontrada.')
        if old['sale_id'] or old['status'] not in {'reserved', 'confirmed'}:
            raise HTTPException(409, 'Solo puedes mover citas pendientes y sin cobrar.')
        if (old['professional_id'], old['appointment_date'], old['start_time']) == (payload.professionalId, str(payload.appointmentDate), payload.startTime):
            return core.appointment_out(old)
        if (old['professional_id'], old['appointment_date'], old['start_time'], old['end_time']) != (payload.expectedProfessionalId, str(payload.expectedDate), payload.expectedStartTime, payload.expectedEndTime):
            raise HTTPException(409, 'Otra persona cambió la cita. Actualiza la agenda antes de moverla.')
        professional = conn.execute('SELECT * FROM service_professionals WHERE id=? AND business_id=? AND active=1', (payload.professionalId, core.current_business_id())).fetchone()
        if not professional:
            raise HTTPException(404, 'Profesional no encontrado.')
        start = datetime.fromisoformat(str(payload.appointmentDate) + 'T' + payload.startTime)
        end = start + timedelta(minutes=old['duration_minutes'])
        check_slot(conn, professional, start, end, appointment_id)
        conn.execute('UPDATE service_appointments SET professional_id=?,professional_name_snapshot=?,appointment_date=?,start_time=?,end_time=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
                     (professional['id'], professional['name'], str(payload.appointmentDate), payload.startTime, end.strftime('%H:%M'), appointment_id))
        core.audit(conn, 'reschedule', 'service_appointment', appointment_id, {'date': str(payload.appointmentDate), 'startTime': payload.startTime, 'professionalId': professional['id']})
        conn.commit()
        return core.appointment_out(conn.execute('SELECT * FROM service_appointments WHERE id=?', (appointment_id,)).fetchone())


def check_slot(conn, professional, start: datetime, end: datetime, exclude_id=''):
    buffer = timedelta(minutes=professional['buffer_minutes'])
    occupied_end = end + buffer
    if end.date() != start.date() or occupied_end.date() != start.date():
        raise HTTPException(422, 'La cita y su tiempo de preparación deben terminar el mismo día.')
    day = start.date().isoformat()
    if day in json.loads(professional['days_off_json'] or '[]'):
        raise HTTPException(409, 'El profesional no trabaja en la fecha seleccionada.')
    periods = json.loads(professional['availability_json'] or '[]')
    if periods:
        weekday = (start.weekday() + 1) % 7  # Sunday=0, matching JS and existing stored schedules.
        if not any(p.get('dia') == weekday and p.get('inicio', '') <= start.strftime('%H:%M') and p.get('fin', '') >= occupied_end.strftime('%H:%M') for p in periods):
            raise HTTPException(422, 'La cita queda fuera de la jornada o invade un descanso del profesional.')
    appointments = conn.execute("SELECT * FROM service_appointments WHERE professional_id=? AND business_id=? AND appointment_date=? AND status IN ('reserved','confirmed','attended') AND id<>?", (professional['id'], core.current_business_id(), day, exclude_id)).fetchall()
    for appointment in appointments:
        existing_start = datetime.fromisoformat(day + 'T' + appointment['start_time'])
        existing_end = datetime.fromisoformat(day + 'T' + appointment['end_time']) + buffer
        if start < existing_end and occupied_end > existing_start:
            raise HTTPException(409, 'La cita se cruza con otra cita o con su tiempo de preparación.')


@router.put('/{professional_id}/schedule')
def save_schedule(professional_id: str, payload: Schedule):
    with core.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        professional = conn.execute('SELECT * FROM service_professionals WHERE id=? AND business_id=? AND active=1', (professional_id, core.current_business_id())).fetchone()
        if not professional:
            raise HTTPException(404, 'Profesional no encontrado.')
        if professional['schedule_revision'] != payload.revision:
            raise HTTPException(409, 'El horario cambió. Actualiza antes de guardarlo.')
        conn.execute('UPDATE service_professionals SET availability_json=?,days_off_json=?,buffer_minutes=?,schedule_revision=schedule_revision+1 WHERE id=?',
                     (json.dumps([p.model_dump() for p in payload.availability]), json.dumps(sorted({d.isoformat() for d in payload.daysOff})), payload.bufferMinutes, professional_id))
        core.audit(conn, 'schedule', 'professional', professional_id, {'periods': len(payload.availability), 'bufferMinutes': payload.bufferMinutes})
        conn.commit()
        return core.professional_out(conn.execute('SELECT * FROM service_professionals WHERE id=?', (professional_id,)).fetchone())
