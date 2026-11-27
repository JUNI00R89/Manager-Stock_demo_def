import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const changePassword = vi.fn(async () => ({ ok: true, closedSessions: 2 }));
const logoutAll = vi.fn(async () => ({ ok: true, closedSessions: 3 }));
const desktop = { on: false };

vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../services/desktop', () => ({ isDesktopMode: () => desktop.on }));
vi.mock('../services/dataService', () => ({ authService: { changePassword, logoutAll } }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'U1', name: 'Dueña', email: 'duena@negocio.co', role: 'owner' } }),
}));

const { Account } = await import('./Account');

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('Mi cuenta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    desktop.on = false;
  });

  it('cambia la contraseña con la actual y la nueva repetida', async () => {
    render(<Account />);
    fill('Contraseña actual', 'ClaveVieja123');
    fill('Contraseña nueva', 'ClaveNueva456!');
    fill('Repite la contraseña nueva', 'ClaveNueva456!');
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('ClaveVieja123', 'ClaveNueva456!'));
  });

  it('no envía si la nueva no coincide', () => {
    render(<Account />);
    fill('Contraseña actual', 'ClaveVieja123');
    fill('Contraseña nueva', 'ClaveNueva456!');
    fill('Repite la contraseña nueva', 'Distinta456!');
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

    expect(screen.getByText('Las contraseñas nuevas no coinciden.')).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('cierra la sesión en los demás dispositivos tras confirmar', async () => {
    render(<Account />);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión en los demás dispositivos' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar las demás sesiones' }));

    await waitFor(() => expect(logoutAll).toHaveBeenCalled());
  });

  it('en la app de escritorio avisa que necesita el servidor', () => {
    desktop.on = true;
    render(<Account />);
    expect(screen.getByText(/necesita conexión con el servidor/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cambiar contraseña' })).not.toBeInTheDocument();
  });
});
