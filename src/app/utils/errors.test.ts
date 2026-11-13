import { describe, expect, it } from 'vitest'
import { getErrorDescription, getErrorMessage } from './errors'

describe('getErrorMessage', () => {
  it('traduce los errores de red a un mensaje claro', () => {
    expect(getErrorMessage(new Error('Failed to fetch'))).toBe(
      'No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.',
    )
    expect(getErrorMessage(new Error('NetworkError when attempting to fetch resource'))).toBe(
      'No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.',
    )
    expect(getErrorMessage(new Error('Load failed'))).toBe(
      'No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.',
    )
  })

  it('conserva el mensaje de un Error normal', () => {
    expect(getErrorMessage(new Error('Ya existe una cuenta con ese correo.'))).toBe(
      'Ya existe una cuenta con ese correo.',
    )
  })

  it('usa el fallback cuando el Error no tiene mensaje', () => {
    expect(getErrorMessage(new Error('   '), 'No se pudo crear el usuario.')).toBe(
      'No se pudo crear el usuario.',
    )
  })

  it('acepta strings y recorta espacios', () => {
    expect(getErrorMessage('  Algo falló  ', 'fallback')).toBe('Algo falló')
    expect(getErrorMessage('   ', 'fallback')).toBe('fallback')
  })

  it('extrae el detalle de un objeto', () => {
    expect(getErrorMessage({ detail: 'Correo inválido' })).toBe('Correo inválido')
    expect(getErrorMessage({ message: 'Token expirado' })).toBe('Token expirado')
    expect(getErrorMessage({ error: 'No autorizado' })).toBe('No autorizado')
  })

  it('extrae mensajes de validación en formato de lista', () => {
    const error = {
      detail: [
        { loc: ['body', 'email'], msg: 'Invalid email' },
        { loc: ['body', 'password'], msg: 'Too short' },
      ],
    }
    expect(getErrorMessage(error)).toBe('email: Invalid email; password: Too short')
  })

  it('extrae message de un detail objeto', () => {
    expect(getErrorMessage({ detail: { message: 'Token expirado' } })).toBe('Token expirado')
  })

  it('usa el fallback para objetos sin mensaje', () => {
    expect(getErrorMessage({ foo: 'bar' }, 'Error genérico')).toBe('Error genérico')
  })

  it('devuelve cadena vacía si el fallback es vacío', () => {
    expect(getErrorMessage(undefined, '')).toBe('')
  })
})

describe('getErrorDescription', () => {
  it('devuelve el mensaje del Error', () => {
    expect(getErrorDescription(new Error('Motivo concreto'))).toBe('Motivo concreto')
  })

  it('devuelve vacío para un Error sin mensaje', () => {
    expect(getErrorDescription(new Error(''))).toBe('')
    expect(getErrorDescription(new Error('   '))).toBe('')
  })

  it('traduce los errores de red', () => {
    expect(getErrorDescription(new Error('Failed to fetch'))).toBe(
      'No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.',
    )
  })

  it('delega en getErrorMessage para otros valores', () => {
    expect(getErrorDescription('  motivo  ')).toBe('motivo')
    expect(getErrorDescription({ detail: 'detalle' })).toBe('detalle')
  })
})
