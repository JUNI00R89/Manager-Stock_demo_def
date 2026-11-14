import { AppointmentMoveHandle } from '../../components/AppointmentMoveHandle';
import { ConfirmActionDialog } from '../../components/ConfirmActionDialog';
import { moveServiceAppointment } from '../../services/dataService';
import { ProfessionalScheduleDialog } from '../../components/ProfessionalScheduleDialog';
import { ServiceCheckoutDialog } from '../../components/ServiceCheckoutDialog';
import { useAuth } from '../../context/AuthContext';
import { canPerformAction } from '../../security/permissions';
import { useCallback, useEffect, useState } from 'react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import {
  CalendarDays, Clock, User,
  Scissors, Check, X
} from 'lucide-react';
import type { Cita, Profesional, Servicio } from '../../utils/types';
import { dataService, deleteServiceAppointment, editServiceAppointment, getServiceAppointments, getServiceProfessionals, getServicesCatalog, updateServiceAppointmentStatus, type ServiceAppointmentRecord, type ServiceCatalogRecord, type ServiceProfessionalRecord } from '../../services/dataService';
import { toast } from 'sonner';
import { toastError } from '../../utils/notifications';
import { uniqueRestaurantId } from '../../utils/restaurantStorage';
import { formatMoney as money } from '../../utils/restaurantFormat';

type ViewMode = 'semana' | 'dia';

const ESTADO_CONFIG: Record<Cita['estado'], { label: string; color: string; bg: string; border: string }> = {
  reservada:   { label: 'Reservada',   color: 'text-blue-600',  bg: 'bg-blue-100 dark:bg-blue-950/40',   border: 'border-blue-300 dark:border-blue-700' },
  confirmada:  { label: 'Confirmada',  color: 'text-green-600', bg: 'bg-green-100 dark:bg-green-950/40', border: 'border-green-300 dark:border-green-700' },
  atendida:    { label: 'Atendida',    color: 'text-gray-600',  bg: 'bg-gray-100 dark:bg-gray-800',      border: 'border-gray-300 dark:border-gray-700' },
  cancelada:   { label: 'Cancelada',   color: 'text-red-600',   bg: 'bg-red-100 dark:bg-red-950/40',     border: 'border-red-300 dark:border-red-700' },
  no_asistio:  { label: 'No asistió',  color: 'text-orange-600',bg: 'bg-orange-100 dark:bg-orange-950/40',border:'border-orange-300 dark:border-orange-700'},
};

const HOURS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
const DAYS_OF_WEEK = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export function Appointments() {
  const { user } = useAuth();
  const canManage = canPerformAction(user, 'services.manage');
  const [move, setMove] = useState<{ cita: Cita; date: string; time: string; professionalId: string } | null>(null);
  const [professionalRows, setProfessionalRows] = useState<ServiceProfessionalRecord[]>([]);
  const [schedulePro, setSchedulePro] = useState<ServiceProfessionalRecord | null>(null);
  const [appointmentRows, setAppointmentRows] = useState<ServiceAppointmentRecord[]>([]);
  const [checkout, setCheckout] = useState<ServiceAppointmentRecord | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('semana');
  const [selectedPro, setSelectedPro] = useState<string | 'todos'>('todos');
  const [selectedCita, setSelectedCita] = useState<Cita | null>(null);
  const [editingCita, setEditingCita] = useState(false);
  const [editForm, setEditForm] = useState({ serviceId: '', professionalId: '', clientName: '', clientPhone: '', clientEmail: '', appointmentDate: '', startTime: '', notes: '' });
  const [deletingCita, setDeletingCita] = useState(false);
  const [confirmDeleteCita, setConfirmDeleteCita] = useState(false);
  const [services, setServices] = useState<Servicio[]>([]);
  const [professionals, setProfessionals] = useState<Profesional[]>([]);
  const [citas, setCitas] = useState<Cita[]>([]);
  const [loading, setLoading] = useState(true);
  const today = new Date();
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(today);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [serviceRows, professionalRows, appointmentRows] = await Promise.all([getServicesCatalog(), getServiceProfessionals(), getServiceAppointments()]);
      const mappedServices: Servicio[] = serviceRows.map((v: ServiceCatalogRecord) => ({ id:v.id, nombre:v.nombre, duracion:v.duracion, precio:v.precio, categoria:v.categoria, color:v.color }));
      const mappedProfessionals: Profesional[] = professionalRows.map((v: ServiceProfessionalRecord) => ({ id:v.id, nombre:v.nombre, especialidad:v.especialidad, color:v.color, horario:v.horario.map(h => ({ dia:h.dia ?? 1, inicio:h.inicio ?? '09:00', fin:h.fin ?? '18:00' })) }));
      const statusMap: Record<ServiceAppointmentRecord['estado'], Cita['estado']> = { reserved:'reservada', confirmed:'confirmada', attended:'atendida', cancelled:'cancelada', no_show:'no_asistio' };
      const mappedAppointments: Cita[] = appointmentRows.map((v: ServiceAppointmentRecord) => ({ id:v.id, clienteId:v.clienteId || '', clienteNombre:v.clienteNombre, clienteTelefono:v.clienteTelefono, clienteEmail:v.clienteEmail, servicioId:v.servicioId, servicioNombre:v.servicioNombre, profesionalId:v.profesionalId, profesionalNombre:v.profesionalNombre, fecha:v.fecha, horaInicio:v.horaInicio, horaFin:v.horaFin, estado:statusMap[v.estado], notas:v.notes, saleId:v.saleId }));
      setProfessionalRows(professionalRows); setAppointmentRows(appointmentRows); setServices(mappedServices); setProfessionals(mappedProfessionals); setCitas(mappedAppointments);
    } catch (error) { toastError(error, 'No se pudo cargar la agenda del negocio.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const setAppointmentStatus = async (appointment: Cita, status: ServiceAppointmentRecord['estado']) => {
    try { await updateServiceAppointmentStatus(appointment.id, status); toast.success(status === 'attended' ? 'Cita marcada como atendida.' : 'Estado de la cita actualizado.'); await load(); setSelectedCita(null); }
    catch (error) { toastError(error, 'No se pudo actualizar la cita.'); }
  };
  const [charging, setCharging] = useState(false);
  const chargeAppointment = async (appointment: Cita, paymentMethod: 'cash' | 'card' | 'digital') => {
    setCharging(true);
    try {
      // The server charges the booked price and rejects a second charge, so a fresh key per click is safe.
      const session = await dataService.getCurrentCashSession();
      const sale = await dataService.createSale({ items: [], appointmentIds: [appointment.id], customer: appointment.clienteNombre, paymentMethod, cashSessionId: session?.id, idempotencyKey: uniqueRestaurantId('cobro-cita') });
      toast.success('Cita cobrada.', { description: `Venta ${sale.id}` });
      await load(); setSelectedCita(null);
    } catch (error) { toastError(error, 'No se pudo cobrar la cita.'); }
    finally { setCharging(false); }
  };

  const beginEdit = (appointment: Cita) => {
    setEditForm({ serviceId: appointment.servicioId, professionalId: appointment.profesionalId, clientName: appointment.clienteNombre, clientPhone: appointment.clienteTelefono || '', clientEmail: appointment.clienteEmail || '', appointmentDate: appointment.fecha, startTime: appointment.horaInicio, notes: appointment.notas || '' });
    setEditingCita(true);
  };
  const saveEdit = async () => {
    if (!selectedCita || editForm.clientName.trim().length < 2 || !editForm.serviceId || !editForm.professionalId || !editForm.appointmentDate || !editForm.startTime) { toast.error('Completa los datos obligatorios de la cita.'); return; }
    try {
      await editServiceAppointment(selectedCita.id, { ...editForm, clientName: editForm.clientName.trim() });
      toast.success('Cita actualizada.'); setEditingCita(false); setSelectedCita(null); await load();
    } catch (error) { toastError(error, 'No se pudo editar la cita.'); }
  };
  const removeAppointment = async () => {
    if (!selectedCita) return;
    setDeletingCita(true);
    try { await deleteServiceAppointment(selectedCita.id); toast.success('Cita eliminada.'); setSelectedCita(null); await load(); }
    catch (error) { toastError(error, 'No se pudo eliminar la cita.'); }
    finally { setDeletingCita(false); }
  };

  const filteredCitas = citas.filter(c => selectedPro === 'todos' || c.profesionalId === selectedPro);
  const todayCitas = filteredCitas.filter(c => c.fecha === todayKey);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayKey + 'T12:00:00');
    d.setDate(d.getDate() - (d.getDay() + 6) % 7 + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; return { label: DAYS_OF_WEEK[i], iso, isToday: iso === todayKey };
  });

  const gridColumns = viewMode === 'dia'
    ? professionals.filter(p => selectedPro === 'todos' || p.id === selectedPro).map(p => ({ key: p.id, iso: todayKey, label: p.nombre, isToday: true, professionalId: p.id }))
    : weekDays.map(d => ({ ...d, key: d.iso, professionalId: '' }));
  const visibleDates = new Set(gridColumns.map(d => d.iso));
  const gridHours = [...new Set([...HOURS, ...filteredCitas.filter(c => visibleDates.has(c.fecha)).map(c => c.horaInicio)])].sort();

  return (
    <Layout>

      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <CalendarDays className="text-orange-500" size={24} /> Agenda de Citas
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">{todayCitas.length} citas hoy · Consulta y administra citas existentes desde esta agenda.</p>
          </div>
        </div>

        {canManage && <div className="flex flex-wrap gap-2">{professionalRows.map(p => <Button key={p.id} variant="outline" className="min-h-11" onClick={() => setSchedulePro(p)}>Horario de {p.name}</Button>)}</div>}
        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(['semana', 'dia'] as ViewMode[]).map(v => (
              <button key={v} onClick={() => setViewMode(v)} className={`px-4 py-2 text-sm font-medium transition-colors ${viewMode === v ? 'bg-orange-500 text-white' : 'text-muted-foreground hover:bg-accent'}`}>
                {v === 'semana' ? 'Semana' : 'Día'}
              </button>
            ))}
          </div>

          <div className="flex gap-1">
            <button onClick={() => setSelectedPro('todos')} className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${selectedPro === 'todos' ? 'bg-orange-500 text-white' : 'bg-accent text-muted-foreground hover:bg-orange-50 dark:hover:bg-orange-950/30'}`}>
              Todos
            </button>
            {professionals.map(p => (
              <button key={p.id} onClick={() => setSelectedPro(p.id)} className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${selectedPro === p.id ? 'text-white' : 'bg-accent text-muted-foreground'}`} style={selectedPro === p.id ? { backgroundColor: p.color } : {}}>
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                {p.nombre.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3">
          {Object.entries(ESTADO_CONFIG).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5 text-xs">
              <div className={`w-3 h-3 rounded-sm ${v.bg} border ${v.border}`} />
              <span className="text-muted-foreground">{v.label}</span>
            </div>
          ))}
        </div>

        {loading && <Card className="p-6 text-sm text-muted-foreground">Cargando citas del negocio…</Card>}
        {!loading && (services.length === 0 || professionals.length === 0) && <Card className="p-6 text-sm text-muted-foreground">Este negocio todavía no tiene servicios o profesionales registrados en la base de datos.</Card>}

        {/* Weekly grid */}
        <Card className="border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: 600 }}>
              <thead>
                <tr className="border-b border-border bg-accent/30">
                  <th className="w-16 text-left px-3 py-3 text-xs font-semibold text-muted-foreground">Hora</th>
                  {gridColumns.map(d => (
                    <th key={d.key} className={`py-3 text-center text-xs font-semibold ${d.isToday ? 'text-orange-600' : 'text-muted-foreground'}`}>
                      <p>{d.label}</p>
                      <p className={`text-lg font-bold ${d.isToday ? 'text-orange-600' : 'text-foreground'}`}>
                        {parseInt(d.iso.split('-')[2])}
                      </p>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gridHours.map((hour, hi) => (
                  <tr key={hour} className={`border-b border-border/40 ${hi % 2 === 0 ? '' : 'bg-muted/10'}`} style={{ height: 64 }}>
                    <td className="px-3 py-2 text-xs text-muted-foreground font-mono align-top pt-2 sticky left-0 bg-card">{hour}</td>
                    {gridColumns.map(day => {
                      const citas = filteredCitas.filter(c => c.fecha === day.iso && c.horaInicio === hour && (!day.professionalId || c.profesionalId === day.professionalId));

                      return (
                        <td key={day.key} data-appointment-date={day.iso} data-appointment-time={hour} data-appointment-professional={day.professionalId} className={`border-l border-border/30 p-1 align-top ${day.isToday ? 'bg-orange-50/30 dark:bg-orange-950/10' : ''}`}>
                          {citas.map(cita => {
                            const cfg = ESTADO_CONFIG[cita.estado];
                            const isStart = cita.horaInicio === hour;
                            if (!isStart) return null;
                            return (
                              <div
                                key={cita.id}
                                onClick={() => setSelectedCita(cita)}
                                className={`px-2 py-1 rounded-lg border ${cfg.bg} ${cfg.border} cursor-pointer hover:opacity-80 transition-opacity`}
                              >
                                {canManage && ['reservada', 'confirmada'].includes(cita.estado) && <AppointmentMoveHandle label={cita.clienteNombre} onDrop={(date, time, professionalId) => setMove({ cita, date, time, professionalId: professionalId || cita.profesionalId })} />}
                                <p className={`text-[10px] font-bold ${cfg.color} truncate`}>{cita.clienteNombre}</p>
                                <p className="text-[10px] text-muted-foreground truncate">{cita.servicioNombre}</p>
                                <p className="text-[10px] text-muted-foreground">{cita.horaInicio}–{cita.horaFin}</p>
                              </div>
                            );
                          })}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Today's list (quick view) */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Citas de hoy</h3>
          {todayCitas.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border-2 border-dashed border-border rounded-xl">
              <CalendarDays size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Sin citas para hoy</p>
            </div>
          ) : (
            <div className="space-y-2">
              {todayCitas.map(cita => {
                const cfg = ESTADO_CONFIG[cita.estado];
                const pro = professionals.find(p => p.id === cita.profesionalId);
                return (
                  <Card key={cita.id} className={`p-4 border ${cfg.border} cursor-pointer hover:shadow-sm transition-shadow`} onClick={() => setSelectedCita(cita)}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ backgroundColor: pro?.color }}>
                        {cita.clienteNombre.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{cita.clienteNombre}</p>
                        <p className="text-xs text-muted-foreground">{cita.servicioNombre} · {pro?.nombre}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-mono font-bold text-foreground">{cita.horaInicio}</p>
                        <Badge className={`text-[10px] ${cfg.bg} ${cfg.color} border-0`}>{cfg.label}</Badge>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Cita detail modal */}
      {selectedCita && (() => {
        const cfg = ESTADO_CONFIG[selectedCita.estado];
        const pro = professionals.find(p => p.id === selectedCita.profesionalId);
        const svc = services.find(s => s.id === selectedCita.servicioId);
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedCita(null)}>
            <Card className="w-full max-w-sm p-6 border border-border" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-foreground">Detalles de cita</h3>
                <button onClick={() => { setSelectedCita(null); setEditingCita(false); setConfirmDeleteCita(false); }} className="p-1 hover:text-red-500 text-muted-foreground"><X size={18} /></button>
              </div>
              {editingCita ? <div className="space-y-3">
                <label className="block space-y-1 text-xs"><span>Cliente</span><input className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" value={editForm.clientName} onChange={e=>setEditForm({...editForm,clientName:e.target.value})}/></label>
                <label className="block space-y-1 text-xs"><span>Teléfono</span><input type="tel" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" value={editForm.clientPhone} onChange={e=>setEditForm({...editForm,clientPhone:e.target.value})}/></label>
                <label className="block space-y-1 text-xs"><span>Correo electrónico</span><input type="email" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" value={editForm.clientEmail} onChange={e=>setEditForm({...editForm,clientEmail:e.target.value})}/></label>
                <label className="block space-y-1 text-xs"><span>Servicio</span><select className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" value={editForm.serviceId} onChange={e=>setEditForm({...editForm,serviceId:e.target.value})}>{services.map(s=><option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>
                <label className="block space-y-1 text-xs"><span>Profesional</span><select className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" value={editForm.professionalId} onChange={e=>setEditForm({...editForm,professionalId:e.target.value})}>{professionals.map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
                <div className="grid grid-cols-2 gap-2"><label className="block space-y-1 text-xs"><span>Fecha</span><input type="date" className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm" value={editForm.appointmentDate} onChange={e=>setEditForm({...editForm,appointmentDate:e.target.value})}/></label><label className="block space-y-1 text-xs"><span>Hora</span><input type="time" className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm" value={editForm.startTime} onChange={e=>setEditForm({...editForm,startTime:e.target.value})}/></label></div>
                <label className="block space-y-1 text-xs"><span>Observaciones</span><textarea rows={2} className="w-full rounded-lg border border-border bg-background p-2 text-sm" value={editForm.notes} onChange={e=>setEditForm({...editForm,notes:e.target.value})}/></label>
                <div className="flex gap-2"><Button size="sm" className="flex-1" onClick={()=>void saveEdit()}>Guardar cambios</Button><Button size="sm" variant="outline" className="flex-1" onClick={()=>setEditingCita(false)}>Cancelar edición</Button></div>
              </div> : <><div className="space-y-3">
                <Badge className={`${cfg.bg} ${cfg.color} border-0 text-xs`}>{cfg.label}</Badge>
                <p className="text-lg font-bold text-foreground">{selectedCita.clienteNombre}</p>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p className="flex items-center gap-2"><Scissors size={14} className="text-orange-500" />{selectedCita.servicioNombre} · {appointmentRows.find(r => r.id === selectedCita.id)?.durationMinutes ?? svc?.duracion} min</p>
                  <p className="flex items-center gap-2"><User size={14} className="text-orange-500" />{pro?.nombre}</p>
                  <p className="flex items-center gap-2"><Clock size={14} className="text-orange-500" />{selectedCita.horaInicio} — {selectedCita.horaFin}</p>
                </div>
                <p className="text-xl font-bold text-orange-600">{money(appointmentRows.find(r => r.id === selectedCita.id)?.price ?? svc?.precio ?? 0)}</p>
              </div>
              {!['cancelada', 'no_asistio'].includes(selectedCita.estado) && (appointmentRows.find(r => r.id === selectedCita.id)?.saleId || canManage && canPerformAction(user, 'cash.manage')) && <Button className="w-full min-h-11 mt-4" onClick={() => { const row = appointmentRows.find(r => r.id === selectedCita.id); if (row) { setCheckout(row); setSelectedCita(null); } }}>{appointmentRows.find(r => r.id === selectedCita.id)?.saleId ? 'Ver comprobante' : 'Finalizar y cobrar'}</Button>}
              <div style={{ display: canManage ? undefined : 'none' }} className="flex gap-2 mt-5">
                {selectedCita.estado === 'reservada' && (
                  <Button size="sm" className="flex-1 bg-[var(--brand-primary)] text-white hover:opacity-90" onClick={() => void setAppointmentStatus(selectedCita, 'confirmed')}>
                    <Check size={14} className="mr-1" /> Confirmar
                  </Button>
                )}
                {selectedCita.estado === 'confirmada' && (
                  <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={() => void setAppointmentStatus(selectedCita, 'attended')}>
                    <Check size={14} className="mr-1" /> Atendida
                  </Button>
                )}
                {(selectedCita.estado === 'reservada' || selectedCita.estado === 'confirmada') && (
                  <Button size="sm" variant="outline" className="flex-1 border-red-200 text-red-600" onClick={() => void setAppointmentStatus(selectedCita, 'cancelled')}>
                    <X size={14} className="mr-1" /> Cancelar
                  </Button>
                )}
                {selectedCita.estado === 'atendida' && selectedCita.saleId && (
                  <Badge className="flex-1 justify-center bg-green-100 text-green-800">Cobrada</Badge>
                )}
                {/* A charged appointment is part of a sale: the server refuses to edit or delete it. */}
                {!selectedCita.saleId && <>
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => beginEdit(selectedCita)}>Editar</Button>
                  <Button size="sm" variant="outline" disabled={deletingCita} className="border-red-200 text-red-600" onClick={() => setConfirmDeleteCita(true)}>{deletingCita ? 'Eliminando…' : 'Eliminar'}</Button>
                </>}
              </div>
              {canManage && selectedCita.estado === 'atendida' && !selectedCita.saleId && (
                <div className="mt-3 space-y-1">
                  <p className="text-xs text-muted-foreground">{charging ? 'Cobrando…' : 'Cobrar cita con:'}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {([['cash', 'Efectivo'], ['card', 'Tarjeta'], ['digital', 'Digital']] as const).map(([method, label]) => (
                      <Button key={method} size="sm" disabled={charging} className="bg-green-600 text-white hover:bg-green-700" onClick={() => void chargeAppointment(selectedCita, method)}>{label}</Button>
                    ))}
                  </div>
                </div>
              )}
              {confirmDeleteCita && <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-delete-title" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 dark:bg-red-950/20"><h4 id="confirm-delete-title" className="font-semibold text-red-800 dark:text-red-200">¿Eliminar esta cita?</h4><p className="mt-1 text-sm text-red-700 dark:text-red-300">La cita se eliminará de forma permanente. Esta acción no se puede deshacer.</p><div className="mt-3 flex gap-2"><Button size="sm" variant="destructive" disabled={deletingCita} onClick={() => void removeAppointment()}>{deletingCita ? 'Eliminando…' : 'Sí, eliminar'}</Button><Button size="sm" variant="outline" disabled={deletingCita} onClick={() => setConfirmDeleteCita(false)}>Conservar cita</Button></div></div>}
              </>}
            </Card>
          </div>
        );
      })()}
      <ConfirmActionDialog open={!!move} onOpenChange={open => { if (!open) setMove(null); }} title="Mover cita" description={move ? `${move.cita.clienteNombre}: ${move.date} a las ${move.time}, con ${professionals.find(p => p.id === move.professionalId)?.nombre || ''}. Se conservan duración y precio.` : ''} confirmLabel="Confirmar cambio" onConfirm={async () => { if (!move) return; try { await moveServiceAppointment(move.cita.id, { professionalId: move.professionalId, appointmentDate: move.date, startTime: move.time, expectedProfessionalId: move.cita.profesionalId, expectedDate: move.cita.fecha, expectedStartTime: move.cita.horaInicio, expectedEndTime: move.cita.horaFin }); setMove(null); await load(); toast.success('Cita reprogramada.'); } catch (e) { toastError(e, 'No se pudo mover la cita.'); throw e; } }} />
      {schedulePro && <ProfessionalScheduleDialog key={schedulePro.id} professional={schedulePro} onClose={() => setSchedulePro(null)} onSaved={load} />}
      {checkout && <ServiceCheckoutDialog key={checkout.id} appointment={checkout} onClose={() => setCheckout(null)} onSaved={load} />}
    </Layout>
  );
}
