"""Hotel consumption accounting and stock regression tests on disposable SQLite."""
import os
import sys
import tempfile
from pathlib import Path

TEMP = tempfile.TemporaryDirectory(prefix='hotel-charges-')
os.environ['MANAGER_STOCK_DB'] = str(Path(TEMP.name) / 'test.db')
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from fastapi.testclient import TestClient
from backend.main import app, connection


def run():
    with TestClient(app) as c:
        def owner(email):
            r = c.post('/api/auth/register', json={'name': 'Hotel Owner', 'email': email, 'password': 'TestPassword123!'}).json()
            h = {'Authorization': 'Bearer ' + r['access_token']}
            c.put('/api/business/config', headers=h, json={'type': 'hotel', 'name': 'Test Hotel', 'currency': 'COP', 'taxRate': 0, 'features': {'inventory': True, 'pos': True, 'rooms': True, 'reservations': True}}).raise_for_status()
            return h
        auth, other = owner('hotel@test.local'), owner('other@test.local')
        payload = {'name': 'Gaseosa', 'sku': 'SODA', 'category': 'Minibar', 'price': 5000, 'cost': 2000, 'stock': 10, 'minStock': 1, 'unit': 'unidad'}
        product = c.post('/api/products', headers=auth, json=payload).json()
        room = c.post('/api/hotel/rooms', headers=auth, json={'roomNumber': '01', 'pricePerNight': 100000}).json()
        def reserve(name, start, end):
            r = c.post('/api/hotel/reservations', headers=auth, json={'roomId': room['id'], 'guestName': name, 'checkIn': start, 'checkOut': end, 'advance': 20000})
            assert r.status_code == 201, r.text
            return r.json()['id']
        rid = reserve('Primer huésped', '2027-01-10', '2027-01-12')
        second = reserve('Siguiente huésped', '2027-01-12', '2027-01-13')
        base = f'/api/hotel/reservations/{rid}'
        request = {'productId': product['id'], 'quantity': 2, 'idempotencyKey': 'soda-charge-test', 'note': 'Minibar'}
        assert c.post(base + '/charges', headers=auth, json=request).status_code == 409
        assert c.patch(base + '/status', headers=auth, json={'status': 'checkin'}).status_code == 200
        def stock(): return c.get('/api/products', headers=auth).json()[0]['stock']
        assert c.post(base + '/charges', headers=other, json=request).status_code == 404
        assert c.get(base + '/account', headers=other).status_code == 404
        assert c.post(base + '/charges', headers=auth, json={**request, 'quantity': 0.5}).status_code == 422
        assert c.post(base + '/charges', headers=auth, json={**request, 'quantity': 11}).status_code == 409
        assert c.get(base + '/account', headers=auth).json()['charges'] == [] and stock() == 10
        created = c.post(base + '/charges', headers=auth, json=request)
        assert created.status_code == 201, created.text
        account = created.json()
        assert account['accommodationTotal'] == 200000 and account['consumptionTotal'] == 10000
        assert account['total'] == 210000 and account['balance'] == 190000 and stock() == 8
        charge_id = account['charges'][0]['id']
        assert c.post(base + '/charges', headers=auth, json=request).json()['charges'][0]['id'] == charge_id
        assert stock() == 8
        assert c.post(base + '/charges', headers=auth, json={**request, 'quantity': 3}).status_code == 409
        # Editing the catalog must not rewrite the posted price or room charge.
        with connection() as conn:
            conn.execute('UPDATE products SET price=7000 WHERE id=?', (product['id'],))
            conn.execute('UPDATE hotel_rooms SET price_per_night=150000 WHERE id=?', (room['id'],))
        assert c.get(base + '/account', headers=auth).json()['charges'][0]['unitPrice'] == 5000
        cancel_path = base + '/charges/' + charge_id + '/cancel'
        assert c.post(cancel_path, headers=other).status_code == 404
        assert c.post(cancel_path, headers=auth).json()['total'] == 200000 and stock() == 10
        assert c.post(cancel_path, headers=auth).status_code == 200 and stock() == 10
        added = c.post(base + '/charges', headers=auth, json={**request, 'quantity': 1, 'idempotencyKey': 'second-charge-key'}).json()
        assert added['total'] == 207000 and stock() == 9
        assert next(r for r in c.get('/api/hotel/reservations', headers=auth).json() if r['id'] == rid)['totalCharges'] == 207000
        assert c.patch(base + '/status', headers=auth, json={'status': 'checkout'}).status_code == 200
        assert c.get(base + '/account', headers=auth).json()['total'] == 207000
        assert c.get(f'/api/hotel/reservations/{second}/account', headers=auth).json()['charges'] == []
        assert c.post(base + '/charges', headers=auth, json={**request, 'idempotencyKey': 'closed-charge-key'}).status_code == 409
        active = next(row for row in added['charges'] if row['status'] == 'active')
        assert c.post(base + '/charges/' + active['id'] + '/cancel', headers=auth).status_code == 409
        # Only hotel managers can post charges, even if the catalog is readable.
        c.get('/api/subscription', headers=auth)
        with connection() as conn: conn.execute("UPDATE business_subscriptions SET plan_id='enterprise'")
        role = c.post('/api/custom-roles', headers=auth, json={'name': 'Reader', 'permissions': ['hotel.view']}).json()
        c.post('/api/users', headers=auth, json={'name': 'Reader', 'email': 'reader@test.local', 'password': 'TestPassword123!', 'role': 'cashier', 'customRoleId': role['id']}).raise_for_status()
        login = c.post('/api/auth/login', json={'email': 'reader@test.local', 'password': 'TestPassword123!'}).json()
        reader = {'Authorization': 'Bearer ' + login['access_token']}
        assert c.get(base + '/account', headers=reader).status_code == 200
        assert c.get('/api/hotel/products', headers=reader).status_code == 200
        assert c.post(base + '/charges', headers=reader, json=request).status_code == 403
    with TestClient(app) as c:
        assert c.get(base + '/account', headers=auth).json()['total'] == 207000
    print('OK: room consumption, inventory, retry, cancellation, snapshots, checkout, next guest, isolation and permissions')


if __name__ == '__main__':
    run()
