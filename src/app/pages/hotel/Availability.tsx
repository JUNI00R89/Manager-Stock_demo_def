import { ReservationCalendar, calendarDate, shiftDate } from './ReservationCalendar';
import { ConfirmActionDialog } from '../../components/ConfirmActionDialog';
import { HotelAccountDialog } from './HotelAccountDialog';
import { useAuth } from '../../context/AuthContext';
import { canPerformAction } from '../../security/permissions';
import { useCallback, useEffect, useState } from 'react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import {
  ChevronLeft, ChevronRight, Plus, Calendar, Bed, Users, DollarSign,
  CheckCircle2, X, Clock
} from 'lucide-react';
import type { Habitacion, ReservaHotel } from '../../utils/mockData';
import { moveHotelReservation, createHotelReservation, getHotelReservations, getHotelRooms, updateHotelReservationStatus, type HotelReservationRecord, type HotelRoomRecord } from '../../services/dataService';
import { toast } from 'sonner';
import { toastError } from '../../utils/notifications';

const ESTADO_COLORS: Record<ReservaHotel['estado'], string> = {
  confirmada: 'bg-blue-400 dark:bg-blue-600',
  checkin: 'bg-green-500 dark:bg-green-600',
  checkout: 'bg-gray-400 dark:bg-gray-600',
  cancelada: 'bg-red-400 dark:bg-red-600',
};

const ESTADO_LABELS: Record<ReservaHotel['estado'], string> = {
  confirmada: 'Confirmada',
  checkin: 'Check-in',
  checkout: 'Check-out',
  cancelada: 'Cancelada',
};

const TIPO_LABELS = { simple: 'Simple', doble: 'Doble', suite: 'Suite', familiar: 'Familiar' };

function getDaysInView(startDate: Date, numDays: number): Date[] {
  const days: Date[] = [];
  for (let i = 0; i < numDays; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    days.push(d);
  }
  return days;
}

function formatDate(d: Date) {
  return d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' });
}

function isoDate(d: Date) {
  return calendarDate(d);
}

export function Availability() {
  const { user } = useAuth();
  const canManage = canPerformAction(user, 'hotel.manage');
  const [startDate, setStartDate] = useState(() => new Date());
  const [habitaciones, setHabitaciones] = useState<Habitacion[]>([]);
  const [reservas, setReservas] = useState<ReservaHotel[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingReserva, setSavingReserva] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [roomRows, reservationRows] = await Promise.all([getHotelRooms(), getHotelReservations()]);
      setHabitaciones(roomRows.map((room: HotelRoomRecord): Habitacion => ({
        id: room.id, numero: room.number, tipo: room.type === 'double' ? 'doble' : room.type === 'single' ? 'simple' : (room.type === 'deluxe' ? 'familiar' : (room.type as Habitacion['tipo'])),
        piso: room.floor, estado: room.status === 'available' ? 'disponible' : room.status === 'occupied' ? 'ocupada' : room.status === 'cleaning' ? 'limpieza' : room.status === 'maintenance' ? 'mantenimiento' : 'reservada',
        estadoLimpieza: room.status === 'cleaning' ? 'en_limpieza' : room.status === 'maintenance' ? 'sucia' : 'lista', precio: room.pricePerNight, capacidad: room.capacity, amenidades: room.amenities,
      })));
      setReservas(reservationRows.map((reservation: HotelReservationRecord): ReservaHotel => ({
        id: reservation.id, habitacionId: reservation.roomId, huesped: reservation.guestName, email: reservation.guestEmail, telefono: reservation.guestPhone,
        checkIn: reservation.checkIn, checkOut: reservation.checkOut, estado: reservation.status === 'confirmed' ? 'confirmada' : reservation.status === 'checkin' ? 'checkin' : reservation.status === 'checkout' ? 'checkout' : 'cancelada',
        anticipo: reservation.advance, totalCargos: reservation.totalCharges, noches: reservation.nights,
      })));
    } catch (error) { toastError(error, 'No se pudieron cargar las reservas del hotel.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const [selectedReserva, setSelectedReserva] = useState<ReservaHotel | null>(null);
  const [billingId, setBillingId] = useState<string | null>(null);
  const [accountReservations, setAccountReservations] = useState<HotelReservationRecord[]>([]);
  const [showNewReserva, setShowNewReserva] = useState(false);
  const [newReserva, setNewReserva] = useState({ huesped: '', habitacionId: '', checkIn: '', checkOut: '', anticipo: '' });

  const numDays = 14;
  const days = getDaysInView(startDate, numDays);

  const prevPeriod = () => { const d = new Date(startDate); d.setDate(d.getDate() - 7); setStartDate(d); };
  const nextPeriod = () => { const d = new Date(startDate); d.setDate(d.getDate() + 7); setStartDate(d); };

  const [pendingMove, setPendingMove] = useState<{reservation: ReservaHotel; roomId: string; checkIn: string} | null>(null);
  const [moving, setMoving] = useState(false);
  const proposeMove = (move: {reservation: ReservaHotel; roomId: string; checkIn: string}) => {
    const room = habitaciones.find(r => r.id === move.roomId);
    const end = shiftDate(move.checkIn,move.reservation.noches);
    if (!room || ['mantenimiento','limpieza'].includes(room.estado)) { toast.error('La habitación no está disponible.'); return; }
    if (reservas.some(r => r.id !== move.reservation.id && r.habitacionId === move.roomId && ['confirmada','checkin'].includes(r.estado) && r.checkIn < end && r.checkOut > move.checkIn)) { toast.error('Ya existe una reserva durante ese periodo.'); return; }
    setPendingMove(move);
  };
  const saveMove = async () => {
    if (!pendingMove || moving) return;
    setMoving(true);
    try {
      const {reservation,roomId,checkIn} = pendingMove;
      await moveHotelReservation(reservation.id,{roomId,checkIn,expectedRoomId:reservation.habitacionId,expectedCheckIn:reservation.checkIn,expectedCheckOut:reservation.checkOut});
      toast.success('Reserva movida.'); setPendingMove(null); await load();
    } catch(error) { toast.error(error instanceof Error ? error.message : 'No se pudo mover la reserva.'); setPendingMove(null); await load(); }
    finally { setMoving(false); }
  };

  const handleCheckIn = async (reservaId: string) => {
    try { await updateHotelReservationStatus(reservaId, 'checkin'); toast.success('Check-in realizado.'); await load(); setSelectedReserva(null); }
    catch (error) { toastError(error, 'No se pudo registrar el check-in.'); }
  };

  const handleCheckOut = async (reservaId: string) => {
    try { setAccountReservations(await getHotelReservations()); setBillingId(reservaId); setSelectedReserva(null); }
    catch (error) { toastError(error, 'No se pudo cargar la cuenta.'); }
  };

  const handleNewReservaSubmit = async () => {
    if (!newReserva.huesped.trim() || !newReserva.habitacionId || !newReserva.checkIn || !newReserva.checkOut) {
      toast.error('Completa el huésped, habitación, check-in y check-out.');
      return;
    }
    if (newReserva.checkOut <= newReserva.checkIn) { toast.error('El check-out debe ser posterior al check-in.'); return; }
    setSavingReserva(true);
    try {
      const hab = habitaciones.find(h => h.id === newReserva.habitacionId);
      const created = await createHotelReservation({ roomId: newReserva.habitacionId, guestName: newReserva.huesped.trim(), checkIn: newReserva.checkIn, checkOut: newReserva.checkOut, advance: Number(newReserva.anticipo) || 0 });
      toast.success('Reserva creada', { description: `${created.guestName} · Hab. ${hab?.numero ?? created.roomNumber}` });
      setShowNewReserva(false);
      setNewReserva({ huesped: '', habitacionId: '', checkIn: '', checkOut: '', anticipo: '' });
      await load();
    } catch (error) { toastError(error, 'No se pudo crear la reserva.'); }
    finally { setSavingReserva(false); }
  };

  const totalOcupadas = habitaciones.filter(h => h.estado === 'ocupada').length;
  const totalDisponibles = habitaciones.filter(h => h.estado === 'disponible').length;

  return (
    <Layout>
      <div className="min-w-0 space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Calendar className="text-orange-500" size={24} /> Disponibilidad del Hotel
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Vista Gantt de reservas por habitación</p>
          </div>
          {canManage && <Button onClick={() => setShowNewReserva(v => !v)} className="bg-orange-500 hover:bg-orange-600 text-white self-start sm:self-auto">
            <Plus size={18} className="mr-2" /> Nueva reserva
          </Button>}
        </div>

        {/* KPI chips */}
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
            <CheckCircle2 size={16} className="text-green-600" />
            <span className="text-sm font-semibold text-green-700 dark:text-green-400">{totalDisponibles} disponibles</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800">
            <Bed size={16} className="text-orange-600" />
            <span className="text-sm font-semibold text-orange-700 dark:text-orange-400">{totalOcupadas} ocupadas</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
            <Users size={16} className="text-blue-600" />
            <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">{reservas.filter(r => r.estado === 'checkin').length} huéspedes activos</span>
          </div>
        </div>

        {/* New reserva form */}
        {showNewReserva && (
          <Card className="p-5 border border-orange-200 dark:border-orange-800/50 bg-orange-50/50 dark:bg-orange-950/20">
            <h3 className="font-semibold text-foreground mb-4">Nueva Reserva</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Huésped *</label>
                <input value={newReserva.huesped} onChange={e => setNewReserva({...newReserva, huesped: e.target.value})} className="w-full h-10 px-3 rounded-md border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" placeholder="Nombre del huésped" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Habitación *</label>
                <select value={newReserva.habitacionId} onChange={e => setNewReserva({...newReserva, habitacionId: e.target.value})} className="w-full h-10 px-3 rounded-md border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
                  <option value="">Selecciona...</option>
                  {habitaciones.filter(h => h.estado !== 'mantenimiento' && h.estado !== 'limpieza').map(h => (
                    <option key={h.id} value={h.id}>Hab. {h.numero} — {TIPO_LABELS[h.tipo]} (${h.precio}/noche)</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Anticipo (COP)</label>
                <input type="number" min="0" step="1" value={newReserva.anticipo} onChange={e => setNewReserva({...newReserva, anticipo: e.target.value})} className="w-full h-10 px-3 rounded-md border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" placeholder="0" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Check-in *</label>
                <input type="date" value={newReserva.checkIn} onChange={e => setNewReserva({...newReserva, checkIn: e.target.value})} className="w-full h-10 px-3 rounded-md border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Check-out *</label>
                <input type="date" value={newReserva.checkOut} onChange={e => setNewReserva({...newReserva, checkOut: e.target.value})} className="w-full h-10 px-3 rounded-md border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button onClick={() => void handleNewReservaSubmit()} disabled={savingReserva} size="sm" className="bg-orange-500 hover:bg-orange-600 text-white">{savingReserva ? 'Guardando…' : 'Guardar reserva'}</Button>
              <Button onClick={() => setShowNewReserva(false)} variant="outline" size="sm">Cancelar</Button>
            </div>
          </Card>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-3 text-xs">
          {Object.entries(ESTADO_LABELS).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded-sm ${ESTADO_COLORS[k as ReservaHotel['estado']]}`} />
              <span className="text-muted-foreground">{v}</span>
            </div>
          ))}
        </div>

        {loading && <Card className="rounded-xl p-5 text-sm text-muted-foreground">Cargando disponibilidad del hotel…</Card>}

        {/* Gantt calendar */}
        <Card className="border border-border overflow-hidden">
          {/* Navigation */}
          <div className="flex items-center gap-3 p-4 border-b border-border bg-accent/30">
            <Button aria-label="Semana anterior" disabled={moving || !!pendingMove} variant="outline" size="sm" onClick={prevPeriod} className="h-8 w-8 p-0"><ChevronLeft size={16} /></Button>
            <span className="text-sm font-semibold text-foreground flex-1 text-center">
              {days[0].toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}
            </span>
            <Button aria-label="Semana siguiente" disabled={moving || !!pendingMove} variant="outline" size="sm" onClick={nextPeriod} className="h-8 w-8 p-0"><ChevronRight size={16} /></Button>
          </div>

          {!loading && habitaciones.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">No hay habitaciones registradas. Crea habitaciones desde Gestión de habitaciones o carga los datos de demostración.</div> : <ReservationCalendar rooms={habitaciones} reservations={reservas} days={days} canMove={canManage && !loading && !moving && !pendingMove} onSelect={setSelectedReserva} onMove={proposeMove} />}
        </Card>

        {/* Reserva detail modal */}
        {selectedReserva && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedReserva(null)}>
            <Card className="max-h-[90dvh] w-full max-w-md overflow-y-auto p-4 sm:p-6 border border-border" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-foreground text-lg">Detalles de Reserva</h3>
                <button onClick={() => setSelectedReserva(null)} className="p-1 hover:text-red-500 text-muted-foreground">
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-950/40 flex items-center justify-center">
                    <Users size={20} className="text-orange-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{selectedReserva.huesped}</p>
                    <p className="text-xs text-muted-foreground">{selectedReserva.email} · {selectedReserva.telefono}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-3 rounded-lg bg-accent/50">
                    <p className="text-xs text-muted-foreground">Check-in</p>
                    <p className="font-semibold text-foreground">{selectedReserva.checkIn}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-accent/50">
                    <p className="text-xs text-muted-foreground">Check-out</p>
                    <p className="font-semibold text-foreground">{selectedReserva.checkOut}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-accent/50">
                    <p className="text-xs text-muted-foreground">Habitación</p>
                    <p className="font-semibold text-foreground">Hab. {habitaciones.find(h => h.id === selectedReserva.habitacionId)?.numero}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-accent/50">
                    <p className="text-xs text-muted-foreground">Noches</p>
                    <p className="font-semibold text-foreground">{selectedReserva.noches}</p>
                  </div>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800">
                  <span className="text-sm text-muted-foreground">Total cargos</span>
                  <span className="font-bold text-orange-600">${selectedReserva.totalCargos.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                </div>
                <Badge className={`${ESTADO_COLORS[selectedReserva.estado]} text-white text-xs px-3 py-1`}>
                  {ESTADO_LABELS[selectedReserva.estado]}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2 mt-5">
                {canManage && selectedReserva.estado === 'confirmada' && (
                  <Button onClick={() => handleCheckIn(selectedReserva.id)} className="flex-1 bg-green-600 hover:bg-green-700 text-white">
                    <CheckCircle2 size={16} className="mr-2" /> Check-in
                  </Button>
                )}
                {selectedReserva.estado === 'checkin' && (
                  <Button onClick={() => handleCheckOut(selectedReserva.id)} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white">
                    <Clock size={16} className="mr-2" /> Cuenta y cobro
                  </Button>
                )}
                <Button variant="outline" onClick={() => setSelectedReserva(null)} className="flex-1">Cerrar</Button>
              </div>
            </Card>
          </div>
        )}
      </div>
      <ConfirmActionDialog open={!!pendingMove} onOpenChange={open=>{if(!open&&!moving)setPendingMove(null);}} title="Mover reserva" description={pendingMove ? `${pendingMove.reservation.huesped}: de habitación ${habitaciones.find(r=>r.id===pendingMove.reservation.habitacionId)?.numero} (${pendingMove.reservation.checkIn} → ${pendingMove.reservation.checkOut}) a habitación ${habitaciones.find(r=>r.id===pendingMove.roomId)?.numero} (${pendingMove.checkIn} → ${shiftDate(pendingMove.checkIn,pendingMove.reservation.noches)}). Se conservan ${pendingMove.reservation.noches} noches y el precio acordado.` : ''} confirmLabel="Guardar movimiento" onConfirm={saveMove}/>
      {billingId && <HotelAccountDialog reservations={accountReservations.filter(r => r.id === billingId)} initialId={billingId} onClose={() => setBillingId(null)} onSaved={() => void load()} />}
    </Layout>
  );
}
