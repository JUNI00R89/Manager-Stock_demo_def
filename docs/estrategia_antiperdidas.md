# Estrategia anti-pérdidas · Hotel Senderos (Demo)

_Generada el 22/10/2026 a partir de la proyección y de 11 productos activos (ventana de 30 días). Datos de demostración._

## 1. Resumen ejecutivo

- Ingresos últimos 30 días: **$3.710.000** · margen bruto **$1.860.200** (50.1 %).
- Proyección: **$1.183.249** la próxima semana y **$5.341.220** en 30 días (banda 80 %: $4.692.503 – $6.161.869).
- Demanda proyectada **+21.4 %** frente a los últimos 30 días: comprar con la misma cobertura actual perdería ventas.
- **Ventas en riesgo por quiebre: $2.406.054/mes** ($1.291.646 de margen) en 2 productos. Es un techo: asume que el quiebre dura todo el mes.
- **Capital inmovilizado: $316.500** en productos con sobre-stock o sin rotación.
- Inversión de reposición sugerida: **$525.000** (retorno estimado en el primer mes si se sostiene la demanda).
- El margen en riesgo equivale a **2.5×** la inversión de reposición.

## 2. Diagnóstico por producto

| Producto | Precio | Margen | Uds 30 d | Stock | Cobertura | Riesgo | Acción |
|---|---:|---:|---:|---:|---:|---|---|
| Cena para dos | $68.000 | 51% | 24 | 0 | 0 d | Quiebre | Reponer 14 uds ya |
| Lavandería express | $25.000 | 64% | 14 | 1 | 2 d | Cobertura crítica | Reponer 7 uds antes del fin de semana |
| Cerveza 330 ml | $8.000 | 40% | 19 | 39 | 62 d | Sobre-stock | Congelar compra · mover con combo |
| Refresco lata | $5.000 | 44% | 15 | 31 | 62 d | Sobre-stock | Congelar compra · mover con combo |
| Toalla extra | $6.000 | 58% | 30 | 65 | 65 d | Sobre-stock | Congelar compra · mover con combo |
| Snack mix | $9.500 | 41% | 17 | 51 | 90 d | Sobre-stock | Congelar compra · mover con combo |
| Agua mineral 600 ml | $4.500 | 51% | 9 | 36 | 120 d | Sobre-stock | Congelar compra · mover con combo |
| Desayuno a la habitación | $32.000 | 52% | 9 | 8 | 27 d | Saludable | Mantener |
| Kit de bienvenida | $12.000 | 58% | 19 | 23 | 36 d | Saludable | Mantener |
| Vino tinto copa | $18.000 | 42% | 21 | 33 | 47 d | Saludable | Mantener |
| Kit de aseo premium | $12.000 | 47% | 24 | 40 | 50 d | Saludable | Mantener |

## 3. Plan de acción

### A. Reposición inmediata (evita ventas perdidas)

- **Cena para dos**: reponer **14 uds** (cobertura actual 0 días). Inversión $462.000 · demanda proyectada 0.97 uds/día.
- **Lavandería express**: reponer **7 uds** (cobertura actual 2 días). Inversión $63.000 · demanda proyectada 0.57 uds/día.

### B. Congelar compras y liberar capital

- **Agua mineral 600 ml**: cobertura 120 días. No comprar hasta bajar de 45 días; capital liberable $49.500.
- **Cerveza 330 ml**: cobertura 62 días. No comprar hasta bajar de 45 días; capital liberable $50.400.
- **Refresco lata**: cobertura 62 días. No comprar hasta bajar de 45 días; capital liberable $23.800.
- **Snack mix**: cobertura 90 días. No comprar hasta bajar de 45 días; capital liberable $142.800.
- **Toalla extra**: cobertura 65 días. No comprar hasta bajar de 45 días; capital liberable $50.000.

### C. Combos para el valle de demanda

La proyección marca **martes y lunes** como días valle y **sábado y miércoles** como picos.
Usar el valle para mover inventario lento con precio completo (nunca descuentos generalizados):

- **Cena para dos + Toalla extra** (6 ventas conjuntas en 30 días).
- **Refresco lata + Vino tinto copa** (4 ventas conjuntas en 30 días).
- **Cerveza 330 ml + Kit de bienvenida** (4 ventas conjuntas en 30 días).
- **Cena para dos + Kit de aseo premium** (3 ventas conjuntas en 30 días).
- **Cena para dos + Lavandería express** (3 ventas conjuntas en 30 días).

### D. Punto de reorden dinámico (por estacionalidad)

Regla: `punto de reorden = demanda proyectada de 7 días × 1,2`.

| Producto | Mínimo actual | Sugerido | Cambio |
|---|---:|---:|---|
| Toalla extra | 10 | 11 | +1 |
| Cena para dos | 8 | 9 | +1 |
| Kit de aseo premium | 8 | 9 | +1 |
| Vino tinto copa | 6 | 8 | +2 |
| Cerveza 330 ml | 10 | 7 | -3 |
| Kit de bienvenida | 5 | 7 | +2 |
| Refresco lata | 10 | 6 | -4 |
| Snack mix | 8 | 6 | -2 |

### E. Medidas operativas y de control

1. **Alerta de cobertura < 7 días** en la app y compra sugerida automática (14 días de demanda).
2. **Proteger margen:** no descontar más de 10 % en sobre-stock; usar bundles antes que bajar precio.
3. **Registrar mermas** con movimiento `waste` para medir la pérdida real de perecederos.
4. **Rutina semanal:** lunes revisar cobertura y quiebres · miércoles compras programadas · viernes preparar el fin de semana (pico) · domingo cierre de mermas.
5. **KPIs:** quiebres = 0, cobertura mínima 7 días, capital inmovilizado < 30 días, margen bruto estable, merma < 2 % de ventas.

## 4. Supuestos

- Demanda diaria estimada con las ventas de los últimos 30 días, escalada por la proyección del negocio.
- El escalado de demanda se limita a +25 % para no convertir la incertidumbre del modelo en compras agresivas.
- La cobertura es stock / demanda diaria; no descuenta mermas no registradas.
- Los importes son estimaciones para priorizar; validar con conteo físico antes de comprar.

_Generado por `scripts/build_loss_strategy.py` · 22/10/2026 10:13_
