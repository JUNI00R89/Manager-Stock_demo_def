import { useRef } from 'react';
import { GripVertical } from 'lucide-react';
export function AppointmentMoveHandle({ label, onDrop }: { label: string; onDrop: (date: string, startTime: string, professionalId?: string) => void }) {
  const origin = useRef<{ x: number; y: number } | null>(null);
  return <button type="button" className="min-w-11 min-h-11 flex items-center justify-center border rounded-lg touch-none select-none cursor-grab active:cursor-grabbing" aria-label={`Mover cita de ${label}. También puedes usar Editar para elegir fecha y hora.`}
    onClick={e => e.stopPropagation()}
    onPointerDown={e => { e.stopPropagation(); if (e.button !== 0) return; origin.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerCancel={() => { origin.current = null; }}
    onPointerUp={e => {
      e.stopPropagation(); const start = origin.current; origin.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) < 10) return;
      const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-appointment-date]');
      if (cell?.dataset.appointmentDate && cell.dataset.appointmentTime) onDrop(cell.dataset.appointmentDate, cell.dataset.appointmentTime, cell.dataset.appointmentProfessional || undefined);
    }}><GripVertical size={18} /></button>;
}
