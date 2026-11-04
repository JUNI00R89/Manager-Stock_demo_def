/**
 * Pruebas negativas y positivas de `firestore.rules` contra el emulador.
 *
 * Se ejecuta con:
 *   npm run firebase:test-rules
 *
 * El comando `emulators:exec` levanta Firestore, corre este archivo y apaga
 * todo al terminar.
 */

import fs from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const PROJECT_ID = 'demo-manager-stock';
const BUSINESS_A = 'DEMO-FOOD-001';
const BUSINESS_B = 'DEMO-FOOD-002';

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: fs.readFileSync('firestore.rules', 'utf8'),
    host: '127.0.0.1',
    port: 8080,
  },
});

async function seedBaseData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `businesses/${BUSINESS_A}`), { name: 'Negocio A' });
    await setDoc(doc(db, `businesses/${BUSINESS_B}`), { name: 'Negocio B' });
    await setDoc(doc(db, `businesses/${BUSINESS_A}/orders/order-1`), {
      estado: 'pendiente',
      numero: 1,
    });
    await setDoc(doc(db, `businesses/${BUSINESS_B}/orders/order-1`), {
      estado: 'pendiente',
      numero: 1,
    });
    await setDoc(doc(db, `businesses/${BUSINESS_A}/settings/main`), {
      startTime: '06:00',
    });
  });
}

const cases = [];

function test(name, fn) {
  cases.push({ name, fn });
}

test('anónimo no puede leer pedidos', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, `businesses/${BUSINESS_A}/orders/order-1`)));
});

test('miembro del negocio lee sus pedidos', async () => {
  const db = testEnv
    .authenticatedContext('owner-a', { businessId: BUSINESS_A, role: 'owner' })
    .firestore();
  await assertSucceeds(getDoc(doc(db, `businesses/${BUSINESS_A}/orders/order-1`)));
});

test('miembro del negocio A no lee pedidos del negocio B', async () => {
  const db = testEnv
    .authenticatedContext('owner-a', { businessId: BUSINESS_A, role: 'owner' })
    .firestore();
  await assertFails(getDoc(doc(db, `businesses/${BUSINESS_B}/orders/order-1`)));
});

test('usuario sin claim businessId no lee pedidos', async () => {
  const db = testEnv
    .authenticatedContext('sin-negocio', { role: 'owner' })
    .firestore();
  await assertFails(getDoc(doc(db, `businesses/${BUSINESS_A}/orders/order-1`)));
});

test('mesero no puede escribir pedidos directamente', async () => {
  const db = testEnv
    .authenticatedContext('waiter-a', { businessId: BUSINESS_A, role: 'waiter' })
    .firestore();
  await assertFails(
    setDoc(doc(db, `businesses/${BUSINESS_A}/orders/order-2`), {
      estado: 'pendiente',
    }),
  );
});

test('cocina puede leer el tablero', async () => {
  const db = testEnv
    .authenticatedContext('kitchen-a', { businessId: BUSINESS_A, role: 'kitchen' })
    .firestore();
  await assertSucceeds(getDoc(doc(db, `businesses/${BUSINESS_A}/orders/order-1`)));
});

test('cocina no puede editar ajustes', async () => {
  const db = testEnv
    .authenticatedContext('kitchen-a', { businessId: BUSINESS_A, role: 'kitchen' })
    .firestore();
  await assertFails(
    setDoc(doc(db, `businesses/${BUSINESS_A}/settings/main`), {
      startTime: '07:00',
    }),
  );
});

test('mesero no puede editar ajustes', async () => {
  const db = testEnv
    .authenticatedContext('waiter-a', { businessId: BUSINESS_A, role: 'waiter' })
    .firestore();
  await assertFails(
    setDoc(doc(db, `businesses/${BUSINESS_A}/settings/main`), {
      startTime: '07:00',
    }),
  );
});

test('administrador puede editar ajustes', async () => {
  const db = testEnv
    .authenticatedContext('admin-a', {
      businessId: BUSINESS_A,
      role: 'business_admin',
    })
    .firestore();
  await assertSucceeds(
    setDoc(doc(db, `businesses/${BUSINESS_A}/settings/main`), {
      startTime: '07:00',
    }),
  );
});

test('nadie escribe contadores desde el cliente', async () => {
  const db = testEnv
    .authenticatedContext('admin-a', {
      businessId: BUSINESS_A,
      role: 'business_admin',
    })
    .firestore();
  await assertFails(
    setDoc(doc(db, `businesses/${BUSINESS_A}/counters/2026-11-04`), {
      lastNumber: 99,
    }),
  );
});

try {
  await seedBaseData();

  let failed = 0;
  for (const { name, fn } of cases) {
    try {
      await fn();
      console.log(`  OK   ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`  FAIL ${name}`);
      console.error(`       ${error?.message || error}`);
    }
  }

  console.log('');
  console.log(`${cases.length - failed}/${cases.length} pruebas de reglas pasaron.`);

  if (failed > 0) process.exitCode = 1;
} finally {
  await testEnv.cleanup();
}
