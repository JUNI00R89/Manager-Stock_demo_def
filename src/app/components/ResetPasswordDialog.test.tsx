import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResetPasswordDialog } from './ResetPasswordDialog';

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('ResetPasswordDialog', () => {
  it('envía la contraseña nueva cuando las dos coinciden', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<ResetPasswordDialog open userName="Cajero" onOpenChange={() => undefined} onSubmit={onSubmit} />);

    fill('Contraseña nueva', 'Temporal789!');
    fill('Repite la contraseña', 'Temporal789!');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Temporal789!'));
  });

  it('no envía nada si no coinciden o es muy corta', () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<ResetPasswordDialog open userName="Cajero" onOpenChange={() => undefined} onSubmit={onSubmit} />);

    fill('Contraseña nueva', 'Temporal789!');
    fill('Repite la contraseña', 'Otra789!xx');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(screen.getByText('Las contraseñas no coinciden.')).toBeInTheDocument();

    fill('Contraseña nueva', 'corta');
    fill('Repite la contraseña', 'corta');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(screen.getByText('Debe tener al menos 8 caracteres.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
