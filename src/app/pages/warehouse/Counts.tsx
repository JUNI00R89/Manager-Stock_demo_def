import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, CirclePlus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../utils/notifications';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Badge } from '../../components/ui/badge';
import { dataService, type PhysicalCountRecord } from '../../services/dataService';
import {
  dateTime,
  fmtQty,
  PageTitle,
  ProductSelect,
  useWarehousePermissions,
  useWarehouseRefs,
  withoutLine,
} from './shared';

type CountLine = { key: string; productId: string; countedQuantity: string };
const newLine = (): CountLine => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  productId: '',
  countedQuantity: '',
});
const statusLabels: Record<PhysicalCountRecord['status'], string> = {
  open: 'Abierto',
  closed: 'Cerrado',
  cancelled: 'Cancelado',
};

export function WarehouseCounts() {
  const { products, loading, reload } = useWarehouseRefs();
  const permissions = useWarehousePermissions();
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<CountLine[]>([newLine()]);
  const [counts, setCounts] = useState<PhysicalCountRecord[]>([]);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadCounts = async () => {
    setLoadingCounts(true);
    try {
      setCounts(await dataService.getPhysicalCounts(50));
    } catch (error) {
      toastError(error, 'No se pudieron cargar los conteos.');
    } finally {
      setLoadingCounts(false);
    }
  };
  useEffect(() => {
    void loadCounts();
  }, []);

  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const selectedIds = lines.map(line => line.productId).filter(Boolean);
  const duplicate = new Set(selectedIds).size !== selectedIds.length;
  const differences = lines.map(line => {
    const product = productById.get(line.productId);
    const counted = Number(line.countedQuantity);
    return product && line.countedQuantity !== '' && Number.isFinite(counted) ? counted - product.stock : null;
  });
  const differenceCount = differences.filter(value => value !== null && Math.abs(value) > 1e-9).length;
  const totalDifference = differences.reduce((sum, value) => sum + (value ?? 0), 0);

  const updateLine = (key: string, patch: Partial<CountLine>) =>
    setLines(current => current.map(line => (line.key === key ? { ...line, ...patch } : line)));
  const removeLine = (key: string) => setLines(current => withoutLine(current, key));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (duplicate) {
      toast.error('No repitas el mismo producto en un conteo.');
      return;
    }
    const valid = lines.filter(
      line =>
        line.productId &&
        line.countedQuantity !== '' &&
        Number.isFinite(Number(line.countedQuantity)) &&
        Number(line.countedQuantity) >= 0,
    );
    if (!valid.length) {
      toast.error('Agrega al menos un producto e indica la cantidad contada.');
      return;
    }
    if (valid.length !== lines.length) {
      toast.error('Completa la cantidad contada de todas las líneas.');
      return;
    }
    setSaving(true);
    try {
      const count = await dataService.createPhysicalCount({
        notes: notes.trim(),
        items: valid.map(line => ({ productId: line.productId, countedQuantity: Number(line.countedQuantity) })),
      });
      toast.success(`Conteo ${count.id} cerrado. Se generaron ${count.differenceCount} ajuste(s) por diferencia.`);
      setNotes('');
      setLines([newLine()]);
      await Promise.all([loadCounts(), reload()]);
    } catch (error) {
      toastError(error, 'No se pudo registrar el conteo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-7xl space-y-6">
        <PageTitle
          eyebrow="Bodega · Conteos"
          title="Conteo físico de inventario"
          description="Compara lo contado con lo que registra el sistema. Al cerrar el conteo se aplican ajustes trazables por cada diferencia."
          action={
            <Button
              variant="outline"
              onClick={() => void loadCounts()}
              disabled={loadingCounts}
              className="h-11 rounded-xl"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loadingCounts ? 'animate-spin' : ''}`} />
              Actualizar
            </Button>
          }
        />

        <div className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
          <Card className="rounded-2xl border-border/70 p-5 shadow-sm sm:p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/40">
                <ClipboardCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold">Nuevo conteo</h2>
                <p className="text-xs text-muted-foreground">
                  El conteo se cierra al guardar y aplica los ajustes de inmediato.
                </p>
              </div>
            </div>
            {!permissions.canAdjust ? (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                Tu rol no tiene permiso para realizar conteos físicos.
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1">
                  <Label className="text-xs">Notas del conteo</Label>
                  <Textarea
                    value={notes}
                    onChange={event => setNotes(event.target.value)}
                    rows={2}
                    maxLength={1000}
                    placeholder="Zona, responsable, turno, observaciones…"
                    className="rounded-xl"
                  />
                </div>
                <div className="rounded-xl border border-border/70 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Label className="text-xs">Productos contados *</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setLines(current => [...current, newLine()])}
                      className="rounded-lg"
                    >
                      <CirclePlus className="mr-1 h-4 w-4" />
                      Línea
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {lines.map(line => {
                      const product = productById.get(line.productId);
                      const counted = Number(line.countedQuantity);
                      const difference =
                        product && line.countedQuantity !== '' && Number.isFinite(counted)
                          ? counted - product.stock
                          : null;
                      return (
                        <div key={line.key} className="rounded-lg border border-border/60 bg-muted/20 p-2">
                          <div className="grid gap-2 sm:grid-cols-[1fr_120px_36px]">
                            <ProductSelect
                              products={products}
                              value={line.productId}
                              onChange={value => updateLine(line.key, { productId: value })}
                              className="h-10"
                            />
                            <Input
                              aria-label="Cantidad contada"
                              type="number"
                              min="0"
                              step="0.001"
                              value={line.countedQuantity}
                              onChange={event => updateLine(line.key, { countedQuantity: event.target.value })}
                              placeholder="Contado"
                              className="h-10 rounded-lg"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeLine(line.key)}
                              disabled={lines.length === 1}
                              aria-label="Quitar línea"
                              className="text-rose-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          {product && (
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span>
                                Sistema:{' '}
                                <strong className="text-foreground">
                                  {fmtQty(product.stock)} {product.unit}
                                </strong>
                              </span>
                              {difference !== null && (
                                <span>
                                  Diferencia:{' '}
                                  <strong
                                    className={
                                      Math.abs(difference) < 1e-9
                                        ? 'text-emerald-700'
                                        : difference > 0
                                          ? 'text-emerald-700'
                                          : 'text-rose-700'
                                    }
                                  >
                                    {difference > 0 ? '+' : ''}
                                    {fmtQty(difference)} {product.unit}
                                  </strong>
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {duplicate && (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                    Hay productos repetidos. Deja una sola línea por producto.
                  </p>
                )}
                <div className="flex flex-col gap-3 border-t border-border/70 pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">
                    {differenceCount} diferencia(s) · Variación neta:{' '}
                    <strong
                      className={totalDifference < 0 ? 'text-rose-700' : totalDifference > 0 ? 'text-emerald-700' : ''}
                    >
                      {totalDifference > 0 ? '+' : ''}
                      {fmtQty(totalDifference)}
                    </strong>
                  </p>
                  <Button
                    type="submit"
                    disabled={saving || loading || duplicate}
                    className="rounded-xl bg-orange-600 text-white hover:bg-orange-700"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? 'Guardando…' : 'Cerrar conteo'}
                  </Button>
                </div>
              </form>
            )}
          </Card>

          <Card className="rounded-2xl border-border/70 p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="font-semibold">Conteos recientes</h2>
              <p className="mt-1 text-sm text-muted-foreground">Historial de diferencias y ajustes generados</p>
            </div>
            {loadingCounts ? (
              <p className="text-sm text-muted-foreground">Cargando conteos…</p>
            ) : counts.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                Todavía no hay conteos físicos registrados.
              </div>
            ) : (
              <div className="max-h-[600px] space-y-3 overflow-y-auto pr-1">
                {counts.map(count => (
                  <details key={count.id} className="group rounded-xl border border-border/70 p-3">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{count.id}</p>
                          <Badge
                            variant="outline"
                            className={
                              count.status === 'closed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : ''
                            }
                          >
                            {statusLabels[count.status]}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {dateTime(count.createdAt)} · {count.createdByName || 'Sistema'} · {count.items.length}{' '}
                          producto(s)
                        </p>
                        {count.notes && <p className="mt-1 text-xs text-muted-foreground">{count.notes}</p>}
                      </div>
                      <div className="shrink-0 text-right">
                        <p
                          className={`text-sm font-bold ${count.totalDifference < 0 ? 'text-rose-700' : count.totalDifference > 0 ? 'text-emerald-700' : ''}`}
                        >
                          {count.totalDifference > 0 ? '+' : ''}
                          {fmtQty(count.totalDifference)}
                        </p>
                        <p className="text-xs text-muted-foreground">{count.differenceCount} dif.</p>
                      </div>
                    </summary>
                    <div className="mt-3 overflow-x-auto rounded-lg border border-border/60">
                      <table className="w-full min-w-[460px] text-xs">
                        <thead className="bg-muted/40 text-left uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="px-2 py-2 font-semibold">Producto</th>
                            <th className="px-2 py-2 text-right font-semibold">Sistema</th>
                            <th className="px-2 py-2 text-right font-semibold">Contado</th>
                            <th className="px-2 py-2 text-right font-semibold">Diferencia</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {count.items.map(item => (
                            <tr key={item.id}>
                              <td className="px-2 py-2">{item.productName}</td>
                              <td className="px-2 py-2 text-right tabular-nums">{fmtQty(item.systemQuantity)}</td>
                              <td className="px-2 py-2 text-right tabular-nums">{fmtQty(item.countedQuantity)}</td>
                              <td
                                className={`px-2 py-2 text-right font-semibold tabular-nums ${item.difference < 0 ? 'text-rose-700' : item.difference > 0 ? 'text-emerald-700' : 'text-muted-foreground'}`}
                              >
                                {item.difference > 0 ? '+' : ''}
                                {fmtQty(item.difference)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </Layout>
  );
}
