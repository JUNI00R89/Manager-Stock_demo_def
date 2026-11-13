"""Optional UI regression: start Vite and API against a disposable database first."""
import httpx,os,uuid
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
from playwright.sync_api import sync_playwright
api=httpx.Client(base_url='http://127.0.0.1:8000')
key=uuid.uuid4().hex[:8]
auth=api.post('/api/auth/register',json={'name':'Calendar Hotel','email':key+'@calendar.test','password':'TestPassword123!'}).json()
h={'Authorization':'Bearer '+auth['access_token']}
api.put('/api/business/config',headers=h,json={'type':'hotel','name':'Calendar Hotel','features':{'rooms':True,'reservations':True,'inventory':True,'pos':False}}).raise_for_status()
rooms=[api.post('/api/hotel/rooms',headers=h,json={'roomNumber':number,'pricePerNight':price}).json() for number,price in [('01',100),('02',300)]]
today=datetime.now(ZoneInfo('America/Bogota')).date()
def reserve(name,offset):
 r=api.post('/api/hotel/reservations',headers=h,json={'roomId':rooms[0]['id'],'guestName':name,'checkIn':str(today+timedelta(days=offset)),'checkOut':str(today+timedelta(days=offset+2))});r.raise_for_status();return r.json()
reservation=reserve('Mouse Guest',1)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH') or None,headless=True,args=['--no-sandbox'])
 context=b.new_context(viewport={'width':1366,'height':1000},timezone_id='America/Bogota')
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def login(page):
  page.goto('http://127.0.0.1:5173/login',wait_until='networkidle');page.evaluate('(token)=>localStorage.setItem("manager_stock_auth_token",token)',auth['access_token']);page.goto('http://127.0.0.1:5173/hotel/availability',wait_until='networkidle')
 login(page)
 handle=page.get_by_role('button',name='Mover reserva de Mouse Guest',exact=True);handle.scroll_into_view_if_needed();box=handle.bounding_box()
 row2=page.locator('[data-calendar-row="'+rooms[1]['id']+'"]').bounding_box()
 x,y=box['x']+22,box['y']+24
 page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+88,row2['y']+32,steps=8);page.mouse.up()
 page.get_by_role('button',name='Guardar movimiento',exact=True).click()
 handle.wait_for()
 moved=api.get('/api/hotel/reservations',headers=h).json();moved=next(r for r in moved if r['id']==reservation['id'])
 assert moved['roomId']==rooms[1]['id'] and moved['checkIn']==str(today+timedelta(days=2)) and moved['totalCharges']==200,moved
 # Keyboard movement, cancel and persistence after reload.
 handle.focus();page.keyboard.press('Space');page.keyboard.press('ArrowRight');page.keyboard.press('Escape')
 assert page.get_by_role('button',name='Guardar movimiento',exact=True).count()==0
 handle.focus();page.keyboard.press('Space');page.keyboard.press('ArrowRight');page.keyboard.press('Enter');page.get_by_role('button',name='Guardar movimiento',exact=True).click()
 page.reload(wait_until='networkidle');handle.wait_for()
 moved=next(r for r in api.get('/api/hotel/reservations',headers=h).json() if r['id']==reservation['id'])
 assert moved['checkIn']==str(today+timedelta(days=3)),moved
 # Real touch events on a mobile viewport, not synthetic drag/drop.
 mobile=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1,timezone_id='America/Bogota')
 touchpage=mobile.new_page();touch=reserve('Touch Guest',0);login(touchpage)
 handle=touchpage.get_by_role('button',name='Mover reserva de Touch Guest',exact=True);handle.scroll_into_view_if_needed();box=handle.bounding_box();row2=touchpage.locator('[data-calendar-row="'+rooms[1]['id']+'"]').bounding_box()
 x,y=box['x']+22,box['y']+24;tx,ty=x+88,row2['y']+32
 cdp=mobile.new_cdp_session(touchpage)
 cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
 for step in range(1,9):cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+(tx-x)*step/8,'y':y+(ty-y)*step/8}]})
 cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
 touchpage.get_by_role('button',name='Guardar movimiento',exact=True).click()
 touchpage.get_by_role('button',name='Mover reserva de Touch Guest',exact=True).wait_for()
 moved=next(r for r in api.get('/api/hotel/reservations',headers=h).json() if r['id']==touch['id'])
 assert moved['roomId']==rooms[1]['id'] and moved['checkIn']==str(today+timedelta(days=1)),moved
 assert touchpage.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Page overflow on mobile'
 print('OK: mouse, touch and keyboard moves; cancel; preserved price; mobile calendar without page overflow')
 # Refund a settled account, simulate a lost server response, and verify report/download on mobile.
 base='/api/hotel/reservations/'+touch['id']
 api.patch(base+'/status',headers=h,json={'status':'checkin'}).raise_for_status()
 shift=api.post('/api/cash/sessions',headers=h,json={'openingAmount':0}).json()
 api.post(base+'/payments',headers=h,json={'amount':200,'method':'cash','cashSessionId':shift['id'],'idempotencyKey':'browser-paid-'+key}).raise_for_status()
 api.post(base+'/close',headers=h).raise_for_status()
 touchpage.goto('http://127.0.0.1:5173/hotel/rooms',wait_until='networkidle')
 touchpage.get_by_role('button',name='Cuenta y consumos').click()
 touchpage.get_by_label('Estancia / huésped').select_option(touch['id'])
 account=api.get(base+'/account',headers=h).json()
 touchpage.get_by_label('Pago a devolver',exact=True).select_option(account['payments'][0]['id'])
 touchpage.get_by_label('Importe a devolver',exact=True).fill('50')
 touchpage.get_by_label('Motivo de devolución',exact=True).fill('Descuento acordado')
 def lose(route):
  response=route.fetch();assert response.status==201;route.abort()
 touchpage.route('**/api/hotel/reservations/*/refunds',lose,times=1)
 touchpage.get_by_role('button',name='Revisar devolución',exact=True).click()
 touchpage.get_by_role('button',name='Confirmar devolución',exact=True).click()
 touchpage.get_by_role('button',name='Confirmar devolución',exact=True).wait_for(state='visible')
 touchpage.get_by_role('button',name='Confirmar devolución',exact=True).click()
 touchpage.get_by_role('button',name='Comprobante de devolución',exact=True).wait_for()
 account=api.get(base+'/account',headers=h).json();assert len(account['refunds'])==1 and account['refundedTotal']==50 and account['balance']==0,account
 assert api.get('/api/cash/sessions/current',headers=h).json()['expectedAmount']==150
 with touchpage.expect_download() as info:touchpage.get_by_role('button',name='Comprobante de devolución',exact=True).click()
 assert 'Descuento acordado' in Path(info.value.path()).read_text(encoding='utf-8')
 touchpage.goto('http://127.0.0.1:5173/hotel/income',wait_until='networkidle')
 touchpage.get_by_text('Ingreso neto',exact=True).wait_for()
 assert touchpage.evaluate("new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP'}).format(150)") in touchpage.locator('body').inner_text(), touchpage.locator('body').inner_text()
 with touchpage.expect_download() as info:touchpage.get_by_role('button',name='Exportar CSV',exact=True).click()
 csv=Path(info.value.path()).read_text(encoding='utf-8');assert 'Devolución' in csv and '-50.00' in csv,csv
 assert touchpage.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Report overflow on mobile'
 touchpage.set_viewport_size({'width':320,'height':740})
 assert touchpage.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Report overflow at 320px'
 assert not errors,errors
 print('OK: mobile refund, lost-response retry without duplicate, cash adjustment, refund receipt and income report CSV')
 b.close()
