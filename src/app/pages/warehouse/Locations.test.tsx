import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryLocationRecord } from '../../services/dataService';

const base: InventoryLocationRecord = {
  id: 'LOC-1',
  code: 'A-01',
  name: 'Pasillo A',
  zone: 'A',
  aisle: '1',
  rack: '',
  level: 1,
  capacity: 100,
  active: true,
  productCount: 0,
  lotUnits: 0,
  label: 'A-01 Pasillo A',
  createdAt: '2026-11-01T10:00:00-05:00',
};
const inactive: InventoryLocationRecord = { ...base, id: 'LOC-2', code: 'B-02', label: 'B-02', active: false };

const deleteInventoryLocation = vi.fn(async (id: string) => ({ ok: true, id }));
const updateInventoryLocation = vi.fn(async (id: string, input: object) => ({ ...base, ...input, id }));
const getInventoryLocations = vi.fn(async (includeInactive?: boolean) => (includeInactive ? [base, inactive] : [base]));
const reload = vi.fn(async () => undefined);
const desktop = { on: false };

vi.mock('../../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../../services/desktop', () => ({ isDesktopMode: () => desktop.on }));
vi.mock('../../services/dataService', () => ({
  dataService: { deleteInventoryLocation, updateInventoryLocation, getInventoryLocations },
}));
vi.mock('./shared', async importOriginal => ({
  ...(await importOriginal<typeof import('./shared')>()),
  PageTitle: ({ title }: { title: string }) => <h1>{title}</h1>,
  StatCard: () => null,
  useWarehouseRefs: () => ({ locations: [base], loading: false, reload }),
  useWarehousePermissions: () => ({ canEdit: true }),
}));

const { Locations } = await import('./Locations');

describe('Ubicaciones de bodega', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    desktop.on = false;
  });

  it('el botón Desactivar pide confirmación y desactiva la ubicación', async () => {
    render(<Locations />);

    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar ubicación' }));

    await waitFor(() => expect(deleteInventoryLocation).toHaveBeenCalledWith('LOC-1'));
    expect(reload).toHaveBeenCalled();
  });

  it('si el servidor la rechaza, la confirmación sigue abierta', async () => {
    deleteInventoryLocation.mockRejectedValueOnce(new Error('Es la ubicación por defecto de la bodega.'));
    render(<Locations />);

    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar ubicación' }));

    await waitFor(() => expect(deleteInventoryLocation).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Desactivar ubicación' })).toBeInTheDocument();
  });

  it('las ubicaciones inactivas se ven y se pueden reactivar', async () => {
    render(<Locations />);

    fireEvent.click(await screen.findByRole('button', { name: 'Reactivar' }));

    await waitFor(() =>
      expect(updateInventoryLocation).toHaveBeenCalledWith(
        'LOC-2',
        expect.objectContaining({ code: 'B-02', active: true }),
      ),
    );
  });

  it('en la app de escritorio no ofrece desactivar ni reactivar (solo funciona con servidor)', async () => {
    desktop.on = true;
    render(<Locations />);

    expect(await screen.findByText('A-01')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivar' })).not.toBeInTheDocument();
  });
});
