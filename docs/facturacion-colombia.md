# Facturación electrónica en Colombia y evolución de Manager Stock

Investigación: 8 de noviembre de 2026. Revisión de implementación: 9 de noviembre de 2026, hora de Colombia. País confirmado por el propietario: Colombia. No hay proveedor contratado. Las fuentes son documentación oficial y páginas de sus propios proveedores; no se han contratado planes ni emitido documentos fiscales.

## Decisión recomendada

Hacer un piloto técnico con **Factus**, conservando una interfaz de integración independiente del proveedor. La recomendación se basa en su API enfocada en documentos electrónicos y en la documentación de facturas, notas crédito y escenarios de anticipos; **no** es una conclusión sobre el proveedor más barato ni sobre su disponibilidad real. Su sitio remite a un asesor para conocer los planes: hay que obtener una cotización por número de emisores y documentos. [Factus](https://www.factus.com.co/) · [Documentación de API](https://developers.factus.com.co/).

Si la prioridad es que el contador trabaje en un sistema contable conectado, comparar también Siigo y Alegra antes de elegir. La elección debe incluir la razón social contratante y la del proveedor tecnológico que transmite los documentos. La marca comercial de una API por sí sola no sustituye la consulta del [catálogo oficial de proveedores tecnológicos de la DIAN](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/proveedores-tecnologicos/).

| Alternativa | Evidencia publicada | Encaje en este proyecto | Pendiente de confirmar comercialmente |
|---|---|---|---|
| Factus | API de facturas, notas crédito/débito, documentos soporte y otros documentos; documentación con ambiente sandbox. | Primera candidata para conservar Manager Stock como aplicación principal. | Precio por NIT, documento y excedente; certificados, habilitación, soporte, almacenamiento y exportación al terminar contrato. |
| Siigo | API de clientes, productos/servicios, facturas, notas crédito, recibos de caja y reportes. Documenta `Idempotency-Key` para reintentar comprobantes. | Conveniente si Siigo Nube será la contabilidad de referencia. | Plan que incluye API, cupos, empresas, acceso a pruebas, límites y alcance del soporte. |
| Alegra | API de gestión y oferta específica de facturación electrónica en Colombia; publica disponibilidad de sandbox y emisión XML. | Candidata si se desea conectar facturación y procesos contables de Alegra. | Diferencias entre su API de cuenta contable y la oferta de facturación, precio por emisor y documentos, límites y exportación. |
| Integración propia con DIAN | La DIAN contempla software propio, proveedor tecnológico o su solución gratuita, con requisitos de habilitación. | Mayor control, pero exige asumir firma, XML, validaciones, certificados y cambios normativos. No es la primera ruta recomendada para este proyecto. | Operación permanente, mantenimiento normativo y costo de soporte del conector. |

Referencias: [Siigo: recursos](https://developers.siigo.com/docs/siigoapi), [Siigo: idempotencia](https://developers.siigo.com/docs/siigoapi/idempotencia), [Alegra: API de facturación en Colombia](https://www.alegra.com/colombia/api/facturacion-electronica/), [DIAN: requerimientos](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/requerimientos-para-ser-facturador-electronico/).

No se encontró una tarifa pública comparable y confirmada para el mismo escenario de emisores y volumen en las tres opciones consultadas. No conviene comparar el precio de un plan POS con el de una API para múltiples negocios. Solicitar la misma cotización para: un emisor de bajo volumen, cinco emisores independientes y un escenario de crecimiento; incluir notas, documentos rechazados/reintentados, certificados, almacenamiento, impuestos y salida del servicio.

## Lo que cambia en el producto

La documentación técnica de la DIAN consultada publica el anexo de factura electrónica de venta 1.9. La normativa debe leerse con la compilación de la Resolución 000227 de 2025 y sus modificaciones; no basta con implementar un ejemplo antiguo de XML. [Documentación técnica DIAN](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/documentacion-tecnica/) · [Compilación normativa](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0227_2025.htm).

**Cliente y entrega.** La aplicación debe facilitar la identificación del comprador y, cuando corresponda, consultar el servicio de autollenado a través del proveedor. No debe exigir RUT, teléfono o dirección de residencia solamente para expedir la factura. Si el comprador no desea dar correo, debe contemplarse la entrega impresa según el flujo aplicable. Por eso los datos adicionales de la nueva ficha son opcionales y no hay un bloqueo fiscal por falta de teléfono. [DIAN: simplificación de datos del adquirente](https://www.dian.gov.co/Prensa/Paginas/NG-Comunicado-de-Prensa-026-2025.aspx).

**Impuestos.** El negocio tiene hoy una tasa general para sus ventas internas. Antes de emitir electrónicamente se necesita clasificación por artículo/servicio y tratamiento tributario: impuesto, tarifa, base, descuentos y condiciones de exención/exclusión cuando correspondan. No se debe asignar automáticamente un tratamiento fiscal por escoger “hotel”, “restaurante” o “servicios”. La configuración debe corresponder a las operaciones y responsabilidades del emisor. Los borradores actuales muestran este punto como pendiente; no convierten la tasa general histórica en una validación fiscal.

**Documentos distintos.** Factura electrónica, documento equivalente electrónico POS, nota crédito, documento soporte para adquisiciones a no obligados, nómina electrónica y eventos/RADIAN tienen finalidades diferentes. Un ticket del POS, un cierre de caja o un PDF no adquiere validez fiscal por cambiarle el título. El documento soporte de adquisiciones lo genera el comprador en el supuesto correspondiente, no es la factura de venta del comercio. [DIAN: sistema de facturación](https://www.dian.gov.co/impuestos/Paginas/Sistema-de-Factura-Electronica/Sistema-de-Factura-Electronica.aspx) · [Documento soporte](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/soporte-adquisiciones-no-obligados/).

**Correcciones.** Una devolución comercial, la salida de dinero y la nota crédito fiscal son registros relacionados, pero diferentes. La venta original y el documento validado se conservan. Una devolución interna no debe mostrarse como nota crédito aceptada por la DIAN. La documentación del proveedor permite consultar validación y descargar documentos; estas respuestas deben conservarse en el futuro conector. [Factus: notas crédito](https://developers.factus.com.co/notas-credito/crear-y-validar/).

**Contingencia.** Un modo sin conexión no equivale automáticamente a contingencia fiscal autorizada. Deben distinguirse fallas del emisor, del proveedor y de la DIAN, conservar evidencias y transmitir según la regla aplicable al evento. La guía de DIAN contempla numeración de contingencia y transmisión posterior; el conector deberá contrastar el procedimiento con la norma vigente antes de habilitarlo. [DIAN: contingencia](https://factura-electronica.dian.gov.co/contingencia-13.html).

## Diseño del conector que falta implementar

1. Configuración independiente por negocio/NIT, establecimiento y ambiente. Credenciales únicamente en el servidor o en un almacén de secretos. No incluir tokens, certificados o contraseñas en React, `localStorage`, exportaciones o registros de auditoría.
2. Catálogos de referencia del proveedor: tipos de documento, municipios, unidades, tributos y medios de pago. No asumir que el identificador de un proveedor sirve para otro.
3. Numeración: autorización, prefijo, rango, vigencia y alertas de agotamiento; nunca usar el identificador interno `VTA-…` como supuesto consecutivo DIAN.
4. Cálculos monetarios decimales, redondeo documentado y distribución de descuentos por línea. Conservar la versión de las reglas y las condiciones aceptadas al vender/reservar.
5. Cola persistente de envío con un identificador estable por emisor y operación. Guardar documento, intento, resultado y referencia del proveedor. Una respuesta HTTP perdida debe pasar a consulta/reconciliación; no crear otra factura con un número diferente.
6. Estados explícitos: borrador, listo, en envío, resultado desconocido, rechazado, validado y entregado. “Enviado” y “validado” no son sinónimos. Solo una respuesta verificable permite mostrar CUFE/CUDE y estado fiscal.
7. Guardar XML firmado, respuesta de validación, representación gráfica y evidencia de entrega. El hash interno del borrador actual protege su trazabilidad; **no es un CUFE**.
8. Notas crédito/débito vinculadas, motivos, límites por operación y conciliación con devoluciones. Reintentos y recepción de webhooks autenticados, tolerantes a duplicados y desorden.
9. Reconciliación diaria entre ventas, cobros, devoluciones y documentos fiscales. Reportar por separado bruto vendido, neto tras devoluciones, dinero recibido, saldo y estado de emisión.
10. Separar sandbox de producción. Probar rechazo, numeración agotada, caída de conexión, timeout después de aceptación, duplicados, devolución parcial y exportación de XML antes de activar emisión real.

La cola, los adaptadores externos, los catálogos fiscales y la emisión **todavía no están implementados**. La pantalla de preparación no tiene un botón de “emitir” que simule esas funciones.

## Aplicación a cada negocio

| Negocio | Flujo prioritario incorporado | Siguiente extensión funcional/fiscal |
|---|---|---|
| Tienda | Cliente registrado, favoritos, carritos guardados, devolución parcial con cálculo desde la venta original y registro de caja. | Impuestos por línea, variantes/kits, nota crédito conectada y fidelización; crédito/fiado requiere límites y políticas explícitas. |
| Restaurante | Cobro completo de mesa con varios medios, reutilizando el pedido para no consumir inventario dos veces. | División por productos/comensales, traslados entre mesas, modificadores y separación completa de entrega/pago. Modelar propina y descuentos con su tratamiento correcto. |
| Hotel | Panel de hoy; mantiene consumos, pagos, devoluciones y cierre ya existentes. Borrador desde una cuenta cerrada. | Anticipos trazables desde reserva, modificación de estancia con cotización, tarifas, grupos, mantenimiento por fechas y tratamiento fiscal de cada concepto. |
| Servicios | Cobro y devolución de cita más productos; jornadas, descansos, días libres, preparación y movimiento de citas conservando precio/duración. | Reserva pública, recordatorios, paquetes y comisiones; tratar un anticipo, una sesión prestada y una penalidad como conceptos diferentes. |
| Bodega | Conteo ciego enviado a revisión, detección de movimientos concurrentes y aprobación sin duplicar ajustes. | Conteo por lote/ubicación, preparación de despachos, reposición por demanda/plazo y recepción/documento soporte cuando aplique. |

Las siguientes extensiones no se consideran terminadas por aparecer en esta tabla. Formularios fiscales de sectores regulados, nómina y factoring/RADIAN requieren proyectos de integración específicos; no deben activarse automáticamente por agregar un módulo comercial.

## Qué queda implementado en esta entrega

- Clientes por negocio, documentos únicos dentro del negocio, archivo lógico, búsqueda e historial de ventas vinculadas. Las ventas nuevas conservan una copia de los datos del cliente. No se intenta enlazar ventas antiguas por coincidencia de nombres.
- Preparación fiscal: datos del emisor y borradores inmutables desde ventas completadas/cuentas cerradas. El mismo origen no crea dos borradores. Exportación JSON claramente identificada como interna.
- Devoluciones parciales: precios/descuentos/impuesto de la venta original, cantidades acotadas, distribución exacta de centavos, reposición opcional, límites por medio, turno propio y protección frente a reintentos. Los artículos preparados o con lotes no se reponen automáticamente; requieren revisión física.
- Ventas, reportes y proyecciones descuentan devoluciones; se agrupan por la fecha original de venta, con todas las devoluciones conocidas. La caja registra cada salida en su turno real. El costo solo se revierte para artículos repuestos; un artículo dañado conserva su costo. Los CSV separan total original, devuelto y neto.
- El POS conserva el cobro pendiente en el navegador ante una respuesta perdida, incluso después de recargar, y permite confirmar la misma operación. El comprobante usa los datos confirmados por el servidor.
- Servicios: cobro vinculado a una sola venta, conservación del precio reservado, inventario de productos adicionales y caja. Una cita cobrada no se puede editar o borrar; su comprobante permite devolver productos o un importe del servicio, acotado al cobro original. Jornada y preparación se verifican al crear, reprogramar o reactivar una cita.
- Conteos revisados: el formulario oculta existencias; el rol exclusivo de conteo tampoco recibe cantidades teóricas por estas API. El permiso de ajustes permite revisar/aprobar. Los administradores conservan el endpoint anterior de ajustes/conteo inmediato; un rol exclusivo de conteo no puede usarlo.
- Migraciones numeradas con checksum, nuevas áreas de backend separadas, carga de pantallas bajo demanda, CI y copias SQLite verificadas con restauración hacia un archivo nuevo.

El modo local conserva clientes, carritos y reglas/movimiento de citas. Preparación fiscal, devoluciones parciales, cobro integrado de servicios y revisión centralizada de conteos requieren servidor y lo indican en pantalla. No se crea silenciosamente una operación local cuando la respuesta de un cobro del servidor se pierde.

## Comparación ampliada con proyectos similares

Se tomaron patrones de funcionamiento, sin copiar código de otras licencias: [Open Source POS](https://opensourcepos.org/) para cliente/carrito; [Odoo Restaurante](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/restaurant.html) para cuentas y mesas; [TastyIgniter](https://tastyigniter.com/support/articles/managing-menu-items-options) para opciones de menú; [QloApps](https://qloapps.com/property-management-software/) para operación hotelera; [Easy!Appointments](https://easyappointments.org/features/) para jornadas/reserva; [ERPNext Pick List](https://docs.frappe.io/erpnext/pick-list) para preparación con ubicación/lote. Algunas funciones pertenecen a extensiones o servicios de pago; no se asume que todo sea gratuito.

La diferencia que conviene mantener es una experiencia común de clientes, caja y trazabilidad, con pantallas específicas por negocio. No mezclar todos los módulos en la navegación de todos los empleados.

## Copias y comprobación

Antes de migraciones nuevas sobre una base existente, la API conserva una copia verificada. Además, crea una copia local al iniciar si no hay una reciente y comprueba cada hora si corresponde una nueva; intervalo objetivo: 24 horas con la API encendida. Ubicación predeterminada: `backups/` junto a la base de datos. `MANAGER_STOCK_BACKUP_DIR` cambia la ubicación; `MANAGER_STOCK_AUTO_BACKUP=0` desactiva el trabajador. Las copias son verificadas y tienen manifiesto SHA-256. No hay borrado automático ni copia a un proveedor externo: hay que definir conservación, cuota y destino independiente para el despliegue real.

```bash
python scripts/backup_database.py --source /ruta/manager_stock.db --directory /ruta/copias
python scripts/restore_database.py /ruta/copias/manager_stock_....db /ruta/restauracion-nueva.db
```

La restauración rechaza un destino existente. Primero se verifica en una ruta nueva; cambiar la base de producción exige detener el servicio y seleccionar explícitamente el archivo verificado.

Validación reproducible de la entrega:

```bash
npx tsc --noEmit
npm run build
python backend/tests/test_commerce.py
python backend/tests/test_operations.py
node scripts/test_permissions.cjs
node scripts/test_sale_metrics.cjs
```

CI ejecuta además las regresiones de API existentes sobre bases desechables. Las pruebas de navegador requieren iniciar Vite y API sobre una base de pruebas; nunca deben apuntar a datos de clientes reales.
