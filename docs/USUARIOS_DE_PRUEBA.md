# Usuarios y negocios de prueba de MANAGER STOCK

Estas cuentas son datos ficticios para desarrollo local. El script nunca se ejecuta automáticamente y está bloqueado cuando `APP_ENV` o `MANAGER_STOCK_ENV` indican producción.

Ejecuta `python scripts/seed_demo_data.py --allow-demo-data` para crear de forma idempotente los usuarios, negocios, productos, proveedores y una venta de ejemplo en la base SQLite configurada. No se eliminan datos preexistentes.

Para completar únicamente los datos del hotel en una base existente, ejecuta `python scripts/seed_hotel_demo_data.py --allow-demo-data`. También es idempotente y no modifica los demás negocios.

## Credenciales iniciales

| Tipo | Rol | Correo | Contraseña inicial |
|---|---|---|---|
| Plataforma | SUPERADMIN | `superadmin@managerstock.test` | `SuperAdminDemo2026!` |
| Tienda Aurora (Demo) | PROPIETARIO | `owner.retail@managerstock.test` | `TiendaDemo2026!` |
| Tienda Aurora (Demo) | EMPLEADO (cajero de prueba) | `empleado.retail@managerstock.test` | `EmpleadoTienda2026!` |
| Sabores del Parque (Demo) | PROPIETARIO | `owner.comidas@managerstock.test` | `ComidasDemo2026!` |
| Sabores del Parque (Demo) | EMPLEADO (cajero de prueba) | `empleado.comidas@managerstock.test` | `EmpleadoComidas2026!` |
| Hotel Senderos (Demo) | PROPIETARIO | `owner.hotel@managerstock.test` | `HotelDemo2026!` |
| Hotel Senderos (Demo) | EMPLEADO (cajero de prueba) | `empleado.hotel@managerstock.test` | `EmpleadoHotel2026!` |
| Logística Norte (Demo) | PROPIETARIO | `owner.bodega@managerstock.test` | `BodegaDemo2026!` |
| Logística Norte (Demo) | EMPLEADO (cajero de prueba) | `empleado.bodega@managerstock.test` | `EmpleadoBodega2026!` |
| Estudio Nube (Demo) | PROPIETARIO | `owner.servicios@managerstock.test` | `ServiciosDemo2026!` |
| Estudio Nube (Demo) | EMPLEADO (cajero de prueba) | `empleado.servicios@managerstock.test` | `EmpleadoServicios2026!` |

Si una cuenta ya existía, el seed conserva su contraseña actual; en ese caso, la contraseña de la tabla solo corresponde a la creación inicial. Cambia todas las contraseñas si los datos salen del entorno local.

## Datos de hotel incluidos

El negocio `Hotel Senderos (Demo)` incluye 8 habitaciones en 3 pisos (disponible, ocupada, reservada, limpieza y mantenimiento), 7 reservas entre pasadas, activas y futuras, productos de minibar y restaurante, consumos activos y anulados, pagos en efectivo y tarjeta, una devolución y una cuenta cerrada con comprobante descargable. El seed conserva la reserva histórica `DEMO-HOTEL-RES-001` y agrega el resto de forma idempotente.

## Alcance de los datos

El seed crea negocios y registros ficticios por tenant: productos, proveedores, ventas, líneas de venta, movimientos de inventario y, en los tipos hotel y servicios, habitaciones, reservas, consumos, cobros, devoluciones, cierres de cuenta, servicios, profesionales y citas en SQLite. Los módulos que no dispongan de persistencia backend en esta versión no deben considerarse operativos para producción. No se cargan datos reales.
