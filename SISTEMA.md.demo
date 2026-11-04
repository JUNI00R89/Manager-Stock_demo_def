# MANAGER STOCK — arquitectura y estado funcional

## Propósito

Manager Stock es una aplicación de inventario, ventas y gestión operativa para distintos tipos de negocio. Conserva la interfaz de React/TypeScript creada a partir de Figma y utiliza una API FastAPI con SQLite en el entorno local.

## Componentes

- **Frontend:** React, TypeScript, Vite, Tailwind CSS y componentes visuales reutilizables.
- **Backend:** FastAPI y Pydantic. La API obtiene la identidad de sesión desde un token Bearer cuyo hash se almacena en SQLite.
- **Persistencia:** SQLite con claves foráneas, índices, configuración JSON por negocio, movimientos y operaciones transaccionales.
- **Roles:** SUPERADMIN global, propietario, administrador de negocio, cajero y roles personalizados por empresa con permisos operativos delegables.
- **Experiencia visual:** paletas por tipo de negocio, personalización de colores del propietario, iconografía Lucide sin emojis decorativos y manejo de errores por ruta.
- **Soporte:** casos de suspensión con motivo, pantalla de acceso limitado y chat persistente entre propietario y SUPERADMIN.
- **Diseño de datos:** el negocio se selecciona por la identidad validada en backend; los endpoints principales no confían en un `businessId` aportado por el navegador.

## Flujos conectados para probar

1. Registro, login, cierre de sesión y cuentas con estado activo/inactivo.
2. Configuración del negocio y cambio de tipo persistido.
3. Catálogo de productos, precios, costos, stock, SKU y movimientos.
4. Ventas con varias líneas, descuentos, tasa de impuesto del negocio, pagos y clave idempotente.
5. Historial paginado, detalle con costos históricos y anulaciones auditables.
6. Caja: turnos, usuario que abre, ventas ligadas a turno y cierre.
7. Pedidos para el negocio de comidas cuando está activado el módulo de pedidos.
8. Estadísticas y operaciones administrativas globales para SUPERADMIN.
9. Administración de usuarios de negocio y activación/desactivación de cuentas.
10. Reportes CSV y eventos de actividad instrumentados.
11. Creación de roles y usuarios de empresa; la API deriva permisos efectivos y requisitos previos de las operaciones autorizadas.
12. Personalización de apariencia y persistencia de temas por negocio.
13. Suspensión reversible con chat de soporte persistente.

## Negocio de comidas

El tipo `restaurant` en la interfaz se almacena como `food` en la columna de tipo de negocio. Los módulos (menú, pedidos, caja, inventario, mesas y domicilios) son configurables. Un plato se vende como producto individual: el costo unitario es opcional, la existencia se valida cuando se controla inventario y no se requiere una receta. Las tablas históricas `recipes` y `recipe_items` se conservan únicamente por compatibilidad de esquema, y el endpoint de recetas devuelve 404 en negocios de comidas.

Las comandas representan pedidos sin cobrar. En la implementación actual no descuentan existencias hasta que se registra la venta; al cobrar se debe volver a validar el inventario disponible.

## Acceso, temas y soporte

- Las restricciones de roles se aplican en las rutas frontend y en middleware/endpoints del backend. Los roles personalizados nunca pueden recibir `platform.admin`; las dependencias funcionales como lectura de catálogo/caja se añaden al autorizar acciones de venta.
- Los temas predeterminados dependen del tipo de negocio. El propietario puede guardar una paleta y modo claro/oscuro en la configuración de su empresa; el cambio de color no modifica datos comerciales.
- Al suspender una empresa, el propietario puede consultar el motivo y enviar mensajes a través de un caso vinculado. El backend bloquea las operaciones comerciales y permite únicamente los endpoints de suspensión, autenticación y soporte necesarios.
- El panel global de SUPERADMIN muestra los casos, mensajes sin leer y controles para cambiar el estado del caso o reactivar el negocio.
- Las rutas cuentan con un `errorElement` personalizado y un `AppErrorBoundary` como protección adicional.

## Consistencia y trazabilidad

- `sales` almacena el encabezado; `sale_items` las instantáneas de los productos; `sale_payments` los medios de pago; `inventory_movements` los efectos sobre existencias.
- La venta usa una transacción `BEGIN IMMEDIATE` y clave idempotente única por negocio.
- El impuesto y la moneda se obtienen de la configuración persistida del negocio.
- La anulación conserva la fila original y escribe movimientos inversos.
- Un cajero ve las ventas propias y registra contra su turno abierto.
- La app no debe caer silenciosamente a `localStorage` durante una sesión autenticada.

## Límites

Este es un entorno local de desarrollo/prueba, no una instalación comercial lista para desplegar. La administración global incluye métricas básicas, consulta de empresas/usuarios, suspensión/reactivación y auditoría; no implementa todavía pagos o suscripciones SaaS. Algunos módulos de hotel, servicios, bodegas y sucursales conservan funciones de prototipo. Antes de habilitar usuarios remotos, hace falta revisión de seguridad, HTTPS, despliegue endurecido, monitorización, recuperación validada y migración a una base de datos de servidor como PostgreSQL.

Consulta [`README.md`](README.md), [`docs/BASE_DE_DATOS.md`](docs/BASE_DE_DATOS.md) y [`docs/PRUEBAS_MANUALES.md`](docs/PRUEBAS_MANUALES.md) para la ejecución, el esquema y las pruebas.
