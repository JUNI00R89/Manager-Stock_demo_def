import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';

initializeApp();
setGlobalOptions({ region: 'southamerica-east1' });

const db = getFirestore();

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------

function requireAuth(request: { auth?: { uid?: string } | null }): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión.');
  return uid;
}

function assertString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpsError('invalid-argument', `${name} es requerido.`);
  }
  return value.trim();
}

function assertPositiveInt(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new HttpsError('invalid-argument', `${name} debe ser un entero positivo.`);
  }
  return n;
}

async function requireMember(businessId: string, uid: string): Promise<Record<string, unknown>> {
  const snap = await db.doc(`businesses/${businessId}/members/${uid}`).get();
  if (!snap.exists || snap.data()?.active !== true) {
    throw new HttpsError('permission-denied', 'Sin acceso al negocio.');
  }
  return snap.data() as Record<string, unknown>;
}

interface StaffRecord {
  id: string;
  name: string;
  role: string;
}

async function requireStaff(
  businessId: string,
  staffId: string,
  allowedRoles: string[],
): Promise<StaffRecord> {
  const snap = await db.doc(`businesses/${businessId}/staff/${staffId}`).get();
  if (!snap.exists || snap.data()?.active !== true) {
    throw new HttpsError('permission-denied', 'Empleado no válido.');
  }
  const data = snap.data() as Record<string, unknown>;
  const role = String(data.role || '');
  if (!allowedRoles.includes(role)) {
    throw new HttpsError('permission-denied', 'El empleado no tiene permisos para esta acción.');
  }
  return { id: staffId, name: String(data.name || ''), role };
}

function jornadaKey(now: Date, startTime: string, timeZone = 'America/Bogota'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const local = new Date(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00`);
  const [hours, minutes] = startTime.split(':').map(Number);
  local.setMinutes(local.getMinutes() - (hours * 60 + minutes));
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, '0');
  const d = String(local.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------
// crearPedido
// ---------------------------------------------------------------------

export const crearPedido = onCall(async (request) => {
  const uid = requireAuth(request);
  const data = (request.data || {}) as Record<string, unknown>;

  const businessId = assertString(data.businessId, 'businessId');
  const mesaId = assertString(data.mesaId, 'mesaId');
  const meseroId = assertString(data.meseroId, 'meseroId');
  const itemsInput = Array.isArray(data.items) ? data.items : [];
  if (itemsInput.length === 0) {
    throw new HttpsError('invalid-argument', 'El pedido no tiene productos.');
  }
  const nota = typeof data.nota === 'string' ? data.nota.trim() || null : null;
  const orderId = typeof data.orderId === 'string' && data.orderId.trim()
    ? data.orderId.trim()
    : crypto.randomUUID();

  const orderRef = db.doc(`businesses/${businessId}/orders/${orderId}`);

  return db.runTransaction(async (tx) => {
    const member = await requireMember(businessId, uid);
    void member;

    const staff = await requireStaff(businessId, meseroId, ['mesero', 'admin']);

    const settingsSnap = await tx.get(db.doc(`businesses/${businessId}/settings/main`));
    const startTime = String(settingsSnap.data()?.startTime || '06:00');
    const jornada = jornadaKey(new Date(), startTime);

    const existing = await tx.get(orderRef);
    if (existing.exists) {
      const d = existing.data() as Record<string, unknown>;
      return { id: orderId, numero: d.numero, estado: d.estado };
    }

    const businessSnap = await tx.get(db.doc(`businesses/${businessId}`));
    const businessData = (businessSnap.data() || {}) as Record<string, unknown>;
    const taxRate = Number(businessData.taxRate ?? 0.19);

    // Leer productos y recalcular precios en el servidor.
    const productRefs = itemsInput.map((item: unknown) => {
      const productId = assertString((item as Record<string, unknown>)?.productId, 'productId');
      return db.doc(`businesses/${businessId}/products/${productId}`);
    });
    const productSnaps = await Promise.all(productRefs.map((ref) => tx.get(ref)));

    const normalized = itemsInput.map((item: unknown, index: number) => {
      const input = (item || {}) as Record<string, unknown>;
      const productId = assertString(input.productId, 'productId');
      const cantidad = assertPositiveInt(input.cantidad ?? 1, 'cantidad');
      const productSnap = productSnaps[index];
      if (!productSnap.exists) {
        throw new HttpsError('failed-precondition', `Producto no disponible: ${productId}`);
      }
      const product = productSnap.data() as Record<string, unknown>;
      if (product.active === false) {
        throw new HttpsError('failed-precondition', `Producto inactivo: ${productId}`);
      }
      return {
        id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : crypto.randomUUID(),
        productId,
        nombre: String(product.name || ''),
        precioUnitario: Number(product.price || 0),
        cantidad,
        nota: typeof input.nota === 'string' ? input.nota.trim() || null : null,
        ventaDirecta: Boolean(product.directSale),
      };
    });

    const subtotal = normalized.reduce(
      (sum, item) => sum + item.precioUnitario * item.cantidad,
      0,
    );
    const impuesto = Math.round(subtotal * taxRate);
    const total = subtotal + impuesto;
    const directOnly = normalized.every((item) => item.ventaDirecta);

    const counterRef = db.doc(`businesses/${businessId}/counters/${jornada}`);
    const counterSnap = await tx.get(counterRef);
    const numero = (Number(counterSnap.data()?.lastNumber) || 0) + 1;

    const mesaSnap = await tx.get(db.doc(`businesses/${businessId}/tables/${mesaId}`));
    if (!mesaSnap.exists) {
      throw new HttpsError('not-found', 'Mesa no encontrada.');
    }
    const mesaData = mesaSnap.data() as Record<string, unknown>;
    const mesaNumero = Number(mesaData.number || 0);
    const mesaNombre = String(mesaData.name || `Mesa ${mesaNumero}`);

    // Todas las lecturas ya están hechas: desde aquí solo se escribe.
    tx.set(counterRef, { lastNumber: numero }, { merge: true });

    const order = {
      numero,
      jornada,
      estado: directOnly ? 'finalizado' : 'pendiente',
      canal: 'local',
      mesaId,
      mesaNumero,
      mesaNombre,
      meseroId,
      meseroNombre: staff.name,
      items: normalized,
      subtotal,
      impuesto,
      taxRate,
      total,
      nota,
      listoParaLlevar: directOnly,
      version: 1,
      creadoEn: FieldValue.serverTimestamp(),
      actualizadoEn: FieldValue.serverTimestamp(),
    };

    tx.create(orderRef, order);
    tx.create(orderRef.collection('events').doc(), {
      estado: order.estado,
      actorId: meseroId,
      actorNombre: staff.name,
      detalle: { numero, jornada },
      creadoEn: FieldValue.serverTimestamp(),
    });

    return { id: orderId, numero, estado: order.estado };
  });
});

// ---------------------------------------------------------------------
// tomarPedido
// ---------------------------------------------------------------------

export const tomarPedido = onCall(async (request) => {
  const uid = requireAuth(request);
  const data = (request.data || {}) as Record<string, unknown>;

  const businessId = assertString(data.businessId, 'businessId');
  const orderId = assertString(data.orderId, 'orderId');
  const staffId = assertString(data.staffId, 'staffId');

  const orderRef = db.doc(`businesses/${businessId}/orders/${orderId}`);

  return db.runTransaction(async (tx) => {
    await requireMember(businessId, uid);
    const staff = await requireStaff(businessId, staffId, ['cocina', 'admin']);

    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Pedido no encontrado.');
    const order = snap.data() as Record<string, unknown>;

    if (order.estado === 'en_preparacion' && order.tomadoPorId === staffId) {
      return { id: orderId, estado: order.estado };
    }
    if (order.estado !== 'pendiente') {
      throw new HttpsError('failed-precondition', `CONFLICTO:${order.estado}`, {
        pedidoId: orderId,
        estado: order.estado,
      });
    }

    tx.update(orderRef, {
      estado: 'en_preparacion',
      tomadoPorId: staffId,
      tomadoPorNombre: staff.name,
      tomadoEn: FieldValue.serverTimestamp(),
      actualizadoEn: FieldValue.serverTimestamp(),
      version: FieldValue.increment(1),
    });
    tx.create(orderRef.collection('events').doc(), {
      estado: 'en_preparacion',
      actorId: staffId,
      actorNombre: staff.name,
      detalle: {},
      creadoEn: FieldValue.serverTimestamp(),
    });

    return { id: orderId, estado: 'en_preparacion' };
  });
});

// ---------------------------------------------------------------------
// finalizarPedido
// ---------------------------------------------------------------------

export const finalizarPedido = onCall(async (request) => {
  const uid = requireAuth(request);
  const data = (request.data || {}) as Record<string, unknown>;

  const businessId = assertString(data.businessId, 'businessId');
  const orderId = assertString(data.orderId, 'orderId');
  const staffId = assertString(data.staffId, 'staffId');

  const orderRef = db.doc(`businesses/${businessId}/orders/${orderId}`);

  return db.runTransaction(async (tx) => {
    await requireMember(businessId, uid);
    const staff = await requireStaff(businessId, staffId, ['cocina', 'admin']);

    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Pedido no encontrado.');
    const order = snap.data() as Record<string, unknown>;

    if (order.estado === 'finalizado') {
      if (order.finalizadoPorId === staffId) {
        return { id: orderId, estado: order.estado };
      }
      // Otro cocinero ya lo finalizó: no es conflicto bloqueante, solo informar.
      return { id: orderId, estado: order.estado };
    }
    if (order.estado !== 'en_preparacion') {
      throw new HttpsError('failed-precondition', `CONFLICTO:${order.estado}`, {
        pedidoId: orderId,
        estado: order.estado,
      });
    }

    tx.update(orderRef, {
      estado: 'finalizado',
      finalizadoPorId: staffId,
      finalizadoPorNombre: staff.name,
      finalizadoEn: FieldValue.serverTimestamp(),
      actualizadoEn: FieldValue.serverTimestamp(),
      version: FieldValue.increment(1),
    });
    tx.create(orderRef.collection('events').doc(), {
      estado: 'finalizado',
      actorId: staffId,
      actorNombre: staff.name,
      detalle: {},
      creadoEn: FieldValue.serverTimestamp(),
    });

    return { id: orderId, estado: 'finalizado' };
  });
});

// ---------------------------------------------------------------------
// entregarPedido
// ---------------------------------------------------------------------

export const entregarPedido = onCall(async (request) => {
  const uid = requireAuth(request);
  const data = (request.data || {}) as Record<string, unknown>;

  const businessId = assertString(data.businessId, 'businessId');
  const orderId = assertString(data.orderId, 'orderId');
  const staffId = assertString(data.staffId, 'staffId');
  const ventaId = typeof data.ventaId === 'string' ? data.ventaId.trim() || null : null;

  const orderRef = db.doc(`businesses/${businessId}/orders/${orderId}`);

  return db.runTransaction(async (tx) => {
    await requireMember(businessId, uid);
    const staff = await requireStaff(businessId, staffId, ['mesero', 'admin']);

    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Pedido no encontrado.');
    const order = snap.data() as Record<string, unknown>;

    if (order.estado === 'entregado') {
      // Idempotente: si ya se entregó con la misma venta, no duplicar.
      if (ventaId && order.ventaId && order.ventaId !== ventaId) {
        throw new HttpsError('already-exists', 'El pedido ya se entregó con otra venta.');
      }
      // Si la primera entrega no registró la venta (variante B), se concilia ahora.
      if (ventaId && !order.ventaId) {
        tx.update(orderRef, {
          ventaId,
          ventaRegistradaEn: FieldValue.serverTimestamp(),
          actualizadoEn: FieldValue.serverTimestamp(),
        });
      }
      return { id: orderId, estado: order.estado, ventaId: order.ventaId ?? ventaId ?? null };
    }
    if (order.estado !== 'finalizado') {
      throw new HttpsError('failed-precondition', `CONFLICTO:${order.estado}`, {
        pedidoId: orderId,
        estado: order.estado,
      });
    }

    // Solo el mesero asignado o un administrador puede entregar.
    const assignedWaiter = String(order.meseroId || '');
    if (staff.role !== 'admin' && staff.id !== assignedWaiter) {
      throw new HttpsError('permission-denied', 'Solo el mesero asignado o un administrador puede entregar.');
    }

    tx.update(orderRef, {
      estado: 'entregado',
      entregadoPorId: staffId,
      entregadoPorNombre: staff.name,
      entregadoEn: FieldValue.serverTimestamp(),
      actualizadoEn: FieldValue.serverTimestamp(),
      version: FieldValue.increment(1),
      ...(ventaId ? { ventaId, ventaRegistradaEn: FieldValue.serverTimestamp() } : {}),
    });
    tx.create(orderRef.collection('events').doc(), {
      estado: 'entregado',
      actorId: staffId,
      actorNombre: staff.name,
      detalle: ventaId ? { ventaId } : {},
      creadoEn: FieldValue.serverTimestamp(),
    });

    return { id: orderId, estado: 'entregado', ventaId };
  });
});

// ---------------------------------------------------------------------
// cancelarPedido
// ---------------------------------------------------------------------

export const cancelarPedido = onCall(async (request) => {
  const uid = requireAuth(request);
  const data = (request.data || {}) as Record<string, unknown>;

  const businessId = assertString(data.businessId, 'businessId');
  const orderId = assertString(data.orderId, 'orderId');
  const staffId = assertString(data.staffId, 'staffId');
  const motivo = assertString(data.motivo, 'motivo');

  const orderRef = db.doc(`businesses/${businessId}/orders/${orderId}`);

  return db.runTransaction(async (tx) => {
    await requireMember(businessId, uid);
    const staff = await requireStaff(businessId, staffId, ['mesero', 'cocina', 'admin']);

    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Pedido no encontrado.');
    const order = snap.data() as Record<string, unknown>;

    if (order.estado === 'cancelado') {
      return { id: orderId, estado: order.estado };
    }
    if (order.estado === 'entregado') {
      throw new HttpsError('failed-precondition', 'Un pedido entregado no se puede cancelar.');
    }

    tx.update(orderRef, {
      estado: 'cancelado',
      canceladoPorId: staffId,
      canceladoPorNombre: staff.name,
      canceladoEn: FieldValue.serverTimestamp(),
      motivoCancelacion: motivo,
      actualizadoEn: FieldValue.serverTimestamp(),
      version: FieldValue.increment(1),
    });
    tx.create(orderRef.collection('events').doc(), {
      estado: 'cancelado',
      actorId: staffId,
      actorNombre: staff.name,
      detalle: { motivo },
      creadoEn: FieldValue.serverTimestamp(),
    });

    return { id: orderId, estado: 'cancelado' };
  });
});
