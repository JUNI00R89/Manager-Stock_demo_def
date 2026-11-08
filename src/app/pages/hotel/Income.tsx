import { useEffect, useState } from 'react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { getHotelIncomeReport, type HotelIncomeReport } from '../../services/dataService';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota'}).format(new Date());
const money=(value:number)=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP'}).format(value);
const methods={cash:'Efectivo',card:'Tarjeta',transfer:'Transferencia',digital:'Pago digital'};
function downloadCSV(report:HotelIncomeReport){
  const rows=[['Fecha (Colombia)','Tipo','Habitación','Huésped','Medio','Importe COP','Referencia','Reserva','Registro'],...report.transactions.map(r=>[new Date(r.createdAt).toLocaleString('es-CO',{timeZone:'America/Bogota'}),r.kind==='payment'?'Cobro':'Devolución',r.roomNumber,r.guestName,methods[r.method],(r.kind==='payment'?r.amount:-r.amount).toFixed(2),r.reference,r.reservationId,r.id])];
  // Quote cells and neutralize spreadsheet formula prefixes in guest-entered data.
  const escape=(value:string,index:number)=>'"'+(index!==5 && /^[\s]*[=+@-]/.test(value)?"'"+value:value).replaceAll('"','""')+'"';
  const csv='\uFEFF'+rows.map(row=>row.map(escape).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`ingresos-hotel-${report.start}-${report.end}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function HotelIncome(){
  const [start,setStart]=useState(()=>today().slice(0,8)+'01');
  const [end,setEnd]=useState(today);
  const [period,setPeriod]=useState({start,end});
  const [report,setReport]=useState<HotelIncomeReport|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  useEffect(()=>{let active=true;setLoading(true);setError('');setReport(null);getHotelIncomeReport(period.start,period.end).then(data=>{if(active)setReport(data);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[period]);
  return <Layout><main className="min-w-0 space-y-5">
    <header><h1 className="text-2xl font-bold">Ingresos del hotel</h1><p className="mt-2 text-sm text-muted-foreground">Cobros registrados menos devoluciones, por fecha de movimiento en hora de Colombia. No incluye la base de caja ni anticipos anteriores sin registro de pago.</p></header>
    <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={e=>{e.preventDefault();setPeriod({start,end});}}>
      <div className="min-w-0 space-y-1"><Label htmlFor="income-start">Desde</Label><Input id="income-start" className="min-w-0 max-w-full" type="date" required value={start} onChange={e=>setStart(e.target.value)}/></div>
      <div className="min-w-0 space-y-1"><Label htmlFor="income-end">Hasta</Label><Input id="income-end" className="min-w-0 max-w-full" type="date" required min={start} value={end} onChange={e=>setEnd(e.target.value)}/></div>
      <Button disabled={loading} type="submit">Consultar</Button>
    </form>
    {loading&&<p role="status">Cargando ingresos…</p>}{error&&<p role="alert" className="text-red-600">{error}</p>}
    {report&&<>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm">{report.start} → {report.end} · {report.transactions.length} movimientos</p><Button variant="outline" onClick={()=>downloadCSV(report)}>Exportar CSV</Button></div>
      <div className="grid gap-3 sm:grid-cols-3">{[['Cobrado',report.gross],['Devuelto',report.refunded],['Ingreso neto',report.net]].map(([label,value])=><Card key={label} className="min-w-0 p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 break-words text-2xl font-bold">{money(Number(value))}</p></Card>)}</div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{report.methods.map(row=><Card key={row.method} className="p-4"><h2 className="font-semibold">{methods[row.method]}</h2><dl className="mt-3 space-y-2 text-sm">{[['Cobrado',row.gross],['Devuelto',row.refunded],['Neto',row.net]].map(([label,value])=><div key={label} className="flex flex-wrap justify-between gap-2"><dt>{label}</dt><dd>{money(Number(value))}</dd></div>)}</dl></Card>)}</div>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Movimientos del periodo</h2>{!report.transactions.length&&<p className="text-sm text-muted-foreground">No hay movimientos en estas fechas.</p>}{report.transactions.map(row=><Card key={row.id} className="p-4"><div className="flex flex-wrap justify-between gap-2"><strong className="break-words">{row.kind==='payment'?'Cobro':'Devolución'} · Hab. {row.roomNumber} · {row.guestName}</strong><strong className={row.kind==='refund'?'text-red-600':''}>{row.kind==='refund'?'-':''}{money(row.amount)}</strong></div><p className="mt-2 text-sm">{methods[row.method]} · {new Date(row.createdAt).toLocaleString('es-CO',{timeZone:'America/Bogota'})}</p>{row.reference&&<p className="mt-1 break-words text-sm text-muted-foreground">{row.reference}</p>}<p className="mt-1 break-all text-xs text-muted-foreground">{row.id}</p></Card>)}</section>
    </>}
  </main></Layout>;
}
