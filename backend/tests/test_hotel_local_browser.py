"""Optional desktop browser regression: requires Vite and Playwright/Chromium."""
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page();page.goto('http://127.0.0.1:5173/login',wait_until='networkidle')
 result=page.evaluate('''async()=>{
 window.managerStockDesktop={isDesktop:true};
 localStorage.setItem('manager_stock_desktop_user',JSON.stringify({id:'owner',businessId:'calendar-refund-local',role:'owner'}));
 const {desktop}=await import('/src/app/services/desktop.ts');
 const {dataService:d,createHotelReservation,moveHotelReservation,addHotelPayment,refundHotelPayment,closeHotelAccount,getHotelAccount,getHotelIncomeReport,updateHotelReservationStatus}=await import('/src/app/services/dataService.ts');
 const a=await desktop.hotel.createRoom({roomNumber:'01',pricePerNight:100});
 const b=await desktop.hotel.createRoom({roomNumber:'02',pricePerNight:300});
 const r=await createHotelReservation({roomId:a.id,guestName:'Ana',checkIn:'2027-01-10',checkOut:'2027-01-12'});
 const schedule={roomId:b.id,checkIn:'2027-01-11',expectedRoomId:a.id,expectedCheckIn:r.checkIn,expectedCheckOut:r.checkOut};
 const moved=await moveHotelReservation(r.id,schedule);await moveHotelReservation(r.id,schedule);
 if(moved.totalCharges!==200 || moved.roomId!==b.id || moved.checkOut!=='2027-01-13')throw Error('Incorrect move');
 let rejected=0;
 try{await createHotelReservation({roomId:b.id,guestName:'Other',checkIn:'2027-01-12',checkOut:'2027-01-14'});}catch{rejected++;}
 try{await moveHotelReservation(r.id,{...schedule,checkIn:'2027-01-15'});}catch{rejected++;}
 await updateHotelReservationStatus(r.id,'checkin');
 try{await moveHotelReservation(r.id,schedule);}catch{rejected++;}
 const shift=await d.openCashSession(10,'Owner');
 const paid=await addHotelPayment(r.id,{amount:200,method:'cash',reference:'Pago',cashSessionId:shift.id,idempotencyKey:'local-payment-request'});
 const receipt=(await closeHotelAccount(r.id)).receipt;
 const input={paymentId:paid.payments[0].id,amount:50,cashSessionId:shift.id,reason:'Descuento acordado',idempotencyKey:'local-refund-request'};
 await Promise.all([refundHotelPayment(r.id,input),refundHotelPayment(r.id,input)]);
 try{await refundHotelPayment(r.id,{...input,amount:51});}catch(e){if(e.status===409)rejected++;}
 try{await refundHotelPayment(r.id,{...input,amount:151,idempotencyKey:'excessive-refund'});}catch(e){if(e.status===422)rejected++;}
 const account=await getHotelAccount(r.id);
 if(JSON.stringify(account.receipt)!==JSON.stringify(receipt))throw Error('Receipt changed');
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota'}).format(new Date());
 const report=await getHotelIncomeReport(day,day);
 const expected=(await d.getCurrentCashSession()).expectedAmount;
 const closed=await d.closeCashSession(shift.id,160);
 localStorage.setItem('test-reservation-id',r.id);
 return {rejected,refunds:account.refunds.length,net:account.netPaidTotal,balance:account.balance,expected,difference:closed.difference,gross:report.gross,refunded:report.refunded,reportNet:report.net};
 }''')
 assert result=={'rejected':5,'refunds':1,'net':150,'balance':0,'expected':160,'difference':0,'gross':200,'refunded':50,'reportNet':150},result
 page.reload(wait_until='networkidle')
 result=page.evaluate('''async()=>{window.managerStockDesktop={isDesktop:true};const {getHotelAccount}=await import('/src/app/services/dataService.ts');const a=await getHotelAccount(localStorage.getItem('test-reservation-id'));return {date:a.reservation.checkIn,refunds:a.refunds.length,net:a.netPaidTotal};}''')
 assert result=={'date':'2027-01-11','refunds':1,'net':150},result
 print('OK: local schedule, overlap/stale/checkin guards, concurrent refund retry, limits, preserved closed receipt, cash, report and persistence')
 b.close()
