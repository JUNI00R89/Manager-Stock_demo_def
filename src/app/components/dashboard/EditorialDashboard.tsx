import type { ElementType, ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, ArrowUpRight, Package } from 'lucide-react';
import type { SaleRecord } from '../../services/dataService';
import type { Product } from '../../utils/types';
import { saleNetTotal } from '../../utils/saleMetrics';
import { METHOD_NAMES } from '../../utils/paymentLabel';
import { formatMoney as money } from '../../utils/restaurantFormat';
import '../../pages/editorial-page.css';

const compactMoney = (value: number) => {
  if (!Number.isFinite(value)) return '$0';
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
};

const STATUS = {
  completed: ['Completada', 'dash-status-success'],
  cancelled: ['Anulada', 'dash-status-danger'],
  pending: ['Pendiente', 'dash-status-warning'],
} as const;

export type DashboardChartState = 'ok' | 'empty' | 'off' | 'restricted';

const CHART_EMPTY: Record<Exclude<DashboardChartState, 'ok'>, [string, string]> = {
  empty: ['Sin actividad registrada', 'Las ventas completadas de los últimos 7 días aparecerán aquí.'],
  off: ['Ventas desactivadas', 'Activa Caja / Ventas en la configuración para consultar estos indicadores.'],
  restricted: ['Estadísticas restringidas', 'Tu rol no permite consultar el comportamiento de las ventas.'],
};

/**
 * Dashboard in the editorial design (the /design-preview look) with the business's real data.
 * Only the presentation changes: Dashboard computes every number and permission.
 */
export function EditorialDashboard({
  title,
  subtitle,
  actions,
  hero,
  chart,
  quickActions,
  middle,
  recentSales,
  lowStock,
}: {
  title: string;
  subtitle: string;
  actions: ReactNode;
  hero: {
    kicker: string;
    label: string;
    value: ReactNode;
    note: string;
    metrics: { label: string; value: ReactNode; note: string }[];
  };
  chart: { state: DashboardChartState; data: { day: string; ingresos: number }[]; total: number; count: number };
  quickActions: { label: string; description: string; icon: ElementType; path: string }[];
  middle?: ReactNode;
  /** null hides the column (module off or no permission). */
  recentSales: SaleRecord[] | null;
  lowStock: Product[] | null;
}) {
  const navigate = useNavigate();
  const columns = [recentSales, lowStock].filter(Boolean).length;
  return (
    <div className="editorial-page space-y-6">
      <header className="dash-header">
        <div>
          <p className="dash-eyebrow">Panel de control</p>
          <h1 className="dash-title">{title}</h1>
          <p className="dash-subtitle">{subtitle}</p>
        </div>
        <div className="dash-actions">{actions}</div>
      </header>

      <section className="dash-hero" aria-label="Resumen del día">
        <div className="dash-hero-top">
          <p className="dash-hero-kicker">{hero.kicker}</p>
          <span className="dash-hero-date">
            {new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
        </div>
        <div className="dash-hero-body">
          <div>
            <p className="dash-hero-label">{hero.label}</p>
            <p className="dash-hero-value">{hero.value}</p>
            <p className="dash-hero-note">{hero.note}</p>
          </div>
          <div className="dash-hero-metrics">
            {hero.metrics.map(metric => (
              <div key={metric.label} className="dash-hero-metric">
                <p className="dash-hero-metric-label">{metric.label}</p>
                <p className="dash-hero-metric-value">{metric.value}</p>
                <p className="dash-hero-metric-note">{metric.note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="dash-main-grid">
        <section className="dash-panel">
          <div className="dash-panel-head">
            <div>
              <p className="dash-kicker">Comportamiento</p>
              <h2 className="dash-panel-title">Ingresos de los últimos 7 días</h2>
            </div>
            {chart.state === 'ok' && (
              <div className="dash-chart-summary">
                <p className="dash-chart-total">{money(chart.total)}</p>
                <p className="dash-chart-delta">{chart.count} ventas completadas</p>
              </div>
            )}
          </div>
          <div className="dash-chart">
            {chart.state === 'ok' ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart.data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashboard-revenue-fill" x1="0" y1="0" x2="0" y2="1">
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
                    fill="url(#dashboard-revenue-fill)"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <Activity className="h-7 w-7 text-muted-foreground/60" />
                <p className="mt-3 font-medium">{CHART_EMPTY[chart.state][0]}</p>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">{CHART_EMPTY[chart.state][1]}</p>
              </div>
            )}
          </div>
        </section>

        {quickActions.length > 0 && (
          <aside className="dash-rail">
            <div className="dash-rail-head">
              <p className="dash-kicker">Atajos</p>
              <h2 className="dash-panel-title">Accesos rápidos</h2>
              <p className="dash-rail-note">Tareas frecuentes del negocio.</p>
            </div>
            <div className="dash-rail-list">
              {quickActions.map(action => (
                <button
                  key={action.path}
                  type="button"
                  onClick={() => navigate(action.path)}
                  className="dash-rail-item"
                >
                  <span className="dash-rail-icon">
                    <action.icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="dash-rail-label">{action.label}</span>
                    <span className="dash-rail-desc">{action.description}</span>
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>

      {middle}

      {columns > 0 && (
        <section className="dash-ledger">
          <div className="dash-ledger-head">
            <div>
              <p className="dash-kicker">Operación</p>
              <h2 className="dash-panel-title">Movimiento reciente</h2>
            </div>
            <p className="dash-ledger-note">Ventas por fecha original, descontadas sus devoluciones.</p>
          </div>
          <div className={`dash-ledger-grid ${columns === 2 ? 'is-split' : ''}`}>
            {recentSales && (
              <div className="dash-ledger-column">
                <div className="dash-ledger-subhead">
                  <h3 className="dash-ledger-title">Últimas ventas</h3>
                  <button type="button" onClick={() => navigate('/sales')} className="dash-ledger-link">
                    Ver todas <ArrowUpRight className="h-3 w-3" />
                  </button>
                </div>
                {recentSales.length ? (
                  recentSales.map(sale => {
                    const [label, tone] = STATUS[sale.status];
                    return (
                      <button
                        key={sale.id}
                        type="button"
                        onClick={() => navigate(`/sales/${sale.id}`)}
                        className="dash-ledger-row w-full text-left"
                      >
                        <span className="dash-ledger-time">
                          {new Date(sale.date).toLocaleTimeString('es-CO', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="dash-ledger-primary">{sale.customer || 'Cliente general'}</span>
                          <span className="dash-ledger-meta">
                            {sale.id} · {sale.productName} · {METHOD_NAMES[sale.paymentMethod] ?? sale.paymentMethod}
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
                  <p className="py-6 text-sm text-muted-foreground">Las operaciones confirmadas se listarán aquí.</p>
                )}
              </div>
            )}
            {lowStock && (
              <div className="dash-ledger-column">
                <div className="dash-ledger-subhead">
                  <h3 className="dash-ledger-title">Alertas de inventario</h3>
                  <button type="button" onClick={() => navigate('/products')} className="dash-ledger-link">
                    Inventario <ArrowUpRight className="h-3 w-3" />
                  </button>
                </div>
                {lowStock.length ? (
                  lowStock.slice(0, 5).map(product => (
                    <div key={product.id} className="dash-ledger-row">
                      <span className="dash-ledger-stock">{product.stock}</span>
                      <span className="min-w-0 flex-1">
                        <span className="dash-ledger-primary">{product.name}</span>
                        <span className="dash-ledger-meta">Mínimo recomendado: {product.minStock}</span>
                      </span>
                      <span className="dash-status dash-status-danger">
                        <span className="dash-status-dot" />
                        Reponer
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                    <Package className="h-4 w-4 text-emerald-500" /> No hay productos bajo su nivel mínimo.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
