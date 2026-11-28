import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeliverPaymentDialog } from './DeliverPaymentDialog';
import type { Pedido } from '../../utils/restaurantTypes';

const order = { id: 'PED-1', numero: 7, mesaNombre: 'Mesa 1', total: 21420 } as unknown as Pedido;

describe('DeliverPaymentDialog', () => {
  it('por defecto cobra todo en efectivo con un clic', async () => {
    const onConfirm = vi.fn(async () => undefined);
    render(<DeliverPaymentDialog order={order} busy={false} onClose={() => undefined} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cobrar y entregar' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(order, [{ method: 'cash', amount: 21420 }]));
  });

  it('permite cobrar con tarjeta y no deja entregar si falta dinero por repartir', async () => {
    const onConfirm = vi.fn(async () => undefined);
    render(<DeliverPaymentDialog order={order} busy={false} onClose={() => undefined} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: 'Todo en tarjeta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cobrar y entregar' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(order, [{ method: 'card', amount: 21420 }]));

    onConfirm.mockClear();
    fireEvent.change(screen.getByLabelText('Tarjeta'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cobrar y entregar' }));
    expect(await screen.findByText('Distribuye el total del pedido entre los medios de pago.')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
