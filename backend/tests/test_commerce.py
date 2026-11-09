"""Customer isolation, immutable billing drafts and atomic partial refunds on disposable SQLite."""
import hashlib
import json
import os
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

TEMP = tempfile.TemporaryDirectory(prefix='commerce-')
os.environ['MANAGER_STOCK_DB'] = str(Path(TEMP.name) / 'test.db')
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from fastapi.testclient import TestClient
from backend.main import app, connection
from backend.migrations import migrate


def run():
    with TestClient(app) as c:
        def owner(name):
            r = c.post('/api/auth/register', json={'name': name, 'email': name + '@test.local', 'password': 'TestPassword123!'})
            r.raise_for_status()
            h = {'Authorization': 'Bearer ' + r.json()['access_token']}
            c.put('/api/business/config', headers=h, json={'type': 'retail', 'name': name, 'currency': 'COP', 'taxRate': .19, 'features': {'inventory': True, 'pos': True}}).raise_for_status()
            return h
        h, other = owner('Owner'), owner('Other')
        payload = {'name': 'Ana', 'documentNumber': '12345', 'email': 'ana@test.local'}
        customer = c.post('/api/customers', headers=h, json=payload).json()
        assert c.post('/api/customers', headers=h, json=payload).status_code == 409
        foreign = c.post('/api/customers', headers=other, json=payload).json()
        assert c.get('/api/customers?search=Ana', headers=h).json() == [customer]
        assert c.get('/api/customers?search=%25', headers=h).json() == []
        assert c.put('/api/customers/' + customer['id'], headers=other, json=customer).status_code == 404
        updated = c.put('/api/customers/' + customer['id'], headers=h, json={**customer, 'phone': '123'}).json()
        assert c.put('/api/customers/' + customer['id'], headers=h, json=customer).status_code == 409
        product = c.post('/api/products', headers=h, json={'name': 'Gaseosa', 'sku': 'GAS', 'category': 'Bebidas', 'price': 100.01, 'stock': 10, 'minStock': 0, 'cost': 50, 'unit': 'unidad'}).json()
        shift = c.post('/api/cash/sessions', headers=h, json={'openingAmount': 200}).json()
        sale_input = {'idempotencyKey': 'sale-test-123', 'customerId': customer['id'], 'items': [{'productId': product['id'], 'quantity': 3}], 'globalDiscountPercent': 10, 'cashSessionId': shift['id']}
        assert c.post('/api/sales', headers=h, json={**sale_input, 'customerId': foreign['id']}).status_code == 404
        r = c.post('/api/sales', headers=h, json=sale_input); r.raise_for_status(); sale = r.json()
        assert sale['customerId'] == customer['id'] and sale['customerSnapshot']['name'] == 'Ana'
        assert len(c.get('/api/customers/' + customer['id'] + '/history', headers=h).json()['sales']) == 1
        assert c.get('/api/customers/' + customer['id'] + '/history', headers=other).status_code == 404
        draft_input = {'sourceType': 'sale', 'sourceId': sale['id'], 'customerId': customer['id']}
        assert c.post('/api/billing/drafts', headers=other, json=draft_input).status_code == 404
        r = c.post('/api/billing/drafts', headers=h, json=draft_input); r.raise_for_status(); draft = r.json()
        assert draft['status'] == 'draft' and draft['emissionEnabled'] is False
        assert len(c.get('/api/billing/drafts', headers=other).json()) == 0
        c.put('/api/customers/' + customer['id'], headers=h, json={**updated, 'name': 'Ana actualizada'}).raise_for_status()
        assert c.post('/api/billing/drafts', headers=h, json=draft_input).json() == draft
        assert draft['snapshot']['customer']['name'] == 'Ana'
        assert hashlib.sha256(json.dumps(draft['snapshot'], ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest() == draft['snapshotHash']
        assert c.post('/api/sales/' + sale['id'] + '/cancel', headers=h).status_code == 409
        base = '/api/sales/' + sale['id'] + '/returns'
        selection = {'items': [{'itemId': sale['items'][0]['id'], 'quantity': 1, 'restock': True}]}
        def stock():
            return c.get('/api/products', headers=h).json()[0]['stock']
        assert stock() == 7
        assert c.post(base + '/quote', headers=other, json=selection).status_code == 404
        quote = c.post(base + '/quote', headers=h, json=selection).json()
        refund = {**selection, 'idempotencyKey': 'return-test-123', 'cashSessionId': shift['id'], 'reason': 'Producto devuelto', 'expectedTotal': quote['total'], 'payments': [{'method': 'cash', 'amount': quote['total']}]}
        assert c.post(base, headers=h, json={**refund, 'expectedTotal': 9999}).status_code == 409
        assert c.post(base, headers=h, json={**refund, 'payments': [{'method': 'card', 'amount': quote['total']}]}).status_code == 422
        assert stock() == 7
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: c.post(base, headers=h, json=refund), range(2)))
        assert [r.status_code for r in results] == [201, 201], [r.text for r in results]
        assert results[0].json() == results[1].json() and stock() == 8
        assert c.post(base, headers=h, json={**refund, 'reason': 'Otro motivo'}).status_code == 409
        assert c.get('/api/cash/sessions/current', headers=h).json()['expectedAmount'] == round(200 + sale['totalPrice'] - quote['total'], 2)
        assert c.post(base + '/quote', headers=h, json={'items': [{**selection['items'][0], 'quantity': 3}]}).status_code == 409
        second = {'items': [{**selection['items'][0], 'quantity': 2, 'restock': False}]}
        q2 = c.post(base + '/quote', headers=h, json=second).json()
        last = c.post(base, headers=h, json={**refund, **second, 'idempotencyKey': 'return-rest-123', 'expectedTotal': q2['total'], 'payments': [{'method': 'cash', 'amount': q2['total']}]})
        last.raise_for_status()
        final = c.get('/api/sales/' + sale['id'], headers=h).json()
        assert c.get('/api/dashboard', headers=h).json()['revenueToday'] == 0
        assert final['returnedTotal'] == sale['totalPrice'] and final['netTotal'] == 0
        assert final['totalPrice'] == sale['totalPrice'] and final['status'] == 'completed'
        assert stock() == 8  # The two damaged products do not enter sellable stock.
        assert c.get('/api/cash/sessions/current', headers=h).json()['expectedAmount'] == 200
        assert c.post('/api/sales/' + sale['id'] + '/cancel', headers=h).status_code == 409
        # Existing databases apply each migration exactly once.
        with connection() as conn:
            versions = list(conn.execute('SELECT * FROM schema_migrations'))
            migrate(conn)
            assert len(list(conn.execute('SELECT * FROM schema_migrations'))) == len(versions)
        # Delegated read permissions do not authorize writes or fiscal snapshots.
        c.get('/api/subscription', headers=h)
        with connection() as conn:
            conn.execute("UPDATE business_subscriptions SET plan_id='enterprise'")
        role = c.post('/api/custom-roles', headers=h, json={'name': 'Consulta clientes', 'permissions': ['customers.view']}).json()
        c.post('/api/users', headers=h, json={'name': 'Employee', 'email': 'staff@test.local', 'password': 'TestPassword123!', 'role': 'cashier', 'customRoleId': role['id']}).raise_for_status()
        staff = {'Authorization': 'Bearer ' + c.post('/api/auth/login', json={'email': 'staff@test.local', 'password': 'TestPassword123!'}).json()['access_token']}
        assert c.get('/api/customers', headers=staff).status_code == 200
        assert c.post('/api/customers', headers=staff, json={'name': 'No permitido'}).status_code == 403
        assert c.get('/api/customers/' + customer['id'] + '/history', headers=staff).json()['sales'] == []
        assert c.get('/api/billing/drafts', headers=staff).status_code == 403
        assert c.post(base, headers=staff, json=refund).status_code == 403
        fiscal_role = c.post('/api/custom-roles', headers=h, json={'name': 'Facturación de caja', 'permissions': ['billing.manage', 'sales.create']}).json()
        c.post('/api/users', headers=h, json={'name': 'Billing Employee', 'email': 'billing@test.local', 'password': 'TestPassword123!', 'role': 'cashier', 'customRoleId': fiscal_role['id']}).raise_for_status()
        fiscal_staff = {'Authorization': 'Bearer ' + c.post('/api/auth/login', json={'email': 'billing@test.local', 'password': 'TestPassword123!'}).json()['access_token']}
        other_source = {'sourceType': 'sale', 'sourceId': sale['id'], 'customerId': customer['id']}
        assert c.post('/api/billing/drafts', headers=fiscal_staff, json=other_source).status_code == 404
        assert c.get('/api/billing/drafts', headers=fiscal_staff).json() == []
        own_shift = c.post('/api/cash/sessions', headers=fiscal_staff, json={'openingAmount': 0}).json()
        own_sale = c.post('/api/sales', headers=fiscal_staff, json={'idempotencyKey': 'billing-staff-sale', 'cashSessionId': own_shift['id'], 'items': [{'productId': product['id'], 'quantity': 1}]}).json()
        own_draft = c.post('/api/billing/drafts', headers=fiscal_staff, json={**other_source, 'sourceId': own_sale['id']})
        assert own_draft.status_code == 201, own_draft.text
        assert len(c.get('/api/billing/drafts', headers=fiscal_staff).json()) == 1
    print('OK: customer isolation, optimistic edits, fiscal snapshots, partial returns, rounding, concurrent retries, cash and permissions')


if __name__ == '__main__':
    run()
