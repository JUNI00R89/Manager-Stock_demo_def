import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Product } from '../utils/types';

const createProductMock = vi.fn();
vi.mock('../services/dataService', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/dataService')>()),
  getProductCategories: async () => [
    { id: 'C1', name: 'Bebidas', description: '', active: true, custom: false },
    { id: 'C2', name: 'Aseo', description: '', active: true, custom: false },
  ],
  dataService: { createProduct: (input: unknown) => createProductMock(input) },
}));

import { BarcodeScanner } from './BarcodeScanner';

const gaseosa = {
  id: 'P1',
  name: 'Gaseosa',
  sku: 'GA1',
  barcode: '7702004003508',
  price: 3000,
  stock: 20,
  minStock: 2,
} as Product;

// El lector USB/Bluetooth escribe el código como un teclado muy rápido y termina con Enter.
function scanWithUsbReader(code: string) {
  const input = document.querySelector('input[aria-hidden="true"]') as HTMLInputElement;
  for (const key of code) fireEvent.keyDown(input, { key });
  fireEvent.keyDown(input, { key: 'Enter' });
}

const wait = (ms: number) => act(() => new Promise(resolve => setTimeout(resolve, ms)));

describe('BarcodeScanner en caja (modo continuo)', () => {
  // Sin animaciones: la tarjeta aparece y se va al instante y la prueba mide solo el comportamiento.
  beforeAll(() => {
    MotionGlobalConfig.skipAnimations = true;
  });
  afterAll(() => {
    MotionGlobalConfig.skipAnimations = false;
  });

  it('el producto escaneado se queda en pantalla hasta tocar «Escanear otro»', async () => {
    const onSell = vi.fn();
    render(<BarcodeScanner products={[gaseosa]} onSell={onSell} mode="continuous" context="pos" onClose={() => {}} />);

    act(() => scanWithUsbReader(gaseosa.barcode!));
    expect(onSell).toHaveBeenCalledTimes(1);

    // Antes la tarjeta se ocultaba sola a los 1,2 s.
    await wait(2000);
    expect(screen.getByText('Gaseosa')).toBeInTheDocument();
    expect(screen.getByText('Añadido al carrito')).toBeInTheDocument();

    // «Agregar otra» suma una unidad y la tarjeta sigue visible.
    fireEvent.click(screen.getByText('Agregar otra'));
    expect(onSell).toHaveBeenCalledTimes(2);
    await wait(500);
    expect(screen.getByText('Gaseosa')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Escanear otro código'));
    await waitFor(() => expect(screen.queryByText('Gaseosa')).not.toBeInTheDocument());
  }, 10000);

  it('un código que no existe se crea con la ficha rápida y queda en el carrito', async () => {
    const code = '7702090000000';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: 1, product: { product_name: 'Jugo de mango 300 ml' } }),
      })),
    );
    createProductMock.mockImplementation(async input => ({ id: 'P9', sku: 'BEB-0001', ...input }));
    const onSell = vi.fn();
    const onProductCreated = vi.fn();
    render(
      <BarcodeScanner
        products={[gaseosa]}
        onSell={onSell}
        onProductCreated={onProductCreated}
        mode="continuous"
        context="pos"
        onClose={() => {}}
      />,
    );

    act(() => scanWithUsbReader(code));
    expect(screen.getByText('Producto no encontrado')).toBeInTheDocument();
    expect(onSell).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Crear producto/ }));
    // El nombre llega solo desde Open Food Facts; el precio se escribe.
    await waitFor(() => expect(screen.getByLabelText(/Nombre/)).toHaveValue('Jugo de mango 300 ml'));
    await user.type(screen.getByLabelText('Precio de venta'), '2500');
    await user.click(screen.getByRole('button', { name: /Guardar/ }));

    await waitFor(() => expect(onProductCreated).toHaveBeenCalledTimes(1));
    expect(createProductMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Jugo de mango 300 ml',
        price: 2500,
        stock: 1,
        category: 'Bebidas',
        barcode: code,
        sku: '',
      }),
    );
    expect(onSell).toHaveBeenCalledWith(expect.objectContaining({ id: 'P9', name: 'Jugo de mango 300 ml' }));
    expect(screen.getByText('Añadido al carrito')).toBeInTheDocument();
    expect(screen.getByText('Jugo de mango 300 ml')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('sin permiso para crear productos, el botón no abre la ficha', () => {
    const onClose = vi.fn();
    render(<BarcodeScanner products={[gaseosa]} mode="continuous" context="pos" onClose={onClose} />);
    act(() => scanWithUsbReader('7702090000000'));
    fireEvent.click(screen.getByRole('button', { name: /Crear producto/ }));
    expect(screen.queryByLabelText('Precio de venta')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });
});
