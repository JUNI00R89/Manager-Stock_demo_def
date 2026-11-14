import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpFromLine, CirclePlus, PackageMinus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../utils/notifications';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { dataService, type InventoryLotRecord, type InventoryMovementRecord } from '../../services/dataService';
import type { Product } from '../../utils/types';
import {
  BarcodeScan,
  dateOnly,
  dateTime,
  fmtQty,
  LotSelect,
  PageTitle,
  ProductSelect,
  useWarehouseRefs,
  withoutLine,
} from './shared';

type ExitLine = { key: string; productId: string; quantity: string; unit: string; lotId: string };
const newLine = (): ExitLine => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  productId: '',
  quantity: '1',
  unit: '',
  lotId: '',
});
const wasteReasons = [
  { code: 'vencido', label: 'Vencido', description: 'Producto caducado o fuera de fecha.' },
  { code: 'danado', label: 'Dañado', description: 'Empaque roto, contaminación o deterioro.' },
  {
    code: 'error_preparacion',
    label: 'Error de preparación',
    description: 'Producto mal preparado o devuelto por cocina.',
  },
  { code: 'otro', label: 'Otro', description: 'Otra causa justificada.' },
] as const;
const exitReasons = {
  consumption: 'Consumo interno',
  direct_sale: 'Venta directa',
  other: 'Otra salida',
} as const;

export function WarehouseExits({ mode }: { mode: 'exit' | 'waste' }) {
  const isWaste = mode === 'waste';
  const { products, locations, loading, reload } = useWarehouseRefs();
  const [exitType, setExitType] = useState<keyof typeof exitReasons>('consumption');
  const [reason, setReason] = useState('');
  const [reasonCode, setReasonCode] = useState<(typeof wasteReasons)[number]['code']>('vencido');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<ExitLine[]>([newLine()]);
  const [lots, setLots] = useState<InventoryLotRecord[]>([]);
  const [recent, setRecent] = useState<InventoryMovementRecord[]>([]);
  const [saving, setSaving] = useState(false);

  const loadLots = async () => {
    try {
      setLots(await dataService.getInventoryLots({ includeEmpty: false }));
    } catch {
      /* los lotes son opcionales */
    }
  };
  const loadRecent = async () => {
    try {
      setRecent(await dataService.getInventoryMovements(300, undefined, { types: isWaste ? 'waste' : 'consumption' }));
    } catch {
      /* historial informativo */
    }
  };
  useEffect(() => {
    void loadLots();
    void loadRecent();
  }, [mode]);

  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const wasteReason = wasteReasons.find(item => item.code === reasonCode)!;
  const effectiveReason = isWaste ? reason.trim() || wasteReason.label : reason.trim() || exitReasons[exitType];
  const totalUnits = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);

  const updateLine = (key: string, patch: Partial<ExitLine>) =>
    setLines(current => current.map(line => (line.key === key ? { ...line, ...patch } : line)));
  const changeProduct = (key: string, productId: string) => {
    const product = productById.get(productId);
    updateLine(key, { productId, unit: product?.unit || '', lotId: '' });
  };
  const removeLine = (key: string) => setLines(current => withoutLine(current, key));
  const addScannedProduct = (scanned: Product[]) => {
    const product = scanned[0];
    if (product) setLines(current => [...current, { ...newLine(), productId: product.id, unit: product.unit || '' }]);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const invalid = lines.find(
      line => !line.productId || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0,
    );
    if (invalid) {
      toast.error('Selecciona productos y cantidades mayores que cero.');
      return;
    }
    if (isWaste && (reason.trim() || wasteReason.label).length < 3) {
      toast.error('Escribe el motivo de la merma.');
      return;
    }
    setSaving(true);
    try {
      const items = lines.map(line => ({
        productId: line.productId,
        quantity: Number(line.quantity),
        unit: line.unit || undefined,
        lotId: line.lotId || null,
      }));
      const operation = isWaste
        ? await dataService.createInventoryWaste({
            reasonCode,
            reason: reason.trim() || wasteReason.label,
            notes: notes.trim(),
            items,
          })
        : await dataService.createInventoryExit({ exitType, reason: reason.trim(), notes: notes.trim(), items });
      toast.success(`${isWaste ? 'Merma' : 'Salida'} ${operation.id} registrada correctamente.`);
      setLines([newLine()]);
      setReason('');
      setNotes('');
      await Promise.all([reload(), loadLots(), loadRecent()]);
    } catch (error) {
      toastError(error, `No se pudo registrar la ${isWaste ? 'merma' : 'salida'}.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-7xl space-y-6">
        <PageTitle
          eyebrow={`Bodega · ${isWaste ? 'Mermas' : 'Salidas'}`}
          title={isWaste ? 'Registrar merma de inventario' : 'Registrar salida de inventario'}
          description={
            isWaste
              ? 'Clasifica cada pérdida con un motivo obligatorio (vencido, dañado, error de preparación u otro) para calcular su costo real.'
              : 'Consumo interno, venta directa u otras salidas. Si hay lotes, se descuentan automáticamente por FEFO.'
          }
        />

        <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
          <Card className="rounded-2xl border-border/70 p-5 shadow-sm sm:p-6">
            <form onSubmit={submit} className="space-y-5">
              {isWaste ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="waste-reason">Motivo de la merma *</Label>
                    <select
                      id="waste-reason"
                      value={reasonCode}
                      onChange={event => {
                        const next = event.target.value as typeof reasonCode;
                        setReasonCode(next);
                        setReason(wasteReasons.find(item => item.code === next)?.label || '');
                      }}
                      className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                    >
                      {wasteReasons.map(item => (
                        <option key={item.code} value={item.code}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">{wasteReason.description}</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="waste-detail">Detalle del motivo *</Label>
                    <Input
                      id="waste-detail"
                      value={reason}
                      onChange={event => setReason(event.target.value)}
                      maxLength={300}
                      placeholder={wasteReason.label}
                      className="h-11 rounded-xl"
                    />
                    <p className="text-xs text-muted-foreground">Obligatorio para auditoría y reportes de costo.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="exit-type">Tipo de salida *</Label>
                  <select
                    id="exit-type"
                    value={exitType}
                    onChange={event => setExitType(event.target.value as keyof typeof exitReasons)}
                    className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                  >
                    {Object.entries(exitReasons).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="reason">Motivo o justificación</Label>
                <Input
                  id="reason"
                  value={reason}
                  onChange={event => setReason(event.target.value)}
                  maxLength={300}
                  placeholder={effectiveReason}
                  className="h-11 rounded-xl"
                />
              </div>

              <div className="rounded-2xl border border-border/70 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">Productos a retirar</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Selecciona un lote cuando necesites retirar una partida específica; de lo contrario se aplica
                      FEFO.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setLines(current => [...current, newLine()])}
                    className="h-9 shrink-0 rounded-lg"
                  >
                    <CirclePlus className="mr-2 h-4 w-4" />
                    Agregar línea
                  </Button>
                </div>
                <div className="space-y-3">
                  {lines.map((line, index) => {
                    const product = productById.get(line.productId);
                    const lineLots = lots.filter(lot => lot.productId === line.productId);
                    return (
                      <div key={line.key} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <div className="space-y-1 sm:col-span-2 lg:col-span-4">
                            <Label className="text-xs">Producto *</Label>
                            <ProductSelect
                              products={products}
                              value={line.productId}
                              onChange={value => changeProduct(line.key, value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Cantidad *</Label>
                            <Input
                              type="number"
                              min="0.001"
                              step="0.001"
                              value={line.quantity}
                              onChange={event => updateLine(line.key, { quantity: event.target.value })}
                              className="h-11 rounded-xl bg-card"
                            />
                            {product && (
                              <p
                                className={`text-xs ${product.stock < Number(line.quantity) ? 'text-rose-600' : 'text-muted-foreground'}`}
                              >
                                Disponible: {fmtQty(product.stock)} {product.unit}
                              </p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Unidad</Label>
                            <Input
                              value={line.unit}
                              onChange={event => updateLine(line.key, { unit: event.target.value })}
                              placeholder={product?.unit || 'unidad'}
                              className="h-11 rounded-xl bg-card"
                            />
                          </div>
                          <div className="space-y-1 sm:col-span-2">
                            <Label className="text-xs">Lote específico (opcional)</Label>
                            <LotSelect
                              lots={lineLots}
                              value={line.lotId}
                              onChange={value => updateLine(line.key, { lotId: value })}
                            />
                          </div>
                          <div className="flex items-end justify-end sm:col-span-2 lg:col-span-4">
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
                        </div>
                        {line.lotId && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {(() => {
                              const lot = lineLots.find(item => item.id === line.lotId);
                              return lot
                                ? `Lote ${lot.lotCode || 'sin código'} · ${fmtQty(lot.quantity)} disponibles · vence ${dateOnly(lot.expiryDate)}`
                                : '';
                            })()}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notas (opcional)</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={event => setNotes(event.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="Detalle adicional, responsable, área…"
                  className="rounded-xl"
                />
              </div>

              <div className="flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted-foreground">
                  {lines.length} línea(s) · {fmtQty(totalUnits)} unidades · Motivo:{' '}
                  <span className="font-semibold text-foreground">{effectiveReason}</span>
                </div>
                <Button
                  type="submit"
                  disabled={saving || loading}
                  className={`rounded-xl text-white ${isWaste ? 'bg-rose-600 hover:bg-rose-700' : 'bg-orange-600 hover:bg-orange-700'}`}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Registrando…' : isWaste ? 'Registrar merma' : 'Registrar salida'}
                </Button>
              </div>
            </form>
          </Card>

          <div className="space-y-5">
            <Card className="rounded-2xl border-border/70 p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${isWaste ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40' : 'bg-orange-50 text-orange-600 dark:bg-orange-950/40'}`}
                >
                  {isWaste ? <PackageMinus className="h-5 w-5" /> : <ArrowUpFromLine className="h-5 w-5" />}
                </div>
                <div>
                  <h2 className="font-semibold">Escáner de códigos</h2>
                  <p className="text-xs text-muted-foreground">Busca por código de barras o SKU y agrega la línea.</p>
                </div>
              </div>
              <div className="mt-4">
                <BarcodeScan onProducts={addScannedProduct} />
              </div>
            </Card>

            {isWaste && (
              <Card className="rounded-2xl border-amber-200 bg-amber-50/70 p-5 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-semibold">Motivos obligatorios</p>
                    <ul className="mt-2 space-y-1 text-xs leading-5">
                      {wasteReasons.map(item => (
                        <li key={item.code}>
                          • <strong>{item.label}</strong>: {item.description}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Card>
            )}

            {locations.length === 0 && (
              <Card className="rounded-2xl border-border/70 p-5 text-sm text-muted-foreground">
                Aún no hay ubicaciones configuradas. Puedes registrar salidas sin ubicación; para traslados y límites
                por zona, crea ubicaciones en{' '}
                <a href="/warehouse/locations" className="font-semibold text-orange-600 hover:underline">
                  Ubicaciones
                </a>
                .
              </Card>
            )}

            <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
              <div className="border-b border-border p-5">
                <h2 className="font-semibold">Últimas {isWaste ? 'mermas' : 'salidas'}</h2>
                <p className="mt-1 text-sm text-muted-foreground">Historial reciente con usuario y motivo</p>
              </div>
              <div className="max-h-[380px] divide-y divide-border/60 overflow-y-auto">
                {recent.length === 0 ? (
                  <p className="p-6 text-sm text-muted-foreground">No hay registros todavía.</p>
                ) : (
                  recent.slice(0, 20).map(movement => (
                    <div key={movement.id} className="flex items-start gap-3 p-4">
                      <span
                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isWaste ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40' : 'bg-orange-50 text-orange-700 dark:bg-orange-950/40'}`}
                      >
                        {isWaste ? <PackageMinus className="h-4 w-4" /> : <ArrowUpFromLine className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{movement.productName}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {movement.reason || movement.note} · {dateTime(movement.createdAt)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-rose-700">{fmtQty(movement.quantityDelta)}</p>
                        <p className="text-xs text-muted-foreground">{movement.createdByName || ''}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
