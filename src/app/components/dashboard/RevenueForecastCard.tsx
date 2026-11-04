import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, BedDouble, Info, TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card } from '../ui/card';
import type { HotelRoomRecord, SaleRecord } from '../../services/dataService';
import {
  WEEKDAY_SHORT,
  buildRevenueProjection,
  dailyRevenue,
  dayOfMonthOfKey,
  estimateOccupancy,
  weekdayOfKey,
} from '../../utils/revenueForecast';

const money = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
const percent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
const labelOf = (key: string) => `${WEEKDAY_SHORT[weekdayOfKey(key)]} ${dayOfMonthOfKey(key)}`;
const weekdayList = (weekdays: number[]) => weekdays.map(day => WEEKDAY_SHORT[day]).join(' y ');

interface RevenueForecastCardProps {
  sales: SaleRecord[];
  rooms: HotelRoomRecord[];
  isHotel: boolean;
  loading: boolean;
}

/**
 * Proyección de ingresos y ocupación para el Dashboard.
 * El modelo vive en utils/revenueForecast.ts (tendencia + estacionalidad semanal).
 */
export function RevenueForecastCard({ sales, rooms, isHotel, loading }: RevenueForecastCardProps) {
  const [horizon, setHorizon] = useState<7 | 30>(7);
  const projection = useMemo(() => buildRevenueProjection(sales, 90, 30), [sales]);
  const history = useMemo(() => dailyRevenue(sales, 7), [sales]);
  const occupancy = useMemo(
    () => (projection && isHotel ? estimateOccupancy(projection.points, rooms, 30) : null),
    [projection, isHotel, rooms],
  );

  const chartData = useMemo(() => {
    const rows: { day: string; ingresos: number | null; proyeccion: number | null }[] =
      history.map(point => ({ day: labelOf(point.key), ingresos: point.revenue, proyeccion: null }));
    if (rows.length) {
      // Une la serie real con la proyectada en el último día observado.
      rows[rows.length - 1].proyeccion = rows[rows.length - 1].ingresos;
    }
    projection?.points.slice(0, horizon).forEach(point => {
      rows.push({ day: labelOf(point.key), ingresos: null, proyeccion: point.revenue });
    });
    return rows;
  }, [history, projection, horizon]);

  if (!projection) return null;

  const weekDelta = projection.lastWeekTotal > 0
    ? ((projection.weekTotal - projection.lastWeekTotal) / projection.lastWeekTotal) * 100
    : null;

  return (
    <Card className="rounded-2xl border-border/70 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Proyección de ingresos</h2>
            <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-700 dark:bg-orange-950/40 dark:text-orange-200">
              {projection.reliable ? 'Modelo' : 'Estimación preliminar'}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Tendencia y estacionalidad semanal sobre {projection.historyDays} días. La línea punteada estima los próximos {horizon} días.
          </p>
        </div>
        <div className="flex rounded-xl border border-border/70 p-1 text-xs">
          {([7, 30] as const).map(value => (
            <button
              key={value}
              type="button"
              aria-pressed={horizon === value}
              onClick={() => setHorizon(value)}
              className={`rounded-lg px-3 py-1.5 font-medium transition ${horizon === value ? 'bg-orange-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {value === 7 ? '7 días' : '30 días'}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-[1.7fr_1fr]">
        <div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-[var(--chart-1)]" />Real</span>
            <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[var(--chart-2)]" />Proyección</span>
          </div>
          <div className="mt-3 h-[240px]">
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Calculando proyección…</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: 2, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" strokeOpacity={0.55} />
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} width={56} tickFormatter={(value: number) => `${Math.round(value / 1000)}k`} />
                  <Tooltip
                    formatter={(value: number, name: string) => [money(value), name]}
                    contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--card-foreground)' }}
                  />
                  <Line type="monotone" dataKey="ingresos" name="Real" stroke="var(--chart-1)" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
                  <Line type="monotone" dataKey="proyeccion" name="Proyección" stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="6 5" dot={{ r: 2 }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="grid content-start gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <div className="rounded-xl border border-border/60 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Próxima semana</p>
            <p className="mt-1 text-lg font-semibold tracking-tight">{money(projection.weekTotal)}</p>
            {weekDelta !== null && (
              <p className={`mt-0.5 flex items-center gap-1 text-[11px] ${weekDelta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {weekDelta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {percent(weekDelta)} vs. los últimos 7 días
              </p>
            )}
          </div>
          <div className="rounded-xl border border-border/60 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Próximos 30 días</p>
            <p className="mt-1 text-lg font-semibold tracking-tight">{money(projection.monthTotal)}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Banda 80 %: {money(projection.monthLow)} – {money(projection.monthHigh)}
            </p>
          </div>
          {occupancy ? (
            <div className="rounded-xl border border-border/60 p-3">
              <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                <BedDouble className="h-3 w-3" /> Ocupación estimada (30 d)
              </p>
              <p className="mt-1 text-lg font-semibold tracking-tight">{occupancy.occupancyPct.toFixed(1)}%</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">ADR {money(occupancy.adr)} · {occupancy.rooms} habitaciones</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border/60 p-3">
              <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                <TrendingUp className="h-3 w-3" /> Tendencia diaria
              </p>
              <p className="mt-1 text-lg font-semibold tracking-tight">{money(projection.slope)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Variación estimada por día</p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
        <span>
          Días valle: <strong className="text-foreground">{weekdayList(projection.lowWeekdays)}</strong>
        </span>
        <span>
          Picos: <strong className="text-foreground">{weekdayList(projection.highWeekdays)}</strong>
        </span>
        <span className="flex items-center gap-1">
          <Info className="h-3 w-3" />
          {isHotel
            ? 'Ocupación estimada con ingresos y tarifa promedio: el POS no registra noches vendidas.'
            : 'Proyección estadística de demanda; no sustituye un cierre contable.'}
        </span>
        {projection.reliable === false && <span className="text-amber-600">Pocos días con actividad: interpreta como tendencia.</span>}
      </div>
    </Card>
  );
}
