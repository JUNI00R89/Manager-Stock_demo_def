/**
 * Prueba de humo de las Cloud Functions de pedidos contra los emuladores.
 *
 * Ejecutar con:
 *   npm run firebase:test-functions
 */

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.GCLOUD_PROJECT ||= 'demo-manager-stock';

const PROJECT = process.env.GCLOUD_PROJECT;
const REGION = 'southamerica-east1';
const AUTH_HOST = '127.0.0.1:9099';
const FUNCTIONS_HOST = '127.0.0.1:5001';
const PASSWORD = 'ComidasDemo2026!';

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');

initializeApp({ projectId: PROJECT });
const db = getFirestore();

async function signIn(email) {
  const res = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
    },
  );
  const json = await res.json();
  if (!res.ok) throw new Error(`signIn ${email}: ${JSON.stringify(json)}`);
  return json.idToken;
}

async function callFn(name, idToken, data) {
  const res = await fetch(`http://${FUNCTIONS_HOST}/${PROJECT}/${REGION}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${name}: ${JSON.stringify(json)}`);
  return json.result;
}

const MESERO_EMAIL = 'mesero.comidas@managerstock.test';
const COCINA_EMAIL = 'cocina.comidas@managerstock.test';
const ADMIN_EMAIL = 'admin.comidas@managerstock.test';

let passed = 0;
let failed = 0;

function ok(name) {
  passed += 1;
  console.log(`  OK   ${name}`);
}

function fail(name, error) {
  failed += 1;
  console.error(`  FAIL ${name}`);
  console.error(`       ${error?.message || error}`);
}

async function main() {
  console.log('Probando Cloud Functions de pedidos...');

  const meseroToken = await signIn(MESERO_EMAIL);
  const cocinaToken = await signIn(COCINA_EMAIL);
  const adminToken = await signIn(ADMIN_EMAIL);

  // 1. Crear pedido
  let orderId;
  let numero;
  try {
    const result = await callFn('crearPedido', meseroToken, {
      businessId: 'DEMO-FOOD-001',
      mesaId: 'MESA-01',
      meseroId: 'staff-mesero-01',
      items: [
        { productId: 'DEMO-PRD-FOOD-001', cantidad: 2 },
        { productId: 'DEMO-PRD-FOOD-003', cantidad: 1 },
      ],
      nota: 'Sin cebolla',
    });
    orderId = result.id;
    numero = result.numero;
    if (!orderId || !numero) throw new Error('Respuesta incompleta');
    ok(`crearPedido -> #${numero} (${orderId})`);
  } catch (error) {
    fail('crearPedido', error);
    throw error;
  }

  // 2. Tomar pedido
  try {
    const result = await callFn('tomarPedido', cocinaToken, {
      businessId: 'DEMO-FOOD-001',
      orderId,
      staffId: 'staff-cocina-01',
    });
    if (result.estado !== 'en_preparacion') throw new Error(`estado=${result.estado}`);
    ok('tomarPedido -> en_preparacion');
  } catch (error) {
    fail('tomarPedido', error);
  }

  // 3. Idempotencia de tomar
  try {
    const result = await callFn('tomarPedido', cocinaToken, {
      businessId: 'DEMO-FOOD-001',
      orderId,
      staffId: 'staff-cocina-01',
    });
    if (result.estado !== 'en_preparacion') throw new Error(`estado=${result.estado}`);
    ok('tomarPedido idempotente');
  } catch (error) {
    fail('tomarPedido idempotente', error);
  }

  // 4. Finalizar
  try {
    const result = await callFn('finalizarPedido', cocinaToken, {
      businessId: 'DEMO-FOOD-001',
      orderId,
      staffId: 'staff-cocina-01',
    });
    if (result.estado !== 'finalizado') throw new Error(`estado=${result.estado}`);
    ok('finalizarPedido -> finalizado');
  } catch (error) {
    fail('finalizarPedido', error);
  }

  // 5. Conflicto: tomar un pedido ya finalizado
  try {
    await callFn('tomarPedido', cocinaToken, {
      businessId: 'DEMO-FOOD-001',
      orderId,
      staffId: 'staff-cocina-01',
    });
    fail('conflicto tomar finalizado', new Error('No lanzó error'));
  } catch (error) {
    if (String(error.message).includes('CONFLICTO:finalizado')) {
      ok('conflicto tomar finalizado');
    } else {
      fail('conflicto tomar finalizado', error);
    }
  }

  // 6. Entregar (sin ventaId, variante B la añade el cliente)
  try {
    const result = await callFn('entregarPedido', meseroToken, {
      businessId: 'DEMO-FOOD-001',
      orderId,
      staffId: 'staff-mesero-01',
    });
    if (result.estado !== 'entregado') throw new Error(`estado=${result.estado}`);
    ok('entregarPedido -> entregado');
  } catch (error) {
    fail('entregarPedido', error);
  }

  // 7. Idempotencia de entregar
  try {
    const result = await callFn('entregarPedido', meseroToken, {
      businessId: 'DEMO-FOOD-001',
      orderId,
      staffId: 'staff-mesero-01',
      ventaId: 'venta-demo-001',
    });
    if (result.estado !== 'entregado') throw new Error(`estado=${result.estado}`);
    ok('entregarPedido idempotente con ventaId');
  } catch (error) {
    fail('entregarPedido idempotente', error);
  }

  // 8. Cancelar un pedido nuevo
  let orderId2;
  try {
    const created = await callFn('crearPedido', meseroToken, {
      businessId: 'DEMO-FOOD-001',
      mesaId: 'MESA-02',
      meseroId: 'staff-mesero-01',
      items: [{ productId: 'DEMO-PRD-FOOD-002', cantidad: 1 }],
    });
    orderId2 = created.id;
    const result = await callFn('cancelarPedido', adminToken, {
      businessId: 'DEMO-FOOD-001',
      orderId: orderId2,
      staffId: 'staff-admin-01',
      motivo: 'Cliente se fue',
    });
    if (result.estado !== 'cancelado') throw new Error(`estado=${result.estado}`);
    ok('cancelarPedido -> cancelado');
  } catch (error) {
    fail('cancelarPedido', error);
  }

  // 9. No se puede cancelar un pedido entregado
  try {
    await callFn('cancelarPedido', adminToken, {
      businessId: 'DEMO-FOOD-001',
      orderId,
      staffId: 'staff-admin-01',
      motivo: 'Intento',
    });
    fail('cancelar entregado', new Error('No lanzó error'));
  } catch (error) {
    if (String(error.message).includes('entregado')) {
      ok('cancelar entregado bloqueado');
    } else {
      fail('cancelar entregado', error);
    }
  }

  // 10. Verificar estado final en Firestore
  try {
    const orderSnap = await db.doc(`businesses/DEMO-FOOD-001/orders/${orderId}`).get();
    const data = orderSnap.data();
    if (data?.estado !== 'entregado') throw new Error(`estado final=${data?.estado}`);
    if (data?.ventaId !== 'venta-demo-001') throw new Error(`ventaId=${data?.ventaId}`);
    const events = await db.collection(`businesses/DEMO-FOOD-001/orders/${orderId}/events`).get();
    if (events.size < 4) throw new Error(`events=${events.size}`);
    ok(`Firestore final: entregado, ventaId, ${events.size} eventos`);
  } catch (error) {
    fail('verificación Firestore', error);
  }

  console.log('');
  console.log(`${passed}/${passed + failed} pruebas de funciones pasaron.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
