import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Layout } from '../components/Layout';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { listCustomers, saveCustomer, customerHistory, emptyCustomer, type Customer } from '../services/commerce';
import type { SaleRecord } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import { canPerformAction } from '../security/permissions';
import { toastError } from '../utils/notifications';
import { toast } from 'sonner';

export function Customers() {
  const { user } = useAuth();
  const canManage = canPerformAction(user, 'customers.manage');
  const [search, setSearch] = useState('');
  const [inactive, setInactive] = useState(false);
  const [offset, setOffset] = useState(0);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState<(Omit<Customer, 'id'> & { id?: string }) | null>(null);
  const [history, setHistory] = useState<{ name: string; sales: SaleRecord[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(
    () =>
      listCustomers(search, inactive, offset)
        .then(c => {
          setCustomers(c);
          setError('');
        })
        .catch(e => setError(e.message)),
    [search, inactive, offset],
  );
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void listCustomers(search, inactive, offset)
        .then(c => {
          if (active) {
            setCustomers(c);
            setError('');
          }
        })
        .catch(e => {
          if (active) setError(e.message);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search, inactive, offset]);
  return (
    <Layout>
      <div className="space-y-5 max-w-6xl mx-auto">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold">Clientes</h1>
            <p className="text-muted-foreground">Contactos, datos fiscales e historial de compras de tu negocio.</p>
          </div>
          {canManage && (
            <Button className="min-h-11" onClick={() => setForm({ ...emptyCustomer })}>
              Nuevo cliente
            </Button>
          )}
        </div>
        <Input
          aria-label="Buscar clientes"
          placeholder="Buscar por nombre, documento, teléfono o correo"
          value={search}
          onChange={e => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          className="min-h-11"
        />
        <label className="flex items-center gap-2 min-h-11">
          <input
            type="checkbox"
            checked={inactive}
            onChange={e => {
              setInactive(e.target.checked);
              setOffset(0);
            }}
          />{' '}
          Incluir archivados
        </label>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {customers.map(c => (
            <article key={c.id} className="border rounded-xl p-4 min-w-0 space-y-2">
              <h2 className="font-semibold break-words">
                {c.name}
                {!c.active && ' · Archivado'}
              </h2>
              <p className="text-sm break-words">
                {c.documentType} {c.documentNumber || 'Sin documento'}
                <br />
                {c.phone}
                <br />
                {c.email}
              </p>
              <div className="flex flex-wrap gap-2">
                {canManage && (
                  <Button variant="outline" className="min-h-11" onClick={() => setForm(c)}>
                    Editar
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={async () => {
                    try {
                      const h = await customerHistory(c.id);
                      setHistory({ name: c.name, sales: h.sales });
                    } catch (e) {
                      toastError(e, 'No se pudo cargar el historial.');
                    }
                  }}
                >
                  Historial
                </Button>
              </div>
            </article>
          ))}
        </div>
        {!customers.length && !error && (
          <p className="text-muted-foreground">No hay clientes que coincidan con la búsqueda.</p>
        )}
        <div className="flex gap-3">
          <Button variant="outline" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 100))}>
            Anterior
          </Button>
          <Button variant="outline" disabled={customers.length < 100} onClick={() => setOffset(offset + 100)}>
            Siguiente
          </Button>
        </div>
        <Dialog
          open={!!form}
          onOpenChange={open => {
            if (!open && !busy) setForm(null);
          }}
        >
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{form?.id ? 'Editar cliente' : 'Nuevo cliente'}</DialogTitle>
              <DialogDescription>
                Completa los datos conocidos. Para NIT, escribe el número sin dígito de verificación.
              </DialogDescription>
            </DialogHeader>
            {form && (
              <form
                className="space-y-3"
                onSubmit={async e => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    await saveCustomer(form);
                    setForm(null);
                    await load();
                    toast.success('Cliente guardado.');
                  } catch (err) {
                    toastError(err, 'No se pudo guardar.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label className="block text-sm">
                  Nombre o razón social
                  <Input
                    required
                    minLength={2}
                    maxLength={120}
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    Tipo de documento
                    <select
                      className="block w-full border rounded-md p-2 bg-background min-h-11"
                      value={form.documentType}
                      onChange={e => setForm({ ...form, documentType: e.target.value as Customer['documentType'] })}
                    >
                      {['CC', 'NIT', 'CE', 'TI', 'PP', 'FOREIGN'].map(v => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Número
                    <Input
                      maxLength={30}
                      value={form.documentNumber}
                      onChange={e => setForm({ ...form, documentNumber: e.target.value })}
                    />
                  </label>
                </div>
                {(
                  [
                    ['email', 'Correo', 'email'],
                    ['phone', 'Teléfono', 'tel'],
                    ['address', 'Dirección', 'text'],
                    ['municipalityCode', 'Código de municipio DANE (5 dígitos)', 'text'],
                    ['taxResponsibilities', 'Responsabilidades tributarias según RUT', 'text'],
                  ] as const
                ).map(([key, label, type]) => (
                  <label className="block text-sm" key={key}>
                    {label}
                    <Input type={type} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />
                  </label>
                ))}
                <label className="block text-sm">
                  Tipo de persona
                  <select
                    className="block w-full border rounded-md p-2 bg-background min-h-11"
                    value={form.personType}
                    onChange={e => setForm({ ...form, personType: e.target.value as Customer['personType'] })}
                  >
                    <option value="natural">Natural</option>
                    <option value="legal">Jurídica</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 min-h-11">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={e => setForm({ ...form, active: e.target.checked })}
                  />{' '}
                  Cliente activo
                </label>
                <Button type="submit" disabled={busy} className="w-full min-h-11">
                  {busy ? 'Guardando…' : 'Guardar cliente'}
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!history}
          onOpenChange={open => {
            if (!open) setHistory(null);
          }}
        >
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Historial de {history?.name}</DialogTitle>
              <DialogDescription>
                Hasta 100 ventas vinculadas. Los importes mantienen el valor original de cada venta.
              </DialogDescription>
            </DialogHeader>
            {history?.sales.map(s => (
              <Link
                className="block rounded-lg border p-3 min-h-11"
                to={'/sales/' + encodeURIComponent(s.id)}
                key={s.id}
              >
                {s.id} · {s.status === 'cancelled' ? 'Anulada' : s.status === 'pending' ? 'Pendiente' : 'Completada'}
                <span className="block">
                  {s.totalPrice.toLocaleString('es-CO')} {s.currency}
                </span>
              </Link>
            ))}
            {!history?.sales.length && <p>No hay ventas vinculadas que puedas consultar.</p>}
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
