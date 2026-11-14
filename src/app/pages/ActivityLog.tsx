import { useEffect, useState } from 'react';
import { Activity, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../utils/notifications';
import { Layout } from '../components/Layout';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { dataService, type AuditLogRecord } from '../services/dataService';

const dateTime = (value: string) =>
  new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const actionLabel: Record<string, string> = {
  create: 'Creación',
  update: 'Actualización',
  archive: 'Retiro',
  delete: 'Eliminación',
  cancel: 'Anulación',
  close: 'Cierre',
  open: 'Apertura',
  status_change: 'Cambio de estado',
};
const entityLabel: Record<string, string> = {
  sale: 'Venta',
  product: 'Producto',
  supplier: 'Proveedor',
  order: 'Pedido',
  cash_session: 'Turno de caja',
  recipe: 'Receta',
};

export function ActivityLog() {
  const [rows, setRows] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try {
      setRows(await dataService.getAuditLog(300));
    } catch (error) {
      toastError(error, 'No se pudo consultar la actividad.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <Layout>
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[.16em] text-orange-600">Control y trazabilidad</p>
            <h1 className="mt-1 flex items-center gap-2 text-3xl font-bold tracking-tight">
              <Activity className="h-7 w-7 text-orange-600" /> Actividad del sistema
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Consulta acciones registradas por la API, como ventas, anulaciones, cambios de estado y movimientos de
              caja. Estos eventos ayudan a investigar discrepancias.
            </p>
          </div>
          <Button variant="outline" onClick={() => void load()} className="rounded-xl">
            <RefreshCw className="mr-2 h-4 w-4" />
            Actualizar
          </Button>
        </header>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="rounded-2xl border-border/70 p-5">
            <p className="text-sm text-muted-foreground">Eventos cargados</p>
            <p className="mt-2 text-3xl font-bold">{rows.length}</p>
          </Card>
          <Card className="rounded-2xl border-border/70 p-5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-emerald-600" /> Registro de auditoría
            </div>
            <p className="mt-2 font-semibold">Activo en modo API</p>
            <p className="mt-1 text-xs text-muted-foreground">Los eventos se guardan en SQLite.</p>
          </Card>
          <Card className="rounded-2xl border-border/70 p-5">
            <p className="text-sm text-muted-foreground">Cobertura</p>
            <p className="mt-2 font-semibold">Operaciones críticas</p>
            <p className="mt-1 text-xs text-muted-foreground">El alcance depende de cada endpoint instrumentado.</p>
          </Card>
        </div>
        <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-4">Fecha</th>
                  <th className="px-5 py-4">Acción</th>
                  <th className="px-5 py-4">Entidad</th>
                  <th className="px-5 py-4">Referencia</th>
                  <th className="px-5 py-4">Detalles</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center text-muted-foreground">
                      Cargando registro de actividad…
                    </td>
                  </tr>
                ) : (
                  rows.map(row => (
                    <tr key={row.id} className="align-top hover:bg-muted/20">
                      <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{dateTime(row.createdAt)}</td>
                      <td className="px-5 py-4">
                        <Badge variant="outline" className="rounded-lg">
                          {actionLabel[row.action] || row.action}
                        </Badge>
                      </td>
                      <td className="px-5 py-4 font-medium">{entityLabel[row.entityType] || row.entityType}</td>
                      <td className="px-5 py-4 font-mono text-xs">{row.entityId}</td>
                      <td className="max-w-md px-5 py-4">
                        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-muted-foreground">
                          {JSON.stringify(row.details, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {!loading && rows.length === 0 && (
            <div className="p-12 text-center">
              <Activity className="mx-auto mb-3 h-9 w-9 text-muted-foreground/50" />
              <p className="font-semibold">No hay eventos registrados</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Inicia la API y realiza una operación para verla aquí.
              </p>
            </div>
          )}
          <div className="border-t border-border/70 px-5 py-3 text-xs leading-5 text-muted-foreground">
            El registro es una herramienta de diagnóstico, no una auditoría regulatoria certificada. La autenticación
            por roles todavía debe implementarse en el backend antes de desplegar públicamente.
          </div>
        </Card>
      </div>
    </Layout>
  );
}
