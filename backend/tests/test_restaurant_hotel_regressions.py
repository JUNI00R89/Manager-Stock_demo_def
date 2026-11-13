"""Shared order workflow and persisted housekeeping, using disposable SQLite."""
import os
import sys
import tempfile
from pathlib import Path

TEMP = tempfile.TemporaryDirectory(prefix='stock-workflow-')
os.environ['MANAGER_STOCK_DB'] = str(Path(TEMP.name) / 'test.db')
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from fastapi.testclient import TestClient
from backend.main import app, connection


def run():
    with TestClient(app) as c:
        def register(email, kind):
            response = c.post('/api/auth/register', json={'name': 'Test Owner', 'email': email, 'password': 'TestPassword123!'}).json()
            h = {'Authorization': 'Bearer ' + response['access_token']}
            config = {'type': kind, 'name': 'Test Business', 'currency': 'COP', 'taxRate': 0, 'features': {'inventory': True, 'pos': True, 'rooms': kind == 'hotel', 'reservations': kind == 'hotel', 'tables': True}, 'foodConfig': {'activeModules': ['menu', 'caja', 'pedidos', 'inventario']}}
            assert c.put('/api/business/config', headers=h, json=config).status_code == 200
            return h
        food = register('food@test.local', 'restaurant')
        product = c.post('/api/products', headers=food, json={'name': 'Dish', 'sku': 'DISH', 'category': 'Comidas rápidas', 'price': 1000, 'stock': 10, 'minStock': 1, 'unit': 'unidad'}).json()
        oid = c.post('/api/orders', headers=food, json={'tableNumber': 1, 'waiter': 'Mesero', 'items': [{'productId': product['id'], 'quantity': 2}], 'restaurantMetadata': {'meseroId': 'waiter', 'mesaId': 'table', 'jornada': '2026-11-07'}}).json()['id']
        assert c.patch(f'/api/orders/{oid}/status?status=preparing&expectedStatus=received&actorId=cook&actorName=Cocinero', headers=food).status_code == 200
        assert c.patch(f'/api/orders/{oid}/status?status=preparing&expectedStatus=received&actorId=second', headers=food).status_code == 409
        assert 'Cocinero' in c.get(f'/api/orders/{oid}', headers=food).json()['restaurant_metadata']
        assert c.patch(f'/api/orders/{oid}/status?status=ready&expectedStatus=preparing', headers=food).status_code == 200
        assert c.post('/api/cash/sessions', headers=food, json={'openingAmount': 0}).status_code == 201  # cash needs an open shift
        sale = c.post('/api/sales', headers=food, json={'idempotencyKey': 'restaurant-order-' + oid, 'orderIds': [oid]}).json()
        assert sale['totalPrice'] == 2000
        assert c.get('/api/products', headers=food).json()[0]['stock'] == 8
        assert c.get(f'/api/orders/{oid}', headers=food).json()['sale_id'] == sale['id']
        direct = c.post('/api/orders', headers=food, json={'items': [{'productId': product['id'], 'quantity': 1}], 'restaurantMetadata': {'directProductIds': [product['id']]}})
        assert direct.status_code == 201 and direct.json()['status'] == 'ready'
        hotel = register('hotel@test.local', 'hotel')
        other = register('otherhotel@test.local', 'hotel')
        room = c.post('/api/hotel/rooms', headers=hotel, json={'roomNumber': '101', 'roomType': 'double', 'pricePerNight': 100}).json()
        path = '/api/hotel/rooms/' + room['id'] + '/housekeeping'
        patch = {'cleaningStatus': 'sucia', 'cleaningAssignee': 'Laura', 'expectedStatus': 'inspeccionada'}
        assert c.patch(path, headers=other, json=patch).status_code == 404
        assert c.patch(path, headers=hotel, json=patch).status_code == 200
        assert c.get('/api/hotel/rooms', headers=hotel).json()[0]['cleaningAssignee'] == 'Laura'
        assert c.patch(path, headers=hotel, json=patch).status_code == 409
        assert c.patch(path, headers=hotel, json={**patch, 'expectedStatus': 'sucia', 'cleaningStatus': 'en_limpieza'}).status_code == 200
        assert c.patch(path, headers=hotel, json={'cleaningStatus': 'inspeccionada', 'cleaningAssignee': 'Laura'}).json()['status'] == 'available'
        reservation = c.post('/api/hotel/reservations', headers=hotel, json={'roomId': room['id'], 'guestName': 'Guest', 'checkIn': '2026-12-10', 'checkOut': '2026-12-11'}).json()
        rpath = '/api/hotel/reservations/' + reservation['id'] + '/status'
        assert c.patch(rpath, headers=hotel, json={'status': 'checkin'}).status_code == 200
        assert c.patch(path, headers=hotel, json={'cleaningStatus': 'inspeccionada'}).json()['status'] == 'occupied'
        assert c.patch(rpath, headers=hotel, json={'status': 'checkout'}).status_code == 200
        after = c.get('/api/hotel/rooms', headers=hotel).json()[0]
        assert after['status'] == 'cleaning' and after['cleaningStatus'] == 'sucia'
        # Read-only hotel staff cannot mutate housekeeping.
        c.get('/api/subscription', headers=hotel)
        with connection() as conn: conn.execute("UPDATE business_subscriptions SET plan_id='enterprise'")
        role = c.post('/api/custom-roles', headers=hotel, json={'name': 'Hotel reader', 'permissions': ['hotel.view']}).json()
        assert c.post('/api/users', headers=hotel, json={'name': 'Reader', 'email': 'reader@test.local', 'password': 'TestPassword123!', 'role': 'cashier', 'customRoleId': role['id']}).status_code == 201
        token = c.post('/api/auth/login', json={'email': 'reader@test.local', 'password': 'TestPassword123!'}).json()['access_token']
        reader = {'Authorization': 'Bearer ' + token}
        assert c.get('/api/hotel/rooms', headers=reader).status_code == 200
        assert c.patch(path, headers=reader, json=patch).status_code == 403
    # Reopening the app must keep the saved state.
    with TestClient(app) as c:
        assert c.get('/api/hotel/rooms', headers=hotel).json()[0]['cleaningStatus'] == 'sucia'
    print('OK: shared orders, conflicting transitions, linked checkout, housekeeping, checkout cleaning, isolation and permissions')


if __name__ == '__main__':
    run()
