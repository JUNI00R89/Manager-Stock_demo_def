import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Product } from '../utils/types';
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
});
