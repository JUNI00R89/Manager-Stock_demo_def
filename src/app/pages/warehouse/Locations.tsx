import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin, Package, Pencil, Plus, RefreshCw, Save, Trash2, Warehouse } from 'lucide-react';
import { toast } from 'sonner';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Badge } from '../../components/ui/badge';
import { dataService, type InventoryLocationRecord } from '../../services/dataService';
import { fmtQty, money, PageTitle, StatCard, useWarehousePermissions, useWarehouseRefs } from './shared';

type LocationDraft = {
  code: string; name: string; zone: string; aisle: string; rack: string;
  level: string; capacity: string; active: boolean;
};

const emptyDraft = (): LocationDraft => ({ code: '', name: '', zone: '', aisle: '', rack: '', level: '1', capacity: '100', active: true });

export function Locations() {
  const { locations, loading, reload } = useWarehouseRefs();
  const permissions = useWarehousePermissions();
  const canEdit = permissions.canEdit;
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<LocationDraft>(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    await reload();
  }, [reload]);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => locations.filter(location => {
    const term = search.trim().toLowerCase();
    return !term || `${location.code} ${location.name} ${location.label} ${location.zone}`.toLowerCase().includes(term);
  }), [locations, search]);

  const totalCapacity = locations.reduce((sum, location) => sum + (Number(location.capacity) || 0), 0);
  const totalStock = locations.reduce((sum, location) => sum + (Number(location.lotUnits) || 0), 0);
  const occupancyRate = totalCapacity > 0 ? Math.round((totalStock / totalCapacity) * 100) : 0;

  const startEdit = (location: InventoryLocationRecord) => {
    setEditingId(location.id);
    setDraft({ code: location.code, name: location.name, zone: location.zone, aisle: location.aisle, rack: location.rack, level: String(location.level), capacity: String(location.capacity), active: location.active });
  };
  const cancelEdit = () => { setEditingId(null); setDraft(emptyDraft()); };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.code.trim() || draft.code.trim().length < 2) { toast.error('El código de la ubicación es obligatorio.'); return; }
    if (!draft.aisle.trim() && !draft.rack.trim()) { toast.error('Indica pasillo y/o rack para ubicar el stock.'); return; }
    const payload = {
      code: draft.code.trim().toUpperCase(),
      name: draft.name.trim(),
      zone: draft.zone.trim(),
      aisle: draft.aisle.trim(),
      rack: draft.rack.trim(),
      level: Number(draft.level) || 1,
      capacity: Number(draft.capacity) || 0,
      active: draft.active,
    };
    setSaving(true);
    try {
      if (editingId) { await dataService.updateInventoryLocation(editingId, payload); toast.success('Ubicación actualizada.'); }
      else { await dataService.createInventoryLocation(payload); toast.success('Ubicación creada.'); }
      cancelEdit(); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar la ubicación.'); }
    finally { setSaving(false); }
  };

  const confirmDelete = async (location: InventoryLocationRecord) => {
    setDeletingId(location.id);
    try {
      const result = await dataService.deleteInventoryLocation(location.id);
      toast.success(result?.ok === false ? 'Ubicación desactivada.' : 'Ubicación eliminada.');
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo eliminar la ubicación.'); }
    finally { setDeletingId(null); }
  };

  return <Layout><div className="mx-auto max-w-7xl space-y-6">
    <PageTitle eyebrow="Bodega · Ubicaciones" title="Ubicaciones de bodega" description="Zonas, pasillos, racks y niveles. El stock se asigna a ubicaciones por defecto y por transferencia." action={<Button variant="outline" onClick={() => void load()} disabled={loading} className="h-11 rounded-xl"><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}/>Actualizar</Button>}/>

    <div className="grid gap-3 sm:grid-cols-3">
      <StatCard label="Ubicaciones activas" value={locations.length} hint="Configuradas para el negocio" icon={MapPin} tone="orange"/>
      <StatCard label="Capacidad total" value={fmtQty(totalCapacity)} icon={Warehouse} tone="blue"/>
      <StatCard label="Ocupación" value={`${occupancyRate}%`} hint={`${fmtQty(totalStock)} unidades con existencias`} icon={Package} tone={occupancyRate > 85 ? 'rose' : 'emerald'}/>
    </div>

    {canEdit && <Card className="rounded-2xl border-border/70 p-5 shadow-sm sm:p-6"><h2 className="font-semibold">{editingId ? 'Editar ubicación' : 'Nueva ubicación'}</h2><form onSubmit={save} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><div className="space-y-1"><Label className="text-xs">Código *</Label><Input value={draft.code} onChange={event => setDraft(prev => ({ ...prev, code: event.target.value }))} placeholder="Ej. A-1-R1" className="h-10 rounded-xl"/></div><div className="space-y-1"><Label className="text-xs">Nombre</Label><Input value={draft.name} onChange={event => setDraft(prev => ({ ...prev, name: event.target.value }))} placeholder="Ej. Cocina fría" className="h-10 rounded-xl"/></div><div className="space-y-1"><Label className="text-xs">Zona</Label><Input value={draft.zone} onChange={event => setDraft(prev => ({ ...prev, zone: event.target.value }))} placeholder="A" className="h-10 rounded-xl"/></div><div className="space-y-1"><Label className="text-xs">Pasillo</Label><Input value={draft.aisle} onChange={event => setDraft(prev => ({ ...prev, aisle: event.target.value }))} className="h-10 rounded-xl"/></div><div className="space-y-1"><Label className="text-xs">Rack</Label><Input value={draft.rack} onChange={event => setDraft(prev => ({ ...prev, rack: event.target.value }))} className="h-10 rounded-xl"/></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><div className="space-y-1"><Label className="text-xs">Nivel</Label><Input type="number" min="0" max="999" value={draft.level} onChange={event => setDraft(prev => ({ ...prev, level: event.target.value }))} className="h-10 rounded-xl"/></div><div className="space-y-1"><Label className="text-xs">Capacidad</Label><Input type="number" min="0" step="1" value={draft.capacity} onChange={event => setDraft(prev => ({ ...prev, capacity: event.target.value }))} className="h-10 rounded-xl"/></div><div className="flex items-end"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={event => setDraft(prev => ({ ...prev, active: event.target.checked }))} className="h-4 w-4 accent-[var(--brand-primary)]"/> Activa</label></div></div></div><div className="flex justify-end gap-2 border-t border-border/70 pt-3"><Button type="button" variant="outline" onClick={cancelEdit}>Cancelar</Button><Button type="submit" disabled={saving} className="rounded-xl bg-orange-600 text-white hover:bg-orange-700"><Save className="mr-2 h-4 w-4"/>Guardar</Button></div></form></Card>}

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map(location => { const occupancy = Math.round((Number(location.lotUnits) || 0) / Math.max(1, Number(location.capacity) || 1) * 100); const pct = Math.min(100, occupancy); return <Card key={location.id} className="rounded-2xl border-border/70 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold">{location.code}</h3><p className="mt-1 text-xs text-muted-foreground">{location.label || location.name || 'Ubicación'}</p></div><MapPin className="h-5 w-5 text-orange-500"/><Badge variant="outline" className={location.active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-700'}>{location.active ? 'Activa' : 'Inactiva'}</Badge></div>
        <div className="mt-3 rounded-xl border border-border/70 p-3"><div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Ocupación</span><span className="font-semibold">{fmtQty(location.lotUnits)} / {fmtQty(location.capacity)} ({pct}%)</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className={`bar-fill h-full rounded-full ${pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, pct)}%` }}/></div></div>
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>Productos</span><span>{location.productCount}</span><span>Lotes</span><span>{fmtQty(location.lotUnits)}</span></div>
        {canEdit && <div className="mt-4 flex gap-2 border-t border-border/70 pt-4"><Button size="sm" variant="outline" onClick={() => startEdit(location)} className="rounded-lg"><Pencil className="mr-2 h-4 w-4"/>Editar</Button><Button size="sm" variant="outline" onClick={() => setDeletingId(location.id)} disabled={deletingId === location.id} className="rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50"><Trash2 className="mr-2 h-4 w-4"/>Eliminar</Button></div>}</Card>);})}</div>
    {filtered.length === 0 && <Card className="rounded-2xl border-dashed p-10 text-center"><Warehouse className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50"/><h2 className="font-semibold">Sin ubicaciones</h2><p className="mt-1 text-sm text-muted-foreground">Crea la primera zona o pasillo de la bodega.</p></Card>}
  </div></Layout>;
}
