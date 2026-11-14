import { useEffect, useState } from 'react';
import { Save, Settings as SettingsIcon } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../utils/notifications';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { dataService, type InventorySettingsRecord } from '../../services/dataService';
import { PageTitle, StatCard, useWarehousePermissions, useWarehouseRefs } from './shared';

export function WarehouseSettings() {
  const { locations, settings: loadedSettings, loading, reload } = useWarehouseRefs();
  const permissions = useWarehousePermissions();
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [expiryAlertDays, setExpiryAlertDays] = useState(30);
  const [lowStockAlerts, setLowStockAlerts] = useState(true);
  const [defaultLocationId, setDefaultLocationId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loadedSettings) {
      setAllowNegativeStock(Boolean(loadedSettings.allowNegativeStock));
      setExpiryAlertDays(Number(loadedSettings.expiryAlertDays) || 30);
      setLowStockAlerts(Boolean(loadedSettings.lowStockAlerts));
      setDefaultLocationId(loadedSettings.defaultLocationId || '');
    }
  }, [loadedSettings]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (expiryAlertDays < 0 || expiryAlertDays > 3650) {
      toast.error('El umbral de alertas de vencimiento debe estar entre 0 y 3650 días.');
      return;
    }
    if (permissions.canNegative && !allowNegativeStock) {
      /* sin acción */
    }
    setSaving(true);
    try {
      const updated = await dataService.updateInventorySettings({
        allowNegativeStock,
        expiryAlertDays,
        lowStockAlerts,
        defaultLocationId: defaultLocationId || null,
      });
      toast.success('Configuración de bodega guardada.');
      await Promise.all([reload(), reload()]);
    } catch (error) {
      toastError(error, 'No se pudo guardar la configuración.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-5xl space-y-6">
        <PageTitle
          eyebrow="Bodega · Configuración"
          title="Configuración de bodega"
          description="Controla políticas de stock negativo, alertas de vencimiento y ubicación por defecto."
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Stock negativo permitido"
            value={String(allowNegativeStock)}
            hint="Requiere permiso delegable"
            icon={SettingsIcon}
            tone={allowNegativeStock ? 'amber' : 'emerald'}
          />
          <StatCard
            label="Días para alerta de vencimiento"
            value={String(expiryAlertDays)}
            hint="Lote por vencer o vencido"
            icon={SettingsIcon}
            tone="blue"
          />
          <StatCard
            label="Alertas de stock bajo"
            value={String(lowStockAlerts)}
            hint="Basadas en mínimo"
            icon={SettingsIcon}
            tone="orange"
          />
        </div>

        <Card className="rounded-2xl border-border/70 p-5 shadow-sm sm:p-6">
          <form onSubmit={save} className="space-y-6">
            <div className="flex items-start justify-between gap-3 rounded-xl border border-border/70 p-4">
              <div>
                <h2 className="font-semibold">Política de stock</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Permite salidas y ajustes que exceden las existencias registradas.
                </p>
              </div>
              <Switch
                checked={allowNegativeStock}
                onCheckedChange={setAllowNegativeStock}
                disabled={saving || (!permissions.canNegative && false)}
                className="data-[state=checked]:bg-orange-600"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="expiry">Días de alerta de vencimiento</Label>
                <Input
                  id="expiry"
                  type="number"
                  min="0"
                  max="3650"
                  value={expiryAlertDays}
                  onChange={event => setExpiryAlertDays(Number(event.target.value) || 0)}
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Ubicación por defecto</Label>
                <select
                  id="location"
                  value={defaultLocationId}
                  onChange={event => setDefaultLocationId(event.target.value)}
                  className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option value="">Sin ubicación predeterminada</option>
                  {locations.map(location => (
                    <option key={location.id} value={location.id}>
                      {location.code} · {location.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 p-4">
              <div>
                <h2 className="font-semibold">Alertas de stock bajo</h2>
                <p className="mt-1 text-xs text-muted-foreground">Muestra avisos cuando el stock llega al mínimo.</p>
              </div>
              <Switch
                checked={lowStockAlerts}
                onCheckedChange={setLowStockAlerts}
                disabled={saving}
                className="data-[state=checked]:bg-orange-600"
              />
            </div>
            <div className="flex justify-end border-t border-border/70 pt-5">
              <Button
                type="submit"
                disabled={saving || loading}
                className="rounded-xl bg-orange-600 text-white hover:bg-orange-700"
              >
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Guardando…' : 'Guardar configuración'}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </Layout>
  );
}
