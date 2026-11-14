"""Service payments, professional availability and reviewed counts, including concurrency."""
import os
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
TEMP = tempfile.TemporaryDirectory(prefix='operations-')
os.environ['MANAGER_STOCK_DB'] = str(Path(TEMP.name) / 'test.db')
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from fastapi.testclient import TestClient
from backend.main import app, connection, delete_business_type_data
from backend.backups import create_backup, restore_backup, verify, backup_if_due


def run():
    with TestClient(app) as c:
        account = c.post('/api/auth/register', json={'name': 'Owner', 'email': 'operations@test.local', 'password': 'TestPassword123!'}).json()
        h = {'Authorization': 'Bearer ' + account['access_token']}
        c.put('/api/business/config', headers=h, json={'type': 'services', 'name': 'Salon', 'taxRate': 0, 'features': {'inventory': True, 'services': True, 'reservations': True, 'pos': False, 'warehouse': True}}).raise_for_status()
        def post(path, data):
            r = c.post('/api/' + path, headers=h, json=data); r.raise_for_status(); return r.json()
        svc = post('services/catalog', {'name': 'Corte', 'durationMinutes': 30, 'price': 100})
        pro = post('services/professionals', {'name': 'Ana'})
        schedule = {'availability': [{'dia': 1, 'inicio': '09:00', 'fin': '12:00'}, {'dia': 1, 'inicio': '14:00', 'fin': '18:00'}], 'daysOff': ['2026-11-16'], 'bufferMinutes': 15, 'revision': 1}
        r = c.put('/api/services/professionals/' + pro['id'] + '/schedule', headers=h, json=schedule); r.raise_for_status()
        assert c.put('/api/services/professionals/' + pro['id'] + '/schedule', headers=h, json=schedule).status_code == 409
        apt_input = {'serviceId': svc['id'], 'professionalId': pro['id'], 'clientName': 'Laura', 'appointmentDate': '2026-11-09', 'startTime': '10:00'}
        for values in [{'startTime': '12:30'}, {'appointmentDate': '2026-11-10'}, {'appointmentDate': '2026-11-16'}, {'startTime': '17:30'}]:
            assert c.post('/api/services/appointments', headers=h, json={**apt_input, **values}).status_code == (409 if values.get('appointmentDate') == '2026-11-16' else 422)
        appointment = post('services/appointments', apt_input)
        assert c.post('/api/services/appointments', headers=h, json={**apt_input, 'startTime': '10:30'}).status_code == 409
        second = post('services/appointments', {**apt_input, 'startTime': '11:00'})
        move = {'professionalId': pro['id'], 'appointmentDate': '2026-11-09', 'startTime': '14:00', 'expectedProfessionalId': pro['id'], 'expectedDate': '2026-11-09', 'expectedStartTime': '10:00', 'expectedEndTime': '10:30'}
        with connection() as conn:
            conn.execute('UPDATE service_catalog SET duration_minutes=45,price=999 WHERE id=?', (svc['id'],))
        base = '/api/services/appointments/' + appointment['id']
        edited = c.put(base, headers=h, json={**apt_input, 'clientName': 'Laura actualizada'}); edited.raise_for_status()
        assert edited.json()['price'] == 100 and edited.json()['durationMinutes'] == 30
        moved = c.patch(base + '/schedule', headers=h, json=move); moved.raise_for_status()
        assert moved.json()['price'] == 100 and moved.json()['horaFin'] == '14:30'
        assert c.patch(base + '/schedule', headers=h, json=move).json() == moved.json()
        assert c.patch(base + '/schedule', headers=h, json={**move, 'startTime': '15:00'}).status_code == 409
        product = post('products', {'name': 'Shampoo', 'sku': 'SH', 'category': 'Productos relacionados', 'price': 50, 'cost': 20, 'stock': 10, 'minStock': 1})
        shift = post('cash/sessions', {'openingAmount': 10})
        checkout = {'idempotencyKey': 'appointment-payment-1', 'cashSessionId': shift['id'], 'items': [{'productId': product['id'], 'quantity': 1}], 'payments': [{'method': 'cash', 'amount': 50}, {'method': 'card', 'amount': 100}]}
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: c.post(base + '/checkout', headers=h, json=checkout), range(2)))
        assert [r.status_code for r in results] == [201, 201], [r.text for r in results]
        assert results[0].json()['id'] == results[1].json()['id']
        receipt = results[0].json()
        assert receipt['totalPrice'] == 150 and len(receipt['items']) == 2
        assert c.get('/api/cash/sessions/current', headers=h).json()['expectedAmount'] == 60
        assert c.get('/api/products', headers=h).json()[0]['stock'] == 9
        assert c.get(base + '/receipt', headers=h).json()['id'] == receipt['id']
        service_refund = {'idempotencyKey': 'service-refund-1', 'cashSessionId': shift['id'], 'items': [], 'serviceAmount': 50, 'expectedTotal': 50, 'reason': 'Ajuste del servicio', 'payments': [{'method': 'card', 'amount': 50}]}
        assert c.post(base + '/returns/quote', headers=h, json={'serviceAmount': 50}).json()['total'] == 50
        with ThreadPoolExecutor(max_workers=2) as pool:
            refunds = list(pool.map(lambda _: c.post(base + '/returns', headers=h, json=service_refund), range(2)))
        assert [r.status_code for r in refunds] == [201, 201], [r.text for r in refunds]
        after_refund = c.get(base + '/receipt', headers=h).json()
        assert after_refund['returnableServiceAmount'] == 50 and after_refund['netTotal'] == 100
        assert c.post(base + '/returns/quote', headers=h, json={'serviceAmount': 51}).status_code == 422
        assert c.get('/api/cash/sessions/current', headers=h).json()['expectedAmount'] == 60
        assert c.post(base + '/checkout', headers=h, json={**checkout, 'idempotencyKey': 'duplicate-checkout-2'}).status_code == 409
        assert c.patch(base + '/status', headers=h, json={'status': 'cancelled'}).status_code == 409
        assert c.put(base, headers=h, json=apt_input).status_code == 409
        assert c.delete(base, headers=h).status_code == 409
        # Changing the business type must retain paid service history.
        with connection() as conn:
            delete_business_type_data(conn, account['user']['businessId'], 'services')
            assert conn.execute('SELECT sale_id FROM service_appointments WHERE id=?', (appointment['id'],)).fetchone()[0] == receipt['id']
        descriptor = c.get('/api/inventory/count-products', headers=h).json()[0]
        assert 'stock' not in descriptor
        count_input = {'idempotencyKey': 'count-reviewed-1', 'items': [{'productId': product['id'], 'countedQuantity': 8, 'expectedMovementId': descriptor['movementId']}]}
        review = post('inventory/count-reviews', count_input)
        assert review['status'] == 'open' and c.get('/api/products', headers=h).json()[0]['stock'] == 9
        assert post('inventory/count-reviews', count_input)['id'] == review['id']
        approval = '/api/inventory/count-reviews/' + review['id'] + '/approve'
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: c.post(approval, headers=h), range(2)))
        assert [r.status_code for r in results] == [200, 200]
        assert c.get('/api/products', headers=h).json()[0]['stock'] == 8
        assert c.post('/api/inventory/count-reviews', headers=h, json={**count_input, 'idempotencyKey': 'stale-count-2'}).status_code == 409
        descriptor = c.get('/api/inventory/count-products', headers=h).json()[0]
        waiting = post('inventory/count-reviews', {'idempotencyKey': 'count-waiting-1', 'items': [{'productId': product['id'], 'countedQuantity': 7, 'expectedMovementId': descriptor['movementId']}]})
        assert c.post('/api/services/appointments/' + second['id'] + '/checkout', headers=h, json=checkout).status_code == 409
        post('services/appointments/' + second['id'] + '/checkout', {**checkout, 'idempotencyKey': 'second-service-pay'})
        assert c.post('/api/inventory/count-reviews/' + waiting['id'] + '/approve', headers=h).status_code == 409
        assert c.get('/api/products', headers=h).json()[0]['stock'] == 7
        c.get('/api/subscription', headers=h)
        with connection() as conn:
            conn.execute("UPDATE business_subscriptions SET plan_id='enterprise'")
        role = post('custom-roles', {'name': 'Contador físico', 'permissions': ['inventory.count']})
        post('users', {'name': 'Counter', 'email': 'count@test.local', 'password': 'TestPassword123!', 'role': 'cashier', 'customRoleId': role['id']})
        token = c.post('/api/auth/login', json={'email': 'count@test.local', 'password': 'TestPassword123!'}).json()['access_token']
        counter = {'Authorization': 'Bearer ' + token}
        assert c.get('/api/inventory/count-products', headers=counter).status_code == 200
        hidden = c.get('/api/inventory/count-reviews', headers=counter).json()
        assert all(item['systemQuantity'] is None and item['difference'] is None for r in hidden for item in r['items'])
        assert c.post(approval, headers=counter).status_code == 403
        assert c.get('/api/products', headers=counter).status_code == 403
        # Verify a real restore into a separate file, then refuse overwrite.
        backup = create_backup(Path(os.environ['MANAGER_STOCK_DB']), Path(TEMP.name) / 'copies')
        restored = restore_backup(backup, Path(TEMP.name) / 'restored.db')
        verify(restored)
        os.environ['MANAGER_STOCK_BACKUP_DIR'] = str(backup.parent)
        assert backup_if_due(Path(os.environ['MANAGER_STOCK_DB'])) is None
        assert backup_if_due(restored) is not None  # A different source in the same directory still gets a copy.
        del os.environ['MANAGER_STOCK_BACKUP_DIR']
        try:
            restore_backup(backup, restored)
            raise AssertionError('Restore overwrote an existing database')
        except FileExistsError:
            pass
    print('OK: service checkout, schedule and buffer, rescheduling, cash, retention, blind counts, approval races and verified restore')


if __name__ == '__main__':
    run()
