/**
 * Carga los datos mínimos del negocio de demostración en los emuladores de
 * Firebase (Auth + Firestore).
 *
 * Requisitos:
 *   1. `npm run firebase:emulators` en otra terminal.
 *   2. `npm run firebase:seed`.
 *
 * El script es idempotente: se puede volver a ejecutar y deja los documentos
 * de configuración con los mismos valores.
 */

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.GCLOUD_PROJECT ||= 'demo-manager-stock';

const PROJECT_ID = process.env.GCLOUD_PROJECT;
const PASSWORD = process.env.FIREBASE_SEED_PASSWORD || 'ComidasDemo2026!';
const BUSINESS_ID = 'DEMO-FOOD-001';

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
const { getAuth } = await import('firebase-admin/auth');

const app = initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(app);
const auth = getAuth(app);

const USERS = [
  {
    email: 'owner.comidas@managerstock.test',
    displayName: 'Propietario Demo',
    role: 'owner',
  },
  {
    email: 'admin.comidas@managerstock.test',
    displayName: 'Administradora Demo',
    role: 'business_admin',
  },
  {
    email: 'mesero.comidas@managerstock.test',
    displayName: 'Laura Gómez',
    role: 'waiter',
  },
  {
    email: 'cocina.comidas@managerstock.test',
    displayName: 'Carlos Ruiz',
    role: 'kitchen',
  },
];

const STAFF = [
  {
    id: 'staff-mesero-01',
    email: 'mesero.comidas@managerstock.test',
    name: 'Laura Gómez',
    role: 'mesero',
  },
  {
    id: 'staff-cocina-01',
    email: 'cocina.comidas@managerstock.test',
    name: 'Carlos Ruiz',
    role: 'cocina',
  },
  {
    id: 'staff-admin-01',
    email: 'admin.comidas@managerstock.test',
    name: 'Andrea Díaz',
    role: 'admin',
  },
];

const TABLES = [
  { id: 'MESA-01', number: 1, name: 'Mesa 1', zone: 'Salón', capacity: 4 },
  { id: 'MESA-02', number: 2, name: 'Mesa 2', zone: 'Salón', capacity: 2 },
  { id: 'MESA-03', number: 3, name: 'Mesa 3', zone: 'Terraza', capacity: 6 },
];

const PRODUCTS = [
  {
    id: 'DEMO-PRD-FOOD-001',
    name: 'Hamburguesa clásica',
    sku: 'HAM-001',
    category: 'Hamburguesas',
    price: 18000,
    cost: 9000,
    stock: 30,
    minStock: 5,
    directSale: false,
  },
  {
    id: 'DEMO-PRD-FOOD-002',
    name: 'Papas a la francesa',
    sku: 'PAP-001',
    category: 'Acompañamientos',
    price: 8000,
    cost: 3500,
    stock: 40,
    minStock: 8,
    directSale: false,
  },
  {
    id: 'DEMO-PRD-FOOD-003',
    name: 'Gaseosa 400 ml',
    sku: 'GAS-001',
    category: 'Bebidas',
    price: 4000,
    cost: 1500,
    stock: 60,
    minStock: 12,
    directSale: true,
  },
  {
    id: 'DEMO-PRD-FOOD-004',
    name: 'Postre del día',
    sku: 'POS-001',
    category: 'Postres',
    price: 9000,
    cost: 4000,
    stock: 15,
    minStock: 4,
    directSale: true,
  },
];

async function upsertAuthUser({ email, displayName, role }) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    user = await auth.createUser({
      email,
      password: PASSWORD,
      displayName,
      emailVerified: true,
    });
  }

  await auth.updateUser(user.uid, {
    password: PASSWORD,
    displayName,
    emailVerified: true,
  });

  await auth.setCustomUserClaims(user.uid, {
    businessId: BUSINESS_ID,
    role,
  });

  return user.uid;
}

function friendlyEmulatorHint(error) {
  const message = String(error?.message || error);
  if (message.includes('ECONNREFUSED') || message.includes('UNAVAILABLE')) {
    return [
      'No se pudo conectar con los emuladores de Firebase.',
      'Arranca primero: npm run firebase:emulators',
      `Proyecto: ${PROJECT_ID}`,
      `Firestore: ${process.env.FIRESTORE_EMULATOR_HOST}`,
      `Auth: ${process.env.FIREBASE_AUTH_EMULATOR_HOST}`,
    ].join('\n');
  }
  return message;
}

try {
  console.log(`Sembrando ${PROJECT_ID} (${BUSINESS_ID})...`);

  const uidByEmail = new Map();
  for (const user of USERS) {
    const uid = await upsertAuthUser(user);
    uidByEmail.set(user.email, uid);
    console.log(`  auth  ${user.email.padEnd(38)} ${user.role.padEnd(15)} ${uid}`);
  }

  const businessRef = db.doc(`businesses/${BUSINESS_ID}`);
  await businessRef.set(
    {
      name: 'Sabores del Parque (Demo)',
      businessType: 'food',
      currency: 'COP',
      taxRate: 0.19,
      timezone: 'America/Bogota',
      active: true,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  for (const user of USERS) {
    const uid = uidByEmail.get(user.email);
    await businessRef.collection('members').doc(uid).set(
      {
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        active: true,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  for (const staff of STAFF) {
    await businessRef.collection('staff').doc(staff.id).set(
      {
        authUserId: uidByEmail.get(staff.email),
        name: staff.name,
        role: staff.role,
        active: true,
        pinHash: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  for (const table of TABLES) {
    await businessRef.collection('tables').doc(table.id).set(
      {
        number: table.number,
        name: table.name,
        zone: table.zone,
        capacity: table.capacity,
        status: 'active',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  await businessRef.collection('settings').doc('main').set(
    {
      startTime: '06:00',
      expectedMinutes: 15,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  for (const product of PRODUCTS) {
    await businessRef.collection('products').doc(product.id).set(
      {
        ...product,
        productType: 'food',
        unit: 'unidad',
        active: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  console.log('');
  console.log('Listo. Datos creados:');
  console.log(`  negocio:  ${BUSINESS_ID}`);
  console.log(`  mesas:    ${TABLES.length}`);
  console.log(`  personal: ${STAFF.length}`);
  console.log(`  productos:${String(PRODUCTS.length).padStart(3)}`);
  console.log('');
  console.log('Credenciales de prueba (todas con la misma contraseña):');
  for (const user of USERS) {
    console.log(`  ${user.email.padEnd(40)} ${user.role}`);
  }
  console.log(`  contraseña: ${PASSWORD}`);
  console.log('');
  console.log('Consola de emuladores: http://127.0.0.1:4000');
} catch (error) {
  console.error(friendlyEmulatorHint(error));
  process.exitCode = 1;
} finally {
  await app.delete().catch(() => {});
}
