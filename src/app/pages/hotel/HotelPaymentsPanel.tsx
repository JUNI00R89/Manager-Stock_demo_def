import { HotelRefundsPanel } from './HotelRefundsPanel';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { ConfirmActionDialog } from '../../components/ConfirmActionDialog';
import { addHotelPayment, closeHotelAccount, dataService, type CashSessionRecord, type HotelAccount, type HotelPaymentInput, type PaymentPartMethod } from '../../services/dataService';
import { downloadHotelReceipt } from '../../utils/hotelReceipt';
import { useAuth } from '../../context/AuthContext';
import { uniqueRestaurantId } from '../../utils/restaurantStorage';
const money=(v:number)=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP'}).format(v);
const methods: Record<PaymentPartMethod,string> = {cash:'Efectivo',card:'Tarjeta',transfer:'Transferencia',digital:'Pago digital'};

export function HotelPaymentsPanel({account,canCollect,busy,onBusy,onAccount,onSaved}:{account:HotelAccount;canCollect:boolean;busy:boolean;onBusy:(value:boolean)=>void;onAccount:(account:HotelAccount)=>void;onSaved:()=>void}) {
  const {user}=useAuth();
  const submitting=useRef(false);
  const [session,setSession]=useState<CashSessionRecord|null>(null);
  const [amount,setAmount]=useState('');
  const [method,setMethod]=useState<PaymentPartMethod>('cash');
  const [reference,setReference]=useState('');
  const [cashAmount,setCashAmount]=useState('0');
  const [error,setError]=useState('');
  const [pending,setPending]=useState<HotelPaymentInput|null>(null);
  const [pendingRefund,setPendingRefund]=useState(false);
  const [confirm,setConfirm]=useState<'account'|'shift'|null>(null);
  const id=account.reservation.id;
  const key=`hotel-pending-payment:${user?.businessId}:${id}`;
  const refresh=async()=>{setSession(await dataService.getCurrentCashSession());};
  useEffect(()=>{
    let active=true;
    if(canCollect) dataService.getCurrentCashSession().then(value=>{if(active)setSession(value);}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[canCollect,id]);
  useEffect(()=>{
    let stored:HotelPaymentInput|null=null;
    try{stored=JSON.parse(sessionStorage.getItem(key)||'null');}catch{/* no request */}
    if(stored && account.payments.some(p=>p.idempotencyKey===stored!.idempotencyKey)){sessionStorage.removeItem(key);stored=null;}
    setPending(stored);
  },[key,account.payments]);
  const run=async(action:()=>Promise<void>)=>{if(busy||submitting.current)return;submitting.current=true;onBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:'No se pudo completar la operación.');throw e;}finally{submitting.current=false;onBusy(false);}};
  const open=()=>run(async()=>{setSession(await dataService.openCashSession(Number(cashAmount),user?.name||''));});
  const pay=()=>run(async()=>{
    const input=pending||{amount:Number(amount),method,reference:reference.trim(),cashSessionId:session?.id||'',idempotencyKey:uniqueRestaurantId('hotel')};
    if(!input.cashSessionId)throw new Error('Abre un turno de caja.');
    if(!Number.isFinite(input.amount)||input.amount<=0)throw new Error('Ingresa un importe mayor que cero.');
    sessionStorage.setItem(key,JSON.stringify(input));setPending(input);
    try{
      const updated=await addHotelPayment(id,input);onAccount(updated);sessionStorage.removeItem(key);setPending(null);setAmount('');setReference('');onSaved();await refresh();
    }catch(e){const status=(e as {status?:number}).status;if(status&&status>=400&&status<500){sessionStorage.removeItem(key);setPending(null);}throw e;}
  });
  const finish=()=>run(async()=>{
    if(confirm==='account'){onAccount(await closeHotelAccount(id));onSaved();}
    else if(session){await dataService.closeCashSession(session.id,Number(cashAmount));setSession(null);setCashAmount('0');}
  });
  return <section className="space-y-3 rounded-xl border p-4">
    <h3 className="font-semibold">Pagos y cierre de cuenta</h3>
    <p className="text-sm">Abonos registrados: <strong>{money(account.paidTotal)}</strong></p>
    {account.advance>0&&<p className="text-xs text-muted-foreground">El anticipo previo de {money(account.advance)} ya reduce el saldo y no se suma nuevamente a este turno.</p>}
    {error&&<p role="alert" className="text-red-600 text-sm">{error}</p>}
    {account.payments.map(p=><div key={p.id} className="flex justify-between gap-2 text-sm"><span>{methods[p.method]} · {p.reference||new Date(p.createdAt).toLocaleString('es-CO')}</span><strong>{money(p.amount)}</strong></div>)}
    {canCollect&&<>
      <div className="rounded-lg bg-muted p-3 space-y-2"><p className="text-sm font-medium">{session?'Turno de caja abierto':'Abre tu turno de caja para registrar pagos'}</p>
        {session&&<p className="text-sm">Efectivo esperado: {money(session.expectedAmount??session.openingAmount)}</p>}
        <Label htmlFor="hotel-cash-amount">{session?'Efectivo contado para cerrar el turno':'Base de apertura'}</Label>
        <Input id="hotel-cash-amount" type="number" min="0" step="0.01" value={cashAmount} disabled={busy||!!pending||pendingRefund} onChange={e=>setCashAmount(e.target.value)}/>
        <Button variant="outline" disabled={busy||!!pending||pendingRefund} onClick={()=>session?setConfirm('shift'):void open().catch(()=>undefined)}>{session?'Cerrar turno':'Abrir turno'}</Button>
      </div>
      {!account.closedAt&&account.reservation.status!=='cancelled'&&account.balance>0&&(session||pending)&&<div className="space-y-2">
        {pending&&<p className="text-sm">Hay un pago pendiente de confirmación. Reintenta el mismo pago para comprobarlo.</p>}
        <Label htmlFor="hotel-payment-amount">Importe del abono</Label><Input id="hotel-payment-amount" type="number" min="0.01" step="0.01" max={account.balance} value={pending?.amount??amount} disabled={busy||!!pending||pendingRefund} onChange={e=>setAmount(e.target.value)}/>
        <Label htmlFor="hotel-payment-method">Medio de pago</Label><select id="hotel-payment-method" className="w-full rounded border bg-background p-2" value={pending?.method||method} disabled={busy||!!pending||pendingRefund} onChange={e=>setMethod(e.target.value as PaymentPartMethod)}>{Object.entries(methods).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>
        <Label htmlFor="hotel-payment-reference">Referencia del pago (opcional)</Label><Input id="hotel-payment-reference" maxLength={200} value={pending?.reference??reference} disabled={busy||!!pending||pendingRefund} onChange={e=>setReference(e.target.value)}/>
        <p className="text-xs text-muted-foreground">Registra el pago después de recibirlo. Tarjetas y transferencias se verifican fuera de esta aplicación.</p>
        <Button disabled={busy||pendingRefund} onClick={()=>void pay().catch(()=>undefined)}>{busy?'Procesando…':pending?'Reintentar pago':'Registrar abono'}</Button>
      </div>}
      {!account.closedAt&&account.balance===0&&['checkin','checkout'].includes(account.reservation.status)&&<Button disabled={busy||!!pending||pendingRefund} onClick={()=>setConfirm('account')}>Cerrar cuenta y registrar salida</Button>}
    </>}
    {account.closedAt&&<div className="space-y-2"><p className="font-semibold text-emerald-700">Cuenta cerrada · {account.receiptId}</p>{account.receipt&&<Button variant="outline" onClick={()=>downloadHotelReceipt(account.receipt!)}>Descargar comprobante</Button>}</div>}
    <HotelRefundsPanel account={account} session={session} canCollect={canCollect&&!pending} busy={busy} onBusy={onBusy} onAccount={onAccount} onSaved={async()=>{onSaved();await refresh();}} onPending={setPendingRefund}/>
    <ConfirmActionDialog open={!!confirm} onOpenChange={open=>{if(!open)setConfirm(null);}} title={confirm==='account'?'Cerrar cuenta del huésped':'Cerrar turno de caja'} description={confirm==='account'?'Se generará el comprobante y se registrará la salida. La cuenta quedará cerrada para nuevos cargos y pagos.':`Se comparará el efectivo contado (${money(Number(cashAmount)||0)}) con el esperado (${money(session?.expectedAmount||0)}).`} confirmLabel={confirm==='account'?'Cerrar cuenta':'Cerrar turno'} onConfirm={finish}/>
  </section>;
}
