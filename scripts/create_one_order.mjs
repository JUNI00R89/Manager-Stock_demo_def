process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.GCLOUD_PROJECT ||= 'demo-manager-stock';

const PROJECT = process.env.GCLOUD_PROJECT;
const AUTH_HOST = '127.0.0.1:9099';
const FUNCTIONS_HOST = '127.0.0.1:5001';
const PASSWORD = 'ComidasDemo2026!';

async function signIn(email) {
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json.idToken;
}

async function callFn(name, idToken, data) {
  const res = await fetch(`http://${FUNCTIONS_HOST}/${PROJECT}/southamerica-east1/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json.result;
}

const token = await signIn('mesero.comidas@managerstock.test');
const result = await callFn('crearPedido', token, {
  businessId: 'DEMO-FOOD-001',
  mesaId: 'MESA-03',
  meseroId: 'staff-mesero-01',
  items: [{ productId: 'DEMO-PRD-FOOD-001', cantidad: 1 }],
  nota: 'Prueba tiempo real',
});
console.log('Created order', result.id, result.numero);