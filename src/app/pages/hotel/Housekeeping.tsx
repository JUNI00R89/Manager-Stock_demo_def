import { useState, useEffect, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Building2, CheckCircle2, Clock, AlertTriangle, User, RefreshCw } from 'lucide-react';
import { getHotelRooms, updateHousekeeping, type HotelRoomRecord, type CleaningStatus } from '../../services/dataService';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'sonner';

type EstadoLimpieza = CleaningStatus;

const LIMPIEZA_CONFIG: Record<EstadoLimpieza, { label: string; color: string; bg: string; icon: React.ElementType; next: EstadoLimpieza | null }> = {
  sucia:         { label: 'Sucia',         color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800',    icon: AlertTriangle, next: 'en_limpieza' },
  en_limpieza:   { label: 'En limpieza',   color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800',   icon: Clock,         next: 'lista' },
  lista:         { label: 'Lista',         color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800', icon: CheckCircle2,  next: 'inspeccionada' },
  inspeccionada: { label: 'Inspeccionada', color: 'text-green-600',  bg: 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800', icon: CheckCircle2,  next: null },
};


export function Housekeeping() {
  const { user } = useAuth();
  const canManage = user?.role === 'owner' || user?.role === 'business_admin' || user?.permissions?.includes('hotel.manage');
  const [rooms, setRooms] = useState<HotelRoomRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [filterPiso, setFilterPiso] = useState<number | 'todos'>('todos');
  const [filterEstado, setFilterEstado] = useState<EstadoLimpieza | 'todos'>('todos');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    setLoading(true);
    try { setRooms(await getHotelRooms()); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron cargar las habitaciones.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const habitaciones = rooms.map(room => ({ ...room, numero: room.roomNumber, piso: room.floor, tipo: room.roomType,
    capacidad: room.capacity, estadoLimpieza: room.cleaningStatus || (room.status === 'cleaning' ? 'sucia' : 'inspeccionada') as EstadoLimpieza }));
  const pisos = Array.from(new Set(habitaciones.map(h => h.piso))).sort((a, b) => a - b);
  const filtered = habitaciones.filter(h => (filterPiso === 'todos' || h.piso === filterPiso) && (filterEstado === 'todos' || h.estadoLimpieza === filterEstado));
  const save = async (id: string, next: EstadoLimpieza, assignee?: string) => {
    const room = habitaciones.find(row => row.id === id);
    if (!room || busy || !canManage) return;
    setBusy(id);
    try {
      const updated = await updateHousekeeping(id, { cleaningStatus: next, cleaningAssignee: assignee ?? room.cleaningAssignee ?? '', expectedStatus: room.estadoLimpieza });
      setRooms(prev => prev.map(row => row.id === id ? updated : row));
      toast.success(`Hab. ${room.numero}: limpieza guardada`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo guardar la limpieza.'); }
    finally { setBusy(null); }
  };
  const advanceState = (id: string) => {
    const room = habitaciones.find(row => row.id === id);
    if (!room) return;
    const next = LIMPIEZA_CONFIG[room.estadoLimpieza].next;
    if (next) void save(id, next);
  };

  const counts: Record<EstadoLimpieza, number> = {
    sucia: habitaciones.filter(h => h.estadoLimpieza === 'sucia').length,
    en_limpieza: habitaciones.filter(h => h.estadoLimpieza === 'en_limpieza').length,
    lista: habitaciones.filter(h => h.estadoLimpieza === 'lista').length,
    inspeccionada: habitaciones.filter(h => h.estadoLimpieza === 'inspeccionada').length,
  };

  return (
    <Layout>
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Building2 className="text-orange-500" size={24} /> Tablero de Limpieza
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Estado de habitaciones por piso</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || !!busy} className="self-start sm:self-auto">
            <RefreshCw size={16} className="mr-1.5" /> Actualizar
          </Button>
        </div>

        {loading && <p role="status">Cargando habitaciones…</p>}
        {error && <p role="alert" className="text-red-600">{error}</p>}
        {!loading && !error && !habitaciones.length && <p>No hay habitaciones registradas. Crea las habitaciones desde el módulo de Habitaciones.</p>}
        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(Object.entries(LIMPIEZA_CONFIG) as [EstadoLimpieza, typeof LIMPIEZA_CONFIG[EstadoLimpieza]][]).map(([estado, cfg]) => {
            const Icon = cfg.icon;
            return (
              <Card
                key={estado}
                className={`p-4 border cursor-pointer hover:shadow-sm transition-shadow ${filterEstado === estado ? 'ring-2 ring-orange-500' : 'border-border'}`}
                onClick={() => setFilterEstado(filterEstado === estado ? 'todos' : estado)}
              >
                <div className="flex items-center gap-2">
                  <Icon size={18} className={cfg.color} />
                  <div>
                    <p className="text-2xl font-bold text-foreground">{counts[estado]}</p>
                    <p className="text-[10px] text-muted-foreground">{cfg.label}</p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setFilterPiso('todos')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filterPiso === 'todos' ? 'bg-orange-500 text-white' : 'bg-accent text-muted-foreground hover:bg-orange-50 dark:hover:bg-orange-950/30'}`}>
            Todos los pisos
          </button>
          {pisos.map(piso => (
            <button key={piso} onClick={() => setFilterPiso(piso)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filterPiso === piso ? 'bg-orange-500 text-white' : 'bg-accent text-muted-foreground hover:bg-orange-50 dark:hover:bg-orange-950/30'}`}>
              Piso {piso}
            </button>
          ))}
        </div>

        {/* Grid by floor */}
        {(filterPiso === 'todos' ? pisos : [filterPiso as number]).map(piso => {
          const habitsPiso = filtered.filter(h => h.piso === piso);
          if (habitsPiso.length === 0) return null;
          return (
            <div key={piso}>
              <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                <Building2 size={14} className="text-orange-500" /> Piso {piso}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {habitsPiso.map(hab => {
                  const cfg = LIMPIEZA_CONFIG[hab.estadoLimpieza];
                  const Icon = cfg.icon;
                  const personal = hab.cleaningAssignee;

                  return (
                    <Card key={hab.id} className={`p-4 border ${cfg.bg}`}>
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-bold text-foreground text-base">Hab. {hab.numero}</p>
                          <p className="text-xs text-muted-foreground capitalize">{hab.tipo} · {hab.capacidad} personas</p>
                        </div>
                        <Badge className={`${cfg.bg} ${cfg.color} border-0 text-xs flex items-center gap-1`}>
                          <Icon size={10} /> {cfg.label}
                        </Badge>
                      </div>

                      {personal && (
                        <div className="flex items-center gap-1.5 mb-3 text-xs text-muted-foreground">
                          <User size={12} />
                          <span>{personal}</span>
                        </div>
                      )}

                      <div className="flex gap-2">
                        {cfg.next && canManage && (
                          <Button size="sm" disabled={!!busy} onClick={() => advanceState(hab.id)} className="flex-1 h-8 text-xs bg-orange-500 hover:bg-orange-600 text-white">
                            <Icon size={12} className="mr-1" /> {LIMPIEZA_CONFIG[cfg.next].label}
                          </Button>
                        )}
                        {canManage && (
                          <div className="flex flex-col gap-1">
                            <input aria-label={`Responsable de habitación ${hab.numero}`} placeholder="Responsable" className="w-full rounded border p-1 text-sm" value={drafts[hab.id] ?? personal ?? ''} onChange={e => setDrafts(prev => ({ ...prev, [hab.id]: e.target.value }))} maxLength={120} />
                            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void save(hab.id, hab.estadoLimpieza, drafts[hab.id] ?? personal ?? '')}>Guardar responsable</Button>
                            {hab.estadoLimpieza === 'inspeccionada' && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void save(hab.id, 'sucia')}>Marcar sucia</Button>}
                          </div>
                        )}
                        {hab.estadoLimpieza === 'inspeccionada' && (
                          <div className="flex-1 flex items-center justify-center gap-1 text-green-600 text-xs font-semibold">
                            <CheckCircle2 size={14} /> Lista para huésped
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
