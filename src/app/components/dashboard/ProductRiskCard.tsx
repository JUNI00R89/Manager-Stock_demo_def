import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, GitCompareArrows, PackageX, PauseCircle, ShieldCheck, Sigma, TrendingUp, Wallet } from 'lucide-react';
import { Card } from '../ui/card';
import type { SaleRecord } from '../../services/dataService';
import type { Product } from '../../utils/mockData';
import { analyzeProductRisk, type ProductRiskLevel, type ProductRiskRow } from '../../utils/productRisk';
import { analyzeInventoryScience, anchorOptions, buildComboPlan } from '../../utils/commercialScience';

const money = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
const coverText = (days: number) => (Number.isFinite(days) ? `${Math.round(days)} d` : '∞');

const RISK_ORDER: ProductRiskLevel[] = ['quiebre', 'critico', 'sobre_stock', 'sin_rotacion', 'ok'];
const RISK_LABEL: Record<ProductRiskLevel, string> = {
  quiebre: 'Quiebre',
  critico: 'Cobertura crítica',
  sobre_stock: 'Sobre-stock',
  sin_rotacion: 'Sin rotación',
  ok: 'Saludable',
};
const RISK_CLASS: Record<ProductRiskLevel, string> = {
  quiebre: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  critico: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  sobre_stock: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
  sin_rotacion: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  ok: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
};
const ABC_CLASS = {
  A: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  B: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  C: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};
const XYZ_CLASS = {
  X: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  Y: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  Z: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
};

type Tab = 'riesgos' | 'combos' | 'ciencia';

interface ProductRiskCardProps {
  products: Product[];
  sales: SaleRecord[];
}

/**
 * Plan anti-pérdidas + ciencia de datos comercial:
 * riesgos de inventario, combos factibles con el stock actual y política
 * estadística de inventario (ABC/XYZ, seguridad, EOQ).
 */
export function ProductRiskCard({ products, sales }: ProductRiskCardProps) {
  const [tab, setTab] = useState<Tab>('riesgos');
  const [showDetail, setShowDetail] = useState(true);
  const [anchorId, setAnchorId] = useState('');

  const report = useMemo(() => analyzeProductRisk(products, sales, 30), [products, sales]);
  const anchors = useMemo(() => anchorOptions(products, sales, 30), [products, sales]);
  const science = useMemo(() => analyzeInventoryScience(products, sales, 30), [products, sales]);
  const selectedAnchor = anchorId || anchors.find(anchor => anchor.stock > 0)?.id || anchors[0]?.id || '';
  const combo = useMemo(
    () => (selectedAnchor ? buildComboPlan(selectedAnchor, products, sales, 30) : null),
    [selectedAnchor, products, sales],
  );

  if (!report) return null;

  const atRisk = [...report.stockouts, ...report.critical];
  const freeze = report.overstock.slice(0, 2);
  const hasRisks = atRisk.length > 0 || freeze.length > 0 || report.dead.length > 0;
  const detailRows: ProductRiskRow[] = [...report.rows].sort((a, b) => {
    const byRisk = RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk);
    if (byRisk !== 0) return byRisk;
    return a.coverDays - b.coverDays;
  });
  const bestPair = science.bestPair;
  const bestPairNames = bestPair
    ? [products.find(product => product.id === bestPair.anchorId)?.name, products.find(product => product.id === bestPair.partnerId)?.name].filter(Boolean).join(' + ')
    : '—';
  const headline = combo?.trio ?? (combo?.offers[0]
    ? {
        partners: [combo.offers[0].partner],
        maxCombos: combo.offers[0].maxCombos,
        limiting: combo.offers[0].limiting,
        revenue: combo.offers[0].revenue,
        margin: combo.offers[0].margin,
      }
    : null);

  const tabs: { id: Tab; label: string; icon: typeof AlertTriangle; highlight?: boolean }[] = [
    { id: 'riesgos', label: 'Riesgos', icon: AlertTriangle },
    { id: 'combos', label: 'Combos', icon: GitCompareArrows, highlight: true },
    { id: 'ciencia', label: 'Ciencia de datos', icon: Sigma },
  ];

  return (
    <Card className="rounded-3xl border-border/70 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Plan anti-pérdidas</h2>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              En vivo
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Quiebres, combos y política de inventario según las ventas de los últimos {report.windowDays} días.
          </p>
        </div>
        {report.uplift > 1.001 && (
          <span className="rounded-lg bg-muted px-2 py-1 text-[11px] text-muted-foreground">
            Demanda proyectada +{Math.round((report.uplift - 1) * 100)} %
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-1 rounded-xl border border-border/60 bg-muted/40 p-1">
        {tabs.map(({ id, label, icon: Icon, highlight }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              tab === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {highlight && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-orange-500" />}
          </button>
        ))}
      </div>

      {tab === 'riesgos' && (
        <>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border/60 p-3">
                <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <PackageX className="h-3 w-3" /> Quiebres
                </p>
                <p className={`mt-1 text-2xl font-semibold tracking-tight ${report.stockouts.length ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {report.stockouts.length}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">sin stock y con demanda</p>
              </div>
              <div className="rounded-xl border border-border/60 p-3">
                <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <AlertTriangle className="h-3 w-3" /> Cobertura &lt; 7 d
                </p>
                <p className={`mt-1 text-2xl font-semibold tracking-tight ${report.critical.length ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {report.critical.length}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">productos por agotarse</p>
              </div>
              <div className="rounded-xl border border-border/60 p-3">
                <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <AlertTriangle className="h-3 w-3" /> Ventas en riesgo / mes
                </p>
                <p className="mt-1 text-lg font-semibold tracking-tight text-rose-600">{money(report.revenueAtRisk)}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{money(report.marginAtRisk)} de margen · techo si el quiebre dura el mes</p>
              </div>
              <div className="rounded-xl border border-border/60 p-3">
                <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <Wallet className="h-3 w-3" /> Capital inmovilizado
                </p>
                <p className="mt-1 text-lg font-semibold tracking-tight text-indigo-600">{money(report.tiedCapital)}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">sobre-stock y sin rotación</p>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Acciones prioritarias</p>
              <div className="mt-2 space-y-2">
                {atRisk.map(row => (
                  <div key={row.id} className="flex items-start gap-3 rounded-xl border border-border/60 p-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
                      <PackageX className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{row.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {row.action} · cobertura {coverText(row.coverDays)} · {row.dailyProjected.toFixed(2)} uds/día
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-rose-600">{money(row.reorderQty * row.cost)}</span>
                  </div>
                ))}
                {freeze.map(row => (
                  <div key={row.id} className="flex items-start gap-3 rounded-xl border border-border/60 p-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">
                      <PauseCircle className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{row.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Congelar compra · cobertura {coverText(row.coverDays)} · mover con combo
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-indigo-600">
                      {money(Math.max(0, row.stock - row.daily * 45) * row.cost)}
                    </span>
                  </div>
                ))}
                {!hasRisks && (
                  <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200">
                    <ShieldCheck className="h-4 w-4" />
                    Sin quiebres, sobre-stock ni productos sin rotación.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 border-t border-border/60 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Detalle por producto · {detailRows.length} activos
              </p>
              <button
                type="button"
                onClick={() => setShowDetail(value => !value)}
                aria-expanded={showDetail}
                className="flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
              >
                {showDetail ? 'Ocultar detalle' : 'Ver detalle'}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showDetail ? 'rotate-180' : ''}`} />
              </button>
            </div>
            {showDetail && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3 font-semibold">Producto</th>
                      <th className="px-3 py-2 text-right font-semibold">Stock</th>
                      <th className="px-3 py-2 text-right font-semibold">Demanda/día</th>
                      <th className="px-3 py-2 text-right font-semibold">Cobertura</th>
                      <th className="px-3 py-2 text-right font-semibold">Margen</th>
                      <th className="px-3 py-2 text-right font-semibold">Reorden</th>
                      <th className="px-3 py-2 font-semibold">Riesgo</th>
                      <th className="py-2 pl-3 font-semibold">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {detailRows.map(row => (
                      <tr key={row.id} className="transition hover:bg-muted/20">
                        <td className="py-2.5 pr-3">
                          <p className="font-medium">{row.name}</p>
                          <p className="text-[11px] text-muted-foreground">{row.category}</p>
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${row.stock <= 0 ? 'font-semibold text-rose-600' : ''}`}>
                          {row.stock.toFixed(0)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{row.dailyProjected.toFixed(2)}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${row.risk === 'critico' || row.risk === 'quiebre' ? 'font-semibold text-rose-600' : ''}`}>
                          {coverText(row.coverDays)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{row.marginPct.toFixed(0)}%</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{row.reorderPoint}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-block whitespace-nowrap rounded-lg px-2 py-0.5 text-[11px] font-semibold ${RISK_CLASS[row.risk]}`}>
                            {RISK_LABEL[row.risk]}
                          </span>
                        </td>
                        <td className="py-2.5 pl-3 text-xs text-muted-foreground">{row.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'combos' && (
        <div className="mt-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Producto ancla</span>
              <select
                value={selectedAnchor}
                onChange={event => setAnchorId(event.target.value)}
                className="mt-1 block w-full min-w-[260px] rounded-xl border border-border/70 bg-background px-3 py-2 text-sm"
              >
                {anchors.map(anchor => (
                  <option key={anchor.id} value={anchor.id}>
                    {anchor.name} · {anchor.units} uds vendidas
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[11px] text-muted-foreground">
              Canastas con este producto en 30 días: <strong>{combo?.anchorBaskets ?? 0}</strong>
            </p>
          </div>

          {combo && headline && headline.maxCombos > 0 && (
            <div className="mt-4 rounded-2xl border border-orange-200 bg-orange-50/60 p-4 dark:border-orange-900 dark:bg-orange-950/20">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300">Combo sugerido</p>
                  <p className="mt-1 text-lg font-semibold">
                    {combo.anchor.name} + {headline.partners.map(partner => partner.name).join(' + ')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Limitante: {headline.limiting} · stock del ancla: {combo.anchor.stock} uds
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-orange-700 dark:text-orange-300">{headline.maxCombos}</p>
                  <p className="text-[11px] text-muted-foreground">combos posibles</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <p><span className="text-muted-foreground">Ingreso si se venden: </span><strong>{money(headline.revenue)}</strong></p>
                <p><span className="text-muted-foreground">Margen: </span><strong>{money(headline.margin)}</strong></p>
              </div>
            </div>
          )}

          {combo && (!headline || headline.maxCombos === 0) && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
              {combo.offers.length === 0
                ? 'No hay suficientes ventas conjuntas ni stock para armar combos con este producto.'
                : `Hoy no salen combos completos: el stock limitante es ${headline?.limiting ?? combo.anchor.name}.`}
            </div>
          )}

          {combo && combo.offers.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[840px] text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-semibold">Se vende con</th>
                    <th className="px-3 py-2 text-right font-semibold">Juntos 30 d</th>
                    <th className="px-3 py-2 text-right font-semibold">Confianza</th>
                    <th className="px-3 py-2 text-right font-semibold">Lift</th>
                    <th className="px-3 py-2 font-semibold">Señal</th>
                    <th className="px-3 py-2 text-right font-semibold">Stock</th>
                    <th className="px-3 py-2 text-right font-semibold">Combos</th>
                    <th className="py-2 pl-3 text-right font-semibold">Ingreso potencial</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {combo.offers.map(offer => (
                    <tr key={offer.partner.id} className="transition hover:bg-muted/20">
                      <td className="py-2.5 pr-3">
                        <p className="font-medium">{offer.partner.name}</p>
                        <p className="text-[11px] text-muted-foreground">{offer.partner.category}</p>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{offer.source === 'historial' ? offer.together : '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{offer.source === 'historial' && offer.confidence ? `${Math.round(offer.confidence * 100)}%` : '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{offer.source === 'historial' && offer.lift ? `${offer.lift.toFixed(2)}×` : '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block whitespace-nowrap rounded-lg px-2 py-0.5 text-[11px] font-semibold ${
                          offer.source === 'historial'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                        }`}>
                          {offer.source === 'historial' ? 'Historial' : 'Categoría'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{offer.partner.stock.toFixed(0)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${offer.maxCombos > 0 ? 'font-semibold text-orange-600' : 'text-muted-foreground'}`}>
                        {offer.maxCombos}
                      </td>
                      <td className="py-2.5 pl-3 text-right tabular-nums">{money(offer.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            <strong>Historial:</strong> productos comprados en la misma venta (≥ 3 veces). <strong>Categoría:</strong> afinidad de
            acompañamiento cuando aún no hay suficientes datos. Los combos se calculan con 1 unidad de cada producto y el stock actual;
            el limitante es el que se agota primero.
          </p>
        </div>
      )}

      {tab === 'ciencia' && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border/60 p-3">
              <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                <TrendingUp className="h-3 w-3" /> Concentración (Pareto)
              </p>
              <p className="mt-1 text-lg font-semibold tracking-tight">{science.pareto.count} de {science.pareto.total} productos</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">= {Math.round(science.pareto.share * 100)} % de los ingresos</p>
            </div>
            <div className="rounded-xl border border-border/60 p-3">
              <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                <GitCompareArrows className="h-3 w-3" /> Mayor afinidad
              </p>
              <p className="mt-1 truncate text-sm font-semibold" title={bestPairNames}>{bestPairNames}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {bestPair ? `lift ${bestPair.lift.toFixed(2)}× · ${bestPair.together} ventas juntas` : 'Sin datos suficientes'}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 p-3">
              <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                <Sigma className="h-3 w-3" /> Demanda más volátil
              </p>
              <p className="mt-1 truncate text-sm font-semibold">{science.mostVariable?.name ?? '—'}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {science.mostVariable ? `CV ${science.mostVariable.cv.toFixed(2)} · clase ${science.mostVariable.xyz}` : 'Sin ventas'}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-semibold">Producto</th>
                  <th className="px-3 py-2 text-right font-semibold">Ingresos 30 d</th>
                  <th className="px-3 py-2 text-center font-semibold">ABC</th>
                  <th className="px-3 py-2 text-right font-semibold">CV</th>
                  <th className="px-3 py-2 text-center font-semibold">XYZ</th>
                  <th className="px-3 py-2 text-right font-semibold">Seguridad</th>
                  <th className="px-3 py-2 text-right font-semibold">EOQ</th>
                  <th className="py-2 pl-3 text-right font-semibold">Pedir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {science.rows.map(row => (
                  <tr key={row.id} className="transition hover:bg-muted/20">
                    <td className="py-2.5 pr-3">
                      <p className="font-medium">{row.name}</p>
                      <p className="text-[11px] text-muted-foreground">{row.category}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(row.revenue)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${ABC_CLASS[row.abc]}`}>{row.abc}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.cv.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${XYZ_CLASS[row.xyz]}`}>{row.xyz}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.safetyStock}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{row.eoq}</td>
                    <td className={`py-2.5 pl-3 text-right tabular-nums ${row.suggestedOrder > 0 ? 'font-semibold text-orange-600' : 'text-muted-foreground'}`}>
                      {row.suggestedOrder > 0 ? row.suggestedOrder : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            <strong>ABC</strong> por ingresos (A hasta 80 %, B hasta 95 %). <strong>XYZ</strong> por coeficiente de variación semanal
            (X ≤ 0,50 · Y ≤ 1,00 · Z &gt; 1,00). <strong>Seguridad</strong> = 1,65σ√7 (nivel de servicio 95 %, 7 días de
            reposición). <strong>Pedir</strong> = seguridad + 7 días de demanda − stock. <strong>EOQ</strong> = √(2·D·S / H), con
            S = $50.000 por pedido y H = 25 % del costo; se muestra acotado a 30 días de demanda para productos perecederos.
          </p>
        </div>
      )}
    </Card>
  );
}
