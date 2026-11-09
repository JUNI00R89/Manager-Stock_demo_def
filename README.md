# MANAGER STOCK

Aplicación web para administrar productos, ventas, existencias, proveedores, caja y pedidos de distintos tipos de negocios. Conserva la interfaz React/TypeScript basada en el diseño de Figma y conecta los flujos principales a una API FastAPI con SQLite.

> **Fusión:** esta carpeta (`MANAGER-STOCK-FUSION`) combina los prototipos `MANAGER-STOCK` (base con backend) y `Managuer_Stock` (mejoras de interfaz: tipografía display, escáner de cámara mejorado, kanban de cocina animado, mejoras táctiles y paleta naranja opcional). Detalle completo en [`VERSION_NOTES.md`](VERSION_NOTES.md).

> **Estado:** versión de desarrollo/pruebas locales. Las funciones centrales de autenticación, permisos, catálogo, ventas, caja, pedidos de comidas y administración global tienen implementación en el backend y pruebas. No debe publicarse directamente en Internet ni considerarse todavía un servicio comercial multiusuario listo para producción.

## Funcionalidades principales

- Registro e inicio de sesión reales contra el backend. Las contraseñas se almacenan mediante PBKDF2-HMAC-SHA256 con sal individual; la API emite sesiones tipo Bearer almacenando el hash del token.
- Roles `SUPERADMIN`, `owner` (propietario), `business_admin` (administrador del negocio) y `cashier` (cajero). El rol SUPERADMIN se crea mediante un comando local controlado, no desde el registro público.
- Separación de datos por empresa en los endpoints principales y comprobación de permisos en la API, además del control de rutas y menús en React.
- Administración global de negocios, creación y activación de usuarios, estadísticas básicas, solicitudes de suscripción y bitácora administrativa para SUPERADMIN.
- Catálogo de productos con alta/edición, categoría, precio, costo, existencia, mínimo de inventario y movimientos.
- Ventas con múltiples líneas, métodos de pago, descuentos, impuesto definido en la configuración del negocio, instantáneas históricas de precio/costo, clave idempotente y paginación.
- Anulación de venta con trazabilidad y movimientos inversos, sin borrar el registro original.
- Caja por turno; las ventas de cajero deben pertenecer a su sesión de caja abierta.
- Negocio de comidas con productos preparados individuales, pedidos y estados de preparación. No requiere recetas ni consume ingredientes automáticamente.
- Página pública de presentación en `/` con carrusel interactivo, tipos de negocio y planes cargados desde el backend; el centro `/descargas` muestra la disponibilidad real por plataforma sin enlazar instaladores inexistentes.
- Categorías de productos sugeridas por tipo de negocio y categorías personalizadas persistidas por empresa. Unidades discretas validan cantidades enteras en frontend y backend.
- Configuración persistente del tipo de negocio. Los datos específicos de hotel/servicios/bodega se mantienen durante 15 días en una transición persistida, con aviso, opción de restauración y limpieza backend programada; productos, ventas, usuarios y otros datos compartidos se conservan.
- Reportes con CSV, dashboard y bitácora de actividad para los eventos instrumentados.
- Fondo animado CSS en la pantalla de inicio de sesión, con respeto por `prefers-reduced-motion` y paleta azul petróleo/verde salvia.
- Temas predeterminados por tipo de negocio; panel del propietario para personalizar colores, previsualizar, guardar, cancelar y restaurar el tema.
- Roles personalizados por negocio con permisos delegables; el backend restringe endpoints y la interfaz adapta menús, accesos rápidos y estadísticas. Los permisos incluyen acceso de consulta y gestión para servicios/citas.
- Suspensión administrativa con motivo obligatorio, pantalla especial para el propietario y chat persistente de soporte entre propietario y SUPERADMIN.
- Servicios: el catálogo, los profesionales y la creación de citas están en `/services`; `/services/appointments` se utiliza para agenda, edición, estados y eliminación de citas existentes.
- Suscripciones: planes Gratis, Emprendedor, Negocio y Empresarial con límites de productos/usuarios validados en el backend. La selección de un plan pago queda pendiente hasta que un administrador registre una verificación manual de pago. No hay cobro automático ni proveedor integrado.
- ErrorBoundary de React para ofrecer una recuperación controlada ante errores de interfaz; corregida la referencia del icono `Package` en el punto de venta.
- Centro de alertas calculado desde productos y ventas guardados, sin listas de alertas de demostración.
- Inicio automatizado para Windows mediante `INICIAR_MANAGER_STOCK.bat`, creación controlada de SUPERADMIN mediante `CREAR_SUPERADMIN.bat` y carga opcional de datos ficticios desde `CREAR_DATOS_DE_PRUEBA.bat`.

## Disponibilidad multiplataforma

La web es responsive, pero todavía no se han generado ni firmado instaladores de escritorio o móviles. La página `/descargas` indica el estado de Windows, Android, iOS y Linux. No debe interpretarse como que ya existen aplicaciones nativas publicadas.

## Tecnologías

- Frontend: React, TypeScript, Vite, Tailwind CSS y React Router.
- Backend: FastAPI, Pydantic y SQLite.
- Pruebas de integración API: `fastapi.testclient.TestClient` sobre una base SQLite temporal.

## Requisitos

- Node.js LTS y npm.
- Python 3.11 o posterior, con el lanzador `py` de Windows.
- Visual Studio Code (recomendado).
- Conexión a Internet durante la primera instalación, para descargar las dependencias.

## Ejecutar en Windows

1. Descomprime el proyecto y abre la carpeta `MANAGER-STOCK` en Visual Studio Code.
2. Haz doble clic en `INICIAR_MANAGER_STOCK.bat`, o ejecútalo desde el Explorador de Windows.
3. Permite que cree `.venv` e instale dependencias la primera vez.
4. Espera a que se abran las dos terminales y revisa que no haya errores.
5. Abre la interfaz y la documentación de la API:

   - Aplicación: <http://127.0.0.1:5173/>
   - Salud de API: <http://127.0.0.1:8000/api/health>
   - Documentación interactiva: <http://127.0.0.1:8000/docs>

### Inicio manual desde dos terminales

**Terminal 1 — backend**

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 — frontend**

```powershell
npm install
npm run dev
```

## Cargar negocios de prueba

Para crear cinco negocios demo con propietarios, empleados, productos, proveedores, ventas y registros operativos de hotel/servicios, detén la API y ejecuta `CREAR_DATOS_DE_PRUEBA.bat`. El inicializador utiliza `.venv\Scripts\python.exe` y llama a `PREPARAR_BACKEND.bat` para comprobar e instalar las dependencias del backend antes de ejecutar el seed. Evita ejecutar el script con un Python global que no tenga FastAPI instalado. También puedes ejecutar `.venv\Scripts\python.exe scripts\seed_demo_data.py --allow-demo-data` después de preparar el backend. El script es idempotente, no elimina registros preexistentes y está bloqueado en producción. Las credenciales iniciales y el alcance del seed están en [`docs/USUARIOS_DE_PRUEBA.md`](docs/USUARIOS_DE_PRUEBA.md). Úsalo solo en una base de desarrollo; no ejecutes el seed sobre una base con datos comerciales reales sin una copia y evaluación previa.

## Crear el primer SUPERADMIN

1. Ejecuta `INICIAR_MANAGER_STOCK.bat` al menos una vez para configurar las dependencias.
2. Detén la API si está abierta (opcional para el comando local, pero recomendable para mantener una sola instancia inicializando la base).
3. Ejecuta `CREAR_SUPERADMIN.bat` y completa los datos en la terminal. La contraseña se solicita de forma oculta y nunca debe compartirse.
4. Inicia de nuevo la API si la detuviste y entra por `http://127.0.0.1:5173/`.

También puedes usar la terminal de VS Code:

```powershell
.\.venv\Scripts\python.exe scripts\create_superadmin.py
```

El comando se ejecuta localmente y crea una cuenta privilegiada en la base SQLite activa. Protege el equipo y el archivo de base de datos: alguien con acceso al entorno local puede intentar ejecutar herramientas administrativas. No incluyas contraseñas en archivos del proyecto ni en Git.

## Base de datos y datos de ventas

SQLite se crea automáticamente en `backend/data/manager_stock.db`. El esquema está en [`database/schema.sql`](database/schema.sql) y el diseño se describe en [`docs/BASE_DE_DATOS.md`](docs/BASE_DE_DATOS.md).

La API guarda una venta, sus artículos, pagos, movimientos de inventario y auditoría dentro de una transacción. El servidor calcula los importes a partir de los precios almacenados y usa la tasa de impuesto persistida en la configuración; no confía en el `taxRate` que envía el navegador. La clave idempotente por negocio permite reconocer una operación reintentada. El detalle guarda una instantánea del nombre, SKU, precio y costo del producto al vender.

El historial utiliza páginas de hasta 500 registros y la interfaz solicita más páginas hasta llegar al final. Si existían ventas de un modo local anterior, se conservan en el navegador como respaldo `manager_stock_offline_backup_v1`; no se importan automáticamente porque sus efectos sobre inventario podrían duplicarse. **Cuando hay una sesión autenticada, una caída de API no debe cambiar silenciosamente las operaciones a `localStorage`.** Espera a recuperar la conexión antes de continuar operaciones transaccionales.

La moneda admitida por esta versión es COP. El valor de impuesto es configurable por negocio, pero su configuración tributaria no sustituye una validación contable/fiscal profesional.

## Copias de seguridad

Conserva una copia de `backend/data/manager_stock.db` antes de actualizaciones o migraciones. Puedes usar:

```powershell
.\.venv\Scripts\python.exe scripts\backup_database.py
```

Las copias se escriben por defecto en `backend/data/backups/` (o junto a la ruta configurada de la base). La API verifica una copia diaria mientras está encendida y guarda otra antes de aplicar migraciones nuevas. Configura `MANAGER_STOCK_BACKUP_DIR` para cambiar el destino. `python scripts/restore_database.py COPIA.db NUEVA_RUTA.db` restaura y verifica sin sobrescribir archivos existentes. Ver [operación y facturación en Colombia](docs/facturacion-colombia.md).

## Pruebas

Desde la raíz del proyecto:

```powershell
.\.venv\Scripts\python.exe -m py_compile backend\main.py backend\tests\test_sales_api.py scripts\create_superadmin.py
.\.venv\Scripts\python.exe backend\tests\test_sales_api.py
npm run build
```

La prueba de API utiliza una base SQLite temporal; no modifica la base de datos del negocio. Abarca autenticación, roles predefinidos y personalizados, aislamiento entre negocios, categorías dinámicas, validación de unidades enteras, transición y limpieza a 15 días, hotel y citas persistidas por negocio, configuración/temas, suspensión y chat, reactivación, menú sin recetas, impuestos calculados en servidor, ventas con varios productos, costos históricos, idempotencia, paginación, reversos, caja y auditoría. En esta entrega se validó además la sintaxis de 97 archivos TypeScript/TSX mediante el parser de TypeScript.

**Limitación de validación:** no se pudo completar `npm install` ni `npm run build` en el entorno de generación porque la solicitud al registro de paquetes agotó el tiempo de espera. Debes ejecutar `npm install` y `npm run build` en tu PC antes de desplegar. La comprobación sintáctica no sustituye un build completo ni una prueba visual en navegador.

## Personalización, roles y soporte administrativo

- Los temas por tipo de negocio y los colores personalizados se guardan en la configuración de la empresa. La personalización no cambia los datos comerciales.
- El propietario puede crear roles con permisos delegables, pero no puede crear un SUPERADMIN ni asignar permisos globales. La API verifica los permisos y no confía solamente en las restricciones visuales.
- Al suspender un negocio se requiere un motivo y se genera un caso de soporte. El propietario conserva acceso a la pantalla de suspensión y al chat, mientras las operaciones comerciales quedan bloqueadas por el backend. La resolución de un caso por SUPERADMIN reactiva el negocio.
- El chat consulta mensajes periódicamente; no usa WebSockets en esta versión.
- `AppErrorBoundary` presenta una recuperación amigable ante errores renderizados en React. Los errores de red o del backend requieren además corregir la causa que los genera.

## Limitaciones actuales

- SQLite y `127.0.0.1` están pensados para desarrollo local. Antes de operar por Internet con concurrencia de varios usuarios, migra a PostgreSQL, usa HTTPS, configura gestión de secretos, retención de sesiones, rate limiting, monitoreo y copias automatizadas.
- El panel SUPERADMIN tiene estadísticas globales básicas, gestión de activación/suspensión de negocios y usuarios, gestión de solicitudes de suscripción y auditoría. La facturación automática SaaS y los webhooks de pago todavía no están integrados.
- El cambio de tipo conserva los registros comunes y agenda la limpieza de datos específicos de hotel, servicios o bodega tras el periodo de transición. Habitaciones, reservas, catálogo de servicios, profesionales y citas tienen endpoints tenant-scoped; aún se deben probar visualmente todos los flujos en el navegador y completar cualquier pantalla especializada que siga usando datos de demostración.
- Los pedidos se registran como comandas pendientes; no descuentan existencias hasta que se registra la venta cobrada. Si se trabajan muchas comandas simultáneas, la disponibilidad debe revisarse al cobrar.
- Los reportes de rentabilidad son estimaciones derivadas del costo unitario guardado en cada venta, no contabilidad formal. Los datos históricos previos a la instantánea de costo pueden no tener un costo real reconstruible.
- Las recetas y sus tablas antiguas se conservan únicamente por compatibilidad de esquema/migraciones. En negocio de comidas, la API devuelve 404 para recetas, el menú no muestra el módulo y las ventas no descuentan ingredientes.
- Los datos que hayan existido solo en modo local no se mezclan automáticamente con la base SQLite.

## Estructura principal

```text
MANAGER-STOCK/
├── backend/               # FastAPI, autenticación, API y pruebas
├── database/schema.sql    # Esquema relacional SQLite
├── docs/                  # Arquitectura, base de datos y pruebas manuales
├── scripts/               # Inicialización SUPERADMIN y backup
├── src/                   # React/TypeScript y componentes visuales
├── INICIAR_MANAGER_STOCK.bat
└── CREAR_SUPERADMIN.bat
```

## Diálogos y confirmaciones de interfaz

Las preguntas y confirmaciones administrativas usan modales centrados, no cuadros nativos del navegador. La ventana para suspender negocios solicita un motivo obligatorio y una descripción opcional; las acciones críticas en productos, proveedores, ventas, usuarios y configuración también usan el componente compartido `ConfirmActionDialog`. Las notificaciones no bloqueantes aparecen en la esquina inferior derecha. Consulta `docs/VENTANAS_Y_CONFIRMACIONES.md` para el detalle.


## Pedidos compartidos y limpieza persistente

En el modo habitual (FastAPI) y en la demostración de escritorio, Mesas, Mesero,
Cocina y Pedidos utilizan el mismo servicio de comandas. Las vistas de cocina y
mesero consultan actualizaciones cada dos segundos. Los artículos de venta directa
se guardan con la comanda y no aparecen entre los productos para preparar.
Los pedidos antiguos del repositorio local siguen disponibles en el navegador
original; no se importan automáticamente al servidor. La opción explícita
`VITE_RESTAURANT_BACKEND=firebase` conserva su integración experimental separada.

El tablero de limpieza utiliza las habitaciones del negocio y guarda el estado y
el nombre del responsable. El checkout de una estancia iniciada marca la habitación
como sucia; una reserva posterior se conserva. La API exige `hotel.manage` para
actualizar la limpieza y comprueba que el estado no cambió desde la última lectura.

Pruebas de regresión adicionales (bases temporales):

```sh
python backend/tests/test_checkout_regressions.py
python backend/tests/test_restaurant_hotel_regressions.py
```

## Consumos en la cuenta de una habitación

En **Hotel → Habitaciones → Cuenta y consumos**, selecciona la estancia activa,
el producto y la cantidad para cargarlo a la cuenta. El cargo guarda el nombre y
precio del producto de ese momento, descuenta inventario y se suma al alojamiento.
El resumen muestra alojamiento, consumos, anticipo y saldo pendiente; registrar un
consumo no registra un pago ni una venta de caja.

Los consumos pertenecen a la reserva, por lo que no se trasladan al siguiente
huésped de la habitación. Durante una estancia con check-in se pueden anular cargos;
la anulación conserva el historial y devuelve las existencias. Después del checkout
la cuenta se consulta desde el selector de estancias y mantiene sus importes.
Los reintentos de una misma carga no duplican el consumo. La funcionalidad está
implementada tanto para FastAPI/SQLite como para la demostración local de escritorio.

```sh
python backend/tests/test_hotel_charges.py
```

## Abonos, caja y cierre del hotel

Desde **Cuenta y consumos → Pagos y cierre de cuenta**:

1. Abre tu turno con la base de efectivo o utiliza tu turno abierto.
2. Registra el importe recibido, el medio de pago y una referencia opcional.
   Puedes registrar varios abonos en efectivo, tarjeta, transferencia o pago digital.
3. Cuando el saldo llegue a cero, elige **Cerrar cuenta y registrar salida**.
   Se conserva un comprobante interno descargable en HTML, imprimible desde el navegador.
4. Cierra el turno indicando el efectivo contado. El efectivo esperado incluye la base,
   las ventas en efectivo y los abonos del hotel en efectivo de ese turno.

Los medios distintos de efectivo quedan en el historial de pagos; su confirmación
se realiza fuera de la aplicación. El anticipo previo de la reserva reduce el saldo
pero no vuelve a entrar en el turno actual. Los cobros del hotel se guardan en su
propio registro y no generan una segunda venta POS ni una factura fiscal.
El comprobante conserva los importes y datos del cierre. Una cuenta cerrada no admite
nuevos cargos, pagos ni reapertura. Los reintentos conservan su identificador para
no duplicar cobros si se pierde una respuesta de red.

Cobrar y cerrar requiere `hotel.manage` y `cash.manage`; abrir caja funciona también
cuando el hotel tiene POS desactivado. Cada pago requiere un turno propio abierto.
No se permiten sobrepagos ni anulaciones de consumos que dejen saldo a favor.
Las devoluciones parciales o totales de abonos registrados se gestionan desde la misma cuenta, con motivo obligatorio y comprobante propio.

## Pantallas y acciones según el negocio y el empleado

La navegación y las rutas comprueban el tipo de negocio, los módulos activos y
los permisos del empleado. Los roles personalizados con `hotel.view` pueden
consultar habitaciones, cuentas, disponibilidad y limpieza. Las acciones de gestión
requieren sus permisos correspondientes; la creación de habitaciones sigue reservada
al propietario. En servicios y cocina, los empleados de consulta ven los datos
sin controles de edición. Cobrar pedidos requiere permiso de ventas.

Desactivar **Pedidos** oculta y bloquea las pantallas operativas de restaurante;
desactivar **Menú** oculta su catálogo. La API mantiene sus propias comprobaciones.

Validación adicional:

```sh
python backend/tests/test_hotel_payments.py
node scripts/test_permissions.cjs
npx tsc --noEmit
npm run build
```


## Calendario con mouse, pantalla táctil y teclado

En **Hotel → Disponibilidad**, arrastra el asa de una reserva azul a otra fecha o
habitación. En móvil, el asa permite mover la reserva y el resto del calendario
permite desplazarse. También puedes enfocar el asa y usar espacio, flechas y Enter;
Escape cancela. El destino se muestra antes de confirmar el movimiento.

Solo se mueven reservas confirmadas, antes del check-in. Se conservan la duración,
el importe acordado, los abonos y la identidad de la reserva, incluso si se cambia
a una habitación con otra tarifa. El servidor comprueba disponibilidad, permisos,
negocio y cambios concurrentes. Un conflicto vuelve a cargar el calendario sin
sobrescribir la reserva de otro usuario. El calendario tiene desplazamiento interno
y los formularios y reportes se adaptan al ancho de la pantalla.

## Devoluciones y reporte de ingresos del hotel

En **Cuenta y consumos → Devoluciones de pagos**, abre tu turno, elige el pago,
indica el importe y el motivo, y confirma después de realizar la devolución al
huésped. Se conserva el medio de pago original. No se envía dinero automáticamente.
La suma de devoluciones no puede superar el pago. Las devoluciones en efectivo
reducen el efectivo esperado del turno actual, aunque el pago pertenezca a un turno
anterior; el turno debe tener efectivo suficiente. Los reintentos no duplican
registros y el historial conserva el pago original y cada devolución.

En una cuenta abierta, devolver un pago aumenta el saldo pendiente. En una cuenta
cerrada, una devolución posterior queda registrada por separado y no reabre la
estancia ni modifica el comprobante original. Cada devolución tiene un comprobante
interno descargable. Los anticipos antiguos que no tienen un registro de pago no
se pueden devolver desde este flujo.

**Hotel → Ingresos del hotel** muestra cobros, devoluciones e ingreso neto, con
desglose por medio de pago, fechas y exportación CSV. El periodo usa la fecha del
movimiento en **America/Bogota**, admite hasta 366 días e incluye devoluciones de
pagos anteriores realizadas durante ese periodo. No suma bases de caja, valores
pendientes de reservas ni anticipos anteriores sin fecha de cobro. Para consultar
el reporte, un rol personalizado necesita `hotel.view` y `reports.view`.

```sh
python backend/tests/test_hotel_schedule_refunds.py
node scripts/test_permissions.cjs
```

Las pruebas opcionales de navegador requieren Python con Playwright, Chromium en
`/usr/bin/chromium`, Vite en `127.0.0.1:5173` y la API en `127.0.0.1:8000`. Ejecuta
la API con una base **temporal de pruebas** (`MANAGER_STOCK_DB=/tmp/hotel-ui-test.db`):
las pruebas crean negocios y reservas de demostración.

```sh
python backend/tests/test_hotel_browser.py
python backend/tests/test_hotel_local_browser.py
```

## Clientes, operación y preparación fiscal

Clientes compartidos por negocio, carritos guardados/favoritos, devoluciones parciales, cobros de mesas con varios medios, cobro de citas con productos, jornadas y agenda arrastrable, resumen diario del hotel y conteos con aprobación. La preparación fiscal conserva borradores internos; no emite ni simula facturas DIAN. Consulta alcance, limitaciones del modo local, investigación de proveedores y pendientes en [facturación Colombia](docs/facturacion-colombia.md).
