import { useState } from 'react';
import { saveProfessionalSchedule, type ServiceProfessionalRecord } from '../services/dataService';
import { type ProfessionalSchedule, validateSchedule } from '../utils/serviceSchedule';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { toastError } from '../utils/notifications';
import { toast } from 'sonner';
const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export function ProfessionalScheduleDialog({
  professional,
  onClose,
  onSaved,
}: {
  professional: ServiceProfessionalRecord;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [schedule, setSchedule] = useState<ProfessionalSchedule>({
    availability: professional.availability.map(p => ({
      dia: p.dia ?? 1,
      inicio: p.inicio ?? '09:00',
      fin: p.fin ?? '18:00',
    })),
    daysOff: professional.daysOff || [],
    bufferMinutes: professional.bufferMinutes || 0,
    revision: professional.scheduleRevision || 1,
  });
  const [dates, setDates] = useState((professional.daysOff || []).join('\n'));
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Horario de {professional.name}</DialogTitle>
          <DialogDescription>
            Agrega dos franjas en un día para dejar un descanso entre ellas. Las citas ya reservadas se conservan; las
            nuevas y reprogramadas respetarán estas reglas.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async e => {
            e.preventDefault();
            setBusy(true);
            try {
              const input = { ...schedule, daysOff: dates.split(/[\s,]+/).filter(Boolean) };
              validateSchedule(input);
              await saveProfessionalSchedule(professional.id, input);
              toast.success('Horario guardado.');
              await onSaved();
              onClose();
            } catch (err) {
              toastError(err, 'No se pudo guardar el horario.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {schedule.availability.map((p, index) => (
            <div key={index} className="border rounded-lg p-3 space-y-2">
              <label className="block text-sm">
                Día
                <select
                  className="block border bg-background rounded-md p-2 w-full min-h-11"
                  value={p.dia}
                  onChange={e =>
                    setSchedule(s => ({
                      ...s,
                      availability: s.availability.map((v, i) =>
                        i === index ? { ...v, dia: Number(e.target.value) } : v,
                      ),
                    }))
                  }
                >
                  {days.map((day, i) => (
                    <option value={i} key={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                {(['inicio', 'fin'] as const).map(key => (
                  <label key={key} className="text-sm">
                    {key === 'inicio' ? 'Desde' : 'Hasta'}
                    <Input
                      type="time"
                      required
                      value={p[key]}
                      onChange={e =>
                        setSchedule(s => ({
                          ...s,
                          availability: s.availability.map((v, i) =>
                            i === index ? { ...v, [key]: e.target.value } : v,
                          ),
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSchedule(s => ({ ...s, availability: s.availability.filter((_, i) => i !== index) }))}
              >
                Quitar franja
              </Button>
            </div>
          ))}
          {!schedule.availability.length && (
            <p className="text-sm text-amber-700">
              Sin franjas configuradas, se permite reservar en cualquier día y hora que esté libre.
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setSchedule(s => ({ ...s, availability: [...s.availability, { dia: 1, inicio: '09:00', fin: '18:00' }] }))
            }
          >
            Agregar franja
          </Button>
          <label className="block text-sm">
            Preparación después de cada cita (minutos)
            <Input
              type="number"
              min="0"
              max="120"
              required
              value={schedule.bufferMinutes}
              onChange={e => setSchedule(s => ({ ...s, bufferMinutes: Number(e.target.value) }))}
            />
          </label>
          <label className="block text-sm">
            Fechas sin atención, una por línea (AAAA-MM-DD)
            <textarea
              className="block border bg-background rounded-md w-full p-2 mt-1"
              rows={3}
              value={dates}
              onChange={e => setDates(e.target.value)}
              placeholder="2026-12-25"
            />
          </label>
          <Button className="w-full min-h-11" disabled={busy} type="submit">
            Guardar horario
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
