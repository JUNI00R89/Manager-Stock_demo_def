import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from './badge'

describe('Badge', () => {
  it('renderiza el texto', () => {
    render(<Badge>Activo</Badge>)

    expect(screen.getByText('Activo')).toBeInTheDocument()
  })

  it('aplica la variante visual', () => {
    render(<Badge variant="destructive">Suspendido</Badge>)

    expect(screen.getByText('Suspendido')).toHaveClass('bg-destructive')
  })

  it('permite renderizar como enlace con asChild', () => {
    render(
      <Badge asChild>
        <a href="/estado">Ver estado</a>
      </Badge>,
    )

    expect(screen.getByRole('link', { name: 'Ver estado' })).toHaveAttribute('href', '/estado')
  })
})
