import { beforeEach, describe, expect, it, vi } from 'vitest'

const { errorMock } = vi.hoisted(() => ({ errorMock: vi.fn() }))

vi.mock('sonner', () => ({
  toast: {
    error: errorMock,
  },
}))

import { ERROR_TOAST_DURATION, toastError } from './notifications'

/** Título máximo (72) más el carácter de elipsis. */
const MAX_TITLE_WITH_ELLIPSIS = 73

describe('toastError', () => {
  beforeEach(() => {
    errorMock.mockClear()
  })

  it('muestra el título estable y la razón concreta del servidor', () => {
    toastError(new Error('Ya existe una cuenta con ese correo.'), 'No se pudo crear el usuario.')

    expect(errorMock).toHaveBeenCalledWith('No se pudo crear el usuario.', {
      description: 'Ya existe una cuenta con ese correo.',
      duration: ERROR_TOAST_DURATION,
    })
  })

  it('acorta el título y deja el resto como detalle cuando el error no aporta mensaje', () => {
    toastError(
      undefined,
      'No se pudo iniciar sesión. Verifica tus credenciales y que el backend esté ejecutándose.',
    )

    expect(errorMock).toHaveBeenCalledWith('No se pudo iniciar sesión.', {
      description: 'Verifica tus credenciales y que el backend esté ejecutándose.',
      duration: ERROR_TOAST_DURATION,
    })
  })

  it('no repite la descripción cuando coincide con el fallback corto', () => {
    toastError(new Error('No se pudo crear el usuario.'), 'No se pudo crear el usuario.')

    expect(errorMock).toHaveBeenCalledWith('No se pudo crear el usuario.', {
      duration: ERROR_TOAST_DURATION,
    })
  })

  it('usa el fallback cuando no hay razón', () => {
    toastError(undefined, 'No se pudo guardar.')

    expect(errorMock).toHaveBeenCalledWith('No se pudo guardar.', {
      duration: ERROR_TOAST_DURATION,
    })
  })

  it('explica los errores de red', () => {
    toastError(new Error('Failed to fetch'), 'No se pudo conectar.')

    expect(errorMock).toHaveBeenCalledWith('No se pudo conectar.', {
      description: 'No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.',
      duration: ERROR_TOAST_DURATION,
    })
  })

  it('corta en una palabra completa cuando el mensaje largo no tiene puntuación', () => {
    toastError(
      undefined,
      'No se pudo guardar la configuración del negocio porque el servidor no respondió a tiempo',
    )

    expect(errorMock).toHaveBeenCalledTimes(1)

    const [title, options] = errorMock.mock.calls[0]
    expect(title.endsWith('…')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_WITH_ELLIPSIS)
    expect(options.description.length).toBeGreaterThan(0)
    expect(options.duration).toBe(ERROR_TOAST_DURATION)
  })
})
