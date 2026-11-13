import { useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ArrowUpRight, Banknote, CalendarDays, CreditCard, Download, Filter, Package,
  Plus, Receipt, Smartphone, Store, Truck, Utensils,
} from 'lucide-react';
import { toast } from 'sonner';
import { Layout } from '../components/Layout';
import { Button } from '../components/ui/button';
import './design-preview.css';

const money = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
const compactMoney = (value: number) => {
  if (!Number.isFinite(value)) return '$0';
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
};

const revenueData = [
  { day: 'lun 2', ingresos: 420000 },
  { day: 'mar 3', ingresos: 380000 },
  { day: 'mié 4', ingresos: 510000 },
  { day: 'jue 5', ingresos: 470000 },
  { day: 'vie 6', ingresos: 690000 },
  { day: 'sáb 7', ingresos: 880000 },
  { day: 'dom 8', ingresos: 740000 },
];

const recentSales = [
  { id: 'VTA-1048', time: '14:32', customer: 'Mesa 4 · Almuerzo', detail: '2 × Bowl de pollo · Tarjeta', amount: 78600, status: 'Completada' },
  { id: 'VTA-1047', time: '14:18', customer: 'Mostrador', detail: 'Hamburguesa doble + Limonada · Efectivo', amount: 44900, status: 'Completada' },
  { id: 'VTA-1046', time: '13:55', customer: 'Domicilio · Cra. 12 #45-18', detail: '2 × Wrap de pollo · Transferencia', amount: 62800, status: 'Completada' },
  { id: 'VTA-1045', time: '13:41', customer: 'Mesa 2 · Almuerzo', detail: 'Bowl de pollo + Café · Tarjeta', amount: 39200, status: 'Completada' },
  { id: 'VTA-1044', time: '13:20', customer: 'Mostrador', detail: '3 × Limonada · Efectivo', amount: 27000, status: 'Pendiente' },
];

const paymentMethods = [
  { label: 'Efectivo', percent: 62, amount: 2535800, icon: Banknote },
  { label: 'Tarjeta', percent: 28, amount: 1145200, icon: CreditCard },
  { label: 'Transferencia', percent: 10, amount: 409000, icon: Smartphone },
];

const topProducts = [
  { name: 'Bowl de pollo', units: 42, revenue: 1218000 },
  { name: 'Hamburguesa doble', units: 31, revenue: 1085000 },
  { name: 'Limonada natural', units: 58, revenue: 522000 },
];

const periods = [
  { id: 'today', label: 'Hoy', description: 'Movimiento del día', icon: CalendarDays },
  { id: 'week', label: 'Últimos 7 días', description: 'Periodo seleccionado', icon: CalendarDays },
  { id: 'month', label: 'Este mes', description: 'Acumulado mensual', icon: CalendarDays },
];

const channels = [
  { id: 'all', label: 'Todos los canales', description: 'Sin filtro de origen', icon: Filter },
  { id: 'counter', label: 'Mostrador', description: 'Ventas directas', icon: Store },
  { id: 'table', label: 'Mesa', description: 'Consumo en el local', icon: Utensils },
  { id: 'delivery', label: 'Domicilio', description: 'Entregas a terceros', icon: Truck },
];

const statusClass = (status: string) => {
  if (status === 'Completada') return 'dash-status-success';
  if (status === 'Anulada') return 'dash-status-danger';
  return 'dash-status-warning';
};

export function DesignPreview() {
  const [period, setPeriod] = useState('week');
  const [channel, setChannel] = useState('all');

  return (
    <Layout>
      <div className="design-preview mx-auto max-w-7xl space-y-6">
        <header className="dash-header">
          <div>
            <p className="dash-eyebrow">Módulo de ventas</p>
            <h1 className="dash-title">Ventas</h1>
            <p className="dash-subtitle">
              Historial y comportamiento de las transacciones.
            </p>
          </div>
          <div className="dash-actions">
            <Button variant="outline" size="sm" className="dash-action" onClick={() => toast.info('Vista previa: exportación simulada.')}>
              <Download className="mr-2 h-3.5 w-3.5" />
              Exportar
            </Button>
            <Button size="sm" className="dash-action" onClick={() => toast.info('Vista previa: nueva venta simulada.')}>
              <Plus className="mr-2 h-3.5 w-3.5" />
              Nueva venta
            </Button>
          </div>
        </header>

        <div className="preview-banner">
          <span className="preview-banner-tag">Vista previa</span>
          <p>Datos de ejemplo. Esta pantalla no modifica el Dashboard original ni la operación real.</p>
        </div>

        <section className="dash-hero" aria-label="Resumen de ventas">
          <div className="dash-hero-top">
            <p className="dash-hero-kicker">Últimos 7 días</p>
            <span className="dash-hero-date">Datos de ejemplo</span>
          </div>
          <div className="dash-hero-body">
            <div>
              <p className="dash-hero-label">Ingresos del periodo</p>
              <p className="dash-hero-value">
                {money(4090000)}
              </p>
              <p className="dash-hero-note">
                Sábado 7 fue el día con más ingresos
                <span className="dash-hero-up">
                  <ArrowUpRight className="h-3 w-3" />
                  12,4% vs. periodo anterior
                </span>
              </p>
            </div>
            <div className="dash-hero-metrics">
              <div className="dash-hero-metric">
                <p className="dash-hero-metric-label">Ticket promedio</p>
                <p className="dash-hero-metric-value">
                  {money(31953)}
                </p>
                <p className="dash-hero-metric-note">Por venta completada</p>
              </div>
              <div className="dash-hero-metric">
                <p className="dash-hero-metric-label">Ventas</p>
                <p className="dash-hero-metric-value">
                  128
                </p>
                <p className="dash-hero-metric-note">Transacciones del periodo</p>
              </div>
              <div className="dash-hero-metric">
                <p className="dash-hero-metric-label">Método principal</p>
                <p className="dash-hero-metric-value">Efectivo</p>
                <p className="dash-hero-metric-note">62 % del total cobrado</p>
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
                <p className="dash-chart-total">{money(4090000)}</p>
                <p className="dash-chart-delta is-positive">+12,4% vs. periodo anterior</p>
              </div>
            </div>
            <div className="dash-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="preview-revenue-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} tickMargin={10} />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} width={52} tickFormatter={compactMoney} />
                  <Tooltip
                    formatter={(value: number, name: string) => [money(value), name]}
                    contentStyle={{ borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--card-foreground)', fontSize: 12 }}
                    cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
                  />
                  <Area type="monotone" dataKey="ingresos" name="Ingresos" stroke="var(--chart-1)" strokeWidth={2} fill="url(#preview-revenue-fill)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <aside className="dash-rail">
            <div className="dash-rail-head">
              <p className="dash-kicker">Filtros</p>
              <h2 className="dash-panel-title">Vista de la demostración</h2>
              <p className="dash-rail-note">Los filtros son interactivos, pero los datos no cambian.</p>
            </div>
            <div className="dash-rail-list">
              <p className="preview-rail-group-title">Periodo</p>
              {periods.map(item => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={period === item.id}
                  onClick={() => setPeriod(item.id)}
                  className={`dash-rail-item ${period === item.id ? 'is-active' : ''}`}
                >
                  <span className="dash-rail-icon"><item.icon className="h-3.5 w-3.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="dash-rail-label">{item.label}</span>
                    <span className="dash-rail-desc">{item.description}</span>
                  </span>
                  {period === item.id && <span className="preview-active-dot" />}
                </button>
              ))}
            </div>
            <div className="dash-rail-list mt-5 border-t border-border/60 pt-4">
              <p className="preview-rail-group-title">Canal</p>
              {channels.map(item => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={channel === item.id}
                  onClick={() => setChannel(item.id)}
                  className={`dash-rail-item ${channel === item.id ? 'is-active' : ''}`}
                >
                  <span className="dash-rail-icon"><item.icon className="h-3.5 w-3.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="dash-rail-label">{item.label}</span>
                    <span className="dash-rail-desc">{item.description}</span>
                  </span>
                  {channel === item.id && <span className="preview-active-dot" />}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              className="dash-action mt-5 w-full"
              onClick={() => toast.info('Vista previa: cierre de caja simulado.')}
            >
              <Receipt className="mr-2 h-3.5 w-3.5" />
              Ver cierre de caja
            </Button>
          </aside>
        </div>

        <section className="dash-ledger">
          <div className="dash-ledger-head">
            <div>
              <p className="dash-kicker">Operación</p>
              <h2 className="dash-panel-title">Movimiento reciente</h2>
            </div>
            <p className="dash-ledger-note">Últimas transacciones de la demostración.</p>
          </div>
          <div className="dash-ledger-grid is-split">
            <div className="dash-ledger-column">
              <div className="dash-ledger-subhead">
                <h3 className="dash-ledger-title">Últimas ventas</h3>
                <button type="button" onClick={() => toast.info('Vista previa: historial completo simulado.')} className="dash-ledger-link">
                  Ver todas <ArrowUpRight className="h-3 w-3" />
                </button>
              </div>
              <div>
                {recentSales.map(sale => (
                  <div key={sale.id} className="dash-ledger-row">
                    <span className="dash-ledger-time">{sale.time}</span>
                    <span className="min-w-0 flex-1">
                      <span className="dash-ledger-primary">{sale.customer}</span>
                      <span className="dash-ledger-meta">{sale.id} · {sale.detail}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="dash-ledger-amount">{money(sale.amount)}</span>
                      <span className={`dash-status ${statusClass(sale.status)}`}>
                        <span className="dash-status-dot" />
                        {sale.status}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="dash-ledger-column">
              <div className="dash-ledger-subhead">
                <h3 className="dash-ledger-title">Métodos de pago</h3>
                <span className="dash-ledger-link">62 % efectivo</span>
              </div>
              <div className="preview-method-list">
                {paymentMethods.map(method => (
                  <div key={method.label} className="preview-method">
                    <div className="preview-method-head">
                      <span className="preview-method-label">
                        <method.icon className="h-3.5 w-3.5" />
                        {method.label}
                      </span>
                      <span className="preview-method-percent">{method.percent}%</span>
                    </div>
                    <div className="preview-method-track">
                      <span className="preview-method-bar" style={{ width: `${method.percent}%` }} />
                    </div>
                    <p className="preview-method-amount">{money(method.amount)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 border-t border-border/60 pt-4">
                <div className="dash-ledger-subhead">
                  <h3 className="dash-ledger-title">Top productos</h3>
                  <span className="dash-ledger-link">Por ingresos</span>
                </div>
                <div>
                  {topProducts.map(product => (
                    <div key={product.name} className="dash-ledger-row">
                      <span className="dash-ledger-stock">{product.units}</span>
                      <span className="min-w-0 flex-1">
                        <span className="dash-ledger-primary">{product.name}</span>
                        <span className="dash-ledger-meta">{product.units} unidades vendidas</span>
                      </span>
                      <span className="dash-ledger-amount">{money(product.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <p className="preview-footer">
          <Package className="h-3.5 w-3.5" />
          Pantalla de muestra. El módulo real de Ventas conserva su diseño y comportamiento actual.
        </p>
      </div>
    </Layout>
  );
}
