import { useEffect, useMemo, useState } from 'react';
import { Boxes, CalendarClock, Download, PackageMinus, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../utils/notifications';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { dataService, type InventoryLotRecord } from '../../services/dataService';
import { dateOnly, fmtQty, money, PageTitle, StatCard, useWarehouseRefs } from './shared';
import { downloadCsv } from '../../utils/csv';

const statusLabels: Record<InventoryLotRecord['status'], string> = {
  vencido: 'Vencido',
  por_vencer: 'Por vencer',
  vigente: 'Vigente',
  sin_vencimiento: 'Sin vencimiento',
};
const statusClasses: Record<InventoryLotRecord['status'], string> = {
  vencido: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300',
  por_vencer:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  vigente:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  sin_vencimiento: 'border-border bg-muted text-muted-foreground',
};

export function WarehouseLots() {
  const { locations } = useWarehouseRefs();
  const [lots, setLots] = useState<InventoryLotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [locationId, setLocationId] = useState('all');

  const load = async () => {
    setLoading(true);
    try {
      setLots(await dataService.getInventoryLots({ includeEmpty: false }));
    } catch (error) {
      toastError(error, 'No se pudieron cargar los lotes.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    return lots.filter(lot => {
      const matchesTerm =
        !term || `${lot.productName} ${lot.sku} ${lot.lotCode}`.toLocaleLowerCase('es').includes(term);
      const matchesStatus = status === 'all' || lot.status === status;
      const matchesLocation = locationId === 'all' || lot.locationId === locationId;
      return matchesTerm && matchesStatus && matchesLocation;
    });
  }, [lots, search, status, locationId]);

  const expired = lots.filter(lot => lot.status === 'vencido');
  const expiring = lots.filter(lot => lot.status === 'por_vencer');
  const totalValue = filtered.reduce((sum, lot) => sum + lot.value, 0);
  const totalUnits = filtered.reduce((sum, lot) => sum + lot.quantity, 0);

  const exportCsv = () => {
    downloadCsv(`lotes-${new Date().toISOString().slice(0, 10)}.csv`, [
      [
        'Producto',
        'SKU',
        'Lote',
        'Cantidad',
        'Unidad',
        'Vencimiento',
        'Días restantes',
        'Estado',
        'Ubicación',
        'Costo unitario',
        'Valor',
      ],
      ...filtered.map(lot => [
        lot.productName,
        lot.sku,
        lot.lotCode,
        lot.quantity,
        lot.productUnit,
        lot.expiryDate || '',
        lot.daysLeft ?? '',
        statusLabels[lot.status],
        lot.locationCode || '',
        lot.unitCost,
        lot.value,
      ]),
    ]);
  };

  return (
    <Layout>
      <div className="mx-auto max-w-7xl space-y-6">
        <PageTitle
          eyebrow="Bodega · Lotes"
          title="Lotes y vencimientos"
          description="Controla existencias por lote, ubicación y fecha de vencimiento. Las salidas sin lote específico consumen primero lo más próximo a vencer (FEFO)."
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void load()} disabled={loading} className="h-11 rounded-xl">
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Actualizar
              </Button>
              <Button variant="outline" onClick={exportCsv} disabled={!filtered.length} className="h-11 rounded-xl">
                <Download className="mr-2 h-4 w-4" />
                CSV
              </Button>
            </div>
          }
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Lotes con existencias"
            value={lots.length}
            hint={`${fmtQty(lots.reduce((sum, lot) => sum + lot.quantity, 0))} unidades en total`}
            icon={Boxes}
            tone="orange"
          />
          <StatCard
            label="Por vencer"
            value={expiring.length}
            hint="Dentro del umbral configurado"
            icon={CalendarClock}
            tone={expiring.length ? 'amber' : 'emerald'}
          />
          <StatCard
            label="Vencidos"
            value={expired.length}
            hint="Requieren baja o revisión"
            icon={PackageMinus}
            tone={expired.length ? 'rose' : 'emerald'}
          />
          <StatCard
            label="Valor filtrado"
            value={money(totalValue)}
            hint={`${fmtQty(totalUnits)} unidades visibles`}
            icon={Boxes}
            tone="blue"
          />
        </div>

        <Card className="rounded-2xl border-border/70 p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-[1fr_190px_230px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Buscar producto, SKU o lote…"
                className="h-11 rounded-xl pl-9"
              />
            </div>
            <select
              value={status}
              onChange={event => setStatus(event.target.value)}
              className="h-11 rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="all">Todos los estados</option>
              <option value="por_vencer">Por vencer</option>
              <option value="vencido">Vencidos</option>
              <option value="vigente">Vigentes</option>
              <option value="sin_vencimiento">Sin vencimiento</option>
            </select>
            <select
              value={locationId}
              onChange={event => setLocationId(event.target.value)}
              className="h-11 rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="all">Todas las ubicaciones</option>
              {locations.map(location => (
                <option key={location.id} value={location.id}>
                  {location.code} · {location.name || location.label}
                </option>
              ))}
            </select>
          </div>
        </Card>

        <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-4 font-semibold">Producto</th>
                  <th className="px-5 py-4 font-semibold">Lote</th>
                  <th className="px-5 py-4 font-semibold">Ubicación</th>
                  <th className="px-5 py-4 text-right font-semibold">Cantidad</th>
                  <th className="px-5 py-4 font-semibold">Vencimiento</th>
                  <th className="px-5 py-4 text-right font-semibold">Días</th>
                  <th className="px-5 py-4 font-semibold">Estado</th>
                  <th className="px-5 py-4 text-right font-semibold">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-muted-foreground">
                      Cargando lotes…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-muted-foreground">
                      No hay lotes que coincidan con los filtros. Registra entradas con lote o vencimiento para verlos
                      aquí.
                    </td>
                  </tr>
                ) : (
                  filtered.map(lot => (
                    <tr key={lot.id} className="transition hover:bg-muted/20">
                      <td className="px-5 py-4">
                        <p className="font-semibold">{lot.productName}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">SKU {lot.sku}</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-medium">{lot.lotCode || 'Sin código'}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">Recibido {dateOnly(lot.receivedAt)}</p>
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">
                        {lot.locationCode ? `${lot.locationCode} · ${lot.locationName || ''}` : 'Sin ubicación'}
                      </td>
                      <td className="px-5 py-4 text-right font-semibold tabular-nums">
                        {fmtQty(lot.quantity)}{' '}
                        <span className="font-normal text-muted-foreground">{lot.productUnit}</span>
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">
                        {lot.expiryDate ? dateOnly(lot.expiryDate) : 'Sin vencimiento'}
                      </td>
                      <td
                        className={`px-5 py-4 text-right font-semibold tabular-nums ${lot.daysLeft !== null && lot.daysLeft < 0 ? 'text-rose-600' : lot.daysLeft !== null && lot.daysLeft <= 30 ? 'text-amber-700' : ''}`}
                      >
                        {lot.daysLeft === null ? '—' : lot.daysLeft}
                      </td>
                      <td className="px-5 py-4">
                        <Badge variant="outline" className={statusClasses[lot.status]}>
                          {statusLabels[lot.status]}
                        </Badge>
                      </td>
                      <td className="px-5 py-4 text-right tabular-nums">
                        <p className="font-semibold">{money(lot.value)}</p>
                        <p className="text-xs text-muted-foreground">{money(lot.unitCost)} / unidad</p>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="rounded-2xl border-border/70 p-5 text-sm text-muted-foreground">
          <p>
            Los lotes vencidos o próximos a vencer deben darse de baja como merma con el motivo correspondiente. Si
            necesitas mover una partida entre zonas, crea un traslado seleccionando el lote de origen.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild variant="outline" className="rounded-xl">
              <a href="/warehouse/waste">Registrar merma</a>
            </Button>
            <Button asChild variant="outline" className="rounded-xl">
              <a href="/warehouse/transfers">Crear traslado</a>
            </Button>
          </div>
        </Card>
      </div>
    </Layout>
  );
}
