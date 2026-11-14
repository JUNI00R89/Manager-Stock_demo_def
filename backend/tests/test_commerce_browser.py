"""Optional browser integration tests. Start API on a disposable DB and Vite first."""
import re
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
import httpx
from playwright.sync_api import sync_playwright, expect

api = httpx.Client(base_url='http://127.0.0.1:8000')
suffix = uuid.uuid4().hex[:8]
today = str(datetime.now(ZoneInfo('America/Bogota')).date())


def tenant(kind, features, food=None):
    auth = api.post('/api/auth/register', json={'name': 'Browser ' + kind, 'email': kind + suffix + '@review.test', 'password': 'TestPassword123!'}).json()
    h = {'Authorization': 'Bearer ' + auth['access_token']}
    config = {'name': 'Review ' + kind, 'type': kind, 'taxRate': 0, 'currency': 'COP', 'features': features}
    if food:
        config['foodConfig'] = food
    response = api.put('/api/business/config', headers=h, json=config)
    assert response.status_code == 200, response.text
    return auth, h


def post(h, path, data):
    response = api.post('/api/' + path, headers=h, json=data)
    response.raise_for_status()
    return response.json()


def product(h, name, category='Bebidas'):
    return post(h, 'products', {'name': name, 'sku': uuid.uuid4().hex[:6], 'category': category, 'price': 100, 'stock': 20, 'minStock': 1})


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    errors = []
    def login(auth, path, mobile=False):
        context = browser.new_context(viewport={'width': 390 if mobile else 1366, 'height': 950}, has_touch=mobile, timezone_id='America/Bogota')
        page = context.new_page(); page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto('http://127.0.0.1:5173/login', wait_until='networkidle')
        page.evaluate('(token) => localStorage.setItem("manager_stock_auth_token", token)', auth['access_token'])
        page.goto('http://127.0.0.1:5173' + path, wait_until='networkidle')
        return page
    def fit(page):
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Page overflows viewport'
    auth, h = tenant('retail', {'pos': True, 'inventory': True, 'warehouse': True})
    prod = product(h, 'Gaseosa prueba')
    shift = post(h, 'cash/sessions', {'openingAmount': 0})
    page = login(auth, '/customers', True)
    page.get_by_role('button', name='Nuevo cliente', exact=True).click()
    page.get_by_label('Nombre o razón social').fill('Ana prueba')
    page.get_by_label('Número', exact=True).fill('12345')
    page.get_by_role('button', name='Guardar cliente', exact=True).click()
    expect(page.get_by_role('heading', name='Ana prueba', exact=True)).to_be_visible()
    fit(page)
    customer = api.get('/api/customers', headers=h).json()[0]
    page.goto('http://127.0.0.1:5173/pos', wait_until='networkidle')
    page.get_by_role('button', name='Agregar a favoritos: Gaseosa prueba').click()
    page.get_by_role('button', name='Favoritos', exact=True).click()
    page.get_by_role('heading', name='Gaseosa prueba', exact=True).click()
    page.get_by_role('button', name='Guardar carrito para después', exact=True).click()
    page.locator('summary').filter(has_text='Carritos guardados').click()
    page.get_by_role('button', name='Recuperar', exact=True).click()
    expect(page.get_by_role('button', name='Guardar carrito para después', exact=True)).to_be_enabled()
    fit(page)
    sale = post(h, 'sales', {'idempotencyKey': 'browser-sale-' + suffix, 'cashSessionId': shift['id'], 'customerId': customer['id'], 'items': [{'productId': prod['id'], 'quantity': 3}]})
    page.goto('http://127.0.0.1:5173/sales/' + sale['id'], wait_until='networkidle')
    page.get_by_label('Devolver Gaseosa prueba', exact=True).fill('1')
    page.get_by_label('Motivo', exact=True).fill('Devolución parcial de prueba')
    page.get_by_role('button', name='Revisar devolución', exact=True).click()
    def lose(route):
        response = route.fetch(); assert response.status == 201; route.abort()
    page.route('**/api/sales/*/returns', lose, times=1)
    page.get_by_role('button', name='Confirmar devolución', exact=True).click()
    page.get_by_role('button', name='Confirmar devolución pendiente', exact=True).click()
    expect(page.get_by_text('Devolución parcial de prueba', exact=True)).to_be_visible()
    assert len(api.get('/api/sales/' + sale['id'], headers=h).json()['returns']) == 1
    fit(page)
    page.goto('http://127.0.0.1:5173/billing', wait_until='networkidle')
    page.get_by_label('Código de la venta o reserva').fill(sale['id'])
    page.get_by_label('Cliente registrado').fill('Ana')
    page.get_by_role('button', name=re.compile('^Ana prueba')).click()
    page.get_by_role('button', name='Conservar borrador', exact=True).click()
    page.get_by_role('button', name='Descargar borrador JSON').wait_for()
    with page.expect_download() as info:
        page.get_by_role('button', name='Descargar borrador JSON').click()
    assert 'internal_preparation' in Path(info.value.path()).read_text()
    page.set_viewport_size({'width': 320, 'height': 950}); fit(page)
    page.screenshot(path='/workspace/output/preparacion-fiscal-mobile.png', full_page=True)
    page.goto('http://127.0.0.1:5173/warehouse/counts', wait_until='networkidle')
    page.get_by_label('Agregar producto', exact=True).select_option(prod['id'])
    page.get_by_label('Cantidad contada de Gaseosa prueba', exact=True).fill('17')
    page.get_by_role('button', name='Enviar a revisión', exact=True).click()
    page.locator('summary').filter(has_text='Pendiente de revisión').click()
    page.get_by_role('button', name='Aprobar y ajustar', exact=True).click()
    page.get_by_role('dialog').get_by_role('button', name='Aprobar y ajustar', exact=True).click()
    expect(page.locator('summary').filter(has_text='Aplicado')).to_be_visible()
    assert api.get('/api/products', headers=h).json()[0]['stock'] == 17
    fit(page)
    print('OK: mobile customers, favorites, suspended carts, lost-response refund, fiscal draft export and count approval', flush=True)

    service_auth, sh = tenant('services', {'pos': False, 'inventory': True, 'services': True, 'reservations': True})
    svc = post(sh, 'services/catalog', {'name': 'Corte agenda', 'price': 100, 'durationMinutes': 30})
    pro = post(sh, 'services/professionals', {'name': 'Ana profesional'})
    appointment = post(sh, 'services/appointments', {'clientName': 'Laura agenda', 'serviceId': svc['id'], 'professionalId': pro['id'], 'appointmentDate': today, 'startTime': '10:15'})
    product(sh, 'Shampoo servicios', 'Productos relacionados')
    post(sh, 'cash/sessions', {'openingAmount': 0})
    agenda = login(service_auth, '/services/appointments')
    handle = agenda.get_by_role('button', name=re.compile('^Mover cita de Laura agenda'))
    handle.scroll_into_view_if_needed()
    target = agenda.locator(f'[data-appointment-date="{today}"][data-appointment-time="11:00"]')
    target.scroll_into_view_if_needed(); source_box = handle.bounding_box(); target_box = target.bounding_box()
    agenda.mouse.move(source_box['x'] + 20, source_box['y'] + 20); agenda.mouse.down()
    agenda.mouse.move(target_box['x'] + target_box['width'] / 2, target_box['y'] + 20, steps=12); agenda.mouse.up()
    agenda.get_by_role('button', name='Confirmar cambio', exact=True).click()
    expect(agenda.locator(f'[data-appointment-date="{today}"][data-appointment-time="11:00"]').get_by_text('Laura agenda', exact=True)).to_be_visible()
    assert api.get('/api/services/appointments', headers=sh).json()[0]['horaInicio'] == '11:00'
    mobile = login(service_auth, '/services/appointments', True)
    mobile.get_by_role('button', name='Día', exact=True).click()
    handle = mobile.get_by_role('button', name=re.compile('^Mover cita de Laura agenda'))
    target = mobile.locator(f'[data-appointment-date="{today}"][data-appointment-time="12:00"]')
    handle.evaluate("el => el.scrollIntoView({block:'center',inline:'center'})"); source_box = handle.bounding_box(); target_box = target.bounding_box()
    cdp = mobile.context.new_cdp_session(mobile)
    sx, sy = source_box['x'] + 20, source_box['y'] + 20
    tx, ty = sx, target_box['y'] + 20
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': sx, 'y': sy}]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': tx, 'y': ty}]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    mobile.get_by_role('button', name='Confirmar cambio', exact=True).click()
    mobile.locator(f'[data-appointment-date="{today}"][data-appointment-time="12:00"]').get_by_text('Laura agenda', exact=True).click()
    mobile.get_by_role('button', name='Finalizar y cobrar', exact=True).click()
    mobile.get_by_text('Agregar productos al cobro', exact=True).click()
    mobile.get_by_label('Cantidad de Shampoo servicios', exact=True).fill('1')
    mobile.get_by_role('button', name='Todo en efectivo', exact=True).click()
    mobile.route('**/api/services/appointments/*/checkout', lose, times=1)
    mobile.get_by_role('button', name='Registrar cobro y finalizar', exact=True).click()
    mobile.get_by_role('button', name='Confirmar cobro pendiente', exact=True).click()
    expect(mobile.get_by_role('heading', name='Comprobante de la cita', exact=True)).to_be_visible()
    assert api.get('/api/cash/sessions/current', headers=sh).json()['expectedAmount'] == 200
    assert api.get('/api/products', headers=sh).json()[0]['stock'] == 19
    fit(mobile)
    print('OK: off-hour appointment, mouse and touch reschedule, service + product checkout and retry without duplicate', flush=True)
    mobile.get_by_label(re.compile('^Importe del servicio a devolver')).fill('50')
    mobile.get_by_label('Motivo', exact=True).fill('Ajuste parcial del servicio')
    mobile.get_by_role('button', name='Revisar devolución', exact=True).click()
    mobile.get_by_role('button', name='Confirmar devolución', exact=True).click()
    expect(mobile.get_by_text('Ajuste parcial del servicio', exact=True)).to_be_visible()
    assert api.get('/api/cash/sessions/current', headers=sh).json()['expectedAmount'] == 150
    assert api.get('/api/products', headers=sh).json()[0]['stock'] == 19

    food_auth, fh = tenant('restaurant', {'pos': True, 'inventory': True, 'tables': True}, {'activeModules': ['menu', 'pedidos', 'caja', 'inventario']})
    table = post(fh, 'tables', {'number': 1})
    meal = product(fh, 'Jugo mesa')
    post(fh, 'cash/sessions', {'openingAmount': 0})
    post(fh, 'orders', {'channel': 'table', 'tableNumber': 1, 'restaurantMetadata': {'mesaId': table['id']}, 'items': [{'productId': meal['id'], 'quantity': 2}]})
    table_page = login(food_auth, '/restaurant/tables', True)
    table_page.get_by_role('button', name='Cobrar mesa', exact=True).click()
    table_page.get_by_label('Efectivo', exact=True).fill('100')
    table_page.get_by_label('Tarjeta', exact=True).fill('100')
    table_page.get_by_role('button', name='Confirmar cobro', exact=True).click()
    expect(table_page.get_by_role('dialog')).to_have_count(0)
    bills = api.get('/api/sales', headers=fh).json()
    assert len(bills) == 1 and bills[0]['totalPrice'] == 200 and bills[0]['paymentMethod'] == 'split'
    assert api.get('/api/cash/sessions/current', headers=fh).json()['expectedAmount'] == 100
    assert api.get('/api/products', headers=fh).json()[0]['stock'] == 18
    fit(table_page)

    hotel_auth, hh = tenant('hotel', {'pos': False, 'inventory': False, 'rooms': True, 'reservations': True})
    room = post(hh, 'hotel/rooms', {'roomNumber': '01', 'pricePerNight': 100})
    tomorrow = str((datetime.now(ZoneInfo('America/Bogota')) + timedelta(days=1)).date())
    post(hh, 'hotel/reservations', {'roomId': room['id'], 'guestName': 'Huésped prueba', 'checkIn': today, 'checkOut': tomorrow})
    hotel = login(hotel_auth, '/hotel/today', True)
    expect(hotel.get_by_role('button', name=re.compile('Hab. 01 · Huésped prueba'))).to_be_visible()
    hotel.set_viewport_size({'width': 320, 'height': 900}); fit(hotel)
    hotel.screenshot(path='/workspace/output/hotel-hoy-mobile.png', full_page=True)
    hotel.get_by_role('button', name=re.compile('Hab. 01 · Huésped prueba')).click()
    expect(hotel.get_by_role('dialog')).to_be_visible(); fit(hotel)
    print('OK: partial service refund, mixed table payment, single inventory deduction and Hotel Today at 320px', flush=True)

    # An ambiguous POS response must survive a reload and retain its original key.
    page.set_viewport_size({'width': 390, 'height': 950})
    page.goto('http://127.0.0.1:5173/pos', wait_until='networkidle')
    page.get_by_role('heading', name='Gaseosa prueba', exact=True).click()
    page.get_by_role('button', name='Efectivo', exact=True).click()
    page.get_by_label('Efectivo recibido', exact=True).fill('100')
    page.route('**/api/sales', lose, times=1)
    page.route('**/api/sales/by-key/*', lambda route: route.abort(), times=1)
    page.get_by_role('button', name=re.compile('^Cobrar ')).click()
    page.get_by_role('button', name='Confirmar venta pendiente', exact=True).wait_for()
    page.reload(wait_until='networkidle')
    page.get_by_role('button', name='Confirmar venta pendiente', exact=True).click()
    expect(page.get_by_text(re.compile('^Comprobante interno:'))).to_be_visible()
    assert len(api.get('/api/sales', headers=h).json()) == 2
    assert api.get('/api/products', headers=h).json()[0]['stock'] == 16
    print('OK: POS recovery after lost POST/lookup responses and page reload', flush=True)
    assert not errors, errors
    browser.close()
