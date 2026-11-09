import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Layout } from '../../components/Layout';
import { Button } from '../../components/ui/button';
import { getHotelRooms, getHotelReservations, getHotelAccount, type HotelRoomRecord, type HotelReservationRecord } from '../../services/dataService';
import { HotelAccountDialog } from './HotelAccountDialog';
import { toastError } from '../../utils/notifications';

const bogotaDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function HotelToday() {
  const [rooms, setRooms] = useState<HotelRoomRecord[]>([]);
  const [reservations, setReservations] = useState<HotelReservationRecord[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [today, setToday] = useState(bogotaDate);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [roomRows, bookingRows] = await Promise.all([getHotelRooms(), getHotelReservations()]);
      setRooms(roomRows); setReservations(bookingRows);
      const pending = bookingRows.filter(r => r.status === 'checkin' || r.status === 'confirmed' && r.checkIn <= today);
      const result: Record<string, number> = {};
      // Bound parallel requests for larger hotels.
      for (let i = 0; i < pending.length; i += 5) {
        const batch = await Promise.all(pending.slice(i, i + 5).map(async r => { const account = await getHotelAccount(r.id); return [r.id, account.balance] as const; }));
        batch.forEach(([id, balance]) => { result[id] = balance; });
      }
      setBalances(result);
    } catch (e) { setError('No se pudo actualizar el resumen completo.'); toastError(e, 'No se pudo actualizar el hotel.'); }
    finally { setLoading(false); }
  }, [today]);
  useEffect(() => { void load(); const timer = setInterval(() => setToday(bogotaDate()), 60000); return () => clearInterval(timer); }, [load]);
  const arrivals = reservations.filter(r => r.status === 'confirmed' && r.checkIn <= today);
  const departures = reservations.filter(r => r.status === 'checkin' && r.checkOut <= today);
  const dirty = rooms.filter(r => ['sucia', 'en_limpieza'].includes(r.cleaningStatus || '') || r.status === 'cleaning');
  const ready = rooms.filter(r => r.status === 'available' && ['lista', 'inspeccionada'].includes(r.cleaningStatus || 'inspeccionada'));
  const section = (title: string, rows: HotelReservationRecord[]) => <section className="border rounded-xl p-4 space-y-3"><h2 className="font-semibold">{title} · {rows.length}</h2>{rows.map(r => <button key={r.id} className="w-full text-left rounded-lg border p-3 min-h-11 space-y-1 hover:bg-accent" onClick={() => setSelected(r.id)}><span className="block font-medium">Hab. {r.roomNumber} · {r.guestName}</span><span className="block text-sm text-muted-foreground">{r.checkIn} → {r.checkOut}</span>{balances[r.id] !== undefined && <span className="block text-sm">Saldo: {balances[r.id].toLocaleString('es-CO')} COP</span>}</button>)}{!rows.length && <p className="text-sm text-muted-foreground">Sin pendientes.</p>}</section>;
  return <Layout><div className="space-y-5 max-w-6xl mx-auto"><div className="flex justify-between flex-wrap gap-3"><div><h1 className="text-2xl font-bold">Hotel hoy</h1><p className="text-muted-foreground">{today} · Hora de Colombia · Incluye llegadas y salidas atrasadas.</p></div><Button className="min-h-11" variant="outline" onClick={() => void load()} disabled={loading}>{loading ? 'Actualizando…' : 'Actualizar'}</Button></div>{error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[['Llegadas pendientes', arrivals.length], ['Salidas pendientes', departures.length], ['Habitaciones listas', ready.length], ['Limpieza pendiente', dirty.length]].map(([label, n]) => <div className="rounded-xl border p-4" key={label}><p className="text-sm text-muted-foreground">{label}</p><p className="text-3xl font-bold mt-2">{n}</p></div>)}</div>
    <div className="grid gap-4 md:grid-cols-2">{section('Llegadas', arrivals)}{section('Salidas', departures)}{section('Huéspedes alojados con saldo', reservations.filter(r => r.status === 'checkin' && balances[r.id] > 0))}<section className="rounded-xl border p-4 space-y-3"><h2 className="font-semibold">Limpieza pendiente</h2>{dirty.map(r => <p className="border rounded-lg p-3" key={r.id}>Hab. {r.roomNumber} · {r.cleaningAssignee || 'Sin asignar'}</p>)}<Link className="inline-block underline py-3" to="/hotel/housekeeping">Organizar limpieza</Link><Link className="block underline py-3" to="/hotel/availability">Abrir calendario</Link></section></div>
    {selected && <HotelAccountDialog initialId={selected} reservations={reservations.filter(r => r.id === selected)} onClose={() => setSelected(null)} onSaved={() => void load()} />}
  </div></Layout>;
}
