import { uniqueRestaurantId } from '../utils/restaurantStorage';
import { SaleReturnsPanel } from './SaleReturnsPanel';
import { useEffect, useState } from 'react';
import {
  api,
  dataService,
  type CashSessionRecord,
  type ServiceAppointmentRecord,
  type SaleRecord,
} from '../services/dataService';
import { isDesktopMode } from '../services/desktop';
import type { Product } from '../utils/types';
import { useAuth } from '../context/AuthContext';
import { useBusiness } from '../context/BusinessContext';
import { canPerformAction } from '../security/permissions';
import { PaymentFields, paymentParts } from './PaymentFields';
import { CustomerPicker } from './CustomerPicker';
import type { Customer } from '../services/commerce';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { toastError } from '../utils/notifications';
import { toast } from 'sonner';

export function ServiceCheckoutDialog({
  appointment,
  onClose,
  onSaved,
}: {
  appointment: ServiceAppointmentRecord;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { user } = useAuth();
  const { config } = useBusiness();
  const key = `appointment_checkout:${user?.businessId}:${user?.id}:${appointment.id}`;
  const [session, setSession] = useState<CashSessionRecord | null>(null);
  const [receipt, setReceipt] = useState<SaleRecord | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [discount, setDiscount] = useState('0');
  const [payments, setPayments] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState('0');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(() => sessionStorage.getItem(key));
  const canCollect = canPerformAction(user, 'services.manage') && canPerformAction(user, 'cash.manage');
  useEffect(() => {
    if (isDesktopMode()) return;
    let active = true;
    void api<SaleRecord | null>(`/services/appointments/${appointment.id}/receipt`)
      .then(r => {
        if (active) setReceipt(r);
      })
      .catch(e => toastError(e, 'No se pudo consultar el comprobante.'));
    if (canCollect)
      void dataService
        .getCurrentCashSession()
        .then(s => {
          if (active) setSession(s);
        })
        .catch(e => toastError(e, 'No se pudo consultar la caja.'));
    if ((config?.features.inventory || config?.features.pos) && canPerformAction(user, 'catalog.view'))
      void dataService
        .getProducts()
        .then(p => {
          if (active) setProducts(p.filter(v => !v.productType || v.productType === 'sale_item'));
        })
        .catch(e => toastError(e, 'No se pudieron cargar productos.'));
    return () => {
      active = false;
    };
  }, [appointment.id]);
  const subtotal =
    (appointment.price || 0) +
    products.reduce((sum, p) => sum + Math.round(p.price * (Number(quantities[p.id]) || 0) * 100) / 100, 0);
  const base = Math.round((subtotal - Math.round(((subtotal * Number(discount)) / 100) * 100) / 100) * 100) / 100;
  const total = Math.round((base + Math.round(base * (config?.taxRate ?? 0.19) * 100) / 100) * 100) / 100;
  const collect = async () => {
    setBusy(true);
    try {
      let body = pending;
      if (!body) {
        const parts = paymentParts(payments);
        if (Math.abs(parts.reduce((s, p) => s + p.amount, 0) - total) > 0.01)
          throw new Error('Distribuye el total entre los medios de pago.');
        if (!parts.length && total === 0) parts.push({ method: 'cash', amount: 0 });
        if (Object.values(quantities).some(v => !Number.isFinite(Number(v)) || Number(v) < 0))
          throw new Error('Revisa las cantidades de productos.');
        body = JSON.stringify({
          idempotencyKey: uniqueRestaurantId('op'),
          cashSessionId: session?.id,
          customerId: customer?.id,
          items: Object.entries(quantities)
            .filter(([, q]) => Number(q) > 0)
            .map(([productId, q]) => ({ productId, quantity: Number(q) })),
          payments: parts,
          globalDiscountPercent: Number(discount),
        });
        sessionStorage.setItem(key, body);
        setPending(body);
      }
      const result = await api<SaleRecord>(`/services/appointments/${appointment.id}/checkout`, {
        method: 'POST',
        body,
      });
      setReceipt(result);
      sessionStorage.removeItem(key);
      setPending(null);
      toast.success('Cita cobrada y marcada como atendida.');
      await onSaved();
    } catch (e) {
      if (e && typeof e === 'object' && 'status' in e && [400, 403, 404, 409, 422].includes(Number(e.status))) {
        sessionStorage.removeItem(key);
        setPending(null);
      }
      toastError(e, 'No se pudo confirmar el cobro. Reintenta la misma operación.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{receipt ? 'Comprobante de la cita' : 'Finalizar y cobrar'}</DialogTitle>
          <DialogDescription>
            {appointment.clienteNombre} · {appointment.servicioNombre}
          </DialogDescription>
        </DialogHeader>
        {isDesktopMode() ? (
          <p>Este cobro integrado requiere la aplicación conectada al servidor.</p>
        ) : receipt ? (
          <div className="space-y-3">
            <p className="break-words">{receipt.id}</p>
            {receipt.items.map((i, index) => (
              <p key={index}>
                {i.quantity} × {i.productName} · {i.subtotal.toLocaleString('es-CO')} COP
              </p>
            ))}
            <p className="font-semibold">Total: {receipt.totalPrice.toLocaleString('es-CO')} COP</p>
            <p className="text-sm text-muted-foreground">Comprobante interno. No es una factura electrónica.</p>
            <Button
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }),
                );
                const a = document.createElement('a');
                a.href = url;
                a.download = `${receipt.id}.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Descargar comprobante
            </Button>
            <SaleReturnsPanel
              sale={receipt}
              appointmentId={appointment.id}
              onSaved={async () => {
                setReceipt(await api<SaleRecord>(`/services/appointments/${appointment.id}/receipt`));
                await onSaved();
              }}
            />
          </div>
        ) : canCollect ? (
          <div className="space-y-4">
            {pending ? (
              <>
                <p>Hay un cobro pendiente de confirmar. Se reintentará con la misma clave para evitar duplicados.</p>
                <Button disabled={busy} onClick={() => void collect()}>
                  Confirmar cobro pendiente
                </Button>
              </>
            ) : !session ? (
              <>
                <p>Abre tu turno de caja para registrar el cobro.</p>
                <label className="block text-sm">
                  Efectivo inicial
                  <Input type="number" step="0.01" min="0" value={opening} onChange={e => setOpening(e.target.value)} />
                </label>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      setSession(await dataService.openCashSession(Number(opening), user?.name || ''));
                    } catch (e) {
                      toastError(e, 'No se pudo abrir la caja.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Abrir mi caja
                </Button>
              </>
            ) : (
              <>
                <p>Servicio reservado: {(appointment.price || 0).toLocaleString('es-CO')} COP</p>
                <CustomerPicker value={customer} onChange={setCustomer} />
                {!!products.length && (
                  <details>
                    <summary className="min-h-11 cursor-pointer">Agregar productos al cobro</summary>
                    <div className="space-y-3 max-h-56 overflow-y-auto">
                      {products.map(p => (
                        <label className="grid grid-cols-[1fr_90px] gap-2 items-center text-sm" key={p.id}>
                          <span>
                            {p.name} · {p.price.toLocaleString('es-CO')} COP
                          </span>
                          <Input
                            type="number"
                            min="0"
                            step="0.001"
                            aria-label={'Cantidad de ' + p.name}
                            value={quantities[p.id] || ''}
                            onChange={e => setQuantities(q => ({ ...q, [p.id]: e.target.value }))}
                          />
                        </label>
                      ))}
                    </div>
                  </details>
                )}
                <label className="block text-sm">
                  Descuento general (%)
                  <Input type="number" min="0" max="100" value={discount} onChange={e => setDiscount(e.target.value)} />
                </label>
                <p className="font-semibold">Total con impuestos: {total.toLocaleString('es-CO')} COP</p>
                <PaymentFields total={total} values={payments} onChange={setPayments} disabled={busy} />
                <Button disabled={busy} onClick={() => void collect()} className="w-full min-h-11">
                  Registrar cobro y finalizar
                </Button>
              </>
            )}
          </div>
        ) : (
          <p>La cita no tiene cobro registrado. Necesitas permisos de servicios y caja para cobrar.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
