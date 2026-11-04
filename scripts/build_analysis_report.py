#!/usr/bin/env python3
"""Genera un informe HTML autocontenido con la proyección de ingresos y ocupación.

Reutiliza el modelo de scripts/forecast_revenue_occupancy.py y escribe
docs/analisis_ocupacion.html (sin dependencias externas ni CDN).

Uso:
    python scripts/build_analysis_report.py --business DEMO-HOTEL-001
"""
from __future__ import annotations

import argparse
import html
import sqlite3
import statistics
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from forecast_revenue_occupancy import (  # noqa: E402
    WEEKDAYS_ES,
    backtest,
    fit,
    forecast,
    load_daily_revenue,
    money,
)


def bar_chart_html(rows: list[tuple[str, float, float]], accent: str = "#F26A1B") -> str:
    """rows: (etiqueta, valor, porcentaje 0-100)."""
    bars = []
    for label, value, pct in rows:
        bars.append(
            f'<div class="bar-col"><div class="bar-wrap"><div class="bar" style="height:{max(2, pct):.1f}%;background:{accent}"></div></div>'
            f'<div class="bar-val">{money(value)}</div><div class="bar-lbl">{html.escape(label)}</div></div>'
        )
    return '<div class="bars">' + "".join(bars) + "</div>"


def residency_bar(pct: float, color: str) -> str:
    return (
        f'<div class="occ-bar"><div class="occ-fill" style="width:{max(1, min(100, pct)):.1f}%;background:{color}"></div>'
        f'<span>{pct:.1f}%</span></div>'
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera el informe HTML de proyección.")
    parser.add_argument("--business", default="DEMO-HOTEL-001")
    parser.add_argument("--days", type=int, default=90)
    parser.add_argument("--horizon", type=int, default=30)
    parser.add_argument("--db", default=str(ROOT / "backend" / "data" / "manager_stock.db"))
    parser.add_argument("--out", default=str(ROOT / "docs" / "analisis_ocupacion.html"))
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    business = conn.execute("SELECT name FROM businesses WHERE id=?", (args.business,)).fetchone()
    business_name = business["name"] if business else args.business
    rooms = conn.execute("SELECT price_per_night FROM hotel_rooms WHERE business_id=?", (args.business,)).fetchall()
    room_count = len(rooms)
    adr = statistics.fmean(float(r["price_per_night"]) for r in rooms)
    capacity_day = adr * room_count

    now_co = datetime.now(timezone.utc) - timedelta(hours=5)
    today = now_co.date()
    series = load_daily_revenue(conn, args.business, args.days, today - timedelta(days=1))
    model = fit(series)
    fc = forecast(model, today, args.horizon)
    bt = backtest(series)

    total_hist = sum(v for _, v in series)
    hist_occ = total_hist / adr / (room_count * len(series)) * 100
    revpar = total_hist / len(series) / room_count
    week_occ = fc["weekly_total"] / (capacity_day * 7) * 100
    month_occ = fc["month_total"] / (capacity_day * min(30, args.horizon)) * 100

    weekday_avgs = []
    for wd in range(7):
        vals = [v for d, v in series if d.weekday() == wd]
        weekday_avgs.append(statistics.fmean(vals) if vals else 0.0)
    max_avg = max(weekday_avgs) or 1.0
    chart = bar_chart_html([(WEEKDAYS_ES[i].capitalize(), weekday_avgs[i], weekday_avgs[i] / max_avg * 100) for i in range(7)])

    forecast_rows = []
    for d, y in zip(fc["days"][:7], fc["point"][:7]):
        occ = min(100.0, y / capacity_day * 100)
        color = "#e11d48" if occ < 55 else ("#F26A1B" if occ < 70 else "#059669")
        forecast_rows.append(
            f"<tr><td>{WEEKDAYS_ES[d.weekday()].capitalize()}</td><td>{d.strftime('%d/%m/%Y')}</td>"
            f"<td class='num'>{money(y)}</td><td>{residency_bar(occ, color)}</td></tr>"
        )

    order = sorted(range(7), key=lambda wd: model.seasonal[wd])
    low, high = order[:2], order[-2:]
    base30 = fc["month_total"]
    boosted = 0.0
    for i in range(min(30, args.horizon)):
        d, y = fc["days"][i], fc["point"][i]
        boosted += min(capacity_day, y * 1.25) * 0.88 if d.weekday() in low else y
    delta = boosted - base30
    promo_occ = boosted / (capacity_day * min(30, args.horizon)) * 100

    generated = datetime.now().strftime("%d/%m/%Y %H:%M")
    extra_night_month = adr * 4.3  # una habitación-noche extra por semana

    html_doc = f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Análisis de ocupación · {html.escape(business_name)}</title>
<style>
  :root{{--bg:#f6f7f9;--card:#ffffff;--ink:#111318;--muted:#5b6170;--line:#e6e8ee;--accent:#F26A1B}}
  *{{box-sizing:border-box}}
  body{{margin:0;font-family:Inter,Segoe UI,system-ui,sans-serif;background:var(--bg);color:var(--ink)}}
  .page{{max-width:1060px;margin:0 auto;padding:40px 24px 64px}}
  header{{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:28px}}
  h1{{font-size:26px;margin:0 0 6px;letter-spacing:-.02em}}
  .sub{{color:var(--muted);font-size:13px}}
  .pill{{background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:12px;color:var(--muted)}}
  .grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:22px}}
  .card{{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 20px}}
  .kpi-label{{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}}
  .kpi-value{{font-size:28px;font-weight:700;margin-top:6px;letter-spacing:-.02em}}
  .kpi-note{{font-size:12px;color:var(--muted);margin-top:4px}}
  .card h2{{font-size:15px;margin:0 0 4px}}
  .card p.lead{{margin:0 0 16px;font-size:13px;color:var(--muted)}}
  .bars{{display:flex;align-items:flex-end;gap:10px;height:200px;margin-top:8px}}
  .bar-col{{flex:1;display:flex;flex-direction:column;align-items:center;height:100%}}
  .bar-wrap{{flex:1;width:100%;display:flex;align-items:flex-end;justify-content:center}}
  .bar{{width:70%;border-radius:8px 8px 4px 4px;min-height:3px;opacity:.92}}
  .bar-val{{font-size:11px;color:var(--muted);margin-top:6px;white-space:nowrap}}
  .bar-lbl{{font-size:11px;margin-top:2px;color:var(--ink)}}
  table{{width:100%;border-collapse:collapse;font-size:13px}}
  th{{text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--line)}}
  td{{padding:10px;border-bottom:1px solid var(--line)}}
  td.num{{font-variant-numeric:tabular-nums;font-weight:600}}
  .occ-bar{{position:relative;height:10px;border-radius:999px;background:#eef0f4;overflow:hidden;min-width:120px}}
  .occ-fill{{height:100%;border-radius:999px}}
  .occ-bar span{{position:absolute;right:6px;top:-3px;font-size:10px;color:var(--muted)}}
  .two{{display:grid;grid-template-columns:1.3fr 1fr;gap:14px}}
  @media(max-width:760px){{.two{{grid-template-columns:1fr}}}}
  ul{{margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.65}}
  li{{margin-bottom:6px}}
  .tag{{display:inline-block;background:#fff4ec;color:#b3470c;border-radius:8px;padding:2px 8px;font-size:11px;font-weight:600;margin-right:6px}}
  .warn{{background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:14px 16px;font-size:13px;line-height:1.6;color:#78350f}}
  .foot{{margin-top:26px;font-size:11px;color:var(--muted);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}}
  .band{{position:relative;height:34px;margin-top:10px}}
  .band-range{{position:absolute;top:8px;height:18px;border-radius:9px;background:linear-gradient(90deg,#ffe0cc,#ffc59e);left:0;right:0}}
  .band-median{{position:absolute;top:4px;width:2px;height:26px;background:#b3470c}}
  code{{background:#eef0f4;padding:1px 5px;border-radius:5px;font-size:12px}}
</style>
</head>
<body>
<div class="page">
  <header>
    <div>
      <h1>Análisis de ingresos y ocupación</h1>
      <div class="sub">{html.escape(business_name)} · {len(series)} días de historia · horizonte {min(30, args.horizon)} días</div>
    </div>
    <div class="pill">Generado {generated} · datos demo</div>
  </header>

  <div class="grid">
    <div class="card"><div class="kpi-label">Ocupación histórica</div><div class="kpi-value">{hist_occ:.1f}%</div><div class="kpi-note">RevPAR {money(revpar)}/día</div></div>
    <div class="card"><div class="kpi-label">Próxima semana</div><div class="kpi-value">{money(fc['weekly_total'])}</div><div class="kpi-note">Ocupación {week_occ:.1f}%</div></div>
    <div class="card"><div class="kpi-label">Próximos 30 días</div><div class="kpi-value">{money(fc['month_total'])}</div><div class="kpi-note">Ocupación {month_occ:.1f}%</div></div>
    <div class="card"><div class="kpi-label">Banda 80 % (30 días)</div><div class="kpi-value" style="font-size:20px">{money(fc['p10'])} – {money(fc['p90'])}</div><div class="kpi-note">Mediana {money(fc['p50'])}</div></div>
  </div>

  <div class="card" style="margin-bottom:14px">
    <h2>Ingreso medio por día de la semana</h2>
    <p class="lead">Base del componente estacional del modelo (índice 1,00 = promedio).</p>
    {chart}
  </div>

  <div class="two">
    <div class="card">
      <h2>Proyección día por día</h2>
      <p class="lead">Tendencia + estacionalidad semanal. La ocupación es implícita (ingreso / ADR).</p>
      <table>
        <thead><tr><th>Día</th><th>Fecha</th><th>Ingreso</th><th>Ocupación</th></tr></thead>
        <tbody>{''.join(forecast_rows)}</tbody>
      </table>
    </div>
    <div class="card">
      <h2>Escenario comercial</h2>
      <p class="lead">−12 % de tarifa en <strong>{WEEKDAYS_ES[low[0]]}</strong> y <strong>{WEEKDAYS_ES[low[1]]}</strong> con +25 % de demanda.</p>
      <table>
        <tbody>
          <tr><td>Ingreso 30 días</td><td class="num">{money(boosted)}</td></tr>
          <tr><td>Diferencia vs. base</td><td class="num">{delta:+,.0f}</td></tr>
          <tr><td>Ocupación estimada</td><td class="num">{promo_occ:.1f}% (base {month_occ:.1f}%)</td></tr>
          <tr><td>Habitación-noche extra / semana</td><td class="num">≈ {money(extra_night_month)}/mes</td></tr>
        </tbody>
      </table>
      <div class="band"><div class="band-range"></div><div class="band-median" style="left:{min(98, max(1, (fc['p50'] - fc['p10']) / max(1, fc['p90'] - fc['p10']) * 100)):.0f}%"></div></div>
      <div class="sub" style="margin-top:4px">Banda de incertidumbre del mes: {money(fc['p10'])} · mediana · {money(fc['p90'])}</div>
    </div>
  </div>

  <div class="card" style="margin:14px 0">
    <h2>Plan para subir la ocupación</h2>
    <p class="lead">Priorizado por impacto; los valles son <strong>{WEEKDAYS_ES[low[0]]} y {WEEKDAYS_ES[low[1]]}</strong> y los picos <strong>{WEEKDAYS_ES[high[0]]} y {WEEKDAYS_ES[high[1]]}</strong>.</p>
    <ul>
      <li><span class="tag">1</span><strong>Paquete de 2 noches domingo→martes con desayuno.</strong> Convierte una reserva de 1 noche en 2 y sube el ticket de restaurante.</li>
      <li><span class="tag">2</span><strong>Precio dinámico:</strong> −12 % lunes/martes y +5 % sábado. Evita descuentos generalizados que solo regalan margen en picos.</li>
      <li><span class="tag">3</span><strong>Tarifa corporativa lunes-miércoles</strong> con cupo semanal: llena el valle de forma recurrente y predecible.</li>
      <li><span class="tag">4</span><strong>Estancia mínima de 2 noches el sábado</strong> para proteger el pico del canibalismo promocional.</li>
      <li><span class="tag">5</span><strong>Reserva directa (web/WhatsApp)</strong> frente a OTAs: ahorra 15–20 % de comisión por reserva.</li>
      <li><span class="tag">6</span><strong>Medir de verdad:</strong> registrar tarifa/noche y noches vendidas. Hoy la ocupación es un proxy (ingreso / ADR), no una medición.</li>
    </ul>
  </div>

  <div class="warn">
    <strong>Límites de los datos.</strong> El negocio tiene {room_count} habitaciones (capacidad {money(capacity_day)}/día): cada noche vendida mueve ~{100 / room_count:.0f} pp de ocupación diaria, así que lee esto como tendencia, no como precisión fina.
    El POS no registra la tarifa de la habitación, por lo que la ocupación se estima con el ingreso y el ADR ({money(adr)}).
    Validación del modelo: WAPE {bt['wape']:.1f} % vs. {bt['naive_wape']:.1f} % del baseline naive estacional (MAE {money(bt['mae'])}).
  </div>

  <div class="foot">
    <span>Fuente: <code>sales</code> completadas + <code>hotel_rooms</code> · método: tendencia + estacionalidad semanal + Monte Carlo</span>
    <span>Generado por <code>scripts/build_analysis_report.py</code></span>
  </div>
</div>
</body>
</html>
"""
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html_doc, encoding="utf-8")
    print(f"Informe generado: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
