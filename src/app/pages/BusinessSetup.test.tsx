import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '../context/AuthContext'
import { BusinessProvider } from '../context/BusinessContext'
import { ThemeProvider } from '../context/ThemeContext'
import { BusinessSetup } from './BusinessSetup'

describe('BusinessSetup – negocio de comidas', () => {
  it('no ofrece el módulo Domicilios, que no tiene pantalla', async () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <AuthProvider>
            <BusinessProvider>
              <BusinessSetup />
            </BusinessProvider>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByText('Negocio de comidas'))

    // El paso entra con animación (AnimatePresence), por eso se espera.
    expect(await screen.findByText('Mapa de mesas y comandas', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByText('Gestión de repartidores')).not.toBeInTheDocument()
  })
})
