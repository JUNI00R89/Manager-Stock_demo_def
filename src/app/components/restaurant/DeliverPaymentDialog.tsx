import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { PaymentFields, paymentParts } from '../PaymentFields';
import type { PaymentPartRecord } from '../../services/dataService';
import type { Pedido } from '../../utils/restaurantTypes';
import { formatMoney } from '../../utils/restaurantFormat';

interface DeliverPaymentDialogProps {
  order: Pedido | null;
  busy: boolean;
  currency?: string;
  onClose: () => void;
  /** Receives the validated payment split; throws to keep the dialog open. */
  onConfirm: (order: Pedido, payments: PaymentPartRecord[]) => Promise<unknown>;
}

/** Delivering an order charges it: ask how the customer paid (cash by default, any mix of methods). */
export function DeliverPaymentDialog({ order, busy, currency, onClose, onConfirm }: DeliverPaymentDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    setValues(order ? { cash: order.total.toFixed(2) } : {});
    setError('');
  }, [order]);

  const confirm = async () => {
    if (!order) return;
    try {
      const parts = paymentParts(values);
      const paid = parts.reduce((sum, part) => sum + part.amount, 0);
      if (Math.abs(paid - order.total) > 0.01)
        throw new Error('Distribuye el total del pedido entre los medios de pago.');
      setError('');
      await onConfirm(order, parts);
    } catch (reason) {
      if (reason instanceof Error && !busy) setError(reason.message);
    }
  };

  return (
    <Dialog
      open={!!order}
      onOpenChange={open => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cobrar y entregar pedido #{order?.numero}</DialogTitle>
          <DialogDescription>
            {order?.mesaNombre} · Total con impuestos {order ? formatMoney(order.total, currency) : ''}. Elige cómo pagó
            el cliente.
          </DialogDescription>
        </DialogHeader>
        {order && <PaymentFields total={order.total} values={values} onChange={setValues} disabled={busy} />}
        {error && (
          <p role="alert" className="text-sm text-rose-600">
            {error}
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" disabled={busy} onClick={onClose}>
            Volver
          </Button>
          <Button
            className="h-11 bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={busy}
            onClick={() => void confirm()}
          >
            Cobrar y entregar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
