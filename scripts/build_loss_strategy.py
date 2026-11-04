#!/usr/bin/env python3
"""Genera la estrategia anti-pérdidas a partir de la proyección, el stock y los márgenes.

Analiza por producto: demanda, cobertura de inventario, margen, riesgo de quiebre,
sobre-stock y canastas de compra. Escribe:
    docs/estrategia_antiperdidas.md
    docs/estrategia_antiperdidas.html

Uso:
    python scripts/build_loss_strategy.py --business DEMO-HOTEL-001
"""
from __future__ import annotations

import argparse
import html
import math
import sqlite3
import statistics
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from forecast_revenue_occupancy import WEEKDAYS_ES, fit, forecast, load_daily_revenue  # noqa: E402

RISK_LABELS = {
    "QUIEBRE": "Quiebre",
    "CRITICO": "Cobertura crítica",
    "SOBRE_STOCK": "Sobre-stock",
    "SIN_ROTACION": "Sin rotación",
    "MARGEN_BAJO": "Margen bajo",
    "OK": "Saludable",
}
RISK_ORDER = ["QUIEBRE", "CRITICO", "SOBRE_STOCK", "SIN_ROTACION", "MARGEN_BAJO", "OK"]


def money(value: float) -> str:
    return f"${value:,.0f}".replace(",", ".")


def load_products(conn: sqlite3.Connection, business_id: str) -> list[dict]:
    return [dict(row) for row in conn.execute(
        "SELECT id,name,sku,category,price,cost,stock,min_stock,unit FROM products "
        "WHERE business_id=? AND active=1 AND product_type='sale_item' ORDER BY name",
        (business_id,),
    )]


def load_items(conn: sqlite3.Connection, business_id: str) -> list[dict]:
    return [dict(row) for row in conn.execute(
        """SELECT si.sale_id, si.product_id, si.product_name, si.quantity, si.unit_price,
                  si.unit_cost_snapshot, si.line_total, s.created_at
           FROM sale_items si JOIN sales s ON s.id=si.sale_id
           WHERE s.business_id=? AND s.status='completed'""",
        (business_id,),
    )]


def analyze(conn: sqlite3.Connection, business_id: str, days: int = 30) -> dict:
    now_co = datetime.now(timezone.utc) - timedelta(hours=5)
    today = now_co.date()
    from_key = (today - timedelta(days=days)).isoformat()
    from_key_90 = (today - timedelta(days=90)).isoformat()

    products = load_products(conn, business_id)
    items = load_items(conn, business_id)
    by_30: dict[str, dict] = {}
    by_90: dict[str, dict] = {}
    last_sale: dict[str, str] = {}
    for item in items:
        day = str(item["created_at"])[:10]
        product_id = item["product_id"]
        last_sale[product_id] = max(last_sale.get(product_id, ""), day)
        if day >= from_key:
            acc = by_30.setdefault(product_id, {"units": 0.0, "revenue": 0.0, "cost": 0.0})
            acc["units"] += float(item["quantity"])
            acc["revenue"] += float(item["line_total"])
            acc["cost"] += float(item["quantity"]) * float(item["unit_cost_snapshot"] or 0)
        if day >= from_key_90:
            acc = by_90.setdefault(product_id, {"units": 0.0})
            acc["units"] += float(item["quantity"])

    # Proyección de demanda para escalar la reposición.
    series = load_daily_revenue(conn, business_id, 90, today - timedelta(days=1))
    model = fit(series)
    projection = forecast(model, today, 30)
    revenue_30 = sum(float(acc["revenue"]) for acc in by_30.values())
    window_total = float(conn.execute(
        "SELECT COALESCE(SUM(total),0) FROM sales WHERE business_id=? AND status='completed' AND substr(created_at,1,10) >= ?",
        (business_id, from_key),
    ).fetchone()[0])
    uplift = (projection["month_total"] / window_total) if window_total else 1.0
    # Tope conservador: la proyección de ingresos no debe traducirse en compras
    # agresivas cuando el modelo tiene alta incertidumbre.
    uplift = max(1.0, min(1.25, uplift))

    rows: list[dict] = []
    for product in products:
        acc = by_30.get(product["id"], {"units": 0.0, "revenue": 0.0, "cost": 0.0})
        units = float(acc["units"])
        daily = units / days
        daily_projected = daily * uplift
        stock = float(product["stock"])
        cover = stock / daily if daily > 0 else (float("inf") if stock > 0 else 0.0)
        margin_pct = ((product["price"] - product["cost"]) / product["price"] * 100) if product["price"] else 0.0

        risk: list[str] = []
        if stock <= 0 and daily > 0:
            risk.append("QUIEBRE")
        elif daily > 0 and cover < 7:
            risk.append("CRITICO")
        elif daily > 0 and cover > 60:
            risk.append("SOBRE_STOCK")
        elif daily == 0 and stock > 0 and by_90.get(product["id"], {}).get("units", 0) == 0:
            risk.append("SIN_ROTACION")
        if margin_pct < 20 and units > 0:
            risk.append("MARGEN_BAJO")

        reorder_qty = 0
        if risk and risk[0] in {"QUIEBRE", "CRITICO"}:
            reorder_qty = max(0, math.ceil(daily_projected * 14 - stock))
        elif risk and risk[0] == "SOBRE_STOCK":
            reorder_qty = 0

        reorder_point = math.ceil(daily_projected * 7 * 1.2) if daily_projected > 0 else 0
        action = "Mantener"
        if risk and risk[0] == "QUIEBRE":
            action = f"Reponer {reorder_qty} uds ya"
        elif risk and risk[0] == "CRITICO":
            action = f"Reponer {reorder_qty} uds antes del fin de semana"
        elif risk and risk[0] == "SOBRE_STOCK":
            action = "Congelar compra · mover con combo"
        elif risk and risk[0] == "SIN_ROTACION":
            action = "Liquidar o descontinuar"
        elif "MARGEN_BAJO" in risk:
            action = "Revisar precio o costo"

        rows.append({
            "id": product["id"], "name": product["name"], "sku": product["sku"],
            "category": product["category"], "price": float(product["price"]), "cost": float(product["cost"]),
            "stock": stock, "min_stock": float(product["min_stock"]), "unit": product["unit"],
            "units": units, "revenue": float(acc["revenue"]), "won": float(acc["cost"]),
            "margin_pct": margin_pct, "daily": daily, "daily_projected": daily_projected,
            "cover": cover, "risk": risk[0] if risk else "OK", "reorder_qty": reorder_qty,
            "reorder_point": reorder_point, "action": action, "last_sale": last_sale.get(product["id"], "—"),
        })

    # Canastas de la ventana analizada.
    pairs: Counter = Counter()
    by_sale: dict[str, list[str]] = {}
    for item in items:
        if str(item["created_at"])[:10] >= from_key:
            by_sale.setdefault(item["sale_id"], []).append(item["product_name"])
    for names in by_sale.values():
        unique = sorted(set(names))
        for i in range(len(unique)):
            for j in range(i + 1, len(unique)):
                pairs[(unique[i], unique[j])] += 1

    stockout = [row for row in rows if row["risk"] == "QUIEBRE"]
    critical = [row for row in rows if row["risk"] == "CRITICO"]
    overstock = [row for row in rows if row["risk"] == "SOBRE_STOCK"]
    dead = [row for row in rows if row["risk"] == "SIN_ROTACION"]
    low_margin = [row for row in rows if row["risk"] == "MARGEN_BAJO"]

    revenue_risk = sum(row["daily_projected"] * 30 * row["price"] for row in stockout + critical)
    margin_risk = sum(row["daily_projected"] * 30 * (row["price"] - row["cost"]) for row in stockout + critical)
    tied_capital = sum(max(0.0, row["stock"] - row["daily"] * 45) * row["cost"] for row in overstock)
    tied_capital += sum(row["stock"] * row["cost"] for row in dead)
    reorder_investment = sum(row["reorder_qty"] * row["cost"] for row in stockout + critical)

    ranked = sorted(range(7), key=lambda wd: model.seasonal[wd])
    return {
        "business_id": business_id,
        "business_name": conn.execute("SELECT name FROM businesses WHERE id=?", (business_id,)).fetchone()["name"],
        "days": days,
        "products": rows,
        "revenue_30": revenue_30,
        "cost_30": sum(float(acc["cost"]) for acc in by_30.values()),
        "revenue_risk": revenue_risk,
        "margin_risk": margin_risk,
        "tied_capital": tied_capital,
        "reorder_investment": reorder_investment,
        "stockout": stockout,
        "critical": critical,
        "overstock": overstock,
        "dead": dead,
        "low_margin": low_margin,
        "pairs": pairs.most_common(6),
        "week_total": projection["weekly_total"],
        "month_total": projection["month_total"],
        "month_low": projection["p10"],
        "month_high": projection["p90"],
        "uplift": uplift,
        "valley": WEEKDAYS_ES[ranked[0]],
        "valley2": WEEKDAYS_ES[ranked[1]],
        "peak": WEEKDAYS_ES[ranked[-1]],
        "peak2": WEEKDAYS_ES[ranked[-2]],
        "window_total": window_total,
    }


def table_rows(data: dict) -> list[str]:
    ordered = sorted(data["products"], key=lambda row: (RISK_ORDER.index(row["risk"]), row["cover"]))
    result = []
    for row in ordered:
        cover = "—" if row["daily"] == 0 else ("∞" if row["cover"] == float("inf") else f"{row['cover']:.0f} d")
        risk = RISK_LABELS[row["risk"]]
        result.append(
            f"<tr><td><strong>{html.escape(row['name'])}</strong><br><span class='muted'>{html.escape(row['category'])}</span></td>"
            f"<td class='num'>{money(row['price'])}</td><td class='num'>{row['margin_pct']:.0f}%</td>"
            f"<td class='num'>{row['units']:.0f}</td><td class='num'>{row['stock']:.0f}</td>"
            f"<td class='num'>{cover}</td><td><span class='tag tag-{row['risk'].lower()}'>{risk}</span></td>"
            f"<td>{html.escape(row['action'])}</td></tr>"
        )
    return result


def render_markdown(data: dict) -> str:
    lines = [
        f"# Estrategia anti-pérdidas · {data['business_name']}",
        "",
        f"_Generada el {datetime.now().strftime('%d/%m/%Y')} a partir de la proyección y de "
        f"{len(data['products'])} productos activos (ventana de {data['days']} días). Datos de demostración._",
        "",
        "## 1. Resumen ejecutivo",
        "",
        f"- Ingresos últimos {data['days']} días: **{money(data['revenue_30'])}** · margen bruto **{money(data['revenue_30'] - data['cost_30'])}** ({(data['revenue_30'] - data['cost_30']) / data['revenue_30'] * 100:.1f} %).",
        f"- Proyección: **{money(data['week_total'])}** la próxima semana y **{money(data['month_total'])}** en 30 días "
        f"(banda 80 %: {money(data['month_low'])} – {money(data['month_high'])}).",
        f"- Demanda proyectada **+{(data['uplift'] - 1) * 100:.1f} %** frente a los últimos {data['days']} días: comprar con la misma cobertura actual perdería ventas.",
        f"- **Ventas en riesgo por quiebre: {money(data['revenue_risk'])}/mes** ({money(data['margin_risk'])} de margen) en {len(data['stockout']) + len(data['critical'])} productos. Es un techo: asume que el quiebre dura todo el mes.",
        f"- **Capital inmovilizado: {money(data['tied_capital'])}** en productos con sobre-stock o sin rotación.",
        f"- Inversión de reposición sugerida: **{money(data['reorder_investment'])}** (retorno estimado en el primer mes si se sostiene la demanda).",
        f"- El margen en riesgo equivale a **{data['margin_risk'] / data['reorder_investment']:.1f}×** la inversión de reposición." if data["reorder_investment"] else "",
        "",
        "## 2. Diagnóstico por producto",
        "",
        "| Producto | Precio | Margen | Uds 30 d | Stock | Cobertura | Riesgo | Acción |",
        "|---|---:|---:|---:|---:|---:|---|---|",
    ]
    for row in sorted(data["products"], key=lambda r: (RISK_ORDER.index(r["risk"]), r["cover"])):
        cover = "—" if row["daily"] == 0 else ("∞" if row["cover"] == float("inf") else f"{row['cover']:.0f} d")
        lines.append(
            f"| {row['name']} | {money(row['price'])} | {row['margin_pct']:.0f}% | {row['units']:.0f} | "
            f"{row['stock']:.0f} | {cover} | {RISK_LABELS[row['risk']]} | {row['action']} |"
        )

    lines += [
        "",
        "## 3. Plan de acción",
        "",
        "### A. Reposición inmediata (evita ventas perdidas)",
        "",
    ]
    if data["stockout"] or data["critical"]:
        for row in data["stockout"] + data["critical"]:
            cover_text = "0 días" if row["stock"] <= 0 else f"{row['cover']:.0f} días"
            lines.append(
                f"- **{row['name']}**: reponer **{row['reorder_qty']} uds** (cobertura actual {cover_text}). "
                f"Inversión {money(row['reorder_qty'] * row['cost'])} · demanda proyectada {row['daily_projected']:.2f} uds/día."
            )
    else:
        lines.append("- Sin quiebres ni coberturas críticas en este momento.")

    lines += [
        "",
        "### B. Congelar compras y liberar capital",
        "",
    ]
    if data["overstock"] or data["dead"]:
        for row in data["overstock"] + data["dead"]:
            excess = max(0.0, row["stock"] - row["daily"] * 45)
            lines.append(
                f"- **{row['name']}**: cobertura {row['cover']:.0f} días. No comprar hasta bajar de 45 días; "
                f"capital liberable {money(excess * row['cost'])}."
            )
    else:
        lines.append("- Sin sobre-stock relevante.")

    lines += [
        "",
        "### C. Combos para el valle de demanda",
        "",
        f"La proyección marca **{data['valley']} y {data['valley2']}** como días valle y **{data['peak']} y {data['peak2']}** como picos.",
        "Usar el valle para mover inventario lento con precio completo (nunca descuentos generalizados):",
        "",
    ]
    for (a, b), count in data["pairs"][:5]:
        lines.append(f"- **{a} + {b}** ({count} ventas conjuntas en {data['days']} días).")

    lines += [
        "",
        "### D. Punto de reorden dinámico (por estacionalidad)",
        "",
        "Regla: `punto de reorden = demanda proyectada de 7 días × 1,2`.",
        "",
        "| Producto | Mínimo actual | Sugerido | Cambio |",
        "|---|---:|---:|---|",
    ]
    for row in sorted(data["products"], key=lambda r: r["reorder_point"], reverse=True)[:8]:
        delta = row["reorder_point"] - row["min_stock"]
        sign = "+" if delta > 0 else ""
        lines.append(f"| {row['name']} | {row['min_stock']:.0f} | {row['reorder_point']} | {sign}{delta:.0f} |")

    lines += [
        "",
        "### E. Medidas operativas y de control",
        "",
        "1. **Alerta de cobertura < 7 días** en la app y compra sugerida automática (14 días de demanda).",
        "2. **Proteger margen:** no descontar más de 10 % en sobre-stock; usar bundles antes que bajar precio.",
        "3. **Registrar mermas** con movimiento `waste` para medir la pérdida real de perecederos.",
        "4. **Rutina semanal:** lunes revisar cobertura y quiebres · miércoles compras programadas · viernes preparar el fin de semana (pico) · domingo cierre de mermas.",
        "5. **KPIs:** quiebres = 0, cobertura mínima 7 días, capital inmovilizado < 30 días, margen bruto estable, merma < 2 % de ventas.",
        "",
        "## 4. Supuestos",
        "",
        "- Demanda diaria estimada con las ventas de los últimos 30 días, escalada por la proyección del negocio.",
        "- El escalado de demanda se limita a +25 % para no convertir la incertidumbre del modelo en compras agresivas.",
        "- La cobertura es stock / demanda diaria; no descuenta mermas no registradas.",
        "- Los importes son estimaciones para priorizar; validar con conteo físico antes de comprar.",
        "",
        f"_Generado por `scripts/build_loss_strategy.py` · {datetime.now().strftime('%d/%m/%Y %H:%M')}_",
        "",
    ]
    return "\n".join(lines)


def render_html(data: dict) -> str:
    rows = "".join(table_rows(data))
    actions = []
    for row in data["stockout"] + data["critical"]:
        actions.append(
            f"<li><strong>Reponer {row['reorder_qty']} uds de {html.escape(row['name'])}</strong> "
            f"· inversión {money(row['reorder_qty'] * row['cost'])} · demanda {row['daily_projected']:.2f} uds/día</li>"
        )
    for row in data["overstock"] + data["dead"]:
        actions.append(
            f"<li><strong>Congelar compra de {html.escape(row['name'])}</strong> "
            f"(cobertura {row['cover']:.0f} días) y moverlo con combo</li>"
        )
    pairs_html = "".join(
        f"<li><strong>{html.escape(a)} + {html.escape(b)}</strong> · {count} ventas conjuntas</li>"
        for (a, b), count in data["pairs"][:5]
    )
    reorder_rows = "".join(
        f"<tr><td>{html.escape(row['name'])}</td><td class='num'>{row['min_stock']:.0f}</td>"
        f"<td class='num'><strong>{row['reorder_point']}</strong></td>"
        f"<td class='num'>{row['reorder_point'] - row['min_stock']:+.0f}</td></tr>"
        for row in sorted(data["products"], key=lambda r: r["reorder_point"], reverse=True)[:8]
    )

    return f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Estrategia anti-pérdidas · {html.escape(data['business_name'])}</title>
<style>
  :root{{--bg:#f6f7f9;--card:#fff;--ink:#111318;--muted:#5b6170;--line:#e6e8ee;--accent:#F26A1B}}
  *{{box-sizing:border-box}}
  body{{margin:0;font-family:Inter,Segoe UI,system-ui,sans-serif;background:var(--bg);color:var(--ink)}}
  .page{{max-width:1080px;margin:0 auto;padding:40px 24px 64px}}
  header{{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:26px}}
  h1{{font-size:26px;margin:0 0 6px;letter-spacing:-.02em}}
  .sub{{color:var(--muted);font-size:13px}}
  .pill{{background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:12px;color:var(--muted)}}
  .grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:20px}}
  .card{{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 20px}}
  .kpi-label{{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}}
  .kpi-value{{font-size:26px;font-weight:700;margin-top:6px;letter-spacing:-.02em}}
  .kpi-note{{font-size:12px;color:var(--muted);margin-top:4px}}
  h2{{font-size:16px;margin:0 0 4px}}
  .lead{{margin:0 0 14px;font-size:13px;color:var(--muted)}}
  table{{width:100%;border-collapse:collapse;font-size:13px}}
  th{{text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--line)}}
  td{{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}}
  td.num{{font-variant-numeric:tabular-nums;white-space:nowrap}}
  .muted{{color:var(--muted);font-size:11px}}
  .tag{{display:inline-block;border-radius:8px;padding:2px 8px;font-size:11px;font-weight:600;white-space:nowrap}}
  .tag-quiebre{{background:#ffe4e6;color:#9f1239}}
  .tag-critico{{background:#ffedd5;color:#9a3412}}
  .tag-sobre_stock{{background:#e0e7ff;color:#3730a3}}
  .tag-sin_rotacion{{background:#f3e8ff;color:#6b21a8}}
  .tag-margen_bajo{{background:#fef3c7;color:#92400e}}
  .tag-ok{{background:#dcfce7;color:#166534}}
  .two{{display:grid;grid-template-columns:1.2fr 1fr;gap:14px}}
  @media(max-width:820px){{.two{{grid-template-columns:1fr}}}}
  ul{{margin:6px 0 0;padding-left:18px;font-size:13px;line-height:1.7}}
  .warn{{background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:14px 16px;font-size:13px;line-height:1.6;color:#78350f;margin-top:14px}}
  .foot{{margin-top:24px;font-size:11px;color:var(--muted)}}
  code{{background:#eef0f4;padding:1px 5px;border-radius:5px;font-size:12px}}
</style>
</head>
<body>
<div class="page">
  <header>
    <div>
      <h1>Estrategia anti-pérdidas</h1>
      <div class="sub">{html.escape(data['business_name'])} · {len(data['products'])} productos · ventana {data['days']} días</div>
    </div>
    <div class="pill">Generado {datetime.now().strftime('%d/%m/%Y %H:%M')} · datos demo</div>
  </header>

  <div class="grid">
    <div class="card"><div class="kpi-label">Ventas en riesgo / mes</div><div class="kpi-value" style="color:#be123c">{money(data['revenue_risk'])}</div><div class="kpi-note">{money(data['margin_risk'])} de margen · techo si el quiebre dura el mes</div></div>
    <div class="card"><div class="kpi-label">Capital inmovilizado</div><div class="kpi-value" style="color:#4338ca">{money(data['tied_capital'])}</div><div class="kpi-note">sobre-stock y sin rotación</div></div>
    <div class="card"><div class="kpi-label">Inversión de reposición</div><div class="kpi-value">{money(data['reorder_investment'])}</div><div class="kpi-note">14 días de demanda proyectada</div></div>
    <div class="card"><div class="kpi-label">Proyección 30 días</div><div class="kpi-value">{money(data['month_total'])}</div><div class="kpi-note">banda 80 %: {money(data['month_low'])} – {money(data['month_high'])}</div></div>
  </div>

  <div class="card" style="margin-bottom:14px">
    <h2>Lectura de la proyección</h2>
    <p class="lead">La demanda estimada para los próximos 30 días es <strong>+{(data['uplift'] - 1) * 100:.1f} %</strong> frente a los últimos {data['days']} días. Con la cobertura actual, esa demanda adicional se pierde en los productos sin stock.</p>
    <ul>
      <li><strong>Próxima semana:</strong> {money(data['week_total'])} · <strong>30 días:</strong> {money(data['month_total'])}.</li>
      <li><strong>Días valle:</strong> {data['valley']} y {data['valley2']} → combos y paquetes para mover sobre-stock sin bajar margen.</li>
      <li><strong>Días pico:</strong> {data['peak']} y {data['peak2']} → asegurar stock y no descontar.</li>
      <li><strong>Quiebres actuales:</strong> {len(data['stockout'])} · <strong>cobertura crítica:</strong> {len(data['critical'])} · <strong>sobre-stock:</strong> {len(data['overstock'])}.</li>
      <li><strong>Inversión de reposición:</strong> {money(data['reorder_investment'])} · margen en riesgo: {money(data['margin_risk'])}/mes.</li>
    </ul>
  </div>

  <div class="card" style="margin-bottom:14px">
    <h2>Diagnóstico por producto</h2>
    <p class="lead">Cobertura = stock / demanda diaria. Menos de 7 días es riesgo de quiebre; más de 60 días es capital detenido.</p>
    <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Producto</th><th>Precio</th><th>Margen</th><th>Uds 30 d</th><th>Stock</th><th>Cobertura</th><th>Riesgo</th><th>Acción</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  </div>

  <div class="two">
    <div class="card">
      <h2>Plan de acción inmediato</h2>
      <p class="lead">Primero lo que evita venta perdida; después lo que libera capital.</p>
      <ul>{''.join(actions) or '<li>Sin acciones urgentes.</li>'}</ul>
    </div>
    <div class="card">
      <h2>Combos con datos de canasta</h2>
      <p class="lead">Pares comprados juntos en los últimos {data['days']} días.</p>
      <ul>{pairs_html or '<li>Sin datos suficientes.</li>'}</ul>
      <p class="lead" style="margin-top:12px">Promocionar en {data['valley']} y {data['valley2']}, nunca en {data['peak']}.</p>
    </div>
  </div>

  <div class="card" style="margin-top:14px">
    <h2>Punto de reorden sugerido</h2>
    <p class="lead">Fórmula: demanda proyectada de 7 días × 1,2 de colchón.</p>
    <table>
      <thead><tr><th>Producto</th><th>Mínimo actual</th><th>Sugerido</th><th>Cambio</th></tr></thead>
      <tbody>{reorder_rows}</tbody>
    </table>
  </div>

  <div class="card" style="margin-top:14px">
    <h2>Rutina y control</h2>
    <ul>
      <li><strong>Lunes:</strong> revisar cobertura, quiebres y capital inmovilizado.</li>
      <li><strong>Martes:</strong> activar combos del valle y medir conversión.</li>
      <li><strong>Miércoles:</strong> ejecutar compras según punto de reorden (no por intuición).</li>
      <li><strong>Viernes:</strong> asegurar stock para el pico del fin de semana.</li>
      <li><strong>Domingo:</strong> registrar mermas con movimiento <code>waste</code>.</li>
      <li><strong>KPIs:</strong> quiebres = 0 · cobertura mínima 7 días · capital inmovilizado &lt; 30 días · margen bruto estable · merma &lt; 2 %.</li>
    </ul>
  </div>

  <div class="warn">
    <strong>Supuestos.</strong> Demanda diaria calculada con ventas de los últimos {data['days']} días y escalada con la proyección del negocio.
    La cobertura no descuenta mermas no registradas. Los importes priorizan decisiones: validar el conteo físico antes de comprar.
    Datos de demostración.
  </div>

  <div class="foot">Generado por <code>scripts/build_loss_strategy.py</code> · fuente: ventas completadas, productos y movimientos de la base SQLite.</div>
</div>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera la estrategia anti-pérdidas.")
    parser.add_argument("--business", default="DEMO-HOTEL-001")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--db", default=str(ROOT / "backend" / "data" / "manager_stock.db"))
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    data = analyze(conn, args.business, args.days)

    md_path = ROOT / "docs" / "estrategia_antiperdidas.md"
    html_path = ROOT / "docs" / "estrategia_antiperdidas.html"
    md_path.write_text(render_markdown(data), encoding="utf-8")
    html_path.write_text(render_html(data), encoding="utf-8")

    print(f"Estrategia: {md_path}")
    print(f"Informe:    {html_path}")
    print(f"Ventas en riesgo/mes: {money(data['revenue_risk'])} · margen: {money(data['margin_risk'])}")
    print(f"Capital inmovilizado: {money(data['tied_capital'])} · reposición: {money(data['reorder_investment'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
