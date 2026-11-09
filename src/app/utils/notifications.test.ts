import { beforeEach, describe, expect, it, vi } from 'vitest'

const { errorMock } = vi.hoisted(() => ({ errorMock: vi.fn() }))

vi.mock('sonner', () => ({
  toast: {
    error: errorMock,
  },
}))

import { toastError } from './notifications'

describe('toastError', () => {
  beforeEach(() => {
    errorMock.mockClear()
  })

  it('muestra el título estable y la razón concreta', () => {
    toastError(new Error('Ya existe una cuenta con ese correo.'), 'No se pudo crear el usuario.')

    expect(errorMock).toHaveBeenCalledWith('No se pudo crear el usuario.', {
      description: 'Ya existe una cuenta con ese correo.',
      duration: 7000,
    })
  })

  it('no repite la descripción cuando coincide con el fallback', () => {
    toastError(new Error('No se pudo crear el usuario.'), 'No se pudo crear el usuario.')

    expect(errorMock).toHaveBeenCalledWith('No se pudo crear el usuario.')
  })

  it('usa el fallback cuando no hay razón', () => {
    toastError(undefined, 'No se pudo guardar.')

    expect(errorMock).toHaveBeenCalledWith('No se pudo guardar.')
  })

  it('explica los errores de red', () => {
    toastError(new Error('Failed to fetch'), 'No se pudo conectar.')

    expect(errorMock).toHaveBeenCalledWith('No se pudo conectar.', {
      description: 'No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.',
      duration: 7000,
    })
  })
})
