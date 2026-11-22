import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, ArrowUpRight, CalendarDays, CircleDot, Download, Plus, Search } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import type { SaleRecord, SaleStatus } from '../../services/dataService';
import { saleNetTotal } from '../../utils/saleMetrics';
import { METHOD_NAMES, digitalDetail } from '../../utils/paymentLabel';
import { dailyRevenue, paymentBreakdown, salesInPeriod, topProducts, type SalesPeriod } from '../../utils/salesSummary';
import { formatMoney as money } from '../../utils/restaurantFormat';
import '../../pages/editorial-page.css';

const compactMoney = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
};

const PERIODS: { id: SalesPeriod; label: string; description: string; kicker: string }[] = [
  { id: 'today', label: 'Hoy', description: 'Movimiento del día', kicker: 'Hoy' },
  { id: 'week', label: 'Últimos 7 días', description: 'Incluye hoy', kicker: 'Últimos 7 días' },
  { id: 'month', label: 'Este mes', description: 'Acumulado mensual', kicker: 'Este mes' },
];

const STATUSES: { id: 'all' | SaleStatus; label: string; description: string }[] = [
  { id: 'all', label: 'Todas', description: 'Todo el historial' },
  { id: 'completed', label: 'Completadas', description: 'Cobradas' },
  { id: 'pending', label: 'Pendientes', description: 'Por completar' },
  { id: 'cancelled', label: 'Anuladas', description: 'Con inventario repuesto' },
];

const STATUS_TONE: Record<SaleStatus, [string, string]> = {
  completed: ['Completada', 'dash-status-success'],
  pending: ['Pendiente', 'dash-status-warning'],
  cancelled: ['Anulada', 'dash-status-danger'],
};

/** Sales history in the editorial design: the same data, search, filters and export as the classic page. */
export function EditorialSales({
  sales,
  loading,
  canCreateSale,
  onExport,
  canExport,
  search,
  onSearch,
  status,
  onStatus,
  filtered,
}: {
  sales: SaleRecord[];
  loading: boolean;
  canCreateSale: boolean;
  canExport: boolean;
  onExport: () => void;
  search: string;
  onSearch: (value: string) => void;
  status: 'all' | SaleStatus;
  onStatus: (value: 'all' | SaleStatus) => void;
  filtered: SaleRecord[];
}) {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<SalesPeriod>('week');
  const current = PERIODS.find(p => p.id === period)!;
  const inPeriod = useMemo(() => salesInPeriod(sales, period), [sales, period]);
  const revenue = inPeriod.reduce((sum, sale) => sum + saleNetTotal(sale), 0);
  const methods = useMemo(() => paymentBreakdown(inPeriod), [inPeriod]);
  const products = useMemo(() => topProducts(inPeriod, 3), [inPeriod]);
  // The month chart runs from day 1 to today; the other periods show the last 7 days for context.
  const chartDays = period === 'month' ? new Date().getDate() : 7;
  const chart = useMemo(() => dailyRevenue(sales, chartDays), [sales, chartDays]);
  const chartTotal = chart.reduce((sum, d) => sum + d.ingresos, 0);

  return (
    <div className="editorial-page mx-auto max-w-7xl space-y-6">
      <header className="dash-header">
        <div>
          <p className="dash-eyebrow">Módulo de ventas</p>
          <h1 className="dash-title">Ventas</h1>
          <p className="dash-subtitle">Historial y comportamiento de las transacciones.</p>
        </div>
        <div className="dash-actions">
          {canExport && (
            <Button variant="outline" size="sm" className="dash-action" onClick={onExport} disabled={!filtered.length}>
              <Download className="mr-2 h-3.5 w-3.5" />
              Exportar
            </Button>
          )}
          {canCreateSale && (
            <Button size="sm" className="dash-action" onClick={() => navigate('/sales/new')}>
              <Plus className="mr-2 h-3.5 w-3.5" />
              Nueva venta
            </Button>
          )}
        </div>
      </header>

      <section className="dash-hero" aria-label="Resumen de ventas">
        <div className="dash-hero-top">
          <p className="dash-hero-kicker">{current.kicker}</p>
          <span className="dash-hero-date">COP · Colombia</span>
        </div>
        <div className="dash-hero-body">
          <div>
            <p className="dash-hero-label">Ventas netas del periodo</p>
            <p className="dash-hero-value">{loading ? '—' : money(revenue)}</p>
            <p className="dash-hero-note">Por fecha original de la venta, descontadas sus devoluciones.</p>
          </div>
          <div className="dash-hero-metrics">
            <div className="dash-hero-metric">
              <p className="dash-hero-metric-label">Ticket promedio</p>
              <p className="dash-hero-metric-value">
                {loading ? '—' : money(inPeriod.length ? revenue / inPeriod.length : 0)}
              </p>
              <p className="dash-hero-metric-note">Por venta completada</p>
            </div>
            <div className="dash-hero-metric">
              <p className="dash-hero-metric-label">Ventas</p>
              <p className="dash-hero-metric-value">{loading ? '—' : inPeriod.length}</p>
              <p className="dash-hero-metric-note">Completadas del periodo</p>
            </div>
            <div className="dash-hero-metric">
              <p className="dash-hero-metric-label">Método principal</p>
              <p className="dash-hero-metric-value">{loading ? '—' : (methods[0]?.label ?? 'Sin ventas')}</p>
              <p className="dash-hero-metric-note">
                {methods[0] ? `${methods[0].percent} % del total cobrado` : 'Aún no hay cobros'}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="dash-main-grid">
        <section className="dash-panel">
          <div className="dash-panel-head">
            <div>
              <p className="dash-kicker">Comportamiento</p>
              <h2 className="dash-panel-title">Ingresos por día</h2>
            </div>
            <div className="dash-chart-summary">
              <p className="dash-chart-total">{money(chartTotal)}</p>
              <p className="dash-chart-delta">{period === 'month' ? 'Este mes' : 'Últimos 7 días'}</p>
            </div>
          </div>
          <div className="dash-chart">
            {chart.some(d => d.ventas > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sales-revenue-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 11 }}
                    stroke="var(--muted-foreground)"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={10}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    stroke="var(--muted-foreground)"
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    tickFormatter={compactMoney}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [money(value), name]}
                    contentStyle={{
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--card)',
                      color: 'var(--card-foreground)',
                      fontSize: 12,
                    }}
                    cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="ingresos"
                    name="Ingresos"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    fill="url(#sales-revenue-fill)"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <Activity className="h-7 w-7 text-muted-foreground/60" />
                <p className="mt-3 font-medium">Sin ventas en este periodo</p>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                  Las ventas completadas aparecerán aquí día por día.
                </p>
              </div>
            )}
          </div>
        </section>

        <aside className="dash-rail">
          <div className="dash-rail-head">
            <p className="dash-kicker">Filtros</p>
            <h2 className="dash-panel-title">Vista de ventas</h2>
            <p className="dash-rail-note">El periodo cambia el resumen; el estado, el listado.</p>
          </div>
          <div className="dash-rail-list">
            <p className="preview-rail-group-title">Periodo</p>
            {PERIODS.map(item => (
              <button
                key={item.id}
                type="button"
                aria-pressed={period === item.id}
                onClick={() => setPeriod(item.id)}
                className={`dash-rail-item ${period === item.id ? 'is-active' : ''}`}
              >
                <span className="dash-rail-icon">
                  <CalendarDays className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="dash-rail-label">{item.label}</span>
                  <span className="dash-rail-desc">{item.description}</span>
                </span>
                {period === item.id && <span className="preview-active-dot" />}
              </button>
            ))}
          </div>
          <div className="dash-rail-list mt-5 border-t border-border/60 pt-4">
            <p className="preview-rail-group-title">Estado</p>
            {STATUSES.map(item => (
              <button
                key={item.id}
                type="button"
                aria-pressed={status === item.id}
                onClick={() => onStatus(item.id)}
                className={`dash-rail-item ${status === item.id ? 'is-active' : ''}`}
              >
                <span className="dash-rail-icon">
                  <CircleDot className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="dash-rail-label">{item.label}</span>
                  <span className="dash-rail-desc">{item.description}</span>
                </span>
                {status === item.id && <span className="preview-active-dot" />}
              </button>
            ))}
          </div>
        </aside>
      </div>

      <section className="dash-ledger">
        <div className="dash-ledger-head">
          <div>
            <p className="dash-kicker">Operación</p>
            <h2 className="dash-panel-title">Transacciones</h2>
          </div>
          <p className="dash-ledger-note">{filtered.length} registros encontrados</p>
        </div>
        <div className="dash-ledger-grid is-split">
          <div className="dash-ledger-column">
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => onSearch(e.target.value)}
                placeholder="Buscar por número, cliente o producto…"
                className="h-10 pl-9"
                aria-label="Buscar ventas"
              />
            </div>
            {loading ? (
              <p className="py-6 text-sm text-muted-foreground">Cargando historial…</p>
            ) : filtered.length ? (
              filtered.map(sale => {
                const [label, tone] = STATUS_TONE[sale.status];
                const detail = digitalDetail(sale.payments);
                return (
                  <button
                    key={sale.id}
                    type="button"
                    onClick={() => navigate(`/sales/${sale.id}`)}
                    className="dash-ledger-row w-full text-left"
                  >
                    <span className="dash-ledger-time">
                      {new Date(sale.date).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' })}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="dash-ledger-primary">{sale.customer || 'Cliente general'}</span>
                      <span className="dash-ledger-meta">
                        {sale.id} · {sale.productName} · {METHOD_NAMES[sale.paymentMethod] ?? sale.paymentMethod}
                        {detail && ` · ${detail}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="dash-ledger-amount">{money(saleNetTotal(sale))}</span>
                      <span className={`dash-status ${tone}`}>
                        <span className="dash-status-dot" />
                        {label}
                      </span>
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="py-6 text-sm text-muted-foreground">No hay ventas que coincidan con la búsqueda.</p>
            )}
          </div>
          <div className="dash-ledger-column">
            <div className="dash-ledger-subhead">
              <h3 className="dash-ledger-title">Métodos de pago</h3>
              <span className="dash-ledger-link">{current.label}</span>
            </div>
            {methods.length ? (
              <div className="preview-method-list">
                {methods.map(method => (
                  <div key={method.method} className="preview-method">
                    <div className="preview-method-head">
                      <span className="preview-method-label">{method.label}</span>
                      <span className="preview-method-percent">{method.percent}%</span>
                    </div>
                    <div className="preview-method-track">
                      <span className="preview-method-bar" style={{ width: `${method.percent}%` }} />
                    </div>
                    <p className="preview-method-amount">{money(method.amount)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">Sin cobros en este periodo.</p>
            )}
            <div className="mt-5 border-t border-border/60 pt-4">
              <div className="dash-ledger-subhead">
                <h3 className="dash-ledger-title">Productos más vendidos</h3>
                <span className="dash-ledger-link">Por ingresos</span>
              </div>
              {products.length ? (
                products.map(product => (
                  <div key={product.name} className="dash-ledger-row">
                    <span className="dash-ledger-stock">{product.units}</span>
                    <span className="min-w-0 flex-1">
                      <span className="dash-ledger-primary">{product.name}</span>
                      <span className="dash-ledger-meta">{product.units} unidades vendidas</span>
                    </span>
                    <span className="dash-ledger-amount">{money(product.revenue)}</span>
                  </div>
                ))
              ) : (
                <p className="py-4 text-sm text-muted-foreground">Sin productos vendidos en este periodo.</p>
              )}
              <button type="button" onClick={() => navigate('/reports')} className="dash-ledger-link mt-3">
                Ver reportes <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
