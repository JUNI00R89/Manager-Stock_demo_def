import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { DesignModeProvider, useDesignMode } from './DesignModeContext'

function Consumer() {
  const { designMode, setDesignMode } = useDesignMode()
  return (
    <div>
      <span>{designMode}</span>
      <button type="button" onClick={() => setDesignMode('classic')}>Usar clásico</button>
      <button type="button" onClick={() => setDesignMode('editorial')}>Usar editorial</button>
    </div>
  )
}

describe('DesignModeProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.design
  })

  it('usa el diseño editorial por defecto y lo marca antes de pintar', () => {
    render(<DesignModeProvider><Consumer /></DesignModeProvider>)

    expect(screen.getByText('editorial')).toBeInTheDocument()
    expect(document.documentElement.dataset.design).toBe('editorial')
  })

  it('respeta el modo clásico guardado en el dispositivo', () => {
    localStorage.setItem('designMode', 'classic')

    render(<DesignModeProvider><Consumer /></DesignModeProvider>)

    expect(screen.getByText('classic')).toBeInTheDocument()
    expect(document.documentElement.dataset.design).toBe('classic')
  })

  it('cambia el atributo global y guarda la preferencia', () => {
    render(<DesignModeProvider><Consumer /></DesignModeProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Usar clásico' }))

    expect(document.documentElement.dataset.design).toBe('classic')
    expect(localStorage.getItem('designMode')).toBe('classic')

    fireEvent.click(screen.getByRole('button', { name: 'Usar editorial' }))

    expect(document.documentElement.dataset.design).toBe('editorial')
    expect(localStorage.getItem('designMode')).toBe('editorial')
  })
})
