import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import {
  Store,
  UtensilsCrossed,
  Hotel,
  Warehouse,
  Scissors,
  ChevronRight,
  ChevronLeft,
  Check,
  Sandwich,
  Building2,
  ShoppingBag,
  Bike,
  Armchair,
  Pizza,
  Soup,
  Beef,
  CookingPot,
  Pencil,
  ClipboardList,
  Wallet,
  Package,
  type LucideIcon,
} from 'lucide-react';
import {
  useBusiness,
  DEFAULT_CONFIGS,
  DEFAULT_BUSINESS_THEMES,
  type BusinessType,
  type BusinessConfig,
  type FoodBusinessConfig,
} from '../context/BusinessContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { toast } from 'sonner';
import { toastError } from '../utils/notifications';

// ─── Business type cards ─────────────────────────────────────────────────────

const BUSINESS_TYPES = [
  {
    type: 'retail' as BusinessType,
    icon: Store,
    label: 'Tienda / Retail',
    desc: 'Venta de productos, control de stock e inventario',
    color: 'text-blue-600',
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    ring: 'ring-blue-500',
  },
  {
    type: 'restaurant' as BusinessType,
    icon: Sandwich,
    label: 'Negocio de comidas',
    desc: 'Hamburgueserías, fondas, empanadas, comida rápida y más',
    color: 'text-orange-600',
    bg: 'bg-orange-50 dark:bg-orange-950/40',
    ring: 'ring-orange-500',
    isFood: true,
  },
  {
    type: 'hotel' as BusinessType,
    icon: Hotel,
    label: 'Hotel / Hospedaje',
    desc: 'Habitaciones, reservas y servicio al huésped',
    color: 'text-purple-600',
    bg: 'bg-purple-50 dark:bg-purple-950/40',
    ring: 'ring-purple-500',
  },
  {
    type: 'warehouse' as BusinessType,
    icon: Warehouse,
    label: 'Distribuidora / Bodega',
    desc: 'Control de bodegas, recepciones y despachos',
    color: 'text-gray-600',
    bg: 'bg-gray-50 dark:bg-gray-950/40',
    ring: 'ring-gray-500',
  },
  {
    type: 'services' as BusinessType,
    icon: Scissors,
    label: 'Servicios / Citas',
    desc: 'Peluquerías, spas, consultorios y agendas',
    color: 'text-pink-600',
    bg: 'bg-pink-50 dark:bg-pink-950/40',
    ring: 'ring-pink-500',
  },
];

// ─── Food sub-wizard data ─────────────────────────────────────────────────────

const SERVICE_MODES = [
  { id: 'mostrador', label: 'Mostrador', icon: Store, desc: 'Atención directa al cliente' },
  { id: 'para_llevar', label: 'Para llevar', icon: ShoppingBag, desc: 'El cliente recoge y se va' },
  { id: 'domicilio', label: 'A domicilio', icon: Bike, desc: 'Despacho a la puerta' },
  { id: 'mesas', label: 'Mesas en local', icon: Armchair, desc: 'Clientes que comen aquí' },
];

const FOOD_TYPES = [
  { id: 'hamburguesas', label: 'Hamburguesas', icon: Sandwich },
  { id: 'salchipapas', label: 'Salchipapas', icon: CookingPot },
  { id: 'empanadas', label: 'Empanadas', icon: Soup },
  { id: 'pollo_asados', label: 'Pollo / Asados', icon: Beef },
  { id: 'casera', label: 'Comida casera', icon: CookingPot },
  { id: 'variadas', label: 'Variadas', icon: Pizza },
  { id: 'otro', label: 'Otro', icon: Pencil, custom: true },
];

const MODULE_OPTIONS = [
  { id: 'menu', label: 'Productos / Menú', icon: ClipboardList, desc: 'Tu carta digital' },
  { id: 'pedidos', label: 'Pedidos / Preparación', icon: ClipboardList, desc: 'Control de comandas y cocina' },
  { id: 'caja', label: 'Caja / Ventas', icon: Wallet, desc: 'Cobrar, tickets, cierre' },
  { id: 'inventario', label: 'Inventario', icon: Package, desc: 'Existencias de productos preparados o envasados' },
  { id: 'mesas', label: 'Mesas', icon: Armchair, desc: 'Mapa de mesas y comandas' },
  // 'domicilios' se ofrecerá cuando exista su pantalla; activarlo no mostraba nada.
];

// ─── MultiSelect chip ─────────────────────────────────────────────────────────

interface ChipSelectProps {
  options: { id: string; label: string; icon: LucideIcon; desc?: string; custom?: boolean }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  customValue?: string;
  onCustomChange?: (val: string) => void;
}

function ChipSelect({ options, selected, onChange, customValue = '', onCustomChange }: ChipSelectProps) {
  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => {
        const active = selected.includes(opt.id);
        return (
          <div key={opt.id} className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => toggle(opt.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all
                ${
                  active
                    ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 ring-1 ring-orange-500/50'
                    : 'border-border bg-background text-foreground hover:border-orange-300 hover:bg-orange-50/50 dark:hover:bg-orange-950/20'
                }`}
            >
              <opt.icon size={16} className={active ? 'text-[var(--brand-primary)]' : 'text-muted-foreground'} />
              <span>{opt.label}</span>
              {active && <Check size={12} className="text-orange-500" />}
            </button>
            {opt.custom && active && onCustomChange && (
              <Input
                placeholder="¿Cuál tipo de comida?"
                value={customValue}
                onChange={e => onCustomChange(e.target.value)}
                className="h-8 text-sm w-48"
                autoFocus
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function BusinessSetup() {
  const navigate = useNavigate();
  const { config: existingConfig, setConfig } = useBusiness();
  const isReconfiguring = new URLSearchParams(window.location.search).get('reconfigure') === '1';

  // When reconfiguring, reuse existing values so users only change what they intend to change.
  const knownFoodTypeIds = FOOD_TYPES.map(food => food.id);
  const existingFoodTypes = existingConfig?.foodConfig?.foodTypes ?? [];
  const existingCustomFood = existingFoodTypes.find(food => !knownFoodTypeIds.includes(food));

  // Wizard step: 0 = type, 1 = food config (only restaurant), 2 = name
  const [step, setStep] = useState(0);
  const [selectedType, setSelectedType] = useState<BusinessType | null>(existingConfig?.type ?? null);
  const [businessName, setBusinessName] = useState(existingConfig?.name ?? '');

  // Food sub-wizard state
  const [serviceModes, setServiceModes] = useState<string[]>(existingConfig?.foodConfig?.serviceModes ?? []);
  const [foodTypes, setFoodTypes] = useState<string[]>(
    existingFoodTypes.filter(food => knownFoodTypeIds.includes(food)).concat(existingCustomFood ? ['otro'] : []),
  );
  const [customFood, setCustomFood] = useState(existingCustomFood ?? '');
  const [activeModules, setActiveModules] = useState<string[]>(
    existingConfig?.foodConfig?.activeModules ?? ['menu', 'caja', 'inventario'],
  );
  const [savingConfig, setSavingConfig] = useState(false);

  const isFood = selectedType === 'restaurant';
  const totalSteps = isFood ? 3 : 2;

  const handleSelectType = (type: BusinessType) => {
    setSelectedType(type);
    if (type === 'restaurant') {
      setStep(1);
    } else {
      setStep(isFood ? 2 : 1);
    }
  };

  const handleBack = () => {
    if (step === 2 && isFood) setStep(1);
    else if (step === 1 && isFood) setStep(0);
    else if (step === 1) setStep(0);
    else setStep(0);
  };

  const handleContinueFood = () => {
    const hasCatalog = activeModules.includes('menu') || activeModules.includes('inventario');
    const requiresCatalog = activeModules.includes('caja') || activeModules.includes('pedidos');
    const hasCoreModule = activeModules.some(module => ['menu', 'inventario', 'caja', 'pedidos'].includes(module));
    if (serviceModes.length === 0 || foodTypes.length === 0 || activeModules.length === 0) return;
    if (!hasCoreModule || (requiresCatalog && !hasCatalog)) return;
    if (foodTypes.includes('otro') && !customFood.trim()) return;
    setStep(2);
  };

  const handleFinish = async () => {
    if (!selectedType || !businessName.trim()) return;

    const baseConfig = DEFAULT_CONFIGS[selectedType];
    let foodConfig: FoodBusinessConfig | undefined;
    let features = { ...baseConfig.features };

    if (isFood) {
      const hasMesas = activeModules.includes('mesas');

      features = {
        ...features,
        tables: hasMesas,
        delivery: false,
        pos: activeModules.includes('caja'),
        inventory: activeModules.includes('inventario'),
      };

      const resolvedFoodTypes =
        foodTypes.includes('otro') && customFood.trim()
          ? [...foodTypes.filter(f => f !== 'otro'), customFood.trim()]
          : foodTypes;

      foodConfig = {
        serviceModes,
        foodTypes: resolvedFoodTypes,
        activeModules,
        displayLabel: 'Negocio de comidas',
      };
    }

    const config: BusinessConfig = {
      ...baseConfig,
      name: businessName.trim(),
      features,
      foodConfig,
      theme: existingConfig?.theme?.customized ? existingConfig.theme : { ...DEFAULT_BUSINESS_THEMES[selectedType] },
    };

    setSavingConfig(true);
    try {
      await setConfig(config);
      toast.success('Configuración del negocio guardada.');
      navigate('/dashboard', { replace: true });
    } catch (error) {
      toastError(error, 'No se pudo guardar la configuración en la base de datos.');
    } finally {
      setSavingConfig(false);
    }
  };

  // ── Step 0: Type selection ────────────────────────────────────────────────

  const StepType = () => (
    <motion.div
      key="step-type"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="space-y-4"
    >
      <div>
        <h2 className="text-xl font-bold text-foreground">¿Qué tipo de negocio tienes?</h2>
        <p className="text-sm text-muted-foreground mt-1">Elige el que mejor describe tu actividad</p>
      </div>
      <div className="space-y-3">
        {BUSINESS_TYPES.map(biz => {
          const Icon = biz.icon;
          return (
            <button
              key={biz.type}
              type="button"
              onClick={() => handleSelectType(biz.type)}
              className={`w-full flex items-center gap-4 p-4 rounded-2xl border border-border bg-card hover:border-orange-400 hover:shadow-sm transition-all text-left group`}
            >
              <div
                className={`w-12 h-12 rounded-xl ${biz.bg} flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform`}
              >
                <Icon size={22} className={biz.color} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground text-sm">{biz.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{biz.desc}</p>
              </div>
              <ChevronRight
                size={18}
                className="text-muted-foreground flex-shrink-0 group-hover:text-orange-500 transition-colors"
              />
            </button>
          );
        })}
        {isReconfiguring && (
          <Button type="button" variant="outline" className="w-full" onClick={() => navigate('/settings')}>
            Cancelar y conservar la configuración actual
          </Button>
        )}
      </div>
    </motion.div>
  );

  // ── Step 1 (food only): Sub-wizard ────────────────────────────────────────

  const StepFoodConfig = () => {
    const hasCatalog = activeModules.includes('menu') || activeModules.includes('inventario');
    const requiresCatalog = activeModules.includes('caja') || activeModules.includes('pedidos');
    const hasCoreModule = activeModules.some(module => ['menu', 'inventario', 'caja', 'pedidos'].includes(module));
    const canContinue =
      serviceModes.length > 0 &&
      foodTypes.length > 0 &&
      activeModules.length > 0 &&
      hasCoreModule &&
      (!requiresCatalog || hasCatalog) &&
      (!foodTypes.includes('otro') || Boolean(customFood.trim()));

    return (
      <motion.div
        key="step-food"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        className="space-y-6"
      >
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Sandwich size={22} className="text-orange-500" /> Cuéntanos de tu negocio
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Vamos a configurar todo según cómo trabajás vos</p>
        </div>

        {/* Q1 */}
        <div className="space-y-3">
          <div>
            <p className="font-semibold text-foreground text-sm">¿Cómo atendés a tus clientes?</p>
            <p className="text-xs text-muted-foreground">Podés seleccionar varias</p>
          </div>
          <ChipSelect options={SERVICE_MODES} selected={serviceModes} onChange={setServiceModes} />
          {serviceModes.length === 0 && <p className="text-xs text-red-500">Seleccioná al menos una modalidad</p>}
        </div>

        {/* Q2 */}
        <div className="space-y-3">
          <div>
            <p className="font-semibold text-foreground text-sm">¿Qué tipo de comida vendés?</p>
            <p className="text-xs text-muted-foreground">Tu menú principal</p>
          </div>
          <ChipSelect
            options={FOOD_TYPES}
            selected={foodTypes}
            onChange={setFoodTypes}
            customValue={customFood}
            onCustomChange={setCustomFood}
          />
          {foodTypes.length === 0 && <p className="text-xs text-red-500">Seleccioná al menos uno.</p>}
          {foodTypes.includes('otro') && !customFood.trim() && (
            <p className="text-xs text-red-500">Escribe el tipo de comida personalizado.</p>
          )}
        </div>

        {/* Q3 */}
        <div className="space-y-3">
          <div>
            <p className="font-semibold text-foreground text-sm">¿Qué querés administrar?</p>
            <p className="text-xs text-muted-foreground">Solo activamos lo que usás</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {MODULE_OPTIONS.map(mod => {
              // Auto-hide mesas if mode not selected, but still show it
              const active = activeModules.includes(mod.id);
              const suggested = mod.id === 'mesas' && serviceModes.includes('mesas');
              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() =>
                    setActiveModules(prev =>
                      prev.includes(mod.id) ? prev.filter(m => m !== mod.id) : [...prev, mod.id],
                    )
                  }
                  className={`flex items-start gap-2 p-3 rounded-xl border text-left text-sm transition-all
                    ${
                      active
                        ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/50 ring-1 ring-orange-500/40'
                        : 'border-border bg-background hover:border-orange-300'
                    }`}
                >
                  <mod.icon size={18} className={active ? 'text-[var(--brand-primary)]' : 'text-muted-foreground'} />
                  <div className="min-w-0">
                    <p
                      className={`font-medium leading-tight ${active ? 'text-orange-700 dark:text-orange-300' : 'text-foreground'}`}
                    >
                      {mod.label}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{mod.desc}</p>
                    {suggested && !active && (
                      <p className="text-[10px] text-orange-500 mt-0.5 font-medium">Sugerido ↑</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {!hasCoreModule && (
          <p className="text-xs text-red-500">Activa al menos un módulo principal: Menú, Pedidos, Caja o Inventario.</p>
        )}
        {requiresCatalog && !hasCatalog && (
          <p className="text-xs text-red-500">
            Para usar Caja o Pedidos, activa Menú o Inventario para poder seleccionar productos.
          </p>
        )}

        <div className="flex gap-3">
          <Button variant="outline" onClick={handleBack} className="flex-1">
            <ChevronLeft size={16} className="mr-1" /> Volver
          </Button>
          <Button
            onClick={handleContinueFood}
            disabled={!canContinue}
            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50"
          >
            Continuar <ChevronRight size={16} className="ml-1" />
          </Button>
        </div>
      </motion.div>
    );
  };

  // ── Step final: Name ──────────────────────────────────────────────────────

  const StepName = () => {
    const typeInfo = BUSINESS_TYPES.find(b => b.type === selectedType);
    const Icon = typeInfo?.icon ?? Building2;

    // Summary chips for food businesses
    const summaryChips = isFood ? [...serviceModes.map(m => SERVICE_MODES.find(s => s.id === m)?.label ?? m)] : [];

    return (
      <motion.div
        key="step-name"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        className="space-y-6"
      >
        <div>
          <h2 className="text-xl font-bold text-foreground">¡Ya casi está!</h2>
          <p className="text-sm text-muted-foreground mt-1">Poné el nombre de tu negocio para empezar</p>
        </div>

        {/* Summary card */}
        {typeInfo && (
          <Card className="p-4 border border-border bg-card">
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-xl ${typeInfo.bg} flex items-center justify-center`}>
                <Icon size={20} className={typeInfo.color} />
              </div>
              <div>
                <p className="font-semibold text-foreground text-sm">
                  {isFood ? 'Negocio de comidas' : typeInfo.label}
                </p>
                {isFood && foodTypes.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {foodTypes
                      .slice(0, 3)
                      .map(f => {
                        const ft = FOOD_TYPES.find(t => t.id === f);
                        return ft ? ft.label : f;
                      })
                      .join(' · ')}
                    {foodTypes.length > 3 ? ` +${foodTypes.length - 3}` : ''}
                  </p>
                )}
              </div>
            </div>
            {isFood && summaryChips.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {summaryChips.map(c => (
                  <span
                    key={c}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 font-medium"
                  >
                    {c}
                  </span>
                ))}
                {activeModules.map(m => {
                  const mod = MODULE_OPTIONS.find(o => o.id === m);
                  return mod ? (
                    <span key={m} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {mod.label}
                    </span>
                  ) : null;
                })}
              </div>
            )}
          </Card>
        )}

        <div className="space-y-2">
          <label className="text-sm font-semibold text-foreground">Nombre del negocio</label>
          <Input
            placeholder={
              isFood ? 'Ej: Burguer Don Pepe, La Fondue, Antojo Express...' : 'Ej: Mi Tienda, Bodega Central...'
            }
            value={businessName}
            onChange={e => setBusinessName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && businessName.trim() && handleFinish()}
            className="h-12 text-base"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">Este nombre aparecerá en tus tickets y reportes</p>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={handleBack} className="flex-1">
            <ChevronLeft size={16} className="mr-1" /> Volver
          </Button>
          <Button
            onClick={() => void handleFinish()}
            disabled={!businessName.trim() || savingConfig}
            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50 font-semibold"
          >
            Empezar <ChevronRight size={16} className="ml-1" />
          </Button>
        </div>
      </motion.div>
    );
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const stepIndex = step; // 0 = type, 1 = food config, 2 = name

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center">
              <Store size={18} className="text-white" />
            </div>
            <span className="text-lg font-bold text-foreground tracking-tight">Manager Stock Pro</span>
          </div>
          <p className="text-sm text-muted-foreground">Configuremos tu negocio en un minuto</p>
        </div>

        {/* Progress bar */}
        {step > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">
                Paso {step} de {totalSteps}
              </span>
              <span className="text-xs text-orange-500 font-medium">{Math.round((step / totalSteps) * 100)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <motion.div
                className="h-full bg-orange-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${(step / totalSteps) * 100}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              />
            </div>
          </div>
        )}

        {/* Card */}
        <Card className="p-6 border border-border shadow-sm">
          <AnimatePresence mode="wait">
            {stepIndex === 0 && StepType()}
            {stepIndex === 1 && isFood && StepFoodConfig()}
            {((stepIndex === 1 && !isFood) || stepIndex === 2) && StepName()}
          </AnimatePresence>
        </Card>

        {/* Step dots */}
        {step > 0 && (
          <div className="flex justify-center gap-2 mt-6">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i < step ? 'bg-orange-500 w-4' : i === step - 1 ? 'bg-orange-400 w-6' : 'bg-border w-4'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
