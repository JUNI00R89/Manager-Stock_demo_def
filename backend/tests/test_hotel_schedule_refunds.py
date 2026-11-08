"""Atomic calendar moves, refunds and hotel income accounting on disposable SQLite."""
import os
import sys
import tempfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from zoneinfo import ZoneInfo
TEMP=tempfile.TemporaryDirectory(prefix='hotel-schedule-refunds-')
os.environ['MANAGER_STOCK_DB']=str(Path(TEMP.name)/'test.db')
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from fastapi.testclient import TestClient
from backend.main import app,connection

def run():
    with TestClient(app) as c:
        def owner(name):
            r=c.post('/api/auth/register',json={'name':name,'email':name+'@test.local','password':'TestPassword123!'}).json()
            h={'Authorization':'Bearer '+r['access_token']}
            c.put('/api/business/config',headers=h,json={'type':'hotel','name':'Hotel','features':{'rooms':True,'reservations':True,'pos':False,'inventory':True}}).raise_for_status()
            return h
        h,other=owner('Owner'),owner('Other')
        def room(number,price,auth=h):
            r=c.post('/api/hotel/rooms',headers=auth,json={'roomNumber':number,'pricePerNight':price});r.raise_for_status();return r.json()['id']
        a,b,foreign=room('01',100),room('02',300),room('03',100,other)
        def reserve(room_id,start,end,name='Ana'):
            r=c.post('/api/hotel/reservations',headers=h,json={'roomId':room_id,'guestName':name,'checkIn':start,'checkOut':end});r.raise_for_status();return r.json()['id']
        rid=reserve(a,'2027-11-10','2027-11-12')
        reserve(b,'2027-11-14','2027-11-16','Other guest')
        base=f'/api/hotel/reservations/{rid}'
        move={'roomId':b,'checkIn':'2027-11-12','expectedRoomId':a,'expectedCheckIn':'2027-11-10','expectedCheckOut':'2027-11-12'}
        assert c.patch(base+'/schedule',headers=other,json=move).status_code==404
        assert c.patch(base+'/schedule',headers=h,json={**move,'roomId':foreign}).status_code==404
        assert c.patch(base+'/schedule',headers=h,json={**move,'checkIn':'2027-11-13'}).status_code==409
        assert c.patch(base+'/schedule',headers=h,json={**move,'checkIn':'invalid'}).status_code==422
        moved=c.patch(base+'/schedule',headers=h,json=move);moved.raise_for_status();moved=moved.json()
        assert moved['roomId']==b and moved['checkOut']=='2027-11-14' and moved['totalCharges']==200
        assert c.patch(base+'/schedule',headers=h,json=move).json()==moved
        assert c.patch(base+'/schedule',headers=h,json={**move,'checkIn':'2027-11-17'}).status_code==409
        rooms={r['id']:r for r in c.get('/api/hotel/rooms',headers=h).json()}
        assert rooms[a]['status']=='available' and rooms[b]['status']=='reserved'
        # Two moves into the same free room/dates cannot both win.
        second=reserve(a,'2027-11-20','2027-11-22')
        third=reserve(a,'2027-11-23','2027-11-25')
        def competing(item):
            rid,date=item
            return c.patch(f'/api/hotel/reservations/{rid}/schedule',headers=h,json={'roomId':b,'checkIn':'2027-11-26','expectedRoomId':a,'expectedCheckIn':date,'expectedCheckOut':'2027-11-'+('22' if rid==second else '25')})
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(competing,[(second,'2027-11-20'),(third,'2027-11-23')]))
        assert sorted(r.status_code for r in results)==[200,409]
        c.patch(base+'/status',headers=h,json={'status':'checkin'}).raise_for_status()
        assert c.patch(base+'/schedule',headers=h,json=move).status_code==409
        shift=c.post('/api/cash/sessions',headers=h,json={'openingAmount':10}).json()
        def pay(amount,method,key):
            r=c.post(base+'/payments',headers=h,json={'amount':amount,'method':method,'cashSessionId':shift['id'],'idempotencyKey':key});r.raise_for_status();return next(p for p in r.json()['payments'] if p['idempotencyKey']==key)
        cash,card=pay(140,'cash','cash-payment-1'),pay(60,'card','card-payment-1')
        refund={'paymentId':cash['id'],'cashSessionId':shift['id'],'amount':50,'reason':'Corrección del cobro','idempotencyKey':'cash-refund-1'}
        assert c.post(base+'/refunds',headers=other,json=refund).status_code==404
        assert c.post(base+'/refunds',headers=h,json={**refund,'paymentId':'missing'}).status_code==404
        assert c.post(base+'/refunds',headers=h,json={**refund,'reason':'  '}).status_code==422
        result=c.post(base+'/refunds',headers=h,json=refund);result.raise_for_status();result=result.json()
        assert result['paidTotal']==200 and result['netPaidTotal']==150 and result['balance']==50
        assert c.get('/api/cash/sessions/current',headers=h).json()['expectedAmount']==100
        assert c.post(base+'/close',headers=h).status_code==409
        assert len(c.post(base+'/refunds',headers=h,json=refund).json()['refunds'])==1
        assert c.post(base+'/refunds',headers=h,json={**refund,'amount':51}).status_code==409
        assert c.post(base+'/refunds',headers=h,json={**refund,'amount':91,'idempotencyKey':'too-much-refund'}).status_code==422
        pay(50,'cash','replacement-payment')
        receipt=c.post(base+'/close',headers=h).json()['receipt']
        assert receipt['netPaidTotal']==200 and receipt['refundedTotal']==50
        card_refund={**refund,'paymentId':card['id'],'amount':20,'idempotencyKey':'card-refund-1'}
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:c.post(base+'/refunds',headers=h,json=card_refund),range(2)))
        assert [r.status_code for r in results]==[201,201]
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda n:c.post(base+'/refunds',headers=h,json={**card_refund,'amount':30,'idempotencyKey':'competing-refund-'+str(n)}),range(2)))
        assert sorted(r.status_code for r in results)==[201,422]
        result=c.get(base+'/account',headers=h).json()
        assert result['refundedTotal']==100 and result['netPaidTotal']==150 and result['balance']==0
        assert result['receipt']==receipt and result['reservation']['status']=='checkout'
        assert c.get('/api/cash/sessions/current',headers=h).json()['expectedAmount']==150
        day=datetime.now(ZoneInfo('America/Bogota')).date().isoformat()
        url=f'/api/hotel/reports/income?start={day}&end={day}'
        report=c.get(url,headers=h);report.raise_for_status();report=report.json()
        assert (report['gross'],report['refunded'],report['net'])==(250,100,150),report
        assert len(report['transactions'])==6
        assert c.get(url,headers=other).json()['net']==0
        assert c.get('/api/hotel/reports/income?start=2027-01-01&end=2026-01-01',headers=h).status_code==422
        closed=c.post('/api/cash/sessions/'+shift['id']+'/close',headers=h,json={'closingAmount':150}).json()
        assert closed['difference']==0
        assert c.post(base+'/refunds',headers=h,json=refund).status_code==201
        new_shift=c.post('/api/cash/sessions',headers=h,json={'openingAmount':0}).json()
        assert c.post(base+'/refunds',headers=h,json={**refund,'amount':1,'cashSessionId':new_shift['id'],'idempotencyKey':'insufficient-cash'}).status_code==409
        # Report boundaries use Colombia time, including movements before 05:00 UTC.
        with connection() as conn:conn.execute("UPDATE hotel_payments SET created_at='2027-03-01 04:59:59' WHERE id=?",(cash['id'],))
        assert c.get('/api/hotel/reports/income?start=2027-02-28&end=2027-02-28',headers=h).json()['gross']==140
        assert c.get('/api/hotel/reports/income?start=2027-03-01&end=2027-03-01',headers=h).json()['gross']==0
        c.get('/api/subscription',headers=h)
        with connection() as conn:conn.execute("UPDATE business_subscriptions SET plan_id='enterprise'")
        def employee(name,permissions):
            role=c.post('/api/custom-roles',headers=h,json={'name':name,'permissions':permissions}).json()
            c.post('/api/users',headers=h,json={'name':name,'email':name+'@test.local','password':'TestPassword123!','role':'cashier','customRoleId':role['id']}).raise_for_status()
            login=c.post('/api/auth/login',json={'email':name+'@test.local','password':'TestPassword123!'}).json()
            return {'Authorization':'Bearer '+login['access_token']}
        reader=employee('Reader',['hotel.view'])
        reporter=employee('Reporter',['hotel.view','reports.view'])
        assert c.patch(base+'/schedule',headers=reader,json=move).status_code==403
        assert c.post(base+'/refunds',headers=reader,json=refund).status_code==403
        assert c.get(url,headers=reader).status_code==403
        assert c.get(url,headers=reporter).status_code==200
    print('OK: calendar moves, conflicts, concurrent bookings/refunds, preserved price, partial refunds, closed receipts, cash, reports, timezone and permissions')

if __name__=='__main__':run()
