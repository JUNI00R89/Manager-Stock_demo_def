# Pruebas del frontend

El frontend usa **Vitest** con **jsdom** y **Testing Library**. La configuración vive en `vitest.config.ts` y el setup global en `src/test/setup.ts`.

## Comandos

```bash
npm test              # ejecuta toda la suite una vez
npm run test:watch    # modo interactivo
npm run test:coverage # ejecuta y genera el reporte de cobertura
```

El reporte de cobertura se genera en `coverage/` y está excluido de Git.

## Cobertura actual

| Área | Archivo |
| --- | --- |
| Mensajes de error y errores de red | `src/app/utils/errors.test.ts` |
| Notificaciones con título + motivo | `src/app/utils/notifications.test.ts` |
| Permisos por rol, tipo de negocio y ruta | `src/app/security/permissions.test.ts` |
| Formatos de fechas, dinero y jornadas | `src/app/utils/restaurantFormat.test.ts` |
| Almacenamiento local por negocio | `src/app/utils/restaurantStorage.test.ts` |
| Proyección de ingresos y ocupación | `src/app/utils/revenueForecast.test.ts` |
| Canastas, combos y ciencia de inventario | `src/app/utils/commercialScience.test.ts` |
| Riesgo de productos y reposición | `src/app/utils/productRisk.test.ts` |
| Componentes base `Button` y `Badge` | `src/app/components/ui/*.test.tsx` |
| Preferencia local del diseño editorial/clásico | `src/app/context/DesignModeContext.test.tsx` |

## Regresión encontrada

Al agregar las pruebas se detectó que `salesWindowStats` no incluía las ventas del día actual en la serie diaria: la ventana terminaba ayer. Eso afectaba la demanda promedio, el stock de seguridad, el EOQ y la clasificación XYZ. Se corrigió en `src/app/utils/commercialScience.ts` y se agregó una prueba de regresión.

## Próximos pasos recomendados

1. Probar `dataService.ts` con `fetch` simulado: errores HTTP, tokens y modo desktop.
2. Probar componentes con contexto: login, POS, mesero y panel de plataforma.
3. Agregar pruebas de integración para flujos críticos de ventas y pedidos.
4. Evaluar Playwright para flujos completos en navegador.
5. Usar la cobertura como guía, no como objetivo: priorizar rutas de dinero, permisos y datos.
