import { useCallback, useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { ShieldCheck, Users, UserPlus, RefreshCw, UserRound, Mail, KeyRound, CircleCheck, CircleX, LoaderCircle, Plus, Shield, Save, Camera } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../utils/notifications';
import { ConfirmActionDialog } from '../components/ConfirmActionDialog';
import { useAuth } from '../context/AuthContext';
import { createBusinessUser, createCustomRole, getBusinessUsers, getCustomRoles, updateBusinessUser, type BusinessUserRecord, type CustomRoleRecord } from '../services/dataService';

const PERMISSIONS = [
  { key: 'dashboard.view', label: 'Ver dashboard', group: 'General' },
  { key: 'catalog.view', label: 'Consultar productos o menú', group: 'Catálogo' },
  { key: 'catalog.create', label: 'Crear productos', group: 'Catálogo' },
  { key: 'catalog.edit', label: 'Editar o retirar productos', group: 'Catálogo' },
  { key: 'inventory.view', label: 'Consultar inventario y movimientos', group: 'Inventario' },
  { key: 'inventory.edit', label: 'Configurar ubicaciones y parámetros de inventario', group: 'Inventario' },
  { key: 'inventory.entry', label: 'Registrar entradas, salidas y mermas', group: 'Inventario' },
  { key: 'inventory.adjust', label: 'Realizar ajustes y conteos físicos', group: 'Inventario' },
  { key: 'inventory.delete', label: 'Eliminar registros de inventario', group: 'Inventario' },
  { key: 'inventory.negative', label: 'Permitir stock negativo', group: 'Inventario' },
  { key: 'purchases.approve', label: 'Aprobar, enviar y cancelar órdenes de compra', group: 'Compras' },
  { key: 'suppliers.view', label: 'Consultar proveedores', group: 'Proveedores' },
  { key: 'suppliers.manage', label: 'Crear o modificar proveedores', group: 'Proveedores' },
  { key: 'sales.view', label: 'Consultar ventas', group: 'Ventas y caja' },
  { key: 'sales.create', label: 'Registrar ventas', group: 'Ventas y caja' },
  { key: 'sales.cancel', label: 'Anular ventas', group: 'Ventas y caja' },
  { key: 'cash.view', label: 'Consultar caja y turnos', group: 'Ventas y caja' },
  { key: 'cash.manage', label: 'Abrir o cerrar turnos de caja', group: 'Ventas y caja' },
  { key: 'orders.view', label: 'Consultar pedidos', group: 'Pedidos' },
  { key: 'orders.manage', label: 'Gestionar pedidos', group: 'Pedidos' },
  { key: 'reports.view', label: 'Consultar reportes', group: 'Reportes' },
  { key: 'activity.view', label: 'Consultar bitácora de actividad', group: 'Administración' },
  { key: 'services.view', label: 'Consultar servicios y agenda', group: 'Servicios y citas' },
  { key: 'services.manage', label: 'Crear, editar y eliminar servicios o citas', group: 'Servicios y citas' },
  { key: 'hotel.view', label: 'Consultar habitaciones y reservas', group: 'Hotel' },
  { key: 'hotel.manage', label: 'Gestionar habitaciones y reservas', group: 'Hotel' },
] as const;

type BaseRole = 'business_admin' | 'cashier';
const roleName = (role: BusinessUserRecord['role'], customRoleName?: string | null) => customRoleName || (role === 'owner' ? 'Propietario' : role === 'business_admin' ? 'Administrador de negocio' : 'Cajero');
const roleStyle = (role: BusinessUserRecord['role'], isCustom?: boolean) => isCustom ? 'border-teal-200 bg-teal-50 text-teal-800' : role === 'owner' ? 'border-violet-200 bg-violet-50 text-violet-700' : role === 'business_admin' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-700';

export function UsersRoles() {
  const { user } = useAuth();
  const [ownerPhoto, setOwnerPhoto] = useState<string | null>(() => {
    try { return localStorage.getItem('manager_stock_owner_photo'); } catch { return null; }
  });
  const [users, setUsers] = useState<BusinessUserRecord[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRoleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleSelection, setRoleSelection] = useState('cashier');
  const [search, setSearch] = useState('');
  const [roleNameInput, setRoleNameInput] = useState('');
  const [rolePermissions, setRolePermissions] = useState<string[]>(['dashboard.view']);
  const [savingRole, setSavingRole] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<BusinessUserRecord | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextUsers, nextRoles] = await Promise.all([getBusinessUsers(), getCustomRoles()]);
      setUsers(nextUsers);
      setCustomRoles(nextRoles);
    } catch (error) { toastError(error, 'No se pudo cargar la lista de usuarios y roles.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const submitUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8) { toast.error('La contraseña debe tener al menos 8 caracteres.'); return; }
    setSaving(true);
    try {
      const selectedCustom = roleSelection.startsWith('custom:') ? roleSelection.slice('custom:'.length) : null;
      const baseRole: BaseRole = roleSelection === 'business_admin' ? 'business_admin' : 'cashier';
      await createBusinessUser({ name: name.trim(), email: email.trim(), password, role: baseRole, customRoleId: selectedCustom });
      toast.success('Usuario creado correctamente.');
      setName(''); setEmail(''); setPassword(''); setRoleSelection('cashier'); setShowForm(false);
      await refresh();
    } catch (error) { toastError(error, 'No se pudo crear el usuario.'); }
    finally { setSaving(false); }
  };

  const submitCustomRole = async (event: React.FormEvent) => {
    event.preventDefault();
    if (user?.role !== 'owner') return;
    if (rolePermissions.length === 0) { toast.error('Selecciona al menos un permiso.'); return; }
    setSavingRole(true);
    try {
      const role = await createCustomRole({ name: roleNameInput.trim(), permissions: rolePermissions });
      toast.success(`Rol “${role.name}” creado.`);
      setRoleNameInput(''); setRolePermissions(['dashboard.view']); setShowRoleForm(false);
      await refresh();
      setRoleSelection(`custom:${role.id}`);
      setShowForm(true);
    } catch (error) { toastError(error, 'No se pudo crear el rol.'); }
    finally { setSavingRole(false); }
  };

  const changeStatus = (target: BusinessUserRecord) => setStatusTarget(target);
  const confirmChangeStatus = async () => {
    if (!statusTarget) return;
    const active = !statusTarget.active;
    try {
      await updateBusinessUser(statusTarget.id, { active });
      toast.success(`Acceso ${active ? 'reactivado' : 'suspendido'}.`);
      await refresh();
    } catch (error) {
      toastError(error, 'No se pudo actualizar el usuario.');
      throw error;
    }
  };

  const changeRole = async (target: BusinessUserRecord, selection: string) => {
    setUpdatingUserId(target.id);
    try {
      if (selection.startsWith('custom:')) await updateBusinessUser(target.id, { customRoleId: selection.slice('custom:'.length) });
      else await updateBusinessUser(target.id, { role: selection as BaseRole, customRoleId: null });
      toast.success(`Rol actualizado para ${target.name}.`);
      await refresh();
    } catch (error) { toastError(error, 'No se pudo actualizar el rol.'); }
    finally { setUpdatingUserId(null); }
  };

  const filteredUsers = users.filter(item => `${item.name} ${item.email} ${roleName(item.role, item.customRoleName)}`.toLowerCase().includes(search.toLowerCase()));
  const canCreateAdmin = user?.role === 'owner';
  const selectedRole = customRoles.find(item => `custom:${item.id}` === roleSelection);
  const groups = [...new Set(PERMISSIONS.map(item => item.group))];

  return <Layout><div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-[var(--brand-primary)]">Administración del negocio</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Usuarios y permisos</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Crea cuentas y define permisos operativos para tu equipo. Los privilegios se verifican en el backend.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void refresh()} disabled={loading} className="rounded-xl"><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}/>Actualizar</Button>{canCreateAdmin && <Button variant="outline" onClick={() => setShowRoleForm(v => !v)} className="rounded-xl"><Shield className="mr-2 h-4 w-4"/>{showRoleForm ? 'Cerrar roles' : 'Crear rol'}</Button>}<Button onClick={() => setShowForm(v => !v)} className="rounded-xl bg-[var(--brand-primary)] text-white hover:opacity-90"><UserPlus className="mr-2 h-4 w-4"/>{showForm ? 'Cerrar usuario' : 'Nuevo usuario'}</Button></div></div>

    <Card className="rounded-2xl border-border/70 p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <label className="relative flex h-20 w-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted text-muted-foreground transition-colors hover:bg-accent" title="Clic para cambiar la foto. Doble clic para quitarla."
          onDoubleClick={e => { e.preventDefault(); setOwnerPhoto(null); try { localStorage.removeItem('manager_stock_owner_photo'); } catch {} }}>
          {ownerPhoto ? (
            <img src={ownerPhoto} alt="Dueño" className="h-full w-full object-cover" />
          ) : (
            <UserRound size={32} />
          )}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                const data = String(reader.result || '');
                setOwnerPhoto(data);
                try { localStorage.setItem('manager_stock_owner_photo', data); } catch {}
              };
              reader.readAsDataURL(file);
              e.target.value = '';
            }}
          />
        </label>
        <div className="flex-1 space-y-1">
          <p className="text-xs font-bold uppercase tracking-[.2em] text-[var(--brand-primary)]">Perfil del dueño</p>
          <h2 className="text-xl font-bold tracking-tight">{user?.name || 'Dueño'}</h2>
          <p className="text-sm text-muted-foreground">{user?.email || '—'}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">Propietario</Badge>
            <Badge variant="outline">{user?.businessId || 'Negocio'}</Badge>
          </div>
          <p className="text-xs text-muted-foreground pt-1">Clic en la foto para cambiarla. Doble clic para quitarla.</p>
        </div>
      </div>
    </Card>

    <div className="grid gap-4 sm:grid-cols-3"><Card className="rounded-2xl p-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-[var(--brand-soft)] p-3 text-[var(--brand-primary)]"><Users size={21}/></div><div><p className="text-sm text-muted-foreground">Usuarios</p><p className="mt-1 text-2xl font-bold">{users.length}</p></div></div></Card><Card className="rounded-2xl p-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><CircleCheck size={21}/></div><div><p className="text-sm text-muted-foreground">Accesos activos</p><p className="mt-1 text-2xl font-bold">{users.filter(u => u.active).length}</p></div></div></Card><Card className="rounded-2xl p-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-slate-100 p-3 text-slate-700"><ShieldCheck size={21}/></div><div><p className="text-sm text-muted-foreground">Roles personalizados</p><p className="mt-1 text-2xl font-bold">{customRoles.length}</p></div></div></Card></div>

    {showRoleForm && canCreateAdmin && <Card className="rounded-2xl border-border/70 p-5 sm:p-6"><div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-[var(--brand-soft)] p-3 text-[var(--brand-primary)]"><Shield size={20}/></div><div><h2 className="font-semibold">Crear rol personalizado</h2><p className="text-sm text-muted-foreground">Solo se ofrecen permisos operativos delegables. Este rol nunca puede administrar la plataforma.</p></div></div><form onSubmit={submitCustomRole} className="space-y-5"><div className="max-w-lg space-y-2"><Label htmlFor="custom-role-name">Nombre del rol</Label><Input id="custom-role-name" value={roleNameInput} onChange={event => setRoleNameInput(event.target.value)} required minLength={2} maxLength={60} placeholder="Ej. Encargado de inventario"/></div><div className="space-y-3"><h3 className="text-sm font-semibold">Permisos que tendrá el rol</h3><p className="text-xs text-muted-foreground">Algunas acciones agregan automáticamente sus permisos previos necesarios; por ejemplo, registrar ventas requiere leer el catálogo y operar el turno de caja.</p><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{groups.map(group => <div key={group} className="rounded-xl border border-border p-4"><h4 className="mb-3 text-sm font-semibold">{group}</h4><div className="space-y-3">{PERMISSIONS.filter(permission => permission.group === group).map(permission => <label key={permission.key} className="flex cursor-pointer items-start gap-2 text-sm"><input type="checkbox" checked={rolePermissions.includes(permission.key)} onChange={event => setRolePermissions(current => { const next = new Set(current); if (event.target.checked) {
                    next.add(permission.key);
                    const dependencies: Record<string, string[]> = {
                      'catalog.create': ['catalog.view'], 'catalog.edit': ['catalog.view'],
                      'inventory.view': [], 'inventory.edit': ['inventory.view'], 'inventory.entry': ['inventory.view'],
                      'inventory.adjust': ['inventory.view'], 'inventory.delete': ['inventory.view'], 'inventory.negative': ['inventory.view'],
                      'purchases.approve': ['inventory.view', 'suppliers.view', 'catalog.view'],
                      'suppliers.manage': ['suppliers.view'], 'cash.manage': ['cash.view'],
                      'sales.create': ['sales.view', 'catalog.view', 'cash.view', 'cash.manage'], 'sales.cancel': ['sales.view'],
                      'orders.manage': ['orders.view'], 'reports.view': ['sales.view', 'catalog.view'],
                    };
                    const addDependencies = (key: string) => (dependencies[key] ?? []).forEach(required => { if (!next.has(required)) next.add(required); addDependencies(required); });
                    addDependencies(permission.key);
                  } else {
                    next.delete(permission.key);
                    const dependencies: Record<string, string[]> = {
                      'catalog.create': ['catalog.view'], 'catalog.edit': ['catalog.view'],
                      'inventory.view': [], 'inventory.edit': ['inventory.view'], 'inventory.entry': ['inventory.view'],
                      'inventory.adjust': ['inventory.view'], 'inventory.delete': ['inventory.view'], 'inventory.negative': ['inventory.view'],
                      'purchases.approve': ['inventory.view', 'suppliers.view', 'catalog.view'],
                      'suppliers.manage': ['suppliers.view'], 'cash.manage': ['cash.view'],
                      'sales.create': ['sales.view', 'catalog.view', 'cash.view', 'cash.manage'], 'sales.cancel': ['sales.view'],
                      'orders.manage': ['orders.view'], 'reports.view': ['sales.view', 'catalog.view'],
                    };
                    let changed = true;
                    while (changed) {
                      changed = false;
                      for (const [dependent, required] of Object.entries(dependencies)) {
                        if (next.has(dependent) && required.some(value => !next.has(value))) { next.delete(dependent); changed = true; }
                      }
                    }
                  }
                  return [...next]; })} className="mt-0.5 h-4 w-4 rounded accent-[var(--brand-primary)]"/><span>{permission.label}{permission.key === 'reports.view' && <span className="mt-0.5 block text-xs text-muted-foreground">Incluye lectura de ventas y catálogo necesaria para calcular los reportes.</span>}</span></label>)}</div></div>)}</div></div><div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => setShowRoleForm(false)}>Cancelar</Button><Button type="submit" disabled={savingRole || roleNameInput.trim().length < 2 || rolePermissions.length === 0} className="bg-[var(--brand-primary)] text-white hover:opacity-90">{savingRole ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}Guardar rol</Button></div></form></Card>}

    {customRoles.length > 0 && <Card className="rounded-2xl border-border/70 p-5"><div className="mb-3 flex items-center gap-2"><Shield size={18} className="text-[var(--brand-primary)]"/><h2 className="font-semibold">Roles disponibles</h2></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{customRoles.map(role => <div key={role.id} className="rounded-xl border border-border p-4"><div className="flex items-center justify-between gap-2"><p className="font-semibold">{role.name}</p><Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-800">Personalizado</Badge></div><p className="mt-2 text-xs text-muted-foreground">{role.permissions.length} permisos delegados</p><p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{role.permissions.map(key => PERMISSIONS.find(item => item.key === key)?.label ?? key).join(' · ') || 'Sin permisos'}</p></div>)}</div></Card>}

    {showForm && <Card className="rounded-2xl border-border/70 p-5 shadow-sm sm:p-6"><div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-[var(--brand-soft)] p-3 text-[var(--brand-primary)]"><UserPlus size={20}/></div><div><h2 className="font-semibold">Crear usuario del negocio</h2><p className="text-sm text-muted-foreground">La cuenta se guardará en la base de datos. Usa una contraseña temporal segura.</p></div></div><form onSubmit={submitUser} className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label htmlFor="staff-name">Nombre completo</Label><Input id="staff-name" value={name} onChange={event => setName(event.target.value)} required minLength={2} placeholder="Nombre del empleado"/></div><div className="space-y-2"><Label htmlFor="staff-email">Correo electrónico</Label><Input id="staff-email" type="email" autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} required placeholder="empleado@negocio.com"/></div><div className="space-y-2"><Label htmlFor="staff-password">Contraseña inicial</Label><div className="relative"><KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input id="staff-password" type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={8} className="pl-9" placeholder="Mínimo 8 caracteres"/></div></div><div className="space-y-2"><Label>Rol</Label><Select value={roleSelection} onValueChange={setRoleSelection}><SelectTrigger><SelectValue placeholder="Selecciona el rol"/></SelectTrigger><SelectContent>{canCreateAdmin && <SelectItem value="business_admin">Administrador de negocio</SelectItem>}<SelectItem value="cashier">Cajero</SelectItem>{canCreateAdmin && customRoles.map(role => <SelectItem key={role.id} value={`custom:${role.id}`}>{role.name}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">{selectedRole ? `${selectedRole.permissions.length} permisos delegados por el propietario.` : 'SUPERADMIN y propietario no se pueden asignar desde aquí.'}</p></div><div className="flex justify-end gap-2 md:col-span-2"><Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button><Button type="submit" disabled={saving} className="bg-[var(--brand-primary)] text-white hover:opacity-90">{saving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin"/> : <UserPlus className="mr-2 h-4 w-4"/>}Crear usuario</Button></div></form></Card>}

    <Card className="overflow-hidden rounded-2xl shadow-sm"><div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">Equipo del negocio</h2><p className="mt-1 text-xs text-muted-foreground">Las cuentas solo pueden operar dentro de esta empresa.</p></div><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nombre, correo o rol…" className="max-w-sm"/></div>{loading ? <div className="flex items-center justify-center gap-3 p-12 text-muted-foreground"><LoaderCircle className="h-5 w-5 animate-spin"/>Cargando usuarios…</div> : filteredUsers.length ? <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-5 py-4 font-semibold">Usuario</th><th className="px-5 py-4 font-semibold">Rol</th><th className="px-5 py-4 font-semibold">Estado</th><th className="px-5 py-4 font-semibold">Creado</th><th className="px-5 py-4 text-right font-semibold">Acciones</th></tr></thead><tbody className="divide-y divide-border/60">{filteredUsers.map(target => <tr key={target.id} className="hover:bg-muted/20"><td className="px-5 py-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground"><UserRound size={18}/></div><div><p className="font-semibold">{target.name}</p><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Mail size={12}/>{target.email}</p></div></div></td><td className="px-5 py-4"><div className="space-y-2"><Badge variant="outline" className={roleStyle(target.role, !!target.customRoleId)}>{roleName(target.role, target.customRoleName)}</Badge>{canCreateAdmin && target.role !== 'owner' && <Select value={target.customRoleId ? `custom:${target.customRoleId}` : target.role} onValueChange={value => void changeRole(target, value)}><SelectTrigger className="h-8 min-w-48" disabled={updatingUserId === target.id}><SelectValue/></SelectTrigger><SelectContent><SelectItem value="cashier">Cajero</SelectItem><SelectItem value="business_admin">Administrador</SelectItem>{customRoles.map(role => <SelectItem key={role.id} value={`custom:${role.id}`}>{role.name}</SelectItem>)}</SelectContent></Select>}</div></td><td className="px-5 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${target.active ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{target.active ? 'Activo' : 'Suspendido'}</span></td><td className="px-5 py-4 text-xs text-muted-foreground">{target.createdAt ? new Date(target.createdAt.replace(' ', 'T') + (target.createdAt.includes('Z') ? '' : 'Z')).toLocaleDateString('es-CO') : '—'}</td><td className="px-5 py-4 text-right">{target.role !== 'owner' && target.id !== user?.id ? <Button size="sm" variant="outline" onClick={() => void changeStatus(target)} className="rounded-lg">{target.active ? <><CircleX className="mr-2 h-4 w-4"/>Suspender</> : <><CircleCheck className="mr-2 h-4 w-4"/>Reactivar</>}</Button> : <span className="text-xs text-muted-foreground">Cuenta protegida</span>}</td></tr>)}</tbody></table></div> : <div className="p-12 text-center"><Users className="mx-auto h-10 w-10 text-muted-foreground/40"/><p className="mt-3 font-semibold">No se encontraron usuarios</p><p className="mt-1 text-sm text-muted-foreground">Prueba otra búsqueda o crea el primer usuario del equipo.</p></div>}</Card>
    <div className="flex gap-3 rounded-xl border border-border bg-muted/30 p-4"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand-primary)]"/><p className="text-xs leading-5 text-muted-foreground">Los roles personalizados solo reciben permisos operativos delegables. No pueden administrar la plataforma, cambiar la configuración crítica ni elevar sus propios privilegios.</p></div>
    <ConfirmActionDialog
      open={Boolean(statusTarget)}
      onOpenChange={open => { if (!open) setStatusTarget(null); }}
      title={statusTarget?.active ? 'Suspender acceso del empleado' : 'Reactivar acceso del empleado'}
      description={statusTarget ? `¿${statusTarget.active ? 'Suspender' : 'reactivar'} el acceso de ${statusTarget.name}?` : ''}
      confirmLabel={statusTarget?.active ? 'Suspender acceso' : 'Reactivar acceso'}
      destructive={Boolean(statusTarget?.active)}
      onConfirm={confirmChangeStatus}
    />
  </div></Layout>;
}
