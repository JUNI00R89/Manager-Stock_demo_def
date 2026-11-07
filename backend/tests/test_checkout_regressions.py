"""Regression checks for checkout, permissions and discrete units on a disposable DB."""
import os
import sys
import tempfile
from pathlib import Path

TEMP = tempfile.TemporaryDirectory(prefix='stock-checkout-')
os.environ['MANAGER_STOCK_DB'] = str(Path(TEMP.name) / 'test.db')
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from fastapi.testclient import TestClient
from backend.main import app, connection


def run():
    with TestClient(app) as c:
        response = c.post('/api/auth/register', json={'name': 'Owner', 'email': 'owner@test.local', 'password': 'TestPassword123!'})
        auth = {'Authorization': 'Bearer ' + response.json()['access_token']}
        config = {'type': 'restaurant', 'name': 'Food', 'currency': 'COP', 'taxRate': 0, 'features': {'inventory': True, 'pos': True}, 'foodConfig': {'activeModules': ['menu', 'caja', 'pedidos', 'inventario']}}
        assert c.put('/api/business/config', headers=auth, json=config).status_code == 200
        product = c.post('/api/products', headers=auth, json={'name': 'Producto', 'sku': 'UNIT', 'category': 'Comidas rápidas', 'price': 1000, 'stock': 10, 'minStock': 1, 'unit': 'unidad'}).json()
        pid = product['id']
        def stock():
            return c.get('/api/products', headers=auth).json()[0]['stock']
        def sale(key, **fields):
            return c.post('/api/sales', headers=auth, json={'idempotencyKey': key, **fields})
        def order(quantity):
            result = c.post('/api/orders', headers=auth, json={'tableNumber': 1, 'items': [{'productId': pid, 'quantity': quantity}]})
            assert result.status_code == 201, result.text
            return result.json()['id']
        # Both individual lines and aggregate quantities must respect the unit.
        for items in [[{'productId': pid, 'quantity': 0.5}], [{'productId': pid, 'quantity': 0.5}] * 2]:
            assert sale('fraction-test', items=items).status_code == 422
            assert stock() == 10
        assert c.post('/api/orders', headers=auth, json={'items': [{'productId': pid, 'quantity': 0.5}]}).status_code == 422
        assert sale('empty-sale-test').status_code == 422
        oid = order(2)
        assert c.patch(f'/api/orders/{oid}/status?status=preparing', headers=auth).status_code == 200
        assert stock() == 8
        # Checkout also sells an extra item and must consume the order only once.
        payload = {'orderIds': [oid], 'items': [{'productId': pid, 'quantity': 1}]}
        paid = sale('checkout-test', **payload)
        assert paid.status_code == 201, paid.text
        assert paid.json()['totalPrice'] == 3000
        assert stock() == 7
        assert c.get(f'/api/orders/{oid}', headers=auth).json()['status'] == 'delivered'
        assert sale('checkout-test', **payload).json()['id'] == paid.json()['id']
        assert stock() == 7
        assert sale('different-key', **payload).status_code == 409
        assert c.patch(f'/api/orders/{oid}/status?status=cancelled', headers=auth).status_code == 409
        assert c.post('/api/sales/' + paid.json()['id'] + '/cancel', headers=auth).status_code == 200
        assert stock() == 10
        # Failed checkout rolls back compensation of previously consumed stock.
        oid2 = order(2)
        c.patch(f'/api/orders/{oid2}/status?status=preparing', headers=auth)
        failed = sale('rollback-test', orderIds=[oid2], items=[{'productId': 'missing-product', 'quantity': 1}])
        assert failed.status_code == 404, failed.text
        assert stock() == 8
        assert c.get(f'/api/orders/{oid2}', headers=auth).json()['status'] == 'preparing'
        # Another tenant cannot charge an order, even knowing its identifier.
        other = c.post('/api/auth/register', json={'name': 'Other', 'email': 'other@test.local', 'password': 'TestPassword123!'}).json()
        other_auth = {'Authorization': 'Bearer ' + other['access_token']}
        c.put('/api/business/config', headers=other_auth, json=config)
        assert c.post('/api/sales', headers=other_auth, json={'idempotencyKey': 'cross-tenant-test', 'orderIds': [oid2]}).status_code == 404
        # Login configuration is readable by employees; changing it stays forbidden.
        c.get('/api/subscription', headers=auth)
        with connection() as conn:
            conn.execute("UPDATE business_subscriptions SET plan_id='enterprise'")
        custom = c.post('/api/custom-roles', headers=auth, json={'name': 'Catalog', 'permissions': ['catalog.view']}).json()
        for suffix, extra in [('cashier', {}), ('custom', {'customRoleId': custom['id']})]:
            email = suffix + '@test.local'
            staff = c.post('/api/users', headers=auth, json={'name': 'Employee', 'email': email, 'password': 'TestPassword123!', 'role': 'cashier', **extra})
            assert staff.status_code == 201, staff.text
            token = c.post('/api/auth/login', json={'email': email, 'password': 'TestPassword123!'}).json()['access_token']
            headers = {'Authorization': 'Bearer ' + token}
            assert c.get('/api/business/config', headers=headers).status_code == 200
            assert c.put('/api/business/config', headers=headers, json=config).status_code == 403
    print('OK: checkout, retry, reversal, rollback, tenant isolation, employee config and discrete units')


if __name__ == '__main__':
    run()
