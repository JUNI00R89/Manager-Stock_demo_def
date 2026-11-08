import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { ConfirmActionDialog } from '../../components/ConfirmActionDialog';
import { refundHotelPayment, type CashSessionRecord, type HotelAccount, type HotelRefundInput } from '../../services/dataService';
import { downloadHotelRefund } from '../../utils/hotelReceipt';
import { toast } from 'sonner';
const money=(amount:number)=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP'}).format(amount);
const methods={cash:'Efectivo',card:'Tarjeta',transfer:'Transferencia',digital:'Pago digital'};

export function HotelRefundsPanel({account,session,canCollect,busy,onBusy,onAccount,onSaved,onPending}:{
  account:HotelAccount;session:CashSessionRecord|null;canCollect:boolean;busy:boolean;
  onBusy:(busy:boolean)=>void;onAccount:(account:HotelAccount)=>void;onSaved:()=>Promise<void>;onPending:(pending:boolean)=>void;
}) {
  const {user}=useAuth();
  const [paymentId,setPaymentId]=useState('');
  const [amount,setAmount]=useState('');
  const [reason,setReason]=useState('');
  const [pending,setPending]=useState<HotelRefundInput|null>(null);
  const [review,setReview]=useState<HotelRefundInput|null>(null);
  const [error,setError]=useState('');
  const sending=useRef(false);
  const key=`hotel-pending-refund:${user?.businessId}:${account.reservation.id}`;
  const refunds=account.refunds || [];
  useEffect(()=>{
    let value:HotelRefundInput|null=null;
    try{value=JSON.parse(sessionStorage.getItem(key)||'null');}catch{/* no pending request */}
    if(value && account.refunds.some(r=>r.idempotencyKey===value!.idempotencyKey)){sessionStorage.removeItem(key);value=null;}
    setPending(value);onPending(!!value);
  },[key,account.refunds,onPending]);
  const available=(id:string)=>Math.round(((account.payments.find(p=>p.id===id)?.amount||0)-refunds.filter(r=>r.paymentId===id).reduce((sum,r)=>sum+r.amount,0))*100)/100;
  const prepare=()=>{
    setError('');
    const input=pending || {paymentId,cashSessionId:session?.id||'',amount:Number(amount),reason:reason.trim(),idempotencyKey:crypto.randomUUID()};
    if(!input.paymentId || !input.cashSessionId || !Number.isFinite(input.amount) || input.amount<=0 || input.amount>available(input.paymentId) || Math.abs(input.amount-Math.round(input.amount*100)/100)>0.000001 || input.reason.length<3){setError('Selecciona un pago, un importe válido y el motivo (mínimo 3 caracteres).');return;}
    setReview(input);
  };
  const submit=async()=>{
    if(!review || sending.current)return;
    sending.current=true;onBusy(true);setError('');
    try{
      sessionStorage.setItem(key,JSON.stringify(review));setPending(review);onPending(true);
      const result=await refundHotelPayment(account.reservation.id,review);
      sessionStorage.removeItem(key);setPending(null);onPending(false);setReview(null);setAmount('');setReason('');onAccount(result);
      toast.success('Devolución registrada.');await onSaved();
    }catch(e){
      const message=e instanceof Error?e.message:'No se pudo confirmar la devolución. Reintenta la misma solicitud.';
      setError(message);toast.error(message);
      const status=(e as {status?:number}).status;
      if(status && status>=400 && status<500){sessionStorage.removeItem(key);setPending(null);onPending(false);setReview(null);}
      throw e;
    }finally{sending.current=false;onBusy(false);}
  };
  return <section className="space-y-3 border-t pt-4">
    <h4 className="font-semibold">Devoluciones de pagos</h4>
    <p className="text-sm">Devuelto: <strong>{money(account.refundedTotal)}</strong> · Cobrado neto: <strong>{money(account.netPaidTotal)}</strong></p>
    {account.closedAt&&<p className="text-xs text-muted-foreground">Las devoluciones posteriores al cierre no reabren la estancia ni modifican el comprobante original.</p>}
    {refunds.map(refund=><div key={refund.id} className="space-y-2 rounded-lg border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span>{methods[refund.method]} · {money(refund.amount)}</span><span>{new Date(refund.createdAt).toLocaleString('es-CO')}</span></div><p className="break-words">{refund.reason}</p><Button size="sm" variant="outline" onClick={()=>downloadHotelRefund(refund,account.reservation)}>Comprobante de devolución</Button></div>)}
    {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
    {canCollect&&(session||pending)&&account.payments.some(p=>available(p.id)>0)&&<div className="space-y-2">
      <p className="text-xs text-muted-foreground">Registra la devolución después de entregar el dinero o verificarla con tu banco. Se usa el mismo medio del pago original. Los anticipos anteriores sin registro de pago no se devuelven desde aquí.</p>
      {pending&&<p className="text-sm font-medium">Hay una devolución pendiente de confirmación. Reinténtala para comprobar el resultado.</p>}
      <Label htmlFor="refund-payment">Pago a devolver</Label>
      <select id="refund-payment" className="h-11 w-full min-w-0 rounded border bg-background px-2 text-sm" value={pending?.paymentId||paymentId} disabled={busy||!!pending} onChange={e=>setPaymentId(e.target.value)}><option value="">Seleccionar pago</option>{account.payments.filter(p=>available(p.id)>0).map(p=><option key={p.id} value={p.id}>{methods[p.method]} · {available(p.id)} COP disponibles · {p.reference||p.id}</option>)}</select>
      <Label htmlFor="refund-amount">Importe a devolver</Label><Input id="refund-amount" type="number" min="0.01" step="0.01" value={pending?.amount??amount} disabled={busy||!!pending} onChange={e=>setAmount(e.target.value)}/>
      <Label htmlFor="refund-reason">Motivo de devolución</Label><Input id="refund-reason" maxLength={500} value={pending?.reason??reason} disabled={busy||!!pending} onChange={e=>setReason(e.target.value)}/>
      <Button variant="outline" disabled={busy} onClick={prepare}>{pending?'Reintentar devolución':'Revisar devolución'}</Button>
    </div>}
    <ConfirmActionDialog open={!!review} onOpenChange={open=>{if(!open&&!busy)setReview(null);}} title="Registrar devolución" description={review?`Devolver ${money(review.amount)} por ${methods[account.payments.find(p=>p.id===review.paymentId)!.method]}. Motivo: ${review.reason}. Confirma únicamente si ya realizaste la devolución; este registro no envía dinero.`:''} confirmLabel="Confirmar devolución" onConfirm={submit}/>
  </section>;
}
