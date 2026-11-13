import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportReport } from '../services/dataService'

const previewMock = vi.fn<(fileName: string, dataUrl: string) => Promise<ImportReport>>()

vi.mock('../services/dataService', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/dataService')>()),
  dataService: { previewProductImport: (...args: [string, string]) => previewMock(...args) },
}))

import { ImportProductsDialog } from './ImportProductsDialog'

const report = (toCreate: ImportReport['toCreate']): ImportReport => ({
  toCreate,
  skipped: [{ row: 5, sku: 'AG1', name: 'Agua' }, { row: 6, sku: '', name: 'Pan blanco' }],
  errors: [{ row: 8, message: 'Falta el precio.' }],
  newCategories: ['Aseo'],
  created: 0,
})

async function pickFile() {
  render(<ImportProductsDialog open onOpenChange={() => {}} onImported={() => {}} />)
  await userEvent.upload(screen.getByLabelText(/archivo/i), new File(['x'], 'productos.xlsx'))
}

describe('ImportProductsDialog', () => {
  beforeEach(() => previewMock.mockReset())

  it('muestra el resumen de la vista previa y habilita importar', async () => {
    previewMock.mockResolvedValue(report([
      { row: 2, sku: 'LE1', name: 'Leche', category: 'Lácteos' },
      { row: 3, sku: 'QU1', name: 'Queso', category: 'Lácteos' },
    ]))
    await pickFile()

    expect(await screen.findByText(/2 productos se crearán/)).toBeTruthy()
    expect(screen.getByText(/AG1/)).toBeTruthy()
    expect(screen.getByText(/Pan blanco/)).toBeTruthy() // skipped by name: no code to show
    expect(screen.getByText('Fila 8: Falta el precio.')).toBeTruthy()
    expect(screen.getByText(/Aseo/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Importar 2 productos' }) as HTMLButtonElement).disabled).toBe(false)
    expect(previewMock).toHaveBeenCalledWith('productos.xlsx', expect.stringMatching(/^data:/))
  })

  it('no deja importar si no hay productos nuevos', async () => {
    previewMock.mockResolvedValue(report([]))
    await pickFile()

    expect(await screen.findByText(/0 productos se crearán/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Importar 0 productos' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
