import { useAuth } from '../../context/AuthContext';
import { canPerformAction } from '../../security/permissions';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Bed, Users, Calendar, DollarSign, CheckCircle, Clock, Wrench, Plus, RefreshCw, X, Save } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../utils/notifications';
import {
  createHotelRoom,
  updateHotelRoom,
  getHotelReservations,
  getHotelRooms,
  updateHotelReservationStatus,
  type HotelReservationRecord,
  type HotelRoomRecord,
} from '../../services/dataService';

import { HotelAccountDialog } from './HotelAccountDialog';

const ROOM_TYPES: Record<string, string> = {
  single: 'Individual',
  simple: 'Individual',
  double: 'Doble',
  suite: 'Suite',
  deluxe: 'Deluxe',
  familiar: 'Familiar',
};
const STATUS_LABELS: Record<HotelRoomRecord['status'], string> = {
  available: 'Disponible',
  occupied: 'Ocupada',
  reserved: 'Reservada',
  maintenance: 'Mantenimiento',
  cleaning: 'Limpieza',
};
const STATUS_STYLES: Record<HotelRoomRecord['status'], string> = {
  available: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20',
  occupied: 'border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/20',
  reserved: 'border-blue-200 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/20',
  maintenance: 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20',
  cleaning: 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/40',
};
const STATUS_BADGES: Record<HotelRoomRecord['status'], string> = {
  available: 'bg-emerald-700 text-white',
  occupied: 'bg-rose-700 text-white',
  reserved: 'bg-blue-700 text-white',
  maintenance: 'bg-amber-700 text-white',
  cleaning: 'bg-slate-700 text-white',
};

export function Rooms() {
  const { user } = useAuth();
  const canManage = canPerformAction(user, 'hotel.manage');
  const [accountRoomId, setAccountRoomId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<HotelRoomRecord[]>([]);
  const [reservations, setReservations] = useState<HotelReservationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingRoom, setEditingRoom] = useState<HotelRoomRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    roomNumber: '',
    roomType: 'double',
    floor: '1',
    capacity: '2',
    pricePerNight: '120000',
  });

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const [roomRows, reservationRows] = await Promise.all([getHotelRooms(), getHotelReservations()]);
      setRooms(roomRows);
      setReservations(reservationRows);
    } catch (error) {
      toastError(error, 'No se pudieron cargar las habitaciones.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const reservationsByRoom = useMemo(() => {
    const map = new Map<string, HotelReservationRecord>();
    reservations
      .filter(r => r.status === 'confirmed' || r.status === 'checkin')
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
      .forEach(r => {
        const current = map.get(r.roomId);
        if (!current || (r.status === 'checkin' && current.status !== 'checkin')) map.set(r.roomId, r);
      });
    return map;
  }, [reservations]);
  const counts = useMemo(
    () => ({
      total: rooms.length,
      available: rooms.filter(r => r.status === 'available').length,
      occupied: rooms.filter(r => r.status === 'occupied').length,
      reserved: rooms.filter(r => r.status === 'reserved').length,
      maintenance: rooms.filter(r => r.status === 'maintenance' || r.status === 'cleaning').length,
      occupancyRate: rooms.length
        ? Math.round((rooms.filter(r => r.status === 'occupied').length / rooms.length) * 100)
        : 0,
    }),
    [rooms],
  );

  const saveRoom = async () => {
    if (!form.roomNumber.trim()) {
      toast.error('Escribe el número de habitación.');
      return;
    }
    setSaving(true);
    try {
      const input = {
        roomNumber: form.roomNumber,
        type: form.roomType,
        roomType: form.roomType,
        floor: Number(form.floor),
        capacity: Number(form.capacity),
        pricePerNight: Number(form.pricePerNight),
      };
      if (editingRoom) {
        // The server keeps the room's occupancy; status here only satisfies the shared payload shape.
        await updateHotelRoom(editingRoom.id, {
          ...input,
          status: editingRoom.status,
          amenities: editingRoom.amenities || [],
        });
        toast.success('Habitación actualizada.');
      } else {
        await createHotelRoom({ ...input, status: 'available', amenities: [] });
        toast.success('Habitación creada.');
      }
      setEditingRoom(null);
      setShowForm(false);
      setForm({ roomNumber: '', roomType: 'double', floor: '1', capacity: '2', pricePerNight: '120000' });
      await load(true);
    } catch (error) {
      toastError(error, editingRoom ? 'No se pudo actualizar la habitación.' : 'No se pudo crear la habitación.');
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (reservation: HotelReservationRecord, status: 'checkin' | 'checkout') => {
    try {
      await updateHotelReservationStatus(reservation.id, status);
      toast.success(status === 'checkin' ? 'Check-in registrado.' : 'Check-out registrado.');
      await load(true);
    } catch (error) {
      toastError(error, 'No se pudo actualizar la reserva.');
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[.16em] text-[var(--brand-primary)]">
              Operación hotelera
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">Gestión de habitaciones</h1>
            <p className="mt-1 text-sm text-muted-foreground">Habitaciones y reservas guardadas para este hotel.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void load(true)} disabled={refreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Actualizar
            </Button>
            {user?.role === 'owner' && (
              <Button onClick={() => setShowForm(v => !v)}>
                <Plus className="mr-2 h-4 w-4" />
                Nueva habitación
              </Button>
            )}
          </div>
        </header>

        {showForm && (
          <Card className="rounded-2xl border-border p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">
                  {editingRoom ? `Editar habitación ${editingRoom.roomNumber}` : 'Registrar habitación'}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  La habitación quedará guardada únicamente en el negocio actual.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setShowForm(false);
                  setEditingRoom(null);
                }}
                aria-label="Cerrar formulario"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-2">
                <Label htmlFor="room-number">Número *</Label>
                <Input
                  id="room-number"
                  value={form.roomNumber}
                  onChange={e => setForm(p => ({ ...p, roomNumber: e.target.value }))}
                  placeholder="101"
                  maxLength={20}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="room-type">Tipo</Label>
                <select
                  id="room-type"
                  value={form.roomType}
                  onChange={e => setForm(p => ({ ...p, roomType: e.target.value }))}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="single">Individual</option>
                  <option value="double">Doble</option>
                  <option value="suite">Suite</option>
                  <option value="deluxe">Deluxe</option>
                  <option value="familiar">Familiar</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="room-floor">Piso</Label>
                <Input
                  id="room-floor"
                  type="number"
                  min="0"
                  step="1"
                  value={form.floor}
                  onChange={e => setForm(p => ({ ...p, floor: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="room-capacity">Capacidad</Label>
                <Input
                  id="room-capacity"
                  type="number"
                  min="1"
                  step="1"
                  value={form.capacity}
                  onChange={e => setForm(p => ({ ...p, capacity: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="room-price">Precio por noche (COP)</Label>
                <Input
                  id="room-price"
                  type="number"
                  min="0"
                  step="1"
                  value={form.pricePerNight}
                  onChange={e => setForm(p => ({ ...p, pricePerNight: e.target.value }))}
                />
              </div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setEditingRoom(null);
                }}
              >
                <X className="mr-2 h-4 w-4" />
                Cancelar
              </Button>
              <Button onClick={() => void saveRoom()} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Guardando…' : editingRoom ? 'Guardar cambios' : 'Guardar habitación'}
              </Button>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {[
            { label: 'Total', value: counts.total, icon: Bed, style: 'text-slate-600' },
            { label: 'Disponibles', value: counts.available, icon: CheckCircle, style: 'text-emerald-700' },
            { label: 'Ocupadas', value: counts.occupied, icon: Users, style: 'text-rose-700' },
            { label: 'Reservadas', value: counts.reserved, icon: Calendar, style: 'text-blue-700' },
            { label: 'Mantenimiento', value: counts.maintenance, icon: Wrench, style: 'text-amber-700' },
            {
              label: 'Ocupación',
              value: `${counts.occupancyRate}%`,
              icon: DollarSign,
              style: 'text-[var(--brand-primary)]',
            },
          ].map(item => (
            <Card key={item.label} className="rounded-2xl border-border p-4">
              <item.icon className={`mb-2 h-5 w-5 ${item.style}`} />
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{item.value}</p>
            </Card>
          ))}
        </div>

        {loading ? (
          <Card className="rounded-2xl p-12 text-center text-muted-foreground">Cargando habitaciones…</Card>
        ) : rooms.length === 0 ? (
          <Card className="rounded-2xl border-dashed p-12 text-center">
            <Bed className="mx-auto h-9 w-9 text-muted-foreground" />
            <h2 className="mt-3 text-lg font-semibold">Aún no hay habitaciones</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Registra una habitación o carga los datos de demostración para comenzar a administrar reservas.
            </p>
            {user?.role === 'owner' && (
              <Button className="mt-4" onClick={() => setShowForm(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Crear primera habitación
              </Button>
            )}
          </Card>
        ) : (
          <div className="space-y-6">
            {Array.from(new Set(rooms.map(r => r.floor)))
              .sort((a, b) => a - b)
              .map(floor => (
                <section key={floor} className="space-y-3">
                  <h2 className="text-lg font-semibold text-foreground">Piso {floor}</h2>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {rooms
                      .filter(r => r.floor === floor)
                      .map(room => {
                        const reservation = reservationsByRoom.get(room.id);
                        return (
                          <Card key={room.id} className={`rounded-2xl border p-5 ${STATUS_STYLES[room.status]}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-2xl font-bold text-foreground">{room.number}</p>
                                <p className="text-sm text-muted-foreground">
                                  {ROOM_TYPES[room.type] || ROOM_TYPES[room.roomType] || room.type}
                                </p>
                              </div>
                              <Badge className={STATUS_BADGES[room.status]}>{STATUS_LABELS[room.status]}</Badge>
                            </div>
                            <div className="mt-4 space-y-2 text-sm">
                              <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Capacidad</span>
                                <span className="font-medium">
                                  {room.capacity} {room.capacity === 1 ? 'persona' : 'personas'}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Por noche</span>
                                <span className="font-semibold">
                                  {new Intl.NumberFormat('es-CO', {
                                    style: 'currency',
                                    currency: 'COP',
                                    maximumFractionDigits: 0,
                                  }).format(room.pricePerNight)}
                                </span>
                              </div>
                            </div>
                            {reservation && (
                              <div className="mt-4 border-t border-border/70 pt-3">
                                <p className="font-semibold text-foreground">{reservation.guestName}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {reservation.checkIn} → {reservation.checkOut}
                                </p>
                                <p className="mt-1 text-sm font-semibold">
                                  Total:{' '}
                                  {new Intl.NumberFormat('es-CO', {
                                    style: 'currency',
                                    currency: 'COP',
                                    maximumFractionDigits: 0,
                                  }).format(reservation.totalCharges)}
                                </p>
                                {canManage && reservation.status === 'confirmed' && (
                                  <Button
                                    className="mt-3 w-full"
                                    size="sm"
                                    onClick={() => void updateStatus(reservation, 'checkin')}
                                  >
                                    <CheckCircle className="mr-2 h-4 w-4" />
                                    Registrar check-in
                                  </Button>
                                )}
                                {canManage && reservation.status === 'checkin' && (
                                  <Button className="mt-3 w-full" size="sm" onClick={() => setAccountRoomId(room.id)}>
                                    <Clock className="mr-2 h-4 w-4" />
                                    Cobrar y registrar salida
                                  </Button>
                                )}
                              </div>
                            )}
                            {reservations.some(r => r.roomId === room.id) && (
                              <Button
                                className="mt-3 w-full"
                                variant="outline"
                                size="sm"
                                onClick={() => setAccountRoomId(room.id)}
                              >
                                Cuenta y consumos
                              </Button>
                            )}
                            {user?.role === 'owner' && (
                              <Button
                                className="mt-2 w-full"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingRoom(room);
                                  setForm({
                                    roomNumber: room.roomNumber,
                                    roomType: room.roomType,
                                    floor: String(room.floor),
                                    capacity: String(room.capacity),
                                    pricePerNight: String(room.pricePerNight),
                                  });
                                  setShowForm(true);
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                              >
                                Editar habitación
                              </Button>
                            )}
                          </Card>
                        );
                      })}
                  </div>
                </section>
              ))}
          </div>
        )}
        {accountRoomId && (
          <HotelAccountDialog
            key={accountRoomId}
            reservations={reservations.filter(r => r.roomId === accountRoomId)}
            initialId={
              reservationsByRoom.get(accountRoomId)?.id ||
              reservations.filter(r => r.roomId === accountRoomId).slice(-1)[0].id
            }
            onClose={() => setAccountRoomId(null)}
            onSaved={() => void load(true)}
          />
        )}
      </div>
    </Layout>
  );
}
