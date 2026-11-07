"""Payments, cash reconciliation and immutable stay receipts on disposable SQLite."""
import os
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
TEMP = tempfile.TemporaryDirectory(prefix='hotel-payments-')
os.environ['MANAGER_STOCK_DB'] = str(Path(TEMP.name) / 'test.db')
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from fastapi.testclient import TestClient
from backend.main import app, connection

def run():
    with TestClient(app) as c:
        def owner(email):
            result = c.post('/api/auth/register', json={'name':'Hotel Owner','email':email,'password':'TestPassword123!'}).json()
            h = {'Authorization':'Bearer '+result['access_token']}
            c.put('/api/business/config', headers=h, json={'type':'hotel','name':'Hotel Test','features':{'rooms':True,'reservations':True,'inventory':True,'pos':False}}).raise_for_status()
            return h
        h, other = owner('owner@payments.test'), owner('other@payments.test')
        room = c.post('/api/hotel/rooms',headers=h,json={'roomNumber':'01','pricePerNight':100000}).json()
        def reserve(name,start,end,advance=0):
            r=c.post('/api/hotel/reservations',headers=h,json={'roomId':room['id'],'guestName':name,'checkIn':start,'checkOut':end,'advance':advance});r.raise_for_status();return r.json()['id']
        rid=reserve('Ana','2027-01-10','2027-01-12',20000)
        next_rid=reserve('Next guest','2027-01-12','2027-01-13')
        base=f'/api/hotel/reservations/{rid}'
        c.patch(base+'/status',headers=h,json={'status':'checkin'}).raise_for_status()
        product=c.post('/api/products',headers=h,json={'name':'Soda','sku':'SODA','category':'Minibar','price':5000,'cost':2000,'stock':10,'minStock':1,'unit':'unidad'}).json()
        charge={'productId':product['id'],'quantity':2,'idempotencyKey':'charge-key-0001'}
        account=c.post(base+'/charges',headers=h,json=charge).json()
        assert account['balance']==190000,account
        assert c.post(base+'/close',headers=h).status_code==409
        shift=c.post('/api/cash/sessions',headers=h,json={'openingAmount':10000}).json()
        pay={'amount':50000,'method':'cash','reference':'partial','cashSessionId':shift['id'],'idempotencyKey':'payment-key-0001'}
        assert c.post(base+'/payments',headers=other,json=pay).status_code==404
        assert c.post(base+'/payments',headers=h,json={**pay,'cashSessionId':'wrong'}).status_code==409
        assert c.post(base+'/payments',headers=h,json={**pay,'amount':200000}).status_code==422
        assert c.post(base+'/payments',headers=h,json={**pay,'amount':1.001}).status_code==422
        account=c.post(base+'/payments',headers=h,json=pay).json()
        assert account['paidTotal']==50000 and account['balance']==140000,account
        assert len(c.post(base+'/payments',headers=h,json=pay).json()['payments'])==1
        assert c.post(base+'/payments',headers=h,json={**pay,'amount':50001}).status_code==409
        assert c.patch(base+'/status',headers=h,json={'status':'cancelled'}).status_code==409
        for method,amount in [('card',60000),('transfer',50000),('digital',30000)]:
            response=c.post(base+'/payments',headers=h,json={**pay,'amount':amount,'method':method,'idempotencyKey':'payment-key-'+method});response.raise_for_status()
        account=response.json()
        assert account['balance']==0 and account['paidTotal']==190000
        assert c.post(base+'/charges/'+account['charges'][0]['id']+'/cancel',headers=h).status_code==409
        assert c.get('/api/cash/sessions/current',headers=h).json()['expectedAmount']==60000
        closed=c.post(base+'/close',headers=h);closed.raise_for_status();closed=closed.json()
        assert closed['reservation']['status']=='checkout' and closed['receiptId']
        assert closed['receipt']['total']==210000 and len(closed['receipt']['payments'])==4
        assert c.post(base+'/close',headers=h).json()['receipt']==closed['receipt']
        assert len(c.post(base+'/payments',headers=h,json=pay).json()['payments'])==4
        assert c.post(base+'/payments',headers=h,json={**pay,'idempotencyKey':'new-closed-payment'}).status_code==409
        assert c.post(base+'/charges',headers=h,json={**charge,'idempotencyKey':'new-closed-charge'}).status_code==409
        assert c.patch(base+'/status',headers=h,json={'status':'checkin'}).status_code==409
        after_room=c.get('/api/hotel/rooms',headers=h).json()[0]
        assert after_room['status']=='reserved' and after_room['cleaningStatus']=='sucia',after_room
        assert c.get(f'/api/hotel/reservations/{next_rid}/account',headers=h).json()['paidTotal']==0
        result=c.post('/api/cash/sessions/'+shift['id']+'/close',headers=h,json={'closingAmount':59000}).json()
        assert result['expectedAmount']==60000 and result['difference']==-1000,result
        assert c.post(f'/api/hotel/reservations/{next_rid}/payments',headers=h,json=pay).status_code==409
        # Custom hotel managers need cash rights too, even with POS disabled.
        c.get('/api/subscription',headers=h)
        with connection() as conn: conn.execute("UPDATE business_subscriptions SET plan_id='enterprise'")
        def employee(name,permissions):
            role=c.post('/api/custom-roles',headers=h,json={'name':name,'permissions':permissions}).json()
            r=c.post('/api/users',headers=h,json={'name':name,'email':name+'@payments.test','password':'TestPassword123!','role':'cashier','customRoleId':role['id']});r.raise_for_status()
            login=c.post('/api/auth/login',json={'email':name+'@payments.test','password':'TestPassword123!'}).json()
            return {'Authorization':'Bearer '+login['access_token']}
        reader=employee('Reader',['hotel.view'])
        manager=employee('Manager',['hotel.manage'])
        collector=employee('Collector',['hotel.manage','cash.manage'])
        assert c.get(base+'/account',headers=reader).status_code==200
        assert c.post(base+'/close',headers=reader).status_code==403
        assert c.post(base+'/payments',headers=manager,json=pay).status_code==403
        own=c.post('/api/cash/sessions',headers=collector,json={'openingAmount':0});own.raise_for_status();own=own.json()
        next_base=f'/api/hotel/reservations/{next_rid}'
        assert c.post(next_base+'/payments',headers=h,json={**pay,'cashSessionId':own['id']}).status_code==409
        paid=c.post(next_base+'/payments',headers=collector,json={**pay,'cashSessionId':own['id']});paid.raise_for_status()
        assert paid.json()['paidTotal']==50000
        # Concurrent retries create one payment; competing payments cannot overdraw the balance.
        retry={**pay,'amount':10000,'cashSessionId':own['id'],'idempotencyKey':'concurrent-retry'}
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses=list(pool.map(lambda _:c.post(next_base+'/payments',headers=collector,json=retry),range(2)))
        assert [response.status_code for response in responses]==[201,201]
        assert c.get(next_base+'/account',headers=h).json()['paidTotal']==60000
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses=list(pool.map(lambda index:c.post(next_base+'/payments',headers=collector,json={**retry,'amount':30000,'idempotencyKey':'competing-payment-'+str(index)}),range(2)))
        assert sorted(response.status_code for response in responses)==[201,422]
        assert c.get(next_base+'/account',headers=h).json()['balance']==10000
    with TestClient(app) as c:
        assert c.get(base+'/account',headers=h).json()['receipt']==closed['receipt']
    print('OK: partial payments, retry, methods, cash totals, receipt, close, stock, next guest, tenant/user isolation and permissions')

if __name__=='__main__': run()
