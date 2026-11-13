import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Layout } from '../components/Layout';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { Switch } from '../components/ui/switch';
import { imagesEnabled } from '../utils/productImage';
import {
  Settings as SettingsIcon,
  Store,
  DollarSign,
  Building2,
  Save,
  RefreshCw,
  CheckCircle,
  LayoutTemplate,
  LayoutGrid,
  Check
} from 'lucide-react';
import { useBusiness, BusinessConfig, DEFAULT_BUSINESS_THEMES, resolveThemeColors, type BusinessTheme } from '../context/BusinessContext';
import { useTheme } from '../context/ThemeContext';
import { useDesignMode } from '../context/DesignModeContext';
import { toast } from 'sonner';
import { toastError } from '../utils/notifications';
import { ConfirmActionDialog } from '../components/ConfirmActionDialog';

export function Settings() {
  const navigate = useNavigate();
  const { config, setConfig } = useBusiness();
  const { setTheme } = useTheme();
  const { designMode, setDesignMode } = useDesignMode();

  const [saving, setSaving] = useState(false);
  const [showReconfigureConfirm, setShowReconfigureConfirm] = useState(false);
  const [formData, setFormData] = useState({
    name: config?.name || '',
    taxRate: ((config?.taxRate ?? 0.19) * 100).toFixed(2),
    currency: config?.currency || 'COP'
  });
  const [themeDraft, setThemeDraft] = useState<BusinessTheme>(config?.theme ?? DEFAULT_BUSINESS_THEMES.retail);
  const [showPhotos, setShowPhotos] = useState(imagesEnabled(config));
  useEffect(() => { setShowPhotos(imagesEnabled(config)); }, [config?.features.productImages]);

  useEffect(() => {
    if (!config) return;
    setFormData({ name: config.name || '', taxRate: ((config.taxRate ?? 0.19) * 100).toFixed(2), currency: config.currency || 'COP' });
    setThemeDraft(config.theme ?? DEFAULT_BUSINESS_THEMES[config.type]);
  }, [config?.name, config?.type, config?.taxRate, config?.theme?.primary, config?.theme?.secondary, config?.theme?.accent, config?.theme?.background, config?.theme?.surface, config?.theme?.mode]);

  const activeBackground = themeDraft.mode === 'dark' ? (themeDraft.darkBackground || '#0D0D10') : (themeDraft.lightBackground || themeDraft.background);
  const activeSurface = themeDraft.mode === 'dark' ? (themeDraft.darkSurface || '#17171B') : (themeDraft.lightSurface || themeDraft.surface);
  // El modo claro mezcla la paleta con salvia para bajar el brillo; la vista
  // previa debe usar exactamente los mismos colores que la aplicación real.
  const previewColors = resolveThemeColors(themeDraft);
  const changeThemeColor = (key: 'primary' | 'secondary' | 'accent' | 'background' | 'surface', value: string) => {
    setThemeDraft(previous => {
      if (key === 'background') return previous.mode === 'dark' ? { ...previous, darkBackground: value, customized: true } : { ...previous, background: value, lightBackground: value, customized: true };
      if (key === 'surface') return previous.mode === 'dark' ? { ...previous, darkSurface: value, customized: true } : { ...previous, surface: value, lightSurface: value, customized: true };
      return { ...previous, [key]: value, customized: true };
    });
  };

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--brand-primary', themeDraft.primary);
    root.style.setProperty('--brand-secondary', themeDraft.secondary);
    root.style.setProperty('--brand-accent', themeDraft.accent);
    root.style.setProperty('--brand-background', previewColors.background);
    root.style.setProperty('--brand-surface', previewColors.surface);
    root.style.setProperty('--brand-soft', `${themeDraft.primary}14`);
    root.dataset.businessTheme = themeDraft.mode;
    setTheme(themeDraft.mode);
  }, [themeDraft, previewColors.background, previewColors.surface, setTheme]);

  const handleSave = async () => {
    if (!config || !formData.name.trim()) {
      toast.error('El nombre del negocio es requerido');
      return;
    }

    const taxRate = parseFloat(formData.taxRate) / 100;
    if (isNaN(taxRate) || taxRate < 0 || taxRate > 1) {
      toast.error('La tasa de impuesto debe estar entre 0 y 100');
      return;
    }

    const updatedConfig: BusinessConfig = {
      ...config,
      name: formData.name.trim(),
      taxRate: taxRate,
      currency: 'COP',
      theme: themeDraft,
      features: { ...config.features, productImages: showPhotos },
    };

    setSaving(true);
    try {
      await setConfig(updatedConfig);
      toast.success('Configuración guardada en la base de datos.');
    } catch (error) {
      toastError(error, 'No se pudo guardar la configuración.');
    } finally { setSaving(false); }
  };

  const saveAppearance = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const savedTheme = { ...themeDraft };
      await setConfig({ ...config, theme: savedTheme });
      setTheme(savedTheme.mode);
      toast.success('Apariencia guardada para este negocio.');
    } catch (error) {
      toastError(error, 'No se pudo guardar la apariencia.');
    } finally { setSaving(false); }
  };

  const cancelAppearance = () => setThemeDraft(config?.theme ?? DEFAULT_BUSINESS_THEMES[config?.type ?? 'retail']);
  const resetAppearance = () => setThemeDraft({ ...DEFAULT_BUSINESS_THEMES[config?.type ?? 'retail'] });

  const handleReconfigure = () => setShowReconfigureConfirm(true);
  const confirmReconfigure = () => {
    toast.info('Selecciona el nuevo tipo de negocio. Los registros existentes se conservarán.');
    navigate('/business-setup?reconfigure=1');
  };

  const getBusinessTypeName = (type: string) => {
    const types = {
      retail: 'Tienda / Retail',
      restaurant: 'Negocio de comidas',
      hotel: 'Hotel / Hospedaje',
      warehouse: 'Bodega / Almacén',
      services: 'Servicios'
    };
    return types[type as keyof typeof types] || type;
  };

  const getActiveFeatures = () => {
    if (!config) return [];

    const features = [];
    if (config.features.inventory) features.push('Inventario');
    if (config.features.pos) features.push('Punto de Venta');
    if (config.features.reservations) features.push('Reservaciones');
    if (config.features.tables) features.push('Gestión de Mesas');
    if (config.features.rooms) features.push('Gestión de Habitaciones');
    if (config.features.warehouse) features.push('Gestión de Bodega');
    if (config.type === 'services' && config.features.services) features.push('Gestión de citas y servicios');

    return features;
  };

  if (!config) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-muted-foreground">No se ha configurado el negocio</p>
          <Button
            onClick={() => navigate('/business-setup')}
            disabled={saving}
                className="mt-4 bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600"
          >
            Configurar Negocio
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-3xl font-bold text-foreground">Configuración</h2>
          <p className="text-muted-foreground mt-1">Administra la configuración de tu negocio</p>
        </div>

        {/* Design mode: preferencia local, reversible en cualquier momento. */}
        <Card className="rounded-2xl border-border/70 p-6 shadow-sm">
          <div className="mb-5 flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-primary)]">
              <LayoutTemplate size={21} />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Diseño de la interfaz</h3>
              <p className="mt-1 text-sm text-muted-foreground">Elige cómo se ve la aplicación en este dispositivo. El cambio se aplica al instante y no modifica tus datos ni la configuración del negocio.</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              aria-pressed={designMode === 'editorial'}
              onClick={() => setDesignMode('editorial')}
              className={`group relative rounded-xl border p-4 text-left transition ${designMode === 'editorial' ? 'border-[var(--brand-primary)] bg-[var(--brand-soft)]' : 'border-border hover:border-foreground/30'}`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <LayoutTemplate size={16} className="text-[var(--brand-primary)]" />
                Editorial
                <span className="rounded-full bg-[var(--brand-primary)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">Nuevo</span>
                {designMode === 'editorial' && <Check size={16} className="ml-auto text-[var(--brand-primary)]" />}
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">Líneas finas, tipografía con carácter y superficies planas, sin sombras ni cristal.</span>
              <span className="mt-4 block rounded-md border border-border bg-background p-2.5" aria-hidden="true">
                <span className="block h-1.5 w-10 rounded-full bg-[var(--brand-primary)]" />
                <span className="mt-2 block h-1 w-full rounded-full bg-foreground/15" />
                <span className="mt-1 block h-1 w-3/4 rounded-full bg-foreground/10" />
              </span>
            </button>

            <button
              type="button"
              aria-pressed={designMode === 'classic'}
              onClick={() => setDesignMode('classic')}
              className={`group relative rounded-xl border p-4 text-left transition ${designMode === 'classic' ? 'border-[var(--brand-primary)] bg-[var(--brand-soft)]' : 'border-border hover:border-foreground/30'}`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <LayoutGrid size={16} className="text-muted-foreground" />
                Clásico
                {designMode === 'classic' && <Check size={16} className="ml-auto text-[var(--brand-primary)]" />}
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">El diseño original de Manager Stock, con sus tarjetas suaves y controles redondeados.</span>
              <span className="mt-4 block rounded-lg border border-border bg-background p-2.5 shadow-sm" aria-hidden="true">
                <span className="block h-1.5 w-10 rounded-full bg-foreground/30" />
                <span className="mt-2 block h-1 w-full rounded-full bg-foreground/15" />
                <span className="mt-1 block h-1 w-3/4 rounded-full bg-foreground/10" />
              </span>
            </button>
          </div>

          <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle size={14} className="text-green-600" />
            La preferencia se guarda solo en este dispositivo y puedes cambiarla cuando quieras.
          </p>
        </Card>

        <Card className="rounded-2xl border-border/70 p-6 shadow-sm">
          <div className="mb-5 flex items-start gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-primary)]"><SettingsIcon size={21}/></div><div><h3 className="text-lg font-semibold">Personalización de apariencia</h3><p className="mt-1 text-sm text-muted-foreground">Ajusta la marca visual de tu negocio. La vista previa se actualiza al cambiar los colores.</p></div></div>
          <div className="mb-5 flex flex-wrap gap-2">
            {([
              { label: 'Predeterminado', theme: DEFAULT_BUSINESS_THEMES[config?.type ?? 'retail'] },
              { label: 'Azul petróleo', theme: DEFAULT_BUSINESS_THEMES.retail },
              { label: 'Terracota', theme: DEFAULT_BUSINESS_THEMES.restaurant },
              { label: 'Grafito', theme: DEFAULT_BUSINESS_THEMES.warehouse },
              { label: 'Verde servicios', theme: DEFAULT_BUSINESS_THEMES.services },
              { label: 'Salvia hotel', theme: DEFAULT_BUSINESS_THEMES.hotel },
              { label: 'Naranja', theme: { primary: '#F26A1B', secondary: '#FF8A4C', accent: '#FFC09B', background: '#F4F4F6', surface: '#FFFFFF', lightBackground: '#F4F4F6', lightSurface: '#FFFFFF', darkBackground: '#0D0D10', darkSurface: '#17171B', mode: themeDraft.mode, customized: true } },
            ]).map(preset => (
              <button key={preset.label} type="button" onClick={() => setThemeDraft(prev => ({ ...preset.theme, mode: prev.mode, customized: true }))} className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium transition hover:border-[var(--brand-primary)]">
                <span className="flex overflow-hidden rounded-full border border-border/60"><span className="h-3.5 w-3.5" style={{ backgroundColor: preset.theme.primary }} /><span className="h-3.5 w-3.5" style={{ backgroundColor: preset.theme.secondary }} /><span className="h-3.5 w-3.5" style={{ backgroundColor: preset.theme.accent }} /></span>
                {preset.label}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {([['primary','Color principal'], ['secondary','Color secundario'], ['accent','Color de acento'], ['background','Fondo de la interfaz'], ['surface','Tarjetas y superficies']] as const).map(([key, label]) => {
              const value = key === 'background' ? activeBackground : key === 'surface' ? activeSurface : themeDraft[key];
              return <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"><span className="text-sm font-medium">{label}</span><span className="flex items-center gap-2"><span className="font-mono text-xs text-muted-foreground">{value}</span><input aria-label={label} type="color" value={value} onChange={event => changeThemeColor(key, event.target.value)} className="h-9 w-11 cursor-pointer rounded-lg border border-border bg-transparent p-1"/></span></label>;
            })}
            <label className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"><span className="text-sm font-medium">Modo de interfaz</span><select value={themeDraft.mode} onChange={event => setThemeDraft(prev => ({ ...prev, mode: event.target.value as 'light' | 'dark', customized: true }))} className="rounded-lg border border-input bg-background px-3 py-2 text-sm"><option value="light">Claro</option><option value="dark">Oscuro</option></select></label>
          </div>
          <div className="mt-5 rounded-2xl border border-border p-4" style={{ backgroundColor: previewColors.background, color: themeDraft.mode === 'dark' ? '#F4F7F8' : '#26312B' }}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider opacity-70">Vista previa</p><p className="mt-1 text-lg font-semibold">{config.name || 'Nombre del negocio'}</p><p className="mt-1 text-sm opacity-75">Así se verán tus componentes principales.</p></div><div className="rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm" style={{ backgroundColor: themeDraft.primary }}>Acción principal</div></div><div className="mt-4 grid grid-cols-3 gap-2"><div className="rounded-lg p-3 text-xs font-medium" style={{ backgroundColor: previewColors.surface, color: themeDraft.mode === 'dark' ? '#F4F7F8' : '#26312B' }}>Panel principal</div><div className="rounded-lg p-3 text-xs font-medium" style={{ backgroundColor: themeDraft.secondary, color: '#FFFFFF' }}>Secundario</div><div className="rounded-lg p-3 text-xs font-medium" style={{ backgroundColor: themeDraft.accent, color: '#26312B' }}>Acento</div></div></div>
          <div className="mt-5 flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={cancelAppearance}>Cancelar</Button><Button type="button" variant="outline" onClick={resetAppearance}>Restaurar predeterminados</Button><Button type="button" onClick={() => void saveAppearance()} disabled={saving} className="bg-[var(--brand-primary)] text-white hover:opacity-90"><Save size={16} className="mr-2"/>{saving ? 'Guardando…' : 'Guardar apariencia'}</Button></div>
        </Card>

        {/* Business Type Card */}
        <Card className="p-6 border-2 border-orange-200">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-yellow-500 rounded-lg flex items-center justify-center">
                <Building2 className="text-white" size={24} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">Tipo de Negocio</h3>
                <p className="text-sm text-muted-foreground">Configuración actual del sistema</p>
              </div>
            </div>
            <Badge className="bg-gradient-to-r from-orange-500 to-yellow-500 text-white">
              {getBusinessTypeName(config.type)}
            </Badge>
          </div>

          <Separator className="my-4" />

          <div className="space-y-3">
            <h4 className="font-semibold text-foreground flex items-center gap-2">
              <CheckCircle size={18} className="text-green-600" />
              Funcionalidades Activas
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {getActiveFeatures().map((feature) => (
                <div
                  key={feature}
                  className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700 font-medium"
                >
                  {feature}
                </div>
              ))}
            </div>
          </div>

          <Separator className="my-4" />

          <Button
            variant="outline"
            onClick={handleReconfigure}
            className="border-orange-300 text-orange-700 hover:bg-orange-50"
          >
            <RefreshCw size={18} className="mr-2" />
            Cambiar Tipo de Negocio
          </Button>
        </Card>

        {/* General Settings */}
        <Card className="p-6 border-2 border-orange-200">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-lg flex items-center justify-center">
              <SettingsIcon className="text-white" size={24} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Configuración General</h3>
              <p className="text-sm text-muted-foreground">Ajusta los parámetros de tu negocio</p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="businessName" className="text-foreground">
                Nombre del Negocio
              </Label>
              <div className="relative">
                <Store className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <Input
                  id="businessName"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="pl-10 border-orange-200"
                  placeholder="Nombre de tu negocio"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
              <div>
                <Label htmlFor="show-product-photos" className="text-foreground">Mostrar fotos en el punto de venta</Label>
                <p className="mt-1 text-xs text-muted-foreground">Las fotos de los productos aparecen en las tarjetas de POS, Mesero y Mesas. Los productos sin foto se ven igual.</p>
              </div>
              <Switch id="show-product-photos" checked={showPhotos} onCheckedChange={setShowPhotos} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="taxRate" className="text-foreground">
                  Tasa de Impuesto (%)
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
                    %
                  </span>
                  <Input
                    id="taxRate"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.taxRate}
                    onChange={(e) => setFormData({ ...formData, taxRate: e.target.value })}
                    className="pl-8 border-orange-200"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Impuesto aplicado en ventas (ej: IVA, IGV, IVU)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="currency" className="text-foreground">
                  Moneda
                </Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                  <Input id="currency" value="COP" readOnly className="pl-10 border-orange-200 bg-muted/40" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Peso colombiano. La multimoneda no está habilitada todavía porque requiere cálculos y reportes compatibles con cada divisa.
                </p>
              </div>
            </div>

            <Separator />

            <div className="flex gap-3">
              <Button
                onClick={() => void handleSave()}
                className="flex-1 bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600"
              >
                <Save size={20} className="mr-2" />
                Guardar Cambios
              </Button>
            </div>
          </div>
        </Card>

        {/* Info Card */}
        <Card className="p-6 border-2 border-blue-200 bg-blue-50">
          <div className="flex gap-3">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                <SettingsIcon className="text-white" size={20} />
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-blue-900 mb-1">Nota sobre la configuración</h4>
              <p className="text-sm text-blue-700">
                Los cambios en la configuración general se aplicarán de inmediato. Si cambias el tipo de negocio,
                algunas funcionalidades podrían activarse o desactivarse según el tipo seleccionado.
              </p>
            </div>
          </div>
        </Card>
      </div>
      <ConfirmActionDialog
        open={showReconfigureConfirm}
        onOpenChange={setShowReconfigureConfirm}
        title="Reconfigurar tipo de negocio"
        description="¿Estás seguro de que quieres reconfigurar el tipo de negocio? Esto puede cambiar los módulos disponibles, pero los registros existentes se conservarán."
        confirmLabel="Continuar"
        onConfirm={confirmReconfigure}
      />
    </Layout>
  );
}
