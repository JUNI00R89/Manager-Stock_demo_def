import { useCallback, useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  Check,
  Crown,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Users,
  Package,
  CreditCard,
} from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../utils/notifications';
import {
  getBusinessSubscription,
  getSubscriptionPlans,
  selectSubscriptionPlan,
  type BusinessSubscriptionRecord,
  type SubscriptionPlanRecord,
} from '../services/dataService';
import { formatMoney as money } from '../utils/restaurantFormat';

function formatDay(value: string) {
  return new Date(value).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Solo se abren links https://; cualquier otro valor (vacío, javascript:, http:) se descarta. */
export function safePaymentUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname ? url.toString() : null;
  } catch {
    return null;
  }
}

function PendingPayment({
  subscription,
  paymentUrl,
}: {
  subscription: BusinessSubscriptionRecord;
  paymentUrl: string | null;
}) {
  const pending = subscription.pendingPlan!;
  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p>
        Solicitud pendiente: <strong>{pending.name}</strong> · {money(pending.priceCOP)} / mes. Conservas el plan{' '}
        {subscription.plan.name}
        {subscription.expiresAt ? ` hasta el ${formatDay(subscription.expiresAt)}` : ''} mientras se verifica el pago;
        al confirmarse, los 30 días se suman a tu vigencia actual si es el mismo plan.
      </p>
      {paymentUrl ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button asChild className="rounded-xl">
            <a href={paymentUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} className="mr-2" />
              Pagar {pending.name} con Mercado Pago
            </a>
          </Button>
          <p className="text-xs text-amber-800">
            El cobro es automático cada mes. Tu plan se activa cuando el equipo verifica el pago.
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-amber-800">
          El link de pago de este plan aún no está disponible. El equipo de Manager Stock te indicará cómo pagar.
        </p>
      )}
    </div>
  );
}

const descriptions: Record<string, string[]> = {
  free: ['Hasta 100 productos activos', '1 usuario en total', 'Módulos disponibles según el negocio'],
  entrepreneur: ['Hasta 1.000 productos activos', 'Hasta 3 usuarios en total', 'Módulos disponibles según el negocio'],
  business: ['Hasta 5.000 productos activos', 'Hasta 10 usuarios en total', 'Módulos disponibles según el negocio'],
  enterprise: ['Hasta 20.000 productos activos', 'Hasta 25 usuarios en total', 'Módulos disponibles según el negocio'],
};

export function Subscription() {
  const [plans, setPlans] = useState<SubscriptionPlanRecord[]>([]);
  const [subscription, setSubscription] = useState<BusinessSubscriptionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [available, current] = await Promise.all([getSubscriptionPlans(), getBusinessSubscription()]);
      setPlans(available);
      setSubscription(current);
    } catch (error) {
      toastError(error, 'No se pudo consultar la suscripción.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const selectPlan = async (plan: SubscriptionPlanRecord) => {
    setBusyPlan(plan.id);
    try {
      const result = await selectSubscriptionPlan(plan.id);
      setSubscription(result);
      if (plan.id === 'free') toast.success('Se activó el plan Gratis.');
      else
        toast.info(
          safePaymentUrl(plan.paymentUrl)
            ? `Solicitud registrada para el plan ${plan.name}. Completa el pago con el botón «Pagar con Mercado Pago»; el plan se activa cuando se verifique.`
            : `Solicitud registrada para el plan ${plan.name}. Se activará cuando se verifique el pago; mientras tanto conservas tu plan actual.`,
        );
    } catch (error) {
      toastError(error, 'No se pudo solicitar el cambio de plan.');
    } finally {
      setBusyPlan(null);
    }
  };

  return (
    <Layout>
      <main className="mx-auto max-w-7xl space-y-8">
        <header className="text-center">
          <p className="text-xs font-bold uppercase tracking-[.2em] text-[var(--brand-primary)]">
            Planes transparentes
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Planes y suscripciones</h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Los límites se validan en el backend. Los planes de pago se cobran cada mes y se activan cuando el equipo de
            Manager Stock verifica el pago.
          </p>
        </header>
        {subscription && (
          <Card className="rounded-2xl border-[var(--brand-primary)]/20 bg-[var(--brand-primary)]/5 p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <span className="rounded-2xl bg-[var(--brand-primary)]/10 p-3 text-[var(--brand-primary)]">
                  <Crown size={24} />
                </span>
                <div>
                  <p className="text-sm text-muted-foreground">Plan aplicado</p>
                  <h2 className="text-2xl font-bold text-foreground">{subscription.plan.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {money(subscription.plan.priceCOP)} / mes · {subscription.plan.maxUsers} usuarios ·{' '}
                    {subscription.plan.maxProducts.toLocaleString('es-CO')} productos
                  </p>
                  {subscription.expiresAt && (
                    <p className="mt-1 text-sm font-medium text-foreground">
                      Vigente hasta el {formatDay(subscription.expiresAt)}
                    </p>
                  )}
                </div>
              </div>
              <Badge variant={subscription.status === 'active' ? 'default' : 'secondary'}>
                {subscription.status === 'active'
                  ? 'Activo'
                  : subscription.status === 'pending_payment'
                    ? 'Pago pendiente'
                    : 'Estado: ' + subscription.status}
              </Badge>
            </div>
            {subscription.status === 'pending_payment' && subscription.pendingPlan && (
              <PendingPayment
                subscription={subscription}
                paymentUrl={safePaymentUrl(plans.find(item => item.id === subscription.pendingPlan?.id)?.paymentUrl)}
              />
            )}
          </Card>
        )}
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {loading && !plans.length ? (
            <Card className="col-span-full flex items-center justify-center gap-3 p-10 text-muted-foreground">
              <LoaderCircle className="animate-spin" />
              Cargando planes…
            </Card>
          ) : (
            plans.map((plan, index) => (
              <Card
                key={plan.id}
                className={`relative flex flex-col rounded-2xl p-5 sm:p-6 ${index === 2 ? 'border-[var(--brand-primary)] shadow-lg' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-foreground">{plan.name}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Para distintos tamaños de operación</p>
                  </div>
                  {index === 2 && <Badge>Recomendado</Badge>}
                </div>
                <p className="mt-6 text-3xl font-bold text-foreground">
                  {money(plan.priceCOP)}
                  <span className="text-sm font-medium text-muted-foreground"> / mes</span>
                </p>
                <div className="mt-5 space-y-3">
                  {(descriptions[plan.id] || []).map(feature => (
                    <p key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Check size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                      {feature}
                    </p>
                  ))}
                  <p className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Users size={16} className="mt-0.5 shrink-0" />
                    Máximo {plan.maxUsers} usuarios incluyendo propietario
                  </p>
                  <p className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Package size={16} className="mt-0.5 shrink-0" />
                    Máximo {plan.maxProducts.toLocaleString('es-CO')} productos activos
                  </p>
                </div>
                <div className="mt-auto pt-6">
                  <Button
                    className="w-full rounded-xl"
                    variant={subscription?.plan.id === plan.id ? 'outline' : 'default'}
                    disabled={
                      loading ||
                      busyPlan !== null ||
                      (subscription?.plan.id === plan.id && subscription.status === 'active')
                    }
                    onClick={() => void selectPlan(plan)}
                  >
                    {busyPlan === plan.id ? (
                      <LoaderCircle className="mr-2 animate-spin" size={16} />
                    ) : (
                      <CreditCard size={16} className="mr-2" />
                    )}
                    {subscription?.plan.id === plan.id && subscription.status === 'active'
                      ? 'Plan actual'
                      : plan.priceCOP === 0
                        ? 'Cambiar al plan Gratis'
                        : `Solicitar ${plan.name}`}
                  </Button>
                </div>
              </Card>
            ))
          )}
        </div>
        <Card className="rounded-2xl p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 text-[var(--brand-primary)]" size={22} />
            <div>
              <h3 className="font-semibold text-foreground">Estado de los pagos</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Cada pago verificado suma 30 días de vigencia; si renuevas antes de que venza, no pierdes los días que
                te quedan. Si el plan vence sin un pago registrado, el negocio pasa al plan Gratis hasta que se registre
                el siguiente pago.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => void load()}
              disabled={loading}
              className="ml-auto shrink-0 rounded-xl"
            >
              <RefreshCw size={15} />
            </Button>
          </div>
        </Card>
      </main>
    </Layout>
  );
}
