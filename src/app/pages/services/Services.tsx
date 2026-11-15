import { useAuth } from '../../context/AuthContext';
import { canPerformAction } from '../../security/permissions';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { CalendarPlus, Clock, Scissors, UserRound, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../utils/notifications';
import {
  createServiceAppointment,
  createServiceCatalogItem,
  createServiceProfessional,
  updateServiceCatalogItem,
  updateServiceProfessional,
  getServiceProfessionals,
  getServicesCatalog,
  type ServiceCatalogRecord,
  type ServiceProfessionalRecord,
} from '../../services/dataService';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function Services() {
  const { user } = useAuth();
  const canManage = canPerformAction(user, 'services.manage');
  const [services, setServices] = useState<ServiceCatalogRecord[]>([]);
  const [professionals, setProfessionals] = useState<ServiceProfessionalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [serviceForm, setServiceForm] = useState({
    name: '',
    durationMinutes: '30',
    price: '0',
    category: 'Servicios principales',
  });
  const [professionalForm, setProfessionalForm] = useState({ name: '', specialty: '' });
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [editingProfessionalId, setEditingProfessionalId] = useState<string | null>(null);
  const [appointment, setAppointment] = useState({
    serviceId: '',
    professionalId: '',
    clientName: '',
    clientPhone: '',
    appointmentDate: today(),
    startTime: '09:00',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [serviceRows, professionalRows] = await Promise.all([getServicesCatalog(), getServiceProfessionals()]);
      setServices(serviceRows);
      setProfessionals(professionalRows);
      setAppointment(current => ({
        ...current,
        serviceId: current.serviceId || serviceRows[0]?.id || '',
        professionalId: current.professionalId || professionalRows[0]?.id || '',
      }));
    } catch (error) {
      toastError(error, 'No se pudo cargar el módulo de servicios.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const submitService = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const serviceInput = {
      name: serviceForm.name.trim(),
      durationMinutes: Number(serviceForm.durationMinutes),
      price: Number(serviceForm.price),
      category: serviceForm.category.trim(),
    };
    if (editingServiceId) {
      try {
        await updateServiceCatalogItem(editingServiceId, {
          ...serviceInput,
          color: services.find(x => x.id === editingServiceId)?.color,
        });
        setEditingServiceId(null);
        setServiceForm({ name: '', durationMinutes: '30', price: '0', category: 'Servicios principales' });
        toast.success('Servicio actualizado.');
        await load();
      } catch (error) {
        toastError(error, 'No se pudo actualizar el servicio.');
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      await createServiceCatalogItem(serviceInput);
      setServiceForm({ name: '', durationMinutes: '30', price: '0', category: 'Servicios principales' });
      toast.success('Servicio creado.');
      await load();
    } catch (error) {
      toastError(error, 'No se pudo crear el servicio.');
    } finally {
      setSaving(false);
    }
  };
  const submitProfessional = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const professionalInput = { name: professionalForm.name.trim(), specialty: professionalForm.specialty.trim() };
    try {
      if (editingProfessionalId) {
        await updateServiceProfessional(editingProfessionalId, {
          ...professionalInput,
          color: professionals.find(x => x.id === editingProfessionalId)?.color,
        });
        setEditingProfessionalId(null);
        toast.success('Profesional actualizado.');
      } else {
        await createServiceProfessional(professionalInput);
        toast.success('Profesional creado.');
      }
      setProfessionalForm({ name: '', specialty: '' });
      await load();
    } catch (error) {
      toastError(
        error,
        editingProfessionalId ? 'No se pudo actualizar el profesional.' : 'No se pudo crear el profesional.',
      );
    } finally {
      setSaving(false);
    }
  };
  const submitAppointment = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await createServiceAppointment({
        ...appointment,
        clientName: appointment.clientName.trim(),
        clientPhone: appointment.clientPhone.trim(),
      });
      toast.success('Cita agendada correctamente.');
      setAppointment(current => ({ ...current, clientName: '', clientPhone: '', notes: '' }));
    } catch (error) {
      toastError(error, 'No se pudo agendar la cita. Revisa disponibilidad y permisos.');
    } finally {
      setSaving(false);
    }
  };

  const fieldClass = 'h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground';
  return (
    <Layout>
      <main className="mx-auto w-full max-w-7xl space-y-7">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[var(--brand-primary)]">
              Operación de servicios
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">Servicios y agendamiento</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Administra el catálogo, registra profesionales y crea nuevas citas. La agenda de citas queda separada para
              consultar y gestionar las reservas existentes.
            </p>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading} className="self-start rounded-xl">
            <RefreshCw size={15} className="mr-2" />
            Actualizar
          </Button>
        </header>
        <section className="grid gap-4 sm:grid-cols-2">
          <Card className="rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-[var(--brand-primary)]/10 p-3 text-[var(--brand-primary)]">
                <Scissors size={21} />
              </span>
              <div>
                <p className="text-sm text-muted-foreground">Servicios activos</p>
                <p className="text-2xl font-bold text-foreground">{services.length}</p>
              </div>
            </div>
          </Card>
          <Card className="rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-emerald-500/10 p-3 text-emerald-700">
                <UserRound size={21} />
              </span>
              <div>
                <p className="text-sm text-muted-foreground">Profesionales activos</p>
                <p className="text-2xl font-bold text-foreground">{professionals.length}</p>
              </div>
            </div>
          </Card>
        </section>
        {canManage && (
          <section className="grid items-start gap-6 xl:grid-cols-[1.1fr_.9fr]">
            <Card className="rounded-2xl p-5 sm:p-6">
              <div className="mb-5 flex items-center gap-3">
                <span className="rounded-xl bg-slate-100 p-3 text-slate-700">
                  <Plus size={20} />
                </span>
                <div>
                  <h2 className="text-lg font-bold text-foreground">
                    {editingServiceId ? 'Editar servicio' : 'Crear servicio'}
                  </h2>
                  <p className="text-sm text-muted-foreground">Define nombre, duración, precio y categoría.</p>
                </div>
              </div>
              <form onSubmit={submitService} className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm sm:col-span-2">
                  <span className="font-medium">Nombre</span>
                  <input
                    required
                    minLength={2}
                    maxLength={120}
                    className={fieldClass}
                    value={serviceForm.name}
                    onChange={e => setServiceForm({ ...serviceForm, name: e.target.value })}
                    placeholder="Ej. Corte de cabello"
                  />
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Duración (minutos)</span>
                  <input
                    required
                    type="number"
                    min="1"
                    max="1440"
                    step="1"
                    className={fieldClass}
                    value={serviceForm.durationMinutes}
                    onChange={e => setServiceForm({ ...serviceForm, durationMinutes: e.target.value })}
                  />
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Precio (COP)</span>
                  <input
                    required
                    type="number"
                    min="0"
                    step="100"
                    className={fieldClass}
                    value={serviceForm.price}
                    onChange={e => setServiceForm({ ...serviceForm, price: e.target.value })}
                  />
                </label>
                <label className="space-y-1.5 text-sm sm:col-span-2">
                  <span className="font-medium">Categoría</span>
                  <input
                    maxLength={80}
                    className={fieldClass}
                    value={serviceForm.category}
                    onChange={e => setServiceForm({ ...serviceForm, category: e.target.value })}
                  />
                </label>
                <div className="sm:col-span-2">
                  <Button
                    type="submit"
                    disabled={saving}
                    className="w-full rounded-xl bg-[var(--brand-primary)] text-white hover:opacity-90"
                  >
                    {saving ? 'Guardando…' : editingServiceId ? 'Guardar cambios' : 'Guardar servicio'}
                  </Button>
                </div>
              </form>
            </Card>
            <Card className="rounded-2xl p-5 sm:p-6">
              <div className="mb-5 flex items-center gap-3">
                <span className="rounded-xl bg-emerald-50 p-3 text-emerald-700">
                  <UserRound size={20} />
                </span>
                <div>
                  <h2 className="text-lg font-bold text-foreground">Registrar profesional</h2>
                  <p className="text-sm text-muted-foreground">Asigna una persona a la agenda del negocio.</p>
                </div>
              </div>
              <form onSubmit={submitProfessional} className="space-y-3">
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium">Nombre completo</span>
                  <input
                    required
                    minLength={2}
                    maxLength={120}
                    className={fieldClass}
                    value={professionalForm.name}
                    onChange={e => setProfessionalForm({ ...professionalForm, name: e.target.value })}
                    placeholder="Nombre del profesional"
                  />
                </label>
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium">Especialidad</span>
                  <input
                    maxLength={120}
                    className={fieldClass}
                    value={professionalForm.specialty}
                    onChange={e => setProfessionalForm({ ...professionalForm, specialty: e.target.value })}
                    placeholder="Ej. Barbería, estética, mantenimiento"
                  />
                </label>
                <Button type="submit" disabled={saving} variant="outline" className="w-full rounded-xl">
                  {editingProfessionalId ? 'Guardar cambios' : 'Guardar profesional'}
                </Button>
                {professionals.length > 0 && (
                  <ul className="space-y-1 border-t border-border pt-3 text-sm">
                    {professionals.map(p => (
                      <li key={p.id} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">
                          {p.nombre}
                          {p.especialidad ? ` · ${p.especialidad}` : ''}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setEditingProfessionalId(p.id);
                            setProfessionalForm({ name: p.nombre, specialty: p.especialidad || '' });
                          }}
                        >
                          Editar
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </form>
            </Card>
          </section>
        )}
        <section className="grid items-start gap-6 xl:grid-cols-[.9fr_1.1fr]">
          <Card style={{ display: canManage ? undefined : 'none' }} className="rounded-2xl p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-3">
              <span className="rounded-xl bg-amber-50 p-3 text-amber-700">
                <CalendarPlus size={20} />
              </span>
              <div>
                <h2 className="text-lg font-bold text-foreground">Agendar una cita</h2>
                <p className="text-sm text-muted-foreground">Las citas creadas aquí aparecerán en la agenda.</p>
              </div>
            </div>
            <form onSubmit={submitAppointment} className="space-y-3">
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Servicio</span>
                <select
                  required
                  className={`${fieldClass} ${appointment.serviceId ? 'ring-2 ring-[#5EEAD4]/60 border-[#5EEAD4]/60 shadow-[0_0_0_1px_rgba(94,234,212,0.4),0_8px_32px_rgba(15,40,80,0.15)] backdrop-blur-[12px] bg-white/10 dark:bg-white/5' : ''}`}
                  value={appointment.serviceId}
                  onChange={e => setAppointment({ ...appointment, serviceId: e.target.value })}
                >
                  <option value="">Selecciona servicio</option>
                  {services.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.nombre} · {s.duracion} min
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Profesional</span>
                <select
                  required
                  className={fieldClass}
                  value={appointment.professionalId}
                  onChange={e => setAppointment({ ...appointment, professionalId: e.target.value })}
                >
                  <option value="">Selecciona profesional</option>
                  {professionals.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} {p.especialidad ? `· ${p.especialidad}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Cliente</span>
                <input
                  required
                  minLength={2}
                  maxLength={120}
                  className={fieldClass}
                  value={appointment.clientName}
                  onChange={e => setAppointment({ ...appointment, clientName: e.target.value })}
                  placeholder="Nombre del cliente"
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Teléfono (opcional)</span>
                <input
                  type="tel"
                  maxLength={40}
                  className={fieldClass}
                  value={appointment.clientPhone}
                  onChange={e => setAppointment({ ...appointment, clientPhone: e.target.value })}
                  placeholder="Teléfono de contacto"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Fecha</span>
                  <input
                    required
                    type="date"
                    min={today()}
                    className={fieldClass}
                    value={appointment.appointmentDate}
                    onChange={e => setAppointment({ ...appointment, appointmentDate: e.target.value })}
                  />
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Hora</span>
                  <input
                    required
                    type="time"
                    step="900"
                    className={fieldClass}
                    value={appointment.startTime}
                    onChange={e => setAppointment({ ...appointment, startTime: e.target.value })}
                  />
                </label>
              </div>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Observaciones</span>
                <textarea
                  maxLength={1000}
                  rows={2}
                  className="w-full rounded-xl border border-border bg-background p-3 text-sm"
                  value={appointment.notes}
                  onChange={e => setAppointment({ ...appointment, notes: e.target.value })}
                />
              </label>
              <Button
                type="submit"
                disabled={saving || !services.length || !professionals.length}
                className="w-full rounded-xl bg-[var(--brand-primary)] text-white hover:opacity-90"
              >
                {saving ? 'Agendando…' : 'Confirmar y agendar cita'}
              </Button>
              <p className="text-xs leading-5 text-muted-foreground">
                El backend valida que el servicio y el profesional pertenezcan a este negocio y rechaza solapamientos de
                horario.
              </p>
            </form>
          </Card>
          <Card className="rounded-2xl p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-foreground">Catálogo de servicios</h2>
                <p className="text-sm text-muted-foreground">Servicios disponibles para agendar.</p>
              </div>
              <Badge>{services.length} servicios</Badge>
            </div>
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Cargando servicios…</p>
            ) : services.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {services.map(service => (
                  <article key={service.id} className="rounded-xl border border-border p-4 transition hover:shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className="rounded-lg p-2"
                        style={{ backgroundColor: `${service.color}18`, color: service.color }}
                      >
                        <Scissors size={18} />
                      </span>
                      <span className="flex items-center gap-1">
                        <Badge variant="secondary">{service.categoria}</Badge>
                        {canManage && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              setEditingServiceId(service.id);
                              setServiceForm({
                                name: service.nombre,
                                durationMinutes: String(service.duracion),
                                price: String(service.precio),
                                category: service.categoria,
                              });
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                          >
                            Editar
                          </Button>
                        )}
                      </span>
                    </div>
                    <h3 className="mt-3 font-semibold text-foreground">{service.nombre}</h3>
                    <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock size={14} />
                        {service.duracion} min
                      </span>
                      <strong className="text-foreground">
                        {new Intl.NumberFormat('es-CO', {
                          style: 'currency',
                          currency: 'COP',
                          maximumFractionDigits: 0,
                        }).format(service.precio)}
                      </strong>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Todavía no hay servicios. Crea el primero con el formulario anterior.
              </div>
            )}
          </Card>
        </section>
      </main>
    </Layout>
  );
}
