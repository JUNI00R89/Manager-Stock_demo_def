import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './button'

describe('Button', () => {
  it('renderiza el contenido y responde al clic', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Guardar</Button>)

    const button = screen.getByRole('button', { name: 'Guardar' })
    expect(button).toBeInTheDocument()

    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('no dispara el clic cuando está deshabilitado', async () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>Guardar</Button>)

    const button = screen.getByRole('button', { name: 'Guardar' })
    expect(button).toBeDisabled()

    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('aplica las clases de variante y tamaño', () => {
    render(<Button variant="destructive" size="lg">Eliminar</Button>)

    const button = screen.getByRole('button', { name: 'Eliminar' })
    expect(button).toHaveClass('bg-destructive')
    expect(button).toHaveClass('h-10')
  })

  it('permite renderizar como enlace con asChild', () => {
    render(
      <Button asChild>
        <a href="/inicio">Inicio</a>
      </Button>,
    )

    expect(screen.getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/inicio')
  })
})
