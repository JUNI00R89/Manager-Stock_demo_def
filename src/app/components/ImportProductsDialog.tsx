import { useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, FolderPlus, SkipForward, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { dataService, type ImportReport } from '../services/dataService';
import { toastError } from '../utils/notifications';

type Props = { open: boolean; onOpenChange: (open: boolean) => void; onImported: () => void };

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
  reader.readAsDataURL(file);
});

/** Upload a spreadsheet, preview what would be created, then confirm. */
export function ImportProductsDialog({ open, onOpenChange, onImported }: Props) {
  const [file, setFile] = useState<{ name: string; dataUrl: string } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  const close = (next: boolean) => {
    if (busy) return;
    if (!next) { setFile(null); setReport(null); }
    onOpenChange(next);
  };

  const downloadTemplate = async () => {
    try {
      const template = await dataService.getProductImportTemplate();
      const link = document.createElement('a');
      link.href = template.dataUrl;
      link.download = template.fileName;
      link.click();
    } catch (error) { toastError(error, 'No se pudo descargar la plantilla.'); }
  };

  const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = ''; // lets the same file be picked again after fixing it
    if (!picked) return;
    setBusy(true);
    setReport(null);
    try {
      const dataUrl = await readAsDataUrl(picked);
      setFile({ name: picked.name, dataUrl });
      setReport(await dataService.previewProductImport(picked.name, dataUrl));
    } catch (error) {
      setFile(null);
      toastError(error, 'No se pudo leer el archivo.');
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const result = await dataService.importProducts(file.name, file.dataUrl);
      toast.success(`${result.created} productos importados`);
      onImported();
      setBusy(false);
      setFile(null); setReport(null); onOpenChange(false);
    } catch (error) {
      toastError(error, 'No se pudo importar el archivo.');
      setBusy(false);
    }
  };

  const count = report?.toCreate.length ?? 0;
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar productos</DialogTitle>
          <DialogDescription>Sube un Excel o CSV. Solo se crean productos nuevos; los códigos que ya existen se saltan.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button type="button" variant="outline" className="w-full rounded-xl" onClick={() => void downloadTemplate()}><Download className="mr-2 h-4 w-4" />Descargar plantilla</Button>
          <div className="space-y-2">
            <Label htmlFor="import-file">Archivo (.xlsx o .csv)</Label>
            <input id="import-file" type="file" accept=".xlsx,.csv" disabled={busy} onChange={event => void pick(event)} className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:py-2 file:text-sm" />
            {file && <p className="flex items-center gap-1 text-xs text-muted-foreground"><FileSpreadsheet className="h-3.5 w-3.5" />{file.name}</p>}
          </div>

          {busy && !report && <p className="text-sm text-muted-foreground">Leyendo el archivo…</p>}
          {report && (
            <section aria-label="Vista previa" className="space-y-2 rounded-xl border border-border/70 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-emerald-600" />{count === 1 ? '1 producto se creará' : `${count} productos se crearán`}</p>
              {report.skipped.length > 0 && <p className="flex items-start gap-2"><SkipForward className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />{report.skipped.length === 1 ? '1 ya existe' : `${report.skipped.length} ya existen`} (se saltan): {report.skipped.map(item => `${item.sku || item.name}${item.archived ? ' (archivado)' : ''}`).join(', ')}</p>}
              {report.newCategories.length > 0 && <p className="flex items-start gap-2"><FolderPlus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />Categorías nuevas: {report.newCategories.join(', ')}</p>}
              {report.errors.length > 0 && <div className="space-y-1">
                <p className="flex items-center gap-2 font-medium text-rose-600"><XCircle className="h-4 w-4" />{report.errors.length === 1 ? '1 fila con error' : `${report.errors.length} filas con error`}</p>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto pl-6 text-xs text-muted-foreground">
                  {report.errors.map(error => <li key={error.row}>Fila {error.row}: {error.message}</li>)}
                </ul>
              </div>}
            </section>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={busy}>Cancelar</Button>
          {report && <Button type="button" onClick={() => void confirm()} disabled={busy || count === 0} className="bg-orange-600 text-white hover:bg-orange-700">{count === 1 ? 'Importar 1 producto' : `Importar ${count} productos`}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
