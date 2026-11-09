import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { CustomerPicker } from '../components/CustomerPicker';
import { billingService, type BillingProfile, type BillingDraft, type Customer } from '../services/commerce';
import { isDesktopMode } from '../services/desktop';
import { useAuth } from '../context/AuthContext';
import { canPerformAction } from '../security/permissions';
import { toastError } from '../utils/notifications';
import { toast } from 'sonner';

export function Billing() {
  const { user } = useAuth();
  const canManage = canPerformAction(user, 'billing.manage');
  const [profile, setProfile] = useState<BillingProfile | null>(null);
  const [drafts, setDrafts] = useState<BillingDraft[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sourceType, setSourceType] = useState<'sale' | 'hotel'>('sale');
  const [sourceId, setSourceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (isDesktopMode()) return;
    let active = true;
    void Promise.all([billingService.profile(), billingService.drafts()]).then(([p, d]) => { if (active) { setProfile(p); setDrafts(d); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  const exportDraft = (draft: BillingDraft) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${draft.id}-borrador-interno.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <Layout><div className="space-y-6 max-w-5xl mx-auto">
    <div><h1 className="text-2xl font-bold">Preparación de facturación electrónica</h1><p className="text-muted-foreground mt-2">Colombia · DIAN</p></div>
    <div className="border rounded-xl p-4 bg-amber-500/10 space-y-2"><p className="font-semibold">Emisión todavía no habilitada</p><p className="text-sm">Aquí puedes registrar los datos del emisor y conservar borradores de ventas y cuentas cerradas del hotel. Estos documentos son internos. Para emitir facturas se requiere conectar el proveedor, configurar impuestos y numeración, y completar las pruebas de habilitación.</p></div>
    {isDesktopMode() ? <p>Los clientes funcionan en este equipo. La preparación fiscal centralizada requiere usar la aplicación conectada al servidor.</p> : <>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {profile && <form className="rounded-xl border p-4 space-y-4" onSubmit={async e => { e.preventDefault(); setBusy(true); try { setProfile(await billingService.saveProfile(profile)); toast.success('Datos del emisor guardados.'); } catch (err) { toastError(err, 'No se pudo guardar.'); } finally { setBusy(false); } }}>
        <h2 className="font-semibold">Datos del emisor</h2><fieldset disabled={!canManage || busy} className="grid gap-4 sm:grid-cols-2">
          {([['legalName', 'Razón social'], ['nit', 'NIT sin dígito de verificación'], ['address', 'Dirección'], ['municipalityCode', 'Municipio DANE (5 dígitos)'], ['taxResponsibilities', 'Responsabilidades tributarias según RUT']] as const).map(([key, label]) => <label className="block text-sm" key={key}>{label}<Input value={profile[key]} className="mt-1 min-h-11" onChange={e => setProfile({ ...profile, [key]: e.target.value })} /></label>)}
          <label className="block text-sm">Proveedor en evaluación<select value={profile.provider} onChange={e => setProfile({ ...profile, provider: e.target.value as BillingProfile['provider'] })} className="block w-full bg-background border rounded-md p-2 mt-1 min-h-11"><option value="undecided">Por decidir</option><option value="factus">Factus</option><option value="alegra">Alegra</option><option value="siigo">Siigo</option></select></label>
        </fieldset>{canManage && <Button type="submit" disabled={busy} className="min-h-11">Guardar datos</Button>}
      </form>}
      {canManage && <form className="rounded-xl border p-4 space-y-4" onSubmit={async e => { e.preventDefault(); if (!customer) return; setBusy(true); try { const draft = await billingService.prepare(sourceType, sourceId.trim(), customer.id); setDrafts(prev => [draft, ...prev.filter(d => d.id !== draft.id)]); toast.success('Borrador interno conservado.'); } catch (err) { toastError(err, 'No se pudo preparar el documento.'); } finally { setBusy(false); } }}>
        <h2 className="font-semibold">Preparar borrador</h2><p className="text-sm text-muted-foreground">El detalle se conserva tal como está ahora. Modificar el catálogo o el cliente después no cambia este borrador.</p>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Origen<select className="block w-full border rounded-md bg-background p-2 min-h-11" value={sourceType} onChange={e => setSourceType(e.target.value as 'sale' | 'hotel')}><option value="sale">Venta completada</option><option value="hotel">Cuenta cerrada del hotel</option></select></label><label className="text-sm">Código de la venta o reserva<Input required value={sourceId} onChange={e => setSourceId(e.target.value)} className="min-h-11" placeholder="Copia el código del detalle de la operación" /></label></div>
        <CustomerPicker value={customer} onChange={setCustomer} /><Button disabled={busy || !customer || !sourceId.trim()} className="min-h-11" type="submit">Conservar borrador</Button>
      </form>}
      <div className="space-y-3"><h2 className="font-semibold">Últimos 50 borradores</h2>{drafts.map(d => <article className="rounded-xl border p-4 space-y-3 min-w-0" key={d.id}><p className="font-semibold break-words">{d.sourceId} · {d.snapshot.customer.name}</p><p className="text-sm">Borrador interno · {new Date(d.createdAt).toLocaleString('es-CO')}</p><details><summary className="cursor-pointer min-h-11">Revisiones pendientes</summary><ul className="list-disc pl-5 space-y-2 text-sm">{d.snapshot.pendingChecks.map(check => <li key={check}>{check}</li>)}</ul></details><Button variant="outline" className="min-h-11" onClick={() => exportDraft(d)}>Descargar borrador JSON</Button></article>)}{!drafts.length && <p className="text-muted-foreground">Aún no hay borradores.</p>}</div>
    </>}
  </div></Layout>;
}
