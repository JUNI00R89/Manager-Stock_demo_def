import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Activity, AlertCircle, Ban, Building2, CheckCircle2, ChevronLeft, ChevronRight, CircleDollarSign,
  Clock3, CreditCard, Download, History, LayoutDashboard, LoaderCircle, LogOut, MessageCircle,
  RefreshCw, RotateCcw, Search, ShieldCheck, Users, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '../utils/errors';
import { toastError } from '../utils/notifications';
import { useAuth } from '../context/AuthContext';
import {
  createPlatformUser, getPlatformAudit, getPlatformBusinesses, getPlatformStats, getPlatformSubscriptions,
  getPlatformSupportCases, getPlatformUsers, setPlatformBusinessStatus, setPlatformUserStatus,
  updatePlatformSubscription, type PlatformAuditRecord, type PlatformSubscriptionRecord, type PlatformUserRecord,
  type SupportCaseRecord,
} from '../services/dataService';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { ConfirmActionDialog } from '../components/ConfirmActionDialog';
import { Card } from '../components/ui/card';
import { SupportCenter } from '../components/SupportCenter';

interface PlatformStats {
  businesses: number; activeBusinesses: number; users: number; activeUsers: number; completedSales: number; salesVolumeCOP: number;
}
interface PlatformBusiness {
  id: string; name: string; type: string; currency: string; active: boolean; createdAt: string; users: number;
  suspensionReason?: string; suspensionDescription?: string; suspendedAt?: string;
}
type TabId = 'overview' | 'businesses' | 'subscriptions' | 'users' | 'support' | 'audit';
type BusinessStatusFilter = 'all' | 'active' | 'suspended';
type SubscriptionStatusFilter = 'all' | PlatformSubscriptionRecord['status'];
type UserStatusFilter = 'all' | 'active' | 'suspended';
type UserRoleFilter = 'all' | PlatformUserRecord['role'];

const PAGE_SIZE = 8;
const SUBSCRIPTION_PAGE_SIZE = 6;
const AUDIT_PAGE_SIZE = 10;

const TABS: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: 'Resumen', icon: LayoutDashboard },
  { id: 'businesses', label: 'Negocios', icon: Building2 },
  { id: 'subscriptions', label: 'Suscripciones', icon: CreditCard },
  { id: 'users', label: 'Usuarios', icon: Users },
  { id: 'support', label: 'Soporte', icon: MessageCircle },
  { id: 'audit', label: 'Auditoría', icon: History },
];

const TYPE_LABELS: Record<string, string> = {
  retail: 'Tienda / Retail',
  food: 'Negocio de comidas',
  restaurant: 'Negocio de comidas',
  hotel: 'Hotel / hospedaje',
  warehouse: 'Bodega',
  services: 'Servicios',
};
const ROLE_LABELS: Record<PlatformUserRecord['role'], string> = {
  superadmin: 'SUPERADMIN',
  owner: 'Propietario',
  business_admin: 'Administrador',
  cashier: 'Cajero',
};
const PLAN_NAMES: Record<string, string> = {
  free: 'Gratis',
  entrepreneur: 'Emprendedor',
  business: 'Negocio',
  enterprise: 'Empresarial',
};
const SUBSCRIPTION_STATUS_LABELS: Record<PlatformSubscriptionRecord['status'], string> = {
  active: 'Activo',
  pending_payment: 'Pago pendiente',
  expired: 'Vencido',
  cancelled: 'Cancelado',
};
const SUPPORT_STATUS_LABELS: Record<SupportCaseRecord['status'], string> = {
  open: 'Abierto',
  in_review: 'En revisión',
  awaiting_business: 'Pendiente del negocio',
  resolved: 'Resuelto',
  closed: 'Cerrado',
};
const AUDIT_ACTION_LABELS: Record<string, string> = {
  suspend: 'Negocio suspendido',
  activate: 'Negocio reactivado',
  suspend_user: 'Usuario suspendido',
  activate_user: 'Usuario reactivado',
  create_user: 'Usuario creado',
  subscription_payment_pending: 'Solicitud de plan registrada',
  subscription_payment_manually_verified: 'Pago verificado y plan activado',
  subscription_request_cancelled: 'Solicitud de suscripción cancelada',
  support_reply: 'Respuesta de soporte',
  support_case_status: 'Estado de caso actualizado',
};
const DETAIL_LABELS: Record<string, string> = {
  active: 'Activo',
  reason: 'Motivo',
  description: 'Descripción',
  paymentReference: 'Referencia',
  planId: 'Plan',
  cancelledPlanId: 'Plan cancelado',
  role: 'Rol',
  businessId: 'Negocio',
  email: 'Correo',
  name: 'Nombre',
  status: 'Estado',
  caseId: 'Caso',
  verificationMode: 'Verificación',
};

const copFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const money = (value: number) => copFormatter.format(value || 0);
const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count === 1 ? singular : pluralForm}`;

function isTabId(value: string | null): value is TabId {
  return TABS.some(tab => tab.id === value);
}

function parseDateValue(value?: string | null): Date | null {
  if (!value) return null;
  let normalized = value.trim();
  if (!normalized) return null;
  if (/^\d{4}-\d{2}-\d{2} \d/.test(normalized)) normalized = normalized.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(normalized)) normalized += 'Z';
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value?: string | null) {
  const date = parseDateValue(value);
  return date ? date.toLocaleDateString('es-CO', { dateStyle: 'medium' }) : '—';
}

function formatDateTime(value?: string | null) {
  const date = parseDateValue(value);
  return date ? date.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function formatClock(date: Date) {
  return date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

function auditActionLabel(action: string) {
  return AUDIT_ACTION_LABELS[action] || action.replaceAll('_', ' ');
}

function formatAuditValue(key: string, value: unknown) {
  if (value === true) return 'Sí';
  if (value === false) return 'No';
  if (value === null || value === undefined || value === '') return '—';
  if (key.toLowerCase().includes('plan')) return PLAN_NAMES[String(value)] || String(value);
  if (key === 'role') return ROLE_LABELS[value as PlatformUserRecord['role']] || String(value);
  if (key === 'verificationMode' && value === 'manual_by_superadmin') return 'Manual (SUPERADMIN)';
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  return text.length > 110 ? `${text.slice(0, 107)}…` : text;
}

function auditDetailChips(details: Record<string, unknown> | null | undefined) {
  if (!details) return [];
  return Object.entries(details)
    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
    .map(([key, value]) => ({
      key,
      label: DETAIL_LABELS[key] || key,
      value: formatAuditValue(key, value),
    }));
}

function buildAuditCsv(events: PlatformAuditRecord[]) {
  const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['Fecha', 'Acción', 'Actor', 'Entidad', 'Detalles'],
    ...events.map(event => [
      formatDateTime(event.createdAt),
      auditActionLabel(event.action),
      event.actorName,
      event.entityId.replace(/^business:/, ''),
      auditDetailChips(event.details).map(item => `${item.label}: ${item.value}`).join(' · '),
    ]),
  ];
  return rows.map(row => row.map(cell).join(',')).join('\n');
}

function downloadAuditCsv(events: PlatformAuditRecord[]) {
  const blob = new Blob([`\uFEFF${buildAuditCsv(events)}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `auditoria-plataforma-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function BusinessStatusPill({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
      {active ? <CheckCircle2 size={13} /> : <Ban size={13} />}
      {active ? 'Activo' : 'Suspendido'}
    </span>
  );
}

function SubscriptionStatusPill({ status }: { status: PlatformSubscriptionRecord['status'] }) {
  const styles: Record<PlatformSubscriptionRecord['status'], string> = {
    active: 'bg-emerald-50 text-emerald-700',
    pending_payment: 'bg-amber-50 text-amber-800',
    expired: 'bg-rose-50 text-rose-700',
    cancelled: 'bg-slate-100 text-slate-600',
  };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>{SUBSCRIPTION_STATUS_LABELS[status]}</span>;
}

function RolePill({ role }: { role: PlatformUserRecord['role'] }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${role === 'superadmin' ? 'bg-violet-100 text-violet-800' : role === 'owner' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-700'}`}>
      {ROLE_LABELS[role]}
    </span>
  );
}

function UserStatusPill({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
      {active ? <CheckCircle2 size={13} /> : <Ban size={13} />}
      {active ? 'Activo' : 'Suspendido'}
    </span>
  );
}

function MetricCard({
  icon: Icon, label, value, detail, tone = 'indigo',
}: {
  icon: LucideIcon; label: string; value: ReactNode; detail: string; tone?: 'indigo' | 'emerald' | 'amber' | 'violet';
}) {
  const tones = {
    indigo: 'bg-indigo-50 text-indigo-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    violet: 'bg-violet-50 text-violet-700',
  };
  return (
    <Card className="rounded-2xl border-slate-200 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-3 text-2xl font-bold tracking-tight">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{detail}</p>
        </div>
        <div className={`rounded-xl p-3 ${tones[tone]}`}><Icon size={21} /></div>
      </div>
    </Card>
  );
}

function SectionHeader({ title, description, count, children }: {
  title: string; description: string; count?: string; children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {count && <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm">{count}</span>}
        {children}
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, description, action }: {
  icon: LucideIcon; title: string; description: string; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center p-10 text-center">
      <div className="rounded-2xl bg-slate-100 p-3 text-slate-500"><Icon size={22} /></div>
      <h3 className="mt-3 font-semibold text-slate-800">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function Pagination({ page, total, pageSize, onPageChange, label = 'registros', className = '' }: {
  page: number; total: number; pageSize: number; onPageChange: (page: number) => void; label?: string; className?: string;
}) {
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * pageSize + 1;
  const end = Math.min(current * pageSize, total);
  return (
    <div className={`flex flex-col gap-2 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between ${className}`}>
      <p>Mostrando {start}–{end} de {total} {label}</p>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onPageChange(current - 1)} disabled={current <= 1} className="h-8 rounded-lg px-2" aria-label="Página anterior">
            <ChevronLeft size={15} />
          </Button>
          <span className="min-w-[4.5rem] text-center font-semibold text-slate-600">Página {current} de {pages}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => onPageChange(current + 1)} disabled={current >= pages} className="h-8 rounded-lg px-2" aria-label="Página siguiente">
            <ChevronRight size={15} />
          </Button>
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 text-sm font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function BusinessDetailDialog({
  business, subscription, ownerName, onClose, onRequestStatus, onViewSubscription,
}: {
  business: PlatformBusiness | null;
  subscription?: PlatformSubscriptionRecord;
  ownerName?: string;
  onClose: () => void;
  onRequestStatus: (business: PlatformBusiness) => void;
  onViewSubscription: (business: PlatformBusiness) => void;
}) {
  if (!business) return null;
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl border-slate-200 p-5 shadow-2xl sm:max-w-2xl sm:p-6">
        <DialogHeader className="pr-7 text-left">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700"><Building2 size={22} /></div>
            <div className="min-w-0">
              <DialogTitle className="truncate text-xl">{business.name}</DialogTitle>
              <DialogDescription className="mt-1">Ficha del negocio, acceso y estado de la suscripción.</DialogDescription>
              <p className="mt-1 break-all font-mono text-[11px] text-slate-400">{business.id}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <BusinessStatusPill active={business.active} />
            {subscription && <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">Suscripción: {SUBSCRIPTION_STATUS_LABELS[subscription.status]}</span>}
          </div>
        </DialogHeader>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <DetailItem label="Tipo de negocio" value={TYPE_LABELS[business.type] || business.type || '—'} />
          <DetailItem label="Registro" value={formatDate(business.createdAt)} />
          <DetailItem label="Usuarios" value={`${business.users} ${business.users === 1 ? 'cuenta' : 'cuentas'}`} />
          <DetailItem label="Propietario" value={ownerName || 'Sin propietario registrado'} />
          <DetailItem label="Plan actual" value={subscription?.plan.name || 'Sin registro'} />
          <DetailItem label="Moneda" value={business.currency || 'COP'} />
        </div>

        {!business.active && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <p className="font-semibold">Negocio suspendido</p>
            <p className="mt-2"><strong>Motivo:</strong> {business.suspensionReason || 'Sin motivo registrado'}</p>
            {business.suspensionDescription && <p className="mt-1 whitespace-pre-wrap"><strong>Detalle:</strong> {business.suspensionDescription}</p>}
            {business.suspendedAt && <p className="mt-2 text-xs text-rose-700">Suspendido el {formatDateTime(business.suspendedAt)}</p>}
          </div>
        )}

        {subscription?.status === 'pending_payment' && subscription.pendingPlan && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Solicitud de plan pendiente</p>
            <p className="mt-1">{subscription.pendingPlan.name} · {money(subscription.pendingPlan.priceCOP)}/mes. Confirma el pago desde la pestaña de suscripciones.</p>
          </div>
        )}

        <DialogFooter className="mt-6 gap-2 sm:flex-row-reverse">
          <Button type="button" variant={business.active ? 'destructive' : 'default'} onClick={() => onRequestStatus(business)} className="rounded-xl">
            {business.active ? 'Suspender negocio' : 'Reactivar negocio'}
          </Button>
          <Button type="button" variant="outline" onClick={() => onViewSubscription(business)} className="rounded-xl">Ver suscripción</Button>
          <Button type="button" variant="ghost" onClick={onClose} className="rounded-xl">Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PlatformAdmin() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: TabId = isTabId(tabParam) ? tabParam : 'overview';

  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [businesses, setBusinesses] = useState<PlatformBusiness[]>([]);
  const [users, setUsers] = useState<PlatformUserRecord[]>([]);
  const [events, setEvents] = useState<PlatformAuditRecord[]>([]);
  const [subscriptions, setSubscriptions] = useState<PlatformSubscriptionRecord[]>([]);
  const [supportCases, setSupportCases] = useState<SupportCaseRecord[]>([]);
  const [paymentRefs, setPaymentRefs] = useState<Record<string, string>>({});
  const [subscriptionBusyId, setSubscriptionBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [userStatusTarget, setUserStatusTarget] = useState<PlatformUserRecord | null>(null);
  const [businessStatusTarget, setBusinessStatusTarget] = useState<PlatformBusiness | null>(null);
  const [suspensionTarget, setSuspensionTarget] = useState<PlatformBusiness | null>(null);
  const [suspensionReason, setSuspensionReason] = useState('');
  const [suspensionDescription, setSuspensionDescription] = useState('');
  const [suspensionValidation, setSuspensionValidation] = useState('');
  const [dialogBusy, setDialogBusy] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createUserBusy, setCreateUserBusy] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'owner' as 'superadmin' | 'owner' | 'business_admin' | 'cashier', businessId: '' });
  const [businessDetailId, setBusinessDetailId] = useState<string | null>(null);

  const [businessSearch, setBusinessSearch] = useState('');
  const [businessStatus, setBusinessStatus] = useState<BusinessStatusFilter>('all');
  const [businessType, setBusinessType] = useState('all');
  const [businessPage, setBusinessPage] = useState(1);
  const [subscriptionSearch, setSubscriptionSearch] = useState('');
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatusFilter>('all');
  const [subscriptionPage, setSubscriptionPage] = useState(1);
  const [userSearch, setUserSearch] = useState('');
  const [userStatus, setUserStatus] = useState<UserStatusFilter>('all');
  const [userRole, setUserRole] = useState<UserRoleFilter>('all');
  const [userBusiness, setUserBusiness] = useState('all');
  const [userPage, setUserPage] = useState(1);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditAction, setAuditAction] = useState('all');
  const [auditPage, setAuditPage] = useState(1);

  const goToTab = useCallback((tab: TabId) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next, { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [searchParams, setSearchParams]);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    setLoadError('');
    try {
      const [nextStats, nextBusinesses, nextUsers, nextEvents, nextSubscriptions, nextSupportCases] = await Promise.all([
        getPlatformStats(),
        getPlatformBusinesses(),
        getPlatformUsers(),
        getPlatformAudit(100),
        getPlatformSubscriptions(),
        getPlatformSupportCases().catch(() => [] as SupportCaseRecord[]),
      ]);
      setStats(nextStats);
      setBusinesses(nextBusinesses);
      setUsers(nextUsers);
      setEvents(nextEvents);
      setSubscriptions(nextSubscriptions);
      setSupportCases(nextSupportCases);
      setLastUpdated(new Date());
    } catch (error) {
      const message = getErrorMessage(error, 'No se pudo cargar la información de la plataforma.');
      setLoadError(message);
      if (!options?.silent) toastError(error, 'No se pudo actualizar la información del panel.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setBusinessPage(1); }, [businessSearch, businessStatus, businessType]);
  useEffect(() => { setSubscriptionPage(1); }, [subscriptionSearch, subscriptionStatus]);
  useEffect(() => { setUserPage(1); }, [userSearch, userStatus, userRole, userBusiness]);
  useEffect(() => { setAuditPage(1); }, [auditSearch, auditAction]);

  const pendingSubscriptions = useMemo(() => subscriptions.filter(item => item.status === 'pending_payment'), [subscriptions]);
  const activePaidSubscriptions = useMemo(() => subscriptions.filter(item => item.status === 'active' && item.plan.priceCOP > 0), [subscriptions]);
  const openSupportCases = useMemo(() => supportCases.filter(item => !['resolved', 'closed'].includes(item.status)), [supportCases]);
  const suspendedBusinesses = useMemo(() => businesses.filter(item => !item.active).length, [businesses]);
  const mrr = useMemo(() => activePaidSubscriptions.reduce((total, item) => total + item.plan.priceCOP, 0), [activePaidSubscriptions]);
  const subscriptionByBusiness = useMemo(() => new Map(subscriptions.map(item => [item.businessId, item])), [subscriptions]);
  const ownerByBusiness = useMemo(() => {
    const map = new Map<string, string>();
    users.filter(item => item.role === 'owner' && item.businessId).forEach(item => {
      if (!map.has(item.businessId!)) map.set(item.businessId!, item.name);
    });
    return map;
  }, [users]);
  const businessById = useMemo(() => new Map(businesses.map(item => [item.id, item])), [businesses]);
  const businessDetail = businessDetailId ? businessById.get(businessDetailId) || null : null;
  const businessTypes = useMemo(() => [...new Set(businesses.map(item => item.type).filter(Boolean))].sort(), [businesses]);
  const planDistribution = useMemo(() => {
    return subscriptions.reduce<Record<string, number>>((accumulator, item) => {
      const name = item.plan.name || 'Sin plan';
      accumulator[name] = (accumulator[name] || 0) + 1;
      return accumulator;
    }, {});
  }, [subscriptions]);

  const filteredBusinesses = useMemo(() => {
    const term = businessSearch.trim().toLowerCase();
    return businesses.filter(business => {
      if (term && ![business.name, business.id, business.suspensionReason || ''].some(value => value.toLowerCase().includes(term))) return false;
      if (businessStatus === 'active' && !business.active) return false;
      if (businessStatus === 'suspended' && business.active) return false;
      if (businessType !== 'all' && business.type !== businessType) return false;
      return true;
    });
  }, [businessSearch, businessStatus, businessType, businesses]);
  const businessPageCount = Math.max(1, Math.ceil(filteredBusinesses.length / PAGE_SIZE));
  const currentBusinessPage = Math.min(businessPage, businessPageCount);
  const pagedBusinesses = filteredBusinesses.slice((currentBusinessPage - 1) * PAGE_SIZE, currentBusinessPage * PAGE_SIZE);

  const filteredSubscriptions = useMemo(() => {
    const term = subscriptionSearch.trim().toLowerCase();
    return subscriptions
      .filter(item => {
        if (term && ![item.businessName, item.businessId, item.plan.name, item.pendingPlan?.name || ''].some(value => value.toLowerCase().includes(term))) return false;
        if (subscriptionStatus !== 'all' && item.status !== subscriptionStatus) return false;
        return true;
      })
      .sort((a, b) => {
        const pendingDiff = Number(b.status === 'pending_payment') - Number(a.status === 'pending_payment');
        return pendingDiff || a.businessName.localeCompare(b.businessName, 'es');
      });
  }, [subscriptionSearch, subscriptionStatus, subscriptions]);
  const subscriptionPageCount = Math.max(1, Math.ceil(filteredSubscriptions.length / SUBSCRIPTION_PAGE_SIZE));
  const currentSubscriptionPage = Math.min(subscriptionPage, subscriptionPageCount);
  const pagedSubscriptions = filteredSubscriptions.slice((currentSubscriptionPage - 1) * SUBSCRIPTION_PAGE_SIZE, currentSubscriptionPage * SUBSCRIPTION_PAGE_SIZE);

  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();
    return users.filter(item => {
      if (term && ![item.name, item.email, item.businessName || '', item.id].some(value => value.toLowerCase().includes(term))) return false;
      if (userStatus === 'active' && !item.active) return false;
      if (userStatus === 'suspended' && item.active) return false;
      if (userRole !== 'all' && item.role !== userRole) return false;
      if (userBusiness !== 'all' && item.businessId !== userBusiness) return false;
      return true;
    });
  }, [userBusiness, userRole, userSearch, userStatus, users]);
  const userPageCount = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const currentUserPage = Math.min(userPage, userPageCount);
  const pagedUsers = filteredUsers.slice((currentUserPage - 1) * PAGE_SIZE, currentUserPage * PAGE_SIZE);

  const filteredAudit = useMemo(() => {
    const term = auditSearch.trim().toLowerCase();
    return events.filter(event => {
      if (auditAction !== 'all' && event.action !== auditAction) return false;
      if (!term) return true;
      const haystack = [event.actorName, event.action, event.entityId, JSON.stringify(event.details || {})].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }, [auditAction, auditSearch, events]);
  const auditPageCount = Math.max(1, Math.ceil(filteredAudit.length / AUDIT_PAGE_SIZE));
  const currentAuditPage = Math.min(auditPage, auditPageCount);
  const pagedAudit = filteredAudit.slice((currentAuditPage - 1) * AUDIT_PAGE_SIZE, currentAuditPage * AUDIT_PAGE_SIZE);
  const auditActions = useMemo(() => [...new Set(events.map(event => event.action))].sort(), [events]);

  const confirmUserStatus = async () => {
    if (!userStatusTarget) return;
    const target = userStatusTarget;
    const active = !target.active;
    setBusyId(target.id);
    try {
      await setPlatformUserStatus(target.id, active);
      toast.success(`Usuario ${active ? 'reactivado' : 'suspendido'}.`);
      setUserStatusTarget(null);
      await refresh({ silent: true });
    } catch (error) {
      toastError(error, 'No se pudo actualizar el usuario.');
      throw error;
    } finally {
      setBusyId(null);
    }
  };

  const handleSubscriptionAction = async (subscription: PlatformSubscriptionRecord, action: 'confirm_payment' | 'cancel_request') => {
    const reference = (paymentRefs[subscription.businessId] || '').trim();
    if (action === 'confirm_payment' && reference.length < 4) {
      toast.error('Introduce la referencia del pago verificado (mínimo 4 caracteres).');
      return;
    }
    setSubscriptionBusyId(subscription.businessId);
    try {
      await updatePlatformSubscription(subscription.businessId, action, reference);
      toast.success(action === 'confirm_payment' ? 'Plan activado tras registrar la verificación manual del pago.' : 'Solicitud de suscripción cancelada.');
      setPaymentRefs(current => {
        const next = { ...current };
        delete next[subscription.businessId];
        return next;
      });
      await refresh({ silent: true });
    } catch (error) {
      toastError(error, 'No se pudo actualizar la suscripción.');
    } finally {
      setSubscriptionBusyId(null);
    }
  };

  const submitNewUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newUser.role !== 'superadmin' && !newUser.businessId) {
      toast.error('Selecciona el negocio al que pertenecerá el usuario.');
      return;
    }
    setCreateUserBusy(true);
    try {
      await createPlatformUser({
        name: newUser.name.trim(),
        email: newUser.email.trim(),
        password: newUser.password,
        role: newUser.role,
        businessId: newUser.role === 'superadmin' ? null : newUser.businessId,
      });
      toast.success('Usuario creado correctamente.');
      setNewUser({ name: '', email: '', password: '', role: 'owner', businessId: '' });
      setCreateUserOpen(false);
      await refresh({ silent: true });
    } catch (error) {
      toastError(error, 'No se pudo crear el usuario.');
    } finally {
      setCreateUserBusy(false);
    }
  };

  const requestBusinessStatus = (business: PlatformBusiness) => {
    setBusinessDetailId(null);
    if (business.active) {
      setSuspensionReason('');
      setSuspensionDescription('');
      setSuspensionValidation('');
      setSuspensionTarget(business);
    } else {
      setBusinessStatusTarget(business);
    }
  };

  const confirmSuspension = async () => {
    if (!suspensionTarget) return;
    const reason = suspensionReason.trim();
    if (reason.length < 4) {
      setSuspensionValidation('Escribe un motivo de al menos 4 caracteres.');
      return;
    }
    const target = suspensionTarget;
    setDialogBusy(true);
    setBusyId(target.id);
    try {
      await setPlatformBusinessStatus(target.id, false, reason, suspensionDescription.trim());
      toast.success('Negocio suspendido. El propietario podrá consultar el motivo y comunicarse con soporte.');
      setSuspensionTarget(null);
      setSuspensionReason('');
      setSuspensionDescription('');
      setSuspensionValidation('');
      await refresh({ silent: true });
    } catch (error) {
      toastError(error, 'No se pudo suspender el negocio.');
    } finally {
      setBusyId(null);
      setDialogBusy(false);
    }
  };

  const confirmBusinessReactivation = async () => {
    if (!businessStatusTarget) return;
    const target = businessStatusTarget;
    setBusyId(target.id);
    try {
      await setPlatformBusinessStatus(target.id, true);
      toast.success('Negocio reactivado.');
      setBusinessStatusTarget(null);
      await refresh({ silent: true });
    } catch (error) {
      toastError(error, 'No se pudo reactivar el negocio.');
      throw error;
    } finally {
      setBusyId(null);
    }
  };

  const viewBusinessSubscription = (business: PlatformBusiness) => {
    setBusinessDetailId(null);
    setSubscriptionSearch(business.name);
    setSubscriptionStatus('all');
    setSubscriptionPage(1);
    goToTab('subscriptions');
  };

  const clearBusinessFilters = () => {
    setBusinessSearch('');
    setBusinessStatus('all');
    setBusinessType('all');
  };
  const clearSubscriptionFilters = () => {
    setSubscriptionSearch('');
    setSubscriptionStatus('all');
  };
  const clearUserFilters = () => {
    setUserSearch('');
    setUserStatus('all');
    setUserRole('all');
    setUserBusiness('all');
  };
  const clearAuditFilters = () => {
    setAuditSearch('');
    setAuditAction('all');
  };

  const signOut = () => { logout(); navigate('/login'); };
  const getTabBadge = (tab: TabId) => {
    if (tab === 'subscriptions' && pendingSubscriptions.length) return pendingSubscriptions.length;
    if (tab === 'support' && openSupportCases.length) return openSupportCases.length;
    if (tab === 'businesses' && suspendedBusinesses) return suspendedBusinesses;
    return null;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-900 to-slate-700 text-white shadow-lg"><ShieldCheck size={23} /></div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">MANAGER STOCK</p>
              <p className="truncate text-xs text-slate-500">Centro de administración global</p>
            </div>
            <span className="hidden rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-bold tracking-wide text-violet-700 sm:inline-flex">SUPERADMIN</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden text-right md:block">
              <p className="text-sm font-semibold">{user?.name}</p>
              <p className="text-xs text-slate-500">{user?.email}</p>
              <p className="text-[11px] text-slate-400">{lastUpdated ? `Actualizado ${formatClock(lastUpdated)}` : 'Sin actualizar'}</p>
            </div>
            <Button variant="outline" onClick={() => void refresh()} disabled={loading} className="rounded-xl">
              <RefreshCw size={15} className={loading ? 'animate-spin sm:mr-2' : 'sm:mr-2'} />
              <span className="hidden sm:inline">Actualizar</span>
            </Button>
            <Button variant="ghost" onClick={signOut} className="rounded-xl text-slate-600">
              <LogOut size={16} className="sm:mr-2" />
              <span className="hidden sm:inline">Salir</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-6 text-white shadow-xl sm:p-8">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.22em] text-indigo-200">Control de plataforma</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Panel global</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Administra negocios, suscripciones, usuarios y soporte desde un solo lugar. Las métricas se calculan con los datos persistidos.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => goToTab('businesses')} className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/15">
                {plural(businesses.length, 'negocio', 'negocios')}
              </button>
              <button type="button" onClick={() => goToTab('subscriptions')} className="rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-400/15">
                {plural(pendingSubscriptions.length, 'pago pendiente', 'pagos pendientes')}
              </button>
              <button type="button" onClick={() => goToTab('support')} className="rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-1.5 text-xs font-semibold text-sky-100 transition hover:bg-sky-400/15">
                {plural(openSupportCases.length, 'caso abierto', 'casos abiertos')}
              </button>
            </div>
          </div>
        </section>

        {loadError && (
          <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 sm:flex-row sm:items-center">
            <AlertCircle className="shrink-0" size={20} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">No se pudo actualizar la información</p>
              <p className="mt-1 break-words text-rose-800">{loadError}</p>
            </div>
            <Button type="button" variant="outline" onClick={() => void refresh()} className="shrink-0 rounded-xl border-rose-200 bg-white text-rose-800">Reintentar</Button>
          </div>
        )}

        <nav aria-label="Secciones del panel" className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            const badge = getTabBadge(tab.id);
            return (
              <button key={tab.id} type="button" onClick={() => goToTab(tab.id)} aria-current={active ? 'page' : undefined} className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
                <Icon size={16} />
                {tab.label}
                {badge !== null && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-white/15 text-white' : 'bg-amber-100 text-amber-800'}`}>{badge}</span>}
              </button>
            );
          })}
        </nav>

        {activeTab === 'overview' && (
          <div className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Negocios registrados" value={loading && !stats ? '—' : stats?.businesses ?? businesses.length} detail={`${plural(stats?.activeBusinesses ?? businesses.filter(item => item.active).length, 'activo', 'activos')} · ${plural(suspendedBusinesses, 'suspendido', 'suspendidos')}`} icon={Building2} />
              <MetricCard label="Usuarios" value={loading && !stats ? '—' : stats?.users ?? users.length} detail={`${plural(stats?.activeUsers ?? users.filter(item => item.active).length, 'activo', 'activos')} · ${users.filter(item => item.role === 'superadmin').length} SUPERADMIN`} icon={Users} tone="violet" />
              <MetricCard label="MRR estimado" value={loading && !subscriptions.length ? '—' : money(mrr)} detail={plural(activePaidSubscriptions.length, 'plan de pago activo', 'planes de pago activos')} icon={CircleDollarSign} tone="emerald" />
              <MetricCard label="Requieren atención" value={loading && !subscriptions.length && !supportCases.length ? '—' : pendingSubscriptions.length + openSupportCases.length} detail={`${plural(pendingSubscriptions.length, 'pago', 'pagos')} · ${plural(openSupportCases.length, 'caso de soporte', 'casos de soporte')}`} icon={AlertCircle} tone="amber" />
            </section>

            <div className="grid gap-6 xl:grid-cols-2">
              <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
                  <div><h2 className="font-bold">Pagos pendientes</h2><p className="mt-1 text-sm text-slate-500">Solicitudes de plan que esperan verificación manual.</p></div>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">{pendingSubscriptions.length}</span>
                </div>
                {pendingSubscriptions.length ? (
                  <div className="divide-y divide-slate-100">
                    {pendingSubscriptions.slice(0, 3).map(subscription => (
                      <div key={subscription.businessId} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{subscription.businessName}</p>
                          <p className="mt-1 text-xs text-slate-500">{subscription.pendingPlan?.name} · {money(subscription.pendingPlan?.priceCOP || 0)}/mes</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => goToTab('subscriptions')} className="shrink-0 rounded-lg">Revisar</Button>
                      </div>
                    ))}
                  </div>
                ) : <p className="p-6 text-sm text-slate-500">No hay pagos pendientes. Las nuevas solicitudes aparecerán aquí.</p>}
                {pendingSubscriptions.length > 3 && <button type="button" onClick={() => goToTab('subscriptions')} className="w-full border-t border-slate-100 px-5 py-3 text-left text-xs font-semibold text-indigo-700 hover:bg-slate-50">Ver todas las solicitudes</button>}
              </Card>

              <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
                  <div><h2 className="font-bold">Soporte abierto</h2><p className="mt-1 text-sm text-slate-500">Conversaciones que necesitan seguimiento.</p></div>
                  <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">{openSupportCases.length}</span>
                </div>
                {openSupportCases.length ? (
                  <div className="divide-y divide-slate-100">
                    {openSupportCases.slice(0, 3).map(item => (
                      <div key={item.id} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{item.businessName || item.businessId}</p>
                          <p className="mt-1 line-clamp-1 text-xs text-slate-500">{item.reason} · {SUPPORT_STATUS_LABELS[item.status]}</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => goToTab('support')} className="shrink-0 rounded-lg">Abrir</Button>
                      </div>
                    ))}
                  </div>
                ) : <p className="p-6 text-sm text-slate-500">No hay casos abiertos. Los casos creados por una suspensión aparecerán aquí.</p>}
                {openSupportCases.length > 3 && <button type="button" onClick={() => goToTab('support')} className="w-full border-t border-slate-100 px-5 py-3 text-left text-xs font-semibold text-indigo-700 hover:bg-slate-50">Ver todos los casos</button>}
              </Card>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
              <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
                  <div><h2 className="font-bold">Actividad reciente</h2><p className="mt-1 text-sm text-slate-500">Últimos cambios administrativos registrados.</p></div>
                  <Button size="sm" variant="ghost" onClick={() => goToTab('audit')} className="rounded-lg text-indigo-700">Ver auditoría</Button>
                </div>
                {events.length ? (
                  <div className="divide-y divide-slate-100">
                    {events.slice(0, 5).map(event => (
                      <div key={event.id} className="flex items-start gap-3 px-5 py-4">
                        <span className="mt-0.5 rounded-lg bg-indigo-50 p-2 text-indigo-700"><Activity size={15} /></span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{auditActionLabel(event.action)}</p>
                          <p className="mt-1 text-xs text-slate-500">{event.actorName} · {formatDateTime(event.createdAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="p-6 text-sm text-slate-500">Todavía no hay eventos. Las suspensiones, creaciones de usuarios y pagos confirmados se registrarán aquí.</p>}
              </Card>

              <Card className="rounded-2xl border-slate-200 p-5 shadow-sm">
                <div>
                  <h2 className="font-bold">Uso de la plataforma</h2>
                  <p className="mt-1 text-sm text-slate-500">Datos operativos de los negocios, no ingresos del SaaS.</p>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Ventas completadas</p><p className="mt-1 text-xl font-bold">{stats?.completedSales ?? 0}</p></div>
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Volumen de ventas</p><p className="mt-1 text-xl font-bold">{money(stats?.salesVolumeCOP || 0)}</p></div>
                </div>
                <div className="mt-5">
                  <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Distribución por plan</p><span className="text-xs text-slate-400">{subscriptions.length} negocios</span></div>
                  <div className="mt-3 space-y-3">
                    {Object.entries(planDistribution).map(([name, count]) => (
                      <div key={name}>
                        <div className="flex items-center justify-between text-xs"><span className="font-medium text-slate-600">{name}</span><span className="tabular-nums text-slate-500">{count}</span></div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${subscriptions.length ? (count / subscriptions.length) * 100 : 0}%` }} /></div>
                      </div>
                    ))}
                    {!Object.keys(planDistribution).length && <p className="text-sm text-slate-500">Sin datos de suscripciones.</p>}
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}

        {activeTab === 'businesses' && (
          <div className="space-y-4">
            <SectionHeader title="Negocios registrados" description="Consulta el estado, el plan y los usuarios de cada negocio. Desde la ficha puedes suspender o reactivar el acceso." count={`${filteredBusinesses.length} de ${businesses.length} negocios`} />
            <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input value={businessSearch} onChange={event => setBusinessSearch(event.target.value)} placeholder="Buscar por nombre, ID o motivo…" aria-label="Buscar negocios" className="h-10 rounded-xl border-slate-200 bg-white pl-9" />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <select value={businessStatus} onChange={event => setBusinessStatus(event.target.value as BusinessStatusFilter)} aria-label="Filtrar por estado" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm outline-none focus:border-indigo-300">
                    <option value="all">Todos los estados</option>
                    <option value="active">Activos</option>
                    <option value="suspended">Suspendidos</option>
                  </select>
                  <select value={businessType} onChange={event => setBusinessType(event.target.value)} aria-label="Filtrar por tipo" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm outline-none focus:border-indigo-300">
                    <option value="all">Todos los tipos</option>
                    {businessTypes.map(type => <option key={type} value={type}>{TYPE_LABELS[type] || type}</option>)}
                  </select>
                </div>
                {(businessSearch || businessStatus !== 'all' || businessType !== 'all') && <Button type="button" variant="ghost" onClick={clearBusinessFilters} className="rounded-xl text-slate-600"><RotateCcw size={15} className="mr-2" />Limpiar</Button>}
              </div>

              {loading && !businesses.length ? (
                <div className="flex items-center justify-center gap-3 p-12 text-slate-500"><LoaderCircle className="animate-spin" />Cargando negocios…</div>
              ) : filteredBusinesses.length ? (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[1040px] text-left text-sm">
                      <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-5 py-4 font-semibold">Negocio</th>
                          <th className="px-5 py-4 font-semibold">Tipo</th>
                          <th className="px-5 py-4 font-semibold">Plan</th>
                          <th className="px-5 py-4 font-semibold">Usuarios</th>
                          <th className="px-5 py-4 font-semibold">Propietario</th>
                          <th className="px-5 py-4 font-semibold">Registro</th>
                          <th className="px-5 py-4 font-semibold">Estado</th>
                          <th className="px-5 py-4 text-right font-semibold">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {pagedBusinesses.map(business => {
                          const subscription = subscriptionByBusiness.get(business.id);
                          return (
                            <tr key={business.id} className="hover:bg-slate-50">
                              <td className="px-5 py-4">
                                <button type="button" onClick={() => setBusinessDetailId(business.id)} className="text-left font-semibold text-slate-900 hover:text-indigo-700">{business.name}</button>
                                <p className="mt-1 font-mono text-[11px] text-slate-400">{business.id}</p>
                                {!business.active && business.suspensionReason && <p className="mt-1 line-clamp-1 text-xs text-rose-600">{business.suspensionReason}</p>}
                              </td>
                              <td className="px-5 py-4 text-slate-600">{TYPE_LABELS[business.type] || business.type}</td>
                              <td className="px-5 py-4"><p className="font-medium text-slate-700">{subscription?.plan.name || 'Sin plan'}</p>{subscription?.pendingPlan && <p className="mt-1 text-xs text-amber-700">Solicita {subscription.pendingPlan.name}</p>}</td>
                              <td className="px-5 py-4 tabular-nums text-slate-600">{business.users}</td>
                              <td className="px-5 py-4 text-slate-600">{ownerByBusiness.get(business.id) || '—'}</td>
                              <td className="px-5 py-4 text-slate-500">{formatDate(business.createdAt)}</td>
                              <td className="px-5 py-4"><BusinessStatusPill active={business.active} /></td>
                              <td className="px-5 py-4">
                                <div className="flex justify-end gap-2">
                                  <Button size="sm" variant="outline" onClick={() => setBusinessDetailId(business.id)} className="rounded-lg">Detalle</Button>
                                  <Button size="sm" variant={business.active ? 'outline' : 'default'} disabled={busyId === business.id} onClick={() => requestBusinessStatus(business)} className="rounded-lg">
                                    {busyId === business.id ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    {business.active ? 'Suspender' : 'Reactivar'}
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="divide-y divide-slate-100 md:hidden">
                    {pagedBusinesses.map(business => {
                      const subscription = subscriptionByBusiness.get(business.id);
                      return (
                        <article key={business.id} className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <button type="button" onClick={() => setBusinessDetailId(business.id)} className="text-left font-semibold text-slate-900 hover:text-indigo-700">{business.name}</button>
                              <p className="mt-1 break-all font-mono text-[10px] text-slate-400">{business.id}</p>
                            </div>
                            <BusinessStatusPill active={business.active} />
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                            <p>Tipo: <span className="font-medium text-slate-700">{TYPE_LABELS[business.type] || business.type}</span></p>
                            <p>Plan: <span className="font-medium text-slate-700">{subscription?.plan.name || 'Sin plan'}</span></p>
                            <p>Usuarios: <span className="font-medium text-slate-700">{business.users}</span></p>
                            <p>Registro: <span className="font-medium text-slate-700">{formatDate(business.createdAt)}</span></p>
                          </div>
                          {!business.active && business.suspensionReason && <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-2 text-xs text-rose-700">{business.suspensionReason}</p>}
                          <div className="mt-3 flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => setBusinessDetailId(business.id)} className="rounded-lg">Detalle</Button>
                            <Button size="sm" variant={business.active ? 'outline' : 'default'} disabled={busyId === business.id} onClick={() => requestBusinessStatus(business)} className="rounded-lg">
                              {business.active ? 'Suspender' : 'Reactivar'}
                            </Button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  <Pagination page={currentBusinessPage} total={filteredBusinesses.length} pageSize={PAGE_SIZE} onPageChange={setBusinessPage} label="negocios" className="border-t border-slate-100" />
                </>
              ) : (
                <EmptyState icon={Building2} title="No hay negocios que coincidan" description="Prueba con otro término o limpia los filtros para ver todos los negocios registrados." action={(businessSearch || businessStatus !== 'all' || businessType !== 'all') ? <Button type="button" variant="outline" onClick={clearBusinessFilters} className="rounded-xl">Limpiar filtros</Button> : undefined} />
              )}
            </Card>
          </div>
        )}

        {activeTab === 'subscriptions' && (
          <div className="space-y-4">
            <SectionHeader title="Suscripciones" description="Revisa solicitudes de plan y registra la verificación manual de pagos. El plan actual no cambia hasta confirmar la solicitud." count={`${filteredSubscriptions.length} de ${subscriptions.length} suscripciones`}>
              {pendingSubscriptions.length > 0 && <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">{plural(pendingSubscriptions.length, 'pendiente', 'pendientes')}</span>}
            </SectionHeader>

            <Card className="rounded-2xl border-slate-200 p-4 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input value={subscriptionSearch} onChange={event => setSubscriptionSearch(event.target.value)} placeholder="Buscar por negocio, ID o plan…" aria-label="Buscar suscripciones" className="h-10 rounded-xl border-slate-200 bg-white pl-9" />
                </div>
                <select value={subscriptionStatus} onChange={event => setSubscriptionStatus(event.target.value as SubscriptionStatusFilter)} aria-label="Filtrar suscripciones por estado" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm outline-none focus:border-indigo-300">
                  <option value="all">Todos los estados</option>
                  <option value="pending_payment">Pago pendiente</option>
                  <option value="active">Activas</option>
                  <option value="expired">Vencidas</option>
                  <option value="cancelled">Canceladas</option>
                </select>
                {(subscriptionSearch || subscriptionStatus !== 'all') && <Button type="button" variant="ghost" onClick={clearSubscriptionFilters} className="rounded-xl text-slate-600"><RotateCcw size={15} className="mr-2" />Limpiar</Button>}
              </div>
            </Card>

            {loading && !subscriptions.length ? (
              <Card className="flex items-center justify-center gap-3 rounded-2xl border-slate-200 p-12 text-slate-500 shadow-sm"><LoaderCircle className="animate-spin" />Cargando suscripciones…</Card>
            ) : filteredSubscriptions.length ? (
              <>
                <div className="grid gap-4 xl:grid-cols-2">
                  {pagedSubscriptions.map(subscription => {
                    const isBusy = subscriptionBusyId === subscription.businessId;
                    return (
                      <Card key={subscription.businessId} className="rounded-2xl border-slate-200 p-5 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <button type="button" onClick={() => setBusinessDetailId(subscription.businessId)} className="text-left font-semibold text-slate-900 hover:text-indigo-700">{subscription.businessName}</button>
                            <p className="mt-1 break-all font-mono text-[10px] text-slate-400">{subscription.businessId}</p>
                          </div>
                          <SubscriptionStatusPill status={subscription.status} />
                        </div>

                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-xl bg-slate-50 p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Plan actual</p>
                            <p className="mt-1 font-semibold text-slate-800">{subscription.plan.name}</p>
                            <p className="mt-1 text-xs text-slate-500">{money(subscription.plan.priceCOP)}/mes · {subscription.plan.maxUsers} usuarios</p>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vigencia</p>
                            <p className="mt-1 font-semibold text-slate-800">{subscription.expiresAt ? `Vence ${formatDate(subscription.expiresAt)}` : subscription.plan.priceCOP === 0 ? 'Sin vencimiento' : 'Sin fecha de vencimiento'}</p>
                            <p className="mt-1 text-xs text-slate-500">{subscription.startedAt ? `Inicio ${formatDate(subscription.startedAt)}` : 'Sin fecha de inicio'}</p>
                          </div>
                        </div>

                        {subscription.status === 'pending_payment' && subscription.pendingPlan ? (
                          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                            <p className="text-sm font-semibold text-amber-900">Solicitud: {subscription.pendingPlan.name} · {money(subscription.pendingPlan.priceCOP)}/mes</p>
                            <p className="mt-1 text-xs leading-5 text-amber-800">El plan actual sigue siendo {subscription.plan.name} hasta que se confirme el pago.</p>
                            <label className="mt-3 block space-y-1.5 text-xs font-medium text-amber-900">
                              <span>Referencia del pago verificado</span>
                              <Input value={paymentRefs[subscription.businessId] || ''} onChange={event => setPaymentRefs(current => ({ ...current, [subscription.businessId]: event.target.value }))} placeholder="Referencia del proveedor o recibo" maxLength={120} className="h-10 rounded-xl border-amber-200 bg-white" />
                            </label>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button size="sm" disabled={isBusy} onClick={() => void handleSubscriptionAction(subscription, 'confirm_payment')} className="rounded-lg bg-emerald-700 text-white hover:bg-emerald-800">
                                {isBusy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                Confirmar pago verificado
                              </Button>
                              <Button size="sm" variant="outline" disabled={isBusy} onClick={() => void handleSubscriptionAction(subscription, 'cancel_request')} className="rounded-lg">Cancelar solicitud</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                            <p className="text-xs text-slate-500">{subscription.plan.priceCOP === 0 ? 'Plan gratuito sin cobro recurrente.' : 'Sin solicitudes pendientes.'}</p>
                            <Button size="sm" variant="ghost" onClick={() => setBusinessDetailId(subscription.businessId)} className="shrink-0 rounded-lg text-indigo-700">Ver ficha</Button>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
                <Pagination page={currentSubscriptionPage} total={filteredSubscriptions.length} pageSize={SUBSCRIPTION_PAGE_SIZE} onPageChange={setSubscriptionPage} label="suscripciones" className="rounded-2xl border border-slate-200 bg-white shadow-sm" />
              </>
            ) : (
              <Card className="rounded-2xl border-slate-200 shadow-sm"><EmptyState icon={CreditCard} title="No hay suscripciones que coincidan" description="Prueba con otro término o cambia el filtro de estado." action={(subscriptionSearch || subscriptionStatus !== 'all') ? <Button type="button" variant="outline" onClick={clearSubscriptionFilters} className="rounded-xl">Limpiar filtros</Button> : undefined} /></Card>
            )}
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-4">
            <SectionHeader title="Usuarios de la plataforma" description="Busca cuentas por nombre, correo o negocio. Los roles privilegiados se administran desde este panel." count={`${filteredUsers.length} de ${users.length} usuarios`}>
              <Button onClick={() => setCreateUserOpen(open => !open)} className="rounded-xl bg-indigo-700 text-white hover:bg-indigo-800">
                <Users size={15} className="mr-2" />{createUserOpen ? 'Cerrar formulario' : 'Crear usuario'}
              </Button>
            </SectionHeader>

            {createUserOpen && (
              <Card className="rounded-2xl border-indigo-100 p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Crear cuenta de plataforma o negocio</h3>
                    <p className="mt-1 text-sm text-slate-500">Las cuentas de negocio requieren un negocio existente. SUPERADMIN es una cuenta global y no pertenece a una empresa.</p>
                  </div>
                </div>
                <form onSubmit={submitNewUser} className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <div className="space-y-1.5"><Label htmlFor="new-user-name">Nombre completo</Label><Input id="new-user-name" required minLength={2} maxLength={120} value={newUser.name} onChange={event => setNewUser({ ...newUser, name: event.target.value })} className="h-10 rounded-xl" /></div>
                  <div className="space-y-1.5"><Label htmlFor="new-user-email">Correo</Label><Input id="new-user-email" required type="email" value={newUser.email} onChange={event => setNewUser({ ...newUser, email: event.target.value })} className="h-10 rounded-xl" /></div>
                  <div className="space-y-1.5"><Label htmlFor="new-user-password">Contraseña inicial</Label><Input id="new-user-password" required minLength={8} type="password" autoComplete="new-password" value={newUser.password} onChange={event => setNewUser({ ...newUser, password: event.target.value })} className="h-10 rounded-xl" /></div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-user-role">Rol</Label>
                    <select id="new-user-role" className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm" value={newUser.role} onChange={event => {
                      const role = event.target.value as typeof newUser.role;
                      setNewUser(current => ({ ...current, role, businessId: role === 'superadmin' ? '' : current.businessId || businesses[0]?.id || '' }));
                    }}>
                      <option value="owner">Propietario</option>
                      <option value="business_admin">Administrador de negocio</option>
                      <option value="cashier">Empleado / cajero</option>
                      <option value="superadmin">SUPERADMIN</option>
                    </select>
                  </div>
                  {newUser.role !== 'superadmin' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="new-user-business">Negocio</Label>
                      <select id="new-user-business" required className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm" value={newUser.businessId} onChange={event => setNewUser({ ...newUser, businessId: event.target.value })}>
                        <option value="">Selecciona un negocio</option>
                        {businesses.map(business => <option key={business.id} value={business.id}>{business.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="flex items-end justify-end gap-2 sm:col-span-2 xl:col-span-3">
                    <Button type="button" variant="outline" onClick={() => setCreateUserOpen(false)} className="rounded-xl">Cancelar</Button>
                    <Button type="submit" disabled={createUserBusy} className="rounded-xl bg-indigo-700 text-white hover:bg-indigo-800">
                      {createUserBusy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Users size={15} className="mr-2" />}
                      Crear usuario
                    </Button>
                  </div>
                </form>
              </Card>
            )}

            <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input value={userSearch} onChange={event => setUserSearch(event.target.value)} placeholder="Buscar por nombre, correo o negocio…" aria-label="Buscar usuarios" className="h-10 rounded-xl border-slate-200 bg-white pl-9" />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <select value={userRole} onChange={event => setUserRole(event.target.value as UserRoleFilter)} aria-label="Filtrar usuarios por rol" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm outline-none focus:border-indigo-300">
                    <option value="all">Todos los roles</option>
                    <option value="owner">Propietario</option>
                    <option value="business_admin">Administrador</option>
                    <option value="cashier">Cajero</option>
                    <option value="superadmin">SUPERADMIN</option>
                  </select>
                  <select value={userStatus} onChange={event => setUserStatus(event.target.value as UserStatusFilter)} aria-label="Filtrar usuarios por estado" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm outline-none focus:border-indigo-300">
                    <option value="all">Todos los estados</option>
                    <option value="active">Activos</option>
                    <option value="suspended">Suspendidos</option>
                  </select>
                  <select value={userBusiness} onChange={event => setUserBusiness(event.target.value)} aria-label="Filtrar usuarios por negocio" className="h-10 max-w-[180px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm outline-none focus:border-indigo-300">
                    <option value="all">Todos los negocios</option>
                    {businesses.map(business => <option key={business.id} value={business.id}>{business.name}</option>)}
                  </select>
                </div>
                {(userSearch || userRole !== 'all' || userStatus !== 'all' || userBusiness !== 'all') && <Button type="button" variant="ghost" onClick={clearUserFilters} className="rounded-xl text-slate-600"><RotateCcw size={15} className="mr-2" />Limpiar</Button>}
              </div>

              {loading && !users.length ? (
                <div className="flex items-center justify-center gap-3 p-12 text-slate-500"><LoaderCircle className="animate-spin" />Cargando usuarios…</div>
              ) : filteredUsers.length ? (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[980px] text-left text-sm">
                      <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-5 py-4 font-semibold">Usuario</th>
                          <th className="px-5 py-4 font-semibold">Negocio</th>
                          <th className="px-5 py-4 font-semibold">Rol</th>
                          <th className="px-5 py-4 font-semibold">Registro</th>
                          <th className="px-5 py-4 font-semibold">Estado</th>
                          <th className="px-5 py-4 text-right font-semibold">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {pagedUsers.map(target => (
                          <tr key={target.id} className="hover:bg-slate-50">
                            <td className="px-5 py-4">
                              <p className="font-semibold">{target.name}</p>
                              <p className="mt-1 text-xs text-slate-500">{target.email}</p>
                              <p className="mt-1 break-all font-mono text-[10px] text-slate-400">{target.id}</p>
                            </td>
                            <td className="px-5 py-4 text-slate-600">
                              {target.businessId ? <button type="button" onClick={() => setBusinessDetailId(target.businessId)} className="text-left hover:text-indigo-700">{target.businessName || target.businessId}</button> : 'Plataforma'}
                            </td>
                            <td className="px-5 py-4"><RolePill role={target.role} /></td>
                            <td className="px-5 py-4 text-slate-500">{formatDate(target.createdAt)}</td>
                            <td className="px-5 py-4"><UserStatusPill active={target.active} /></td>
                            <td className="px-5 py-4 text-right">
                              {target.role === 'superadmin' && target.id === user?.id ? <span className="text-xs text-slate-500">Sesión actual</span> : <Button size="sm" variant="outline" disabled={busyId === target.id} onClick={() => setUserStatusTarget(target)} className="rounded-lg">{target.active ? 'Suspender' : 'Reactivar'}</Button>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="divide-y divide-slate-100 md:hidden">
                    {pagedUsers.map(target => (
                      <article key={target.id} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold">{target.name}</p>
                            <p className="mt-1 break-all text-xs text-slate-500">{target.email}</p>
                          </div>
                          <UserStatusPill active={target.active} />
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <RolePill role={target.role} />
                          <span>·</span>
                          <span>{target.businessId ? target.businessName || target.businessId : 'Plataforma'}</span>
                          <span>·</span>
                          <span>{formatDate(target.createdAt)}</span>
                        </div>
                        <div className="mt-3">
                          {target.role === 'superadmin' && target.id === user?.id ? <span className="text-xs text-slate-500">Sesión actual</span> : <Button size="sm" variant="outline" disabled={busyId === target.id} onClick={() => setUserStatusTarget(target)} className="rounded-lg">{target.active ? 'Suspender' : 'Reactivar'}</Button>}
                        </div>
                      </article>
                    ))}
                  </div>
                  <Pagination page={currentUserPage} total={filteredUsers.length} pageSize={PAGE_SIZE} onPageChange={setUserPage} label="usuarios" className="border-t border-slate-100" />
                </>
              ) : (
                <EmptyState icon={Users} title="No hay usuarios que coincidan" description="Prueba con otro término o limpia los filtros para ver todas las cuentas." action={(userSearch || userRole !== 'all' || userStatus !== 'all' || userBusiness !== 'all') ? <Button type="button" variant="outline" onClick={clearUserFilters} className="rounded-xl">Limpiar filtros</Button> : undefined} />
              )}
            </Card>
          </div>
        )}

        {activeTab === 'support' && (
          <SupportCenter mode="platform" onChanged={() => void refresh({ silent: true })} />
        )}

        {activeTab === 'audit' && (
          <div className="space-y-4">
            <SectionHeader title="Actividad administrativa global" description="Registro de suspensiones, cambios de usuarios, pagos y soporte ejecutados desde este panel." count={`${filteredAudit.length} de ${events.length} eventos`}>
              <Button type="button" variant="outline" onClick={() => downloadAuditCsv(filteredAudit)} disabled={!filteredAudit.length} className="rounded-xl">
                <Download size={15} className="mr-2" />Exportar CSV
              </Button>
            </SectionHeader>

            <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input value={auditSearch} onChange={event => setAuditSearch(event.target.value)} placeholder="Buscar por actor, acción, entidad o detalle…" aria-label="Buscar auditoría" className="h-10 rounded-xl border-slate-200 bg-white pl-9" />
                </div>
                <select value={auditAction} onChange={event => setAuditAction(event.target.value)} aria-label="Filtrar auditoría por acción" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm outline-none focus:border-indigo-300">
                  <option value="all">Todas las acciones</option>
                  {auditActions.map(action => <option key={action} value={action}>{auditActionLabel(action)}</option>)}
                </select>
                {(auditSearch || auditAction !== 'all') && <Button type="button" variant="ghost" onClick={clearAuditFilters} className="rounded-xl text-slate-600"><RotateCcw size={15} className="mr-2" />Limpiar</Button>}
              </div>

              {loading && !events.length ? (
                <div className="flex items-center justify-center gap-3 p-12 text-slate-500"><LoaderCircle className="animate-spin" />Cargando actividad…</div>
              ) : filteredAudit.length ? (
                <>
                  <div className="divide-y divide-slate-100">
                    {pagedAudit.map(event => {
                      const chips = auditDetailChips(event.details);
                      return (
                        <div key={event.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="mt-0.5 rounded-lg bg-indigo-50 p-2 text-indigo-700"><Activity size={16} /></span>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-800">{auditActionLabel(event.action)}</p>
                              <p className="mt-1 text-xs text-slate-500">{event.actorName} · {formatDateTime(event.createdAt)}</p>
                              <p className="mt-1 break-all text-xs text-slate-400">Entidad: {event.entityId.replace(/^business:/, '')}</p>
                              {chips.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {chips.map(chip => <span key={chip.key} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{chip.label}: {chip.value}</span>)}
                                </div>
                              )}
                            </div>
                          </div>
                          <span className="shrink-0 text-xs text-slate-400">{formatDate(event.createdAt)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <Pagination page={currentAuditPage} total={filteredAudit.length} pageSize={AUDIT_PAGE_SIZE} onPageChange={setAuditPage} label="eventos" className="border-t border-slate-100" />
                </>
              ) : (
                <EmptyState icon={History} title={events.length ? 'No hay eventos que coincidan' : 'Todavía no hay eventos administrativos'} description={events.length ? 'Prueba con otro término o cambia el filtro de acción.' : 'Las suspensiones, creaciones de usuarios, pagos confirmados y respuestas de soporte se registrarán aquí automáticamente.'} action={(auditSearch || auditAction !== 'all') ? <Button type="button" variant="outline" onClick={clearAuditFilters} className="rounded-xl">Limpiar filtros</Button> : undefined} />
              )}
            </Card>
          </div>
        )}
      </main>

      <BusinessDetailDialog
        business={businessDetail}
        subscription={businessDetail ? subscriptionByBusiness.get(businessDetail.id) : undefined}
        ownerName={businessDetail ? ownerByBusiness.get(businessDetail.id) : undefined}
        onClose={() => setBusinessDetailId(null)}
        onRequestStatus={requestBusinessStatus}
        onViewSubscription={viewBusinessSubscription}
      />

      <ConfirmActionDialog
        open={Boolean(userStatusTarget)}
        onOpenChange={open => { if (!open) setUserStatusTarget(null); }}
        title={userStatusTarget?.active ? 'Suspender acceso del usuario' : 'Reactivar acceso del usuario'}
        description={userStatusTarget ? `¿${userStatusTarget.active ? 'Suspender' : 'reactivar'} el acceso de ${userStatusTarget.name}?` : ''}
        confirmLabel={userStatusTarget?.active ? 'Suspender usuario' : 'Reactivar usuario'}
        destructive={Boolean(userStatusTarget?.active)}
        onConfirm={confirmUserStatus}
      />

      <Dialog open={Boolean(suspensionTarget)} onOpenChange={open => { if (!open && !dialogBusy) { setSuspensionTarget(null); setSuspensionValidation(''); } }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl border-slate-200 p-5 shadow-2xl sm:max-w-xl sm:p-6">
          <DialogHeader className="pr-7 text-left">
            <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-700"><Ban size={20} /></div>
            <DialogTitle className="text-xl">Suspender negocio</DialogTitle>
            <DialogDescription className="leading-6">El negocio <strong>{suspensionTarget?.name}</strong> dejará de operar temporalmente. Su propietario podrá iniciar sesión para consultar el motivo y comunicarse con soporte.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="suspension-reason">Motivo de la suspensión <span className="text-rose-600">*</span></Label>
              <Input id="suspension-reason" autoFocus value={suspensionReason} onChange={event => { setSuspensionReason(event.target.value); if (suspensionValidation) setSuspensionValidation(''); }} maxLength={180} placeholder="Ej. Incumplimiento de las condiciones de uso" aria-invalid={Boolean(suspensionValidation)} className="h-11 rounded-xl" />
              {suspensionValidation && <p role="alert" className="text-sm text-rose-600">{suspensionValidation}</p>}
              <p className="text-xs text-slate-500">Mínimo 4 caracteres. El propietario verá este motivo.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="suspension-description">Descripción adicional (opcional)</Label>
              <Textarea id="suspension-description" value={suspensionDescription} onChange={event => setSuspensionDescription(event.target.value)} rows={4} maxLength={3000} placeholder="Explica el contexto, los pasos para resolver la situación o la información que el propietario debe aportar." className="resize-y rounded-xl" />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:flex-row-reverse">
            <Button type="button" variant="destructive" disabled={dialogBusy} onClick={() => void confirmSuspension()} className="rounded-xl">
              {dialogBusy && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}{dialogBusy ? 'Suspendiendo…' : 'Confirmar suspensión'}
            </Button>
            <Button type="button" variant="outline" disabled={dialogBusy} onClick={() => setSuspensionTarget(null)} className="rounded-xl">Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={Boolean(businessStatusTarget)}
        onOpenChange={open => { if (!open) setBusinessStatusTarget(null); }}
        title="Reactivar negocio"
        description={businessStatusTarget ? `¿Deseas reactivar ${businessStatusTarget.name}? El propietario volverá a tener acceso a las operaciones permitidas.` : ''}
        confirmLabel="Reactivar negocio"
        onConfirm={confirmBusinessReactivation}
      />
    </div>
  );
}
