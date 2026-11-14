import type { ServiceProfessionalRecord, ServiceAppointmentRecord } from '../services/dataService';
export interface ProfessionalSchedule {
  availability: { dia: number; inicio: string; fin: string }[];
  daysOff: string[];
  bufferMinutes: number;
  revision: number;
}
export function validateSchedule(schedule: ProfessionalSchedule) {
  if (!Number.isInteger(schedule.bufferMinutes) || schedule.bufferMinutes < 0 || schedule.bufferMinutes > 120)
    throw new Error('El tiempo de preparación debe estar entre 0 y 120 minutos.');
  if (
    schedule.daysOff.some(
      d => !/^\d{4}-\d{2}-\d{2}$/.test(d) || new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) !== d,
    )
  )
    throw new Error('Revisa las fechas de descanso.');
  schedule.availability.forEach((p, index) => {
    if (
      !Number.isInteger(p.dia) ||
      p.dia < 0 ||
      p.dia > 6 ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.inicio) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.fin) ||
      p.inicio >= p.fin
    )
      throw new Error('Revisa el día, inicio y fin de cada jornada.');
    if (
      schedule.availability
        .slice(0, index)
        .some(other => other.dia === p.dia && other.inicio < p.fin && other.fin > p.inicio)
    )
      throw new Error('Las franjas del mismo día no pueden cruzarse.');
  });
}
export function checkLocalServiceSlot(
  professional: ServiceProfessionalRecord,
  appointments: ServiceAppointmentRecord[],
  day: string,
  start: string,
  duration: number,
  excludeId = '',
) {
  const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) throw new Error('Hora inválida.');
  const begin = minute(start),
    end = begin + duration + (professional.bufferMinutes || 0);
  if (end >= 1440) throw new Error('La cita y su preparación deben terminar el mismo día.');
  if (professional.daysOff?.includes(day)) throw new Error('El profesional no trabaja en esa fecha.');
  const periods = professional.availability || [];
  const weekday = new Date(day + 'T12:00:00').getDay();
  if (
    periods.length &&
    !periods.some(p => p.dia === weekday && minute(p.inicio || '') <= begin && minute(p.fin || '') >= end)
  )
    throw new Error('La cita queda fuera de la jornada o invade un descanso.');
  if (
    appointments.some(
      a =>
        a.id !== excludeId &&
        a.profesionalId === professional.id &&
        a.fecha === day &&
        ['reserved', 'confirmed', 'attended'].includes(a.estado) &&
        begin < minute(a.horaFin) + (professional.bufferMinutes || 0) &&
        end > minute(a.horaInicio),
    )
  )
    throw new Error('La cita se cruza con otra cita o con su preparación.');
}
