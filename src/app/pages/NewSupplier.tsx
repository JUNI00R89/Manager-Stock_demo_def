import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Building2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../utils/notifications';
import { Layout } from '../components/Layout';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { dataService } from '../services/dataService';
import type { Product } from '../utils/mockData';

export function NewSupplier() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({ name: '', company: '', phone: '', email: '', address: '', products: [] as string[], notes: '' });
  useEffect(() => { void dataService.getProducts().then(setProducts).catch(error => toastError(error, 'No se pudo cargar el catálogo.')); }, []);
  const update = (field: keyof typeof formData, value: string) => setFormData(prev => ({ ...prev, [field]: value }));
  const toggle = (id: string, checked: boolean) => setFormData(prev => ({ ...prev, products: checked ? [...prev.products, id] : prev.products.filter(p => p !== id) }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!formData.name.trim() || !formData.company.trim()) { toast.error('Completa el nombre del contacto y la empresa.'); return; }
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) { toast.error('Revisa el formato del correo electrónico.'); return; }
    setSaving(true);
    try { await dataService.createSupplier({ ...formData, name: formData.name.trim(), company: formData.company.trim(), phone: formData.phone.trim(), email: formData.email.trim(), address: formData.address.trim(), notes: formData.notes.trim() }); toast.success('Proveedor registrado correctamente.'); navigate('/suppliers'); }
    catch (error) { toastError(error, 'No se pudo guardar el proveedor.'); }
    finally { setSaving(false); }
  };
  return <Layout><div className="mx-auto max-w-4xl space-y-6"><div className="flex items-center gap-3"><Button variant="outline" size="icon" onClick={() => navigate('/suppliers')} className="rounded-xl"><ArrowLeft className="h-4 w-4"/></Button><div><p className="text-sm font-semibold uppercase tracking-[.16em] text-orange-600">Abastecimiento</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Nuevo proveedor</h1><p className="mt-1 text-muted-foreground">Guarda datos de contacto y vincula productos que suministra.</p></div></div>
    <form onSubmit={submit} className="space-y-5"><Card className="space-y-6 rounded-2xl border-border/70 p-6 shadow-sm sm:p-8"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/40"><Building2 className="h-5 w-5"/></div><div><h2 className="font-semibold">Datos de contacto</h2><p className="text-sm text-muted-foreground">Solo el nombre y la empresa son obligatorios.</p></div></div><div className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="name">Nombre del contacto *</Label><Input id="name" value={formData.name} onChange={e => update('name', e.target.value)} required maxLength={120} className="h-11 rounded-xl" placeholder="Nombre y apellido"/></div><div className="space-y-2"><Label htmlFor="company">Empresa / negocio *</Label><Input id="company" value={formData.company} onChange={e => update('company', e.target.value)} required maxLength={160} className="h-11 rounded-xl" placeholder="Nombre comercial del proveedor"/></div><div className="space-y-2"><Label htmlFor="phone">Teléfono</Label><Input id="phone" type="tel" value={formData.phone} onChange={e => update('phone', e.target.value)} maxLength={60} className="h-11 rounded-xl" placeholder="300 000 0000"/></div><div className="space-y-2"><Label htmlFor="email">Correo electrónico</Label><Input id="email" type="email" value={formData.email} onChange={e => update('email', e.target.value)} maxLength={160} className="h-11 rounded-xl" placeholder="ventas@proveedor.com"/></div><div className="space-y-2 sm:col-span-2"><Label htmlFor="address">Dirección</Label><Input id="address" value={formData.address} onChange={e => update('address', e.target.value)} maxLength={240} className="h-11 rounded-xl" placeholder="Dirección o zona de entrega"/></div></div></Card>
      <Card className="rounded-2xl border-border/70 p-6 shadow-sm sm:p-8"><div><h2 className="font-semibold">Productos que suministra</h2><p className="mt-1 text-sm text-muted-foreground">Esta relación facilita saber a quién contactar para reponer existencias.</p></div>{products.length ? <div className="mt-5 grid gap-3 sm:grid-cols-2">{products.map(product => <label key={product.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 p-3 transition hover:bg-muted/30"><Checkbox checked={formData.products.includes(product.id)} onCheckedChange={checked => toggle(product.id, checked === true)}/><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{product.name}</span><span className="mt-1 block text-xs text-muted-foreground">SKU {product.sku} · Stock {product.stock}</span></span></label>)}</div> : <p className="mt-4 text-sm text-muted-foreground">No hay productos disponibles todavía.</p>}<div className="mt-6 space-y-2"><Label htmlFor="notes">Notas internas</Label><Textarea id="notes" value={formData.notes} onChange={e => update('notes', e.target.value)} rows={3} maxLength={1000} className="rounded-xl" placeholder="Tiempos de entrega, condiciones de pago, días de pedido…"/></div></Card>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={() => navigate('/suppliers')} className="rounded-xl">Cancelar</Button><Button type="submit" disabled={saving} className="rounded-xl bg-orange-600 text-white hover:bg-orange-700"><Save className="mr-2 h-4 w-4"/>{saving ? 'Guardando…' : 'Guardar proveedor'}</Button></div>
    </form></div></Layout>;
}
