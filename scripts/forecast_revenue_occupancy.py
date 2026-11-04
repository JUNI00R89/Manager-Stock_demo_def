#!/usr/bin/env python3
"""Proyección de ingresos y ocupación para un negocio tipo hotel.

Modelo: tendencia lineal sobre la serie desestacionalizada x índice de
estacionalidad semanal (con contracción hacia 1) y banda de incertidumbre por
Monte Carlo. Incluye backtesting contra un baseline naive-estacional.

Uso:
    python scripts/forecast_revenue_occupancy.py --business DEMO-HOTEL-001
    python scripts/forecast_revenue_occupancy.py --days 120 --horizon 30
"""
from __future__ import annotations

import argparse
import sqlite3
import statistics
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEEKDAYS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


@dataclass
class Model:
    intercept: float
    slope: float
    seasonal: list[float]
    sigma: float
    mean: float
    n: int


def load_daily_revenue(conn: sqlite3.Connection, business_id: str, days: int, end: date) -> list[tuple[date, float]]:
    start = end - timedelta(days=days - 1)
    rows = conn.execute(
        "SELECT substr(created_at,1,10) d, SUM(total) t FROM sales "
        "WHERE business_id=? AND status='completed' AND substr(created_at,1,10) BETWEEN ? AND ? "
        "GROUP BY d",
        (business_id, start.isoformat(), end.isoformat()),
    ).fetchall()
    by_day = {row[0]: float(row[1] or 0) for row in rows}
    return [(start + timedelta(days=i), by_day.get((start + timedelta(days=i)).isoformat(), 0.0)) for i in range(days)]


def fit(series: list[tuple[date, float]]) -> Model:
    values = [v for _, v in series]
    mean = statistics.fmean(values) or 1.0
    # Índice semanal: media del día / media general, con contracción del 50 %
    # para que una semana atípica no deforme la estacionalidad.
    by_wd: dict[int, list[float]] = {}
    for d, v in series:
        by_wd.setdefault(d.weekday(), []).append(v)
    seasonal = [1.0] * 7
    for wd, vals in by_wd.items():
        if vals:
            raw = (statistics.fmean(vals) or 0.0) / mean
            seasonal[wd] = min(1.8, max(0.4, 1.0 + (raw - 1.0) * 0.5))
    # Tendencia por mínimos cuadrados sobre la serie desestacionalizada.
    xs = list(range(len(series)))
    ys = [v / seasonal[d.weekday()] for d, v in series]
    n = len(xs)
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    denom = sum((x - mx) ** 2 for x in xs) or 1.0
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / denom
    intercept = my - slope * mx
    fitted = [(intercept + slope * x) * seasonal[d.weekday()] for x, (d, _) in zip(xs, series)]
    residuals = [max(-3 * mean, min(3 * mean, v - f)) for (_, v), f in zip(series, fitted)]
    sigma = statistics.pstdev(residuals) if n > 2 else mean * 0.3
    return Model(intercept, slope, seasonal, sigma, mean, n)


def predict_day(model: Model, target: date, horizon_index: int) -> float:
    t = model.n - 1 + horizon_index
    base = model.intercept + model.slope * t
    base = max(base, model.mean * 0.2)  # evita proyecciones negativas o colapsadas
    return max(0.0, base * model.seasonal[target.weekday()])


def forecast(model: Model, start: date, horizon: int, sims: int = 20000, seed: int = 42) -> dict:
    import random

    rng = random.Random(seed)
    days = [start + timedelta(days=i) for i in range(horizon)]
    point = [predict_day(model, d, i) for i, d in enumerate(days)]
    weekly = point[:7]
    totals = []
    for _ in range(sims):
        total = 0.0
        for y in point:
            total += max(0.0, rng.gauss(y, model.sigma))
        totals.append(total)
    totals.sort()
    pct = lambda q: totals[min(len(totals) - 1, int(q * len(totals)))]
    return {
        "days": days,
        "point": point,
        "weekly_total": sum(weekly),
        "month_total": sum(point[: min(30, horizon)]),
        "p10": pct(0.10),
        "p50": pct(0.50),
        "p90": pct(0.90),
    }


def backtest(series: list[tuple[date, float]], test_days: int = 28) -> dict:
    train, test = series[:-test_days], series[-test_days:]
    model = fit(train)
    preds = [predict_day(model, d, i) for i, (d, _) in enumerate(test)]
    actuals = [v for _, v in test]
    wape = sum(abs(a - p) for a, p in zip(actuals, preds)) / max(1.0, sum(actuals)) * 100
    mae = statistics.fmean(abs(a - p) for a, p in zip(actuals, preds))
    # Baseline: mismo día de la semana anterior (naive estacional).
    naive = [train[len(train) - 7 + i][1] if i < 7 else actuals[i - 7] for i in range(len(test))]
    naive_wape = sum(abs(a - p) for a, p in zip(actuals, naive)) / max(1.0, sum(actuals)) * 100
    return {"wape": wape, "mae": mae, "naive_wape": naive_wape, "train_days": len(train), "test_days": len(test)}


def money(value: float) -> str:
    return f"${value:,.0f}".replace(",", ".")


def main() -> int:
    parser = argparse.ArgumentParser(description="Proyección de ingresos y ocupación.")
    parser.add_argument("--business", default="DEMO-HOTEL-001")
    parser.add_argument("--days", type=int, default=90, help="Días de historia usados para entrenar.")
    parser.add_argument("--horizon", type=int, default=30)
    parser.add_argument("--db", default=str(ROOT / "backend" / "data" / "manager_stock.db"))
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    rooms = conn.execute("SELECT price_per_night FROM hotel_rooms WHERE business_id=?", (args.business,)).fetchall()
    if not rooms:
        print("El negocio no tiene habitaciones registradas.")
        return 1
    room_count = len(rooms)
    adr = statistics.fmean(float(r["price_per_night"]) for r in rooms)
    capacity_day = adr * room_count

    # Hoy en Colombia = UTC-5
    from datetime import datetime, timezone

    now_co = datetime.now(timezone.utc) - timedelta(hours=5)
    today = now_co.date()
    end = today - timedelta(days=1)  # ayer: último día completo
    series = load_daily_revenue(conn, args.business, args.days, end)
    if len([1 for _, v in series if v > 0]) < 10:
        print("Datos insuficientes para proyectar.")
        return 1

    model = fit(series)
    fc = forecast(model, today, args.horizon)
    bt = backtest(series)

    hist_room_nights = sum(v for _, v in series) / adr
    hist_occ = hist_room_nights / (room_count * len(series)) * 100
    week_occ = fc["weekly_total"] / (capacity_day * 7) * 100
    month_occ = fc["month_total"] / (capacity_day * min(30, args.horizon)) * 100

    print("=" * 66)
    print(f"PROYECCIÓN DE INGRESOS Y OCUPACIÓN · {args.business}")
    print("=" * 66)
    print(f"Historia: {len(series)} días | Habitaciones: {room_count} | ADR: {money(adr)} | Capacidad: {money(capacity_day)}/día")
    print(f"Ocupación histórica media: {hist_occ:5.1f}%  (RevPAR {money(statistics.fmean(v for _, v in series) / room_count)}/día)")
    print(f"Modelo: tendencia {model.slope:+,.0f} $/día² · σ residual {money(model.sigma)} · backtest WAPE {bt['wape']:.1f}% (naive {bt['naive_wape']:.1f}%, MAE {money(bt['mae'])})")

    print("\nPerfil semanal (ingreso medio e índice):")
    for wd in range(7):
        vals = [v for d, v in series if d.weekday() == wd]
        avg = statistics.fmean(vals) if vals else 0
        print(f"  {WEEKDAYS_ES[wd]:10s} {money(avg):>12s}  idx {model.seasonal[wd]:.2f}")

    print("\nPróximos 7 días:")
    for d, y in zip(fc["days"][:7], fc["point"][:7]):
        occ = min(100.0, y / capacity_day * 100)
        print(f"  {WEEKDAYS_ES[d.weekday()]:10s} {d.isoformat()}  {money(y):>12s}  ocupación implícita {occ:5.1f}%")

    print(f"\nPróxima semana : {money(fc['weekly_total'])}  (ocupación {week_occ:.1f}%)")
    print(f"Próximos {min(30, args.horizon)} días: {money(fc['month_total'])}  (ocupación {month_occ:.1f}%)")
    print(f"Banda 80% (mes): {money(fc['p10'])} – {money(fc['p90'])}  (mediana {money(fc['p50'])})")

    # Escenario: promo -12 % en los dos días valle, +25 % de demanda en esos días.
    order = sorted(range(7), key=lambda wd: model.seasonal[wd])
    low, high = order[:2], order[-2:]
    horizon_days = min(30, args.horizon)
    base30 = fc["month_total"]
    boosted = 0.0
    for i in range(horizon_days):
        d = fc["days"][i]
        y = fc["point"][i]
        if d.weekday() in low:
            boosted += min(capacity_day, y * 1.25) * 0.88
        else:
            boosted += y
    delta = boosted - base30
    print(f"\nEscenario comercial: -12 % de tarifa en {WEEKDAYS_ES[low[0]]} y {WEEKDAYS_ES[low[1]]}, +25 % de demanda")
    print(f"  Ingreso 30 días: {money(boosted)} ({delta:+,.0f} vs base)")
    print(f"  Ocupación estimada: {boosted / (capacity_day * horizon_days) * 100:.1f}% (base {month_occ:.1f}%)")
    print(f"  Días valle: {WEEKDAYS_ES[low[0]]}, {WEEKDAYS_ES[low[1]]} | Días pico: {WEEKDAYS_ES[high[0]]}, {WEEKDAYS_ES[high[1]]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
