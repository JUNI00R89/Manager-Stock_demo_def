import { DIGITAL_PROVIDERS } from '../services/dataService';
import { formatMoney } from './restaurantFormat';

const METHODS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  digital: 'Digital',
};

export interface AbonoReceipt {
  businessName: string;
  customerName: string;
  payment: {
    id: string;
    amount: number;
    method: string;
    provider?: string | null;
    reference?: string;
    createdAt: string;
  };
  balance: number;
}

/** Plain-text proof of a fiado payment; used for WhatsApp and for the downloadable receipt. */
export function abonoReceiptText({ businessName, customerName, payment, balance }: AbonoReceipt): string {
  const method =
    (payment.method === 'digital' && DIGITAL_PROVIDERS.find(p => p.id === payment.provider)?.label) ||
    METHODS[payment.method] ||
    payment.method;
  return [
    businessName,
    `Comprobante de abono ${payment.id}`,
    `Fecha: ${new Date(payment.createdAt).toLocaleString('es-CO')}`,
    `Cliente: ${customerName}`,
    `Abono: ${formatMoney(payment.amount)}`,
    `Medio: ${method}${payment.reference ? ` · Ref ${payment.reference}` : ''}`,
    balance > 0 ? `Saldo pendiente: ${formatMoney(balance)}` : 'Cuenta al día. ¡Gracias!',
    'Comprobante interno, no es una factura electrónica.',
  ].join('\n');
}

/** Downloads the receipt as a small HTML file; the text goes in as a text node, never as markup. */
export function downloadAbonoReceipt(receipt: AbonoReceipt) {
  const doc = document.implementation.createHTMLDocument(`Abono ${receipt.payment.id}`);
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  doc.head.prepend(charset);
  const pre = doc.createElement('pre');
  pre.style.cssText = 'font:15px/1.6 system-ui;max-width:420px;margin:40px auto;white-space:pre-wrap';
  pre.textContent = abonoReceiptText(receipt);
  doc.body.append(pre);
  const url = URL.createObjectURL(
    new Blob(['<!doctype html>' + doc.documentElement.outerHTML], { type: 'text/html;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `abono-${receipt.payment.id}.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
