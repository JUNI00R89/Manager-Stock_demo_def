# Notas de la versión — MANAGER STOCK

## Fusión de proyectos (2026-10-17)

Esta carpeta (`MANAGER-STOCK-FUSION`) es el resultado de combinar los dos prototipos que vivían en `2 proyectos`:

- **`MANAGER-STOCK`** — aportó la base: React + TypeScript + Vite + Tailwind 4, backend FastAPI/SQLite, autenticación real con roles, panel SUPERADMIN, reportes CSV, kardex de inventario, temas personalizables por tipo de negocio y las 36 rutas protegidas.
- **`Managuer_Stock`** — aportó las mejoras de interfaz y usabilidad, integradas sobre la base anterior.

Qué se integró desde `Managuer_Stock`:

- Tipografía display **Bricolage Grotesque** (títulos) + **Instrument Sans** (cuerpo), con carga desde Google Fonts y respaldo a fuentes del sistema sin conexión.
- Script anti-flash de tema oscuro y meta `theme-color` en `index.html`.
- Utilidades CSS nuevas: `scrollbar-thin`, `pb-safe`, `num` (cifras tabulares) y `font-display`.
- Mejoras responsive/táctiles globales: objetivos de toque de 44 px, inputs a 16 px para evitar el zoom automático de iOS, `safe-area`, protección de desbordamiento horizontal y `prefers-reduced-motion` global.
- Escáner de código de barras mejorado: estados detallados de cámara (permiso denegado, cámara ocupada, sin cámara, página no segura), motor nativo `BarcodeDetector` con respaldo de ZXing cargado bajo demanda y teclado rápido; conserva la búsqueda sobre los productos reales del negocio (SKU/códigos) con catálogo demo como respaldo.
- Kanban de cocina animado (`motion`): tarjetas con entrada/salida y reordenamiento, cabeceras de columna con color e icono por etapa.
- Acceso directo **Domicilios** en el menú de negocios de comidas (lleva al módulo de pedidos).
- Paletas predefinidas en *Configuración → Apariencia*, incluida la **naranja** de `Managuer_Stock`, además de las cinco paletas por tipo de negocio.
- `Toaster` de notificaciones arriba a la derecha y `StrictMode` de React activo.

Qué se conservó de `MANAGER-STOCK` sin cambios: backend, autenticación/roles, módulo de servicios (prototipo actual), rutas, permisos y bloqueo intencional de la pantalla de recetas.

Los proyectos originales quedaron intactos en `C:\Users\frank\OneDrive\Escritorio\2 proyectos`.

## Implementado en esta entrega

- Autenticación real de backend, almacenamiento de hash de contraseña con sal y sesiones Bearer respaldadas por base de datos.
- Procedimiento local para crear SUPERADMIN; el registro público solo crea propietarios de negocio.
- Autorización de endpoints por rol y empresa, protecciones del panel global y estado activo de las cuentas/empresas.
- Panel SUPERADMIN con estadísticas globales básicas, consulta de empresas y usuarios, suspensión/reactivación y auditoría administrativa.
- CRUD de catálogo conectado a SQLite para los módulos de inventario/menú habilitados.
- Configuración de negocio guardada en base de datos y cambio de tipo sin borrar el catálogo ni las ventas.
- Control de módulos activos tanto en el backend como en el menú/rutas del frontend.
- Negocio de comidas sin módulo de recetas: productos individuales; la API no permite recetas o productos ingrediente para el flujo de comidas; no hay descuento automático de ingredientes.
- Ventas atómicas con varios productos, precios/costos históricos, impuestos calculados con la tasa persistida, pagos, clave idempotente, paginación e inventario.
- Anulaciones que conservan historia y registran movimientos inversos.
- Turno de caja asociado al usuario; ventas de cajero ligadas a su propia sesión.
- Protección para evitar fallback silencioso a `localStorage` mientras existe una sesión autenticada.
- Reportes/exportación CSV, bitácora de actividad y fondo animado CSS para el login con opción de movimiento reducido.
- Scripts de arranque, creación de SUPERADMIN, copias de seguridad y pruebas de integración.

## Mejoras de la entrega actual

- Corregida la referencia sin importar `Package` en el punto de venta y añadido un `AppErrorBoundary` para mostrar un estado de error recuperable.
- Paleta de inicio de sesión ajustada a azul petróleo y verde salvia; los temas predeterminados varían por tipo de negocio.
- Añadido panel de personalización de colores con selector claro/oscuro, previsualización, guardado, cancelación y restauración.
- Roles personalizados: las vistas, accesos rápidos, indicadores y acciones sensibles se filtran por permisos; las comprobaciones del backend siguen siendo obligatorias.
- La suspensión requiere un motivo, permite al propietario consultar el estado tras iniciar sesión y habilita el chat persistente con SUPERADMIN. La resolución reactiva el negocio.
- Centro de alertas calculado desde el catálogo y las ventas almacenadas, con estados leída/oculta guardados por usuario en el navegador.
- Corregido el asistente de configuración inicial para que las funciones internas de pasos no se remonten con cada letra.
- Eliminados los emojis decorativos del código de interfaz inspeccionado y reforzada la coherencia visual de la navegación.

## Pruebas que deben repetirse tras cambios

- `python backend/tests/test_sales_api.py`: pasa en el entorno de trabajo durante esta modificación. Cubre login, roles predefinidos y personalizados, aislamiento entre empresas, tema persistido y validado, suspensión y chat del propietario/SUPERADMIN, módulos, comida sin recetas, ventas atómicas, costos históricos, idempotencia, paginación, impuesto de servidor, anulaciones, caja y auditoría global.
- `python -m py_compile backend/main.py backend/tests/test_sales_api.py scripts/create_superadmin.py`: pasa.
- `npm install` y `npm run build`: pendientes; la instalación desde npm agotó el tiempo de espera en este entorno. Se hizo un parseo de sintaxis de 93 archivos TS/TSX sin errores, pero eso no equivale a una compilación completa. Repite el build en el equipo Windows antes de dar por cerrada la versión.

## Límites conocidos

- La solución está destinada a pruebas locales. Para producción en Internet se requiere hardening de seguridad, HTTPS, migración a PostgreSQL, copias externas y pruebas de concurrencia y recuperación.
- El panel SUPERADMIN incluye las operaciones globales básicas descritas; no hay todavía suscripciones cobradas, integración de pagos, gestión de planes efectiva ni editor visual completo de todas las opciones de la plataforma.
- Habitaciones, reservas de hotel, catálogo de servicios, profesionales y citas tienen persistencia SQLite y endpoints limitados por empresa; housekeeping, traslados de almacén y algunas vistas especializadas aún requieren integración y pruebas visuales adicionales antes de producción.
- Los pedidos no descuentan inventario hasta que se registra la venta cobrada; la disponibilidad debe revalidarse al cobrar.
- Las recetas/tablas relacionadas siguen en el esquema por compatibilidad, pero no participan en el flujo del negocio de comidas.
- No se deben mezclar automáticamente datos locales offline con registros de SQLite; la recuperación necesita una migración controlada.

## Actualización de interfaz: diálogos centrados

- Se reemplazaron los diálogos nativos del navegador por modales centrados reutilizables en suspensión/reactivación de negocios, estado de usuarios, reconfiguración del negocio, retiro de productos/proveedores, anulación de ventas y eliminación de recetas.
- El formulario de suspensión del SUPERADMIN ahora solicita en la misma ventana el motivo obligatorio y la descripción opcional; cancelar no ejecuta la suspensión.
- Se añadió `src/app/components/ConfirmActionDialog.tsx` como patrón común de confirmación con estado de carga y persistencia del contexto si una operación falla.
- Las notificaciones de éxito y error se colocaron en la esquina inferior derecha para no superponerse al encabezado.
- Se añadió `docs/VENTANAS_Y_CONFIRMACIONES.md` con el criterio y la lista de operaciones migradas.
- Verificación estática: se revisaron 94 archivos TS/TSX sin errores sintácticos y no quedan llamadas ejecutables a `window.confirm`, `window.prompt` o `window.alert` en `src`.
- El build de Vite no se ejecutó en este entorno porque la instalación de dependencias npm agotó el tiempo disponible. Debe comprobarse localmente con `npm install` y `npm run build`.

## Correcciones funcionales de esta actualización

- Categorías sugeridas por tipo de negocio y categorías personalizadas persistentes con validación de nombres duplicados por empresa.
- Campos de stock que usan incrementos de una unidad para unidades discretas; el backend rechaza fracciones no válidas.
- Datos de hotel y servicios integrados con SQLite: habitaciones, reservas, catálogo de servicios, profesionales y citas se consultan y modifican a través de endpoints tenant-scoped.
- Se valida que no haya reservas de hotel solapadas ni citas simultáneas para el mismo profesional. Tras el check-out, la habitación conserva el estado reservado si existe otra reserva futura.
- Script idempotente para negocios y usuarios demo con datos ficticios y separación por tenant. Se probó en una base SQLite temporal sin borrar datos preexistentes.
- Documentación actualizada de transiciones de tipo de negocio con vencimiento a 24 horas y casos de prueba manuales.
- Verificación de backend: `python backend/tests/test_sales_api.py` pasó. `python -m py_compile` pasó. El parser de TypeScript inspeccionó 95 archivos TS/TSX sin errores de sintaxis. El build de Vite no se ha vuelto a ejecutar en este entorno porque no se pudo instalar `node_modules`; es necesario verificarlo localmente.


## Corrección del inicializador de datos de prueba

- `CREAR_DATOS_DE_PRUEBA.bat` ya no ejecuta `py -3 scripts\seed_demo_data.py` con el Python global. Llama a `PREPARAR_BACKEND.bat` y usa `.venv\Scripts\python.exe`, que es el entorno del proyecto.
- Se comprueban las importaciones de FastAPI, Uvicorn y HTTPX antes del seed; si faltan, se instalan desde `backend/requirements.txt`.
- `INICIAR_MANAGER_STOCK.bat` comprueba las dependencias importando los paquetes, en lugar de confiar solamente en un archivo marcador que podría haber quedado obsoleto.
- `CREAR_SUPERADMIN.bat` también prepara y reutiliza el mismo entorno virtual. Los scripts limpian variables `PYTHONHOME` y `PYTHONPATH` heredadas para evitar que desvíen la instalación de Python.
- La sintaxis Python y la batería `python backend/tests/test_sales_api.py` pasan en el entorno de trabajo. Los scripts `.bat` de Windows deben confirmarse ejecutándolos en Windows.
- Se añadió `docs/SOLUCIONAR_PYTHON_Y_DATOS_DE_PRUEBA.md` con diagnóstico adicional si Python continúa mostrando el aviso `<prefix>`.

## 2026-10-16 — Servicios, suscripciones y distribución

- Se separó la creación de citas en `/services` de la agenda `/services/appointments`.
- Se añadió edición y eliminación de citas con autorización backend y auditoría.
- El plazo de conservación de módulos ahora es de 15 días.
- Se añadió creación global de usuarios desde SUPERADMIN.
- Se añadieron planes y límites de suscripción centralizados, con solicitudes de pago pendientes y confirmación manual documentada.
- Se añadió carrusel en la web pública y página de disponibilidad de descargas.
- La validación del backend pasó; la compilación completa del frontend queda pendiente por falta de instalación de dependencias en el entorno de trabajo.
