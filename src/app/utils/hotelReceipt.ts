import type { HotelReceipt, HotelRefundRecord, HotelReservationRecord } from '../services/dataService';

/** Builds an inert, printable document; guest names and notes are text nodes. */
export function downloadHotelReceipt(receipt: HotelReceipt) {
  const doc = document.implementation.createHTMLDocument('Comprobante de hotel');
  doc.documentElement.lang = 'es';
  const charset = doc.createElement('meta'); charset.setAttribute('charset', 'utf-8'); doc.head.prepend(charset);
  const style = doc.createElement('style');
  style.textContent = 'body{font:15px system-ui;max-width:800px;margin:40px auto;padding:20px;color:#17212b}table{width:100%;border-collapse:collapse;margin:24px 0}td,th{padding:9px;border-bottom:1px solid #ddd;text-align:left}h1{font-size:26px}@media print{body{margin:0}}';
  doc.head.append(style);
  const line = (tag: string, value: string) => { const el=doc.createElement(tag); el.textContent=value; doc.body.append(el); };
  const money = (n: number) => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP'}).format(n);
  const methods: Record<string,string> = {cash:'Efectivo',card:'Tarjeta',transfer:'Transferencia',digital:'Pago digital'};
  line('h1',receipt.businessName);
  line('h2',`Comprobante interno ${receipt.receiptId}`);
  line('p',`Fecha de cierre: ${new Date(receipt.closedAt!).toLocaleString('es-CO')}`);
  line('p',`Habitación ${receipt.reservation.roomNumber} · ${receipt.reservation.guestName}`);
  line('p',`${receipt.reservation.checkIn} → ${receipt.reservation.checkOut} · Reserva ${receipt.reservation.id}`);
  const rows = [['Concepto','Importe'],['Alojamiento',money(receipt.accommodationTotal)],...receipt.charges.filter(c=>c.status==='active').map(c=>[`${c.productName} · ${c.quantity} × ${money(c.unitPrice)}`,money(c.total)]),['Total',money(receipt.total)],['Anticipo previo',money(receipt.advance)],...receipt.payments.map(p=>[`${methods[p.method]} · ${p.reference || p.id}`,money(p.amount)]),...(receipt.refunds || []).map(r=>[`Devolución · ${methods[r.method]} · ${r.reason}`,money(-r.amount)]),['Saldo pendiente',money(receipt.balance)]];
  const table=doc.createElement('table');
  rows.forEach((row,index)=>{const tr=doc.createElement('tr');row.forEach(value=>{const cell=doc.createElement(index?'td':'th');cell.textContent=value;tr.append(cell);});table.append(tr);});doc.body.append(table);
  line('p','Cuenta cerrada. Conserva este comprobante junto con tus soportes de pago.');
  const url=URL.createObjectURL(new Blob(['<!doctype html>'+doc.documentElement.outerHTML],{type:'text/html;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`comprobante-${receipt.receiptId}.html`;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function downloadHotelRefund(refund: HotelRefundRecord, reservation: HotelReservationRecord) {
  const doc=document.implementation.createHTMLDocument('Comprobante de devolución');
  doc.documentElement.lang='es';
  const meta=doc.createElement('meta');meta.setAttribute('charset','utf-8');doc.head.prepend(meta);
  const methods={cash:'Efectivo',card:'Tarjeta',transfer:'Transferencia',digital:'Pago digital'};
  for(const text of ['Comprobante interno de devolución',refund.id,`Habitación ${reservation.roomNumber} · ${reservation.guestName}`,`Reserva: ${reservation.id}`,`Pago original: ${refund.paymentId}`,`Importe: ${refund.amount.toFixed(2)} COP · ${methods[refund.method]}`,`Fecha: ${new Date(refund.createdAt).toLocaleString('es-CO')}`,`Motivo: ${refund.reason}`,`Turno: ${refund.cashSessionId}`]){const p=doc.createElement('p');p.textContent=text;doc.body.append(p);}
  const url=URL.createObjectURL(new Blob(['<!doctype html>'+doc.documentElement.outerHTML],{type:'text/html;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`devolucion-${refund.id}.html`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
