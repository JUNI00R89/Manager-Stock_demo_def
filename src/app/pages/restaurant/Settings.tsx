import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  KeyRound,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { toastError } from '../../utils/notifications';
import { Layout } from '../../components/Layout';
import { StaffSwitcher } from '../../components/restaurant/StaffSwitcher';
import { ConfirmActionDialog } from '../../components/ConfirmActionDialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../../components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { dataService, type RestaurantTableRecord } from '../../services/dataService';
import { useAuth } from '../../context/AuthContext';
import { useRestaurantScope } from '../../utils/restaurantScope';
import { useRestaurantStaff, RESTAURANT_ROLE_LABELS, type RestaurantStaff } from '../../utils/restaurantStaffStore';
import { useRestaurantSettings } from '../../utils/restaurantSettingsStore';
import { useRestaurantTables } from '../../utils/restaurantOrdersHook';
import { getInitials } from '../../utils/restaurantFormat';
import type { EmpleadoRol } from '../../utils/restaurantTypes';

type SettingsTab = 'mesas' | 'usuarios';

export function RestaurantSettingsPage() {
  const { user } = useAuth();
  const scope = useRestaurantScope();
  const { settings, saveSettings, setTableName, removeTableName } = useRestaurantSettings(scope);
  const { tables, loading: tablesLoading, refresh: refreshTables } = useRestaurantTables();
  const { staff, activeByRole, addStaff, updateStaff, removeStaff, setActive } = useRestaurantStaff(
    scope,
    user?.name || '',
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'usuarios' ? 'usuarios' : 'mesas';
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    setTab(searchParams.get('tab') === 'usuarios' ? 'usuarios' : 'mesas');
  }, [searchParams]);

  const changeTab = (next: SettingsTab) => {
    setTab(next);
    setSearchParams({ tab: next }, { replace: true });
  };

  const [startDraft, setStartDraft] = useState(settings.startTime);
  const [expectedDraft, setExpectedDraft] = useState(String(settings.expectedMinutes));
  useEffect(() => {
    setStartDraft(settings.startTime);
    setExpectedDraft(String(settings.expectedMinutes));
  }, [settings.startTime, settings.expectedMinutes]);

  const saveSchedule = () => {
    if (!/^\d{2}:\d{2}$/.test(startDraft)) {
      toast.error('Usa una hora válida en formato HH:mm.');
      return;
    }
    const expected = Number(expectedDraft);
    if (!Number.isFinite(expected) || expected < 1 || expected > 180) {
      toast.error('El tiempo de alerta debe estar entre 1 y 180 minutos.');
      return;
    }
    saveSettings({ startTime: startDraft, expectedMinutes: Math.round(expected) });
    toast.success('Jornada y alerta actualizadas.');
  };

  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<RestaurantTableRecord | null>(null);
  const [tableNumber, setTableNumber] = useState('1');
  const [tableNameValue, setTableNameValue] = useState('');
  const [tableZone, setTableZone] = useState('Salón');
  const [tableCapacity, setTableCapacity] = useState('4');
  const [savingTable, setSavingTable] = useState(false);
  const [deleteTableTarget, setDeleteTableTarget] = useState<RestaurantTableRecord | null>(null);

  const nextFreeNumber = useMemo(() => {
    const taken = new Set(tables.map(table => table.number));
    let candidate = 1;
    while (taken.has(candidate)) candidate += 1;
    return candidate;
  }, [tables]);

  const openCreateTable = () => {
    setEditingTable(null);
    setTableNumber(String(nextFreeNumber));
    setTableNameValue('');
    setTableZone('Salón');
    setTableCapacity('4');
    setTableDialogOpen(true);
  };

  const openEditTable = (table: RestaurantTableRecord) => {
    setEditingTable(table);
    setTableNumber(String(table.number));
    setTableNameValue(settings.tableNames[table.id] || '');
    setTableZone(table.zone || 'Salón');
    setTableCapacity(String(table.capacity || 4));
    setTableDialogOpen(true);
  };

  const saveTable = async () => {
    const number = Number(tableNumber);
    const capacity = Number(tableCapacity);
    if (!Number.isInteger(number) || number < 1) {
      toast.error('El número de mesa debe ser un entero mayor que cero.');
      return;
    }
    if (!Number.isInteger(capacity) || capacity < 1) {
      toast.error('La capacidad debe ser un entero mayor que cero.');
      return;
    }
    setSavingTable(true);
    try {
      const saved = editingTable
        ? await dataService.updateTable(editingTable.id, { number, zone: tableZone.trim() || 'Salón', capacity })
        : await dataService.createTable({ number, zone: tableZone.trim() || 'Salón', capacity });
      if (tableNameValue.trim()) setTableName(saved.id, tableNameValue);
      else removeTableName(saved.id);
      await refreshTables();
      setTableDialogOpen(false);
      toast.success(editingTable ? 'Mesa actualizada.' : 'Mesa creada.');
    } catch (reason) {
      toastError(reason, 'No se pudo guardar la mesa.');
    } finally {
      setSavingTable(false);
    }
  };

  const toggleTable = async (table: RestaurantTableRecord) => {
    try {
      await dataService.updateTable(table.id, { status: table.status === 'active' ? 'inactive' : 'active' });
      await refreshTables();
    } catch (reason) {
      toastError(reason, 'No se pudo cambiar la mesa.');
    }
  };

  const confirmDeleteTable = async () => {
    if (!deleteTableTarget) return;
    try {
      await dataService.deleteTable(deleteTableTarget.id);
      removeTableName(deleteTableTarget.id);
      await refreshTables();
      toast.success('Mesa eliminada.');
    } catch (reason) {
      toastError(reason, 'No se pudo eliminar la mesa.');
      throw reason;
    }
  };

  const [staffDialogOpen, setStaffDialogOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<RestaurantStaff | null>(null);
  const [staffName, setStaffName] = useState('');
  const [staffRole, setStaffRole] = useState<EmpleadoRol>('mesero');
  const [staffPin, setStaffPin] = useState('');
  const [staffActiveState, setStaffActiveState] = useState(true);
  const [deleteStaffTarget, setDeleteStaffTarget] = useState<RestaurantStaff | null>(null);

  const openCreateStaff = () => {
    setEditingStaff(null);
    setStaffName('');
    setStaffRole('mesero');
    setStaffPin('');
    setStaffActiveState(true);
    setStaffDialogOpen(true);
  };

  const openEditStaff = (person: RestaurantStaff) => {
    setEditingStaff(person);
    setStaffName(person.name);
    setStaffRole(person.role);
    setStaffPin(person.pin || '');
    setStaffActiveState(person.active);
    setStaffDialogOpen(true);
  };

  const saveStaff = () => {
    if (staffName.trim().length < 2) {
      toast.error('Escribe el nombre de la persona.');
      return;
    }
    if (staffPin.trim() && !/^\d{4,8}$/.test(staffPin.trim())) {
      toast.error('El PIN debe tener entre 4 y 8 dígitos.');
      return;
    }
    if (editingStaff) {
      updateStaff(editingStaff.id, {
        name: staffName,
        role: staffRole,
        pin: staffPin,
        active: staffActiveState,
      });
      toast.success('Usuario actualizado.');
    } else {
      addStaff({ name: staffName, role: staffRole, pin: staffPin });
      toast.success('Usuario agregado.');
    }
    setStaffDialogOpen(false);
  };

  const confirmDeleteStaff = async () => {
    if (!deleteStaffTarget) return;
    removeStaff(deleteStaffTarget.id);
    toast.success('Usuario eliminado.');
  };

  return (
    <Layout>
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Restaurante · Configuración</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Ajustes del restaurante
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Mesas, jornada, alertas de cocina y personas que usan las pantallas.
          </p>
        </div>
        <StaffSwitcher scope={scope} role="admin" currentUserName={user?.name || ''} />
      </header>

      <div className="mt-5 flex rounded-xl border border-border bg-card p-1 shadow-sm sm:w-fit">
        <button
          type="button"
          onClick={() => changeTab('mesas')}
          className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none ${tab === 'mesas' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
        >
          <UtensilsCrossed size={17} /> Mesas
        </button>
        <button
          type="button"
          onClick={() => changeTab('usuarios')}
          className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none ${tab === 'usuarios' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
        >
          <Users size={17} /> Usuarios
        </button>
      </div>

      {tab === 'mesas' ? (
        <div className="mt-5 space-y-5">
          <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CalendarClock size={20} />
              </span>
              <div>
                <h2 className="font-bold text-foreground">Jornada y alerta de cocina</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  La numeración reinicia a la hora de inicio. La alerta visual se activa al superar el tiempo esperado.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,12rem)_auto] sm:items-end">
              <div>
                <Label htmlFor="start-time">Hora de inicio</Label>
                <Input
                  id="start-time"
                  type="time"
                  value={startDraft}
                  onChange={event => setStartDraft(event.target.value)}
                  className="mt-1 h-11"
                />
              </div>
              <div>
                <Label htmlFor="expected-minutes">Alerta a los (min)</Label>
                <Input
                  id="expected-minutes"
                  type="number"
                  min={1}
                  max={180}
                  value={expectedDraft}
                  onChange={event => setExpectedDraft(event.target.value)}
                  className="mt-1 h-11"
                />
              </div>
              <Button className="h-11" onClick={saveSchedule}>
                <Save size={17} /> Guardar
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Jornada actual: inicia a las {settings.startTime} y la alerta visual está a los {settings.expectedMinutes}{' '}
              min.
            </p>
          </section>

          <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-foreground">Mesas del salón</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {tables.filter(table => table.status === 'active').length} activas de {tables.length}. Puedes poner un
                  nombre visible como A2.
                </p>
              </div>
              <Button className="h-11" onClick={openCreateTable}>
                <Plus size={17} /> Nueva mesa
              </Button>
            </div>

            {tablesLoading ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[1, 2, 3, 4].map(item => (
                  <div key={item} className="h-28 animate-pulse rounded-2xl border border-border bg-muted/50" />
                ))}
              </div>
            ) : tables.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-border p-8 text-center">
                <UtensilsCrossed size={30} className="mx-auto text-muted-foreground" />
                <p className="mt-2 font-semibold text-foreground">No hay mesas creadas</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Crea la primera mesa para que el mesero pueda tomar pedidos.
                </p>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {tables.map(table => (
                  <article
                    key={table.id}
                    className={`rounded-2xl border p-4 ${table.status === 'active' ? 'border-border bg-background' : 'border-dashed border-border bg-muted/30 opacity-80'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-bold text-foreground">
                          {settings.tableNames[table.id] || `Mesa ${table.number}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {table.zone || 'Salón'} · {table.capacity} puestos · Número {table.number}
                        </p>
                        <Badge
                          variant="outline"
                          className={`mt-2 ${table.status === 'active' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'}`}
                        >
                          {table.status === 'active' ? 'Habilitada' : 'Deshabilitada'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditTable(table)}
                          className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Editar ${settings.tableNames[table.id] || `Mesa ${table.number}`}`}
                        >
                          <Pencil size={17} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTableTarget(table)}
                          className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Eliminar ${settings.tableNames[table.id] || `Mesa ${table.number}`}`}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </div>
                    <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
                      <Switch checked={table.status === 'active'} onCheckedChange={() => void toggleTable(table)} />
                      {table.status === 'active' ? 'Habilitada' : 'Deshabilitada'}
                    </label>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <UserRound size={20} />
                </span>
                <div>
                  <h2 className="font-bold text-foreground">Equipo del restaurante</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Meseros, cocina y administración. El PIN es opcional y protege el cambio de usuario en las
                    pantallas.
                  </p>
                </div>
              </div>
              <Button className="h-11" onClick={openCreateStaff}>
                <Plus size={17} /> Nuevo usuario
              </Button>
            </div>

            {staff.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-border p-8 text-center">
                <Users size={30} className="mx-auto text-muted-foreground" />
                <p className="mt-2 font-semibold text-foreground">No hay usuarios de restaurante</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Agrega al menos un mesero, una persona de cocina y un administrador.
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-2.5">
                {staff.map(person => {
                  const isActive = activeByRole[person.role] === person.id && person.active;
                  return (
                    <article
                      key={person.id}
                      className={`rounded-2xl border p-3.5 ${isActive ? 'border-primary/35 bg-primary/5' : 'border-border bg-background'}`}
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-sm font-bold text-secondary-foreground">
                          {getInitials(person.name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-foreground">{person.name}</p>
                            <Badge variant="outline">{RESTAURANT_ROLE_LABELS[person.role]}</Badge>
                            {person.pin && (
                              <Badge
                                variant="outline"
                                className="border-amber-500/30 text-amber-700 dark:text-amber-300"
                              >
                                <KeyRound size={11} /> PIN
                              </Badge>
                            )}
                            {isActive && (
                              <Badge className="border-transparent bg-primary text-primary-foreground">En uso</Badge>
                            )}
                            {!person.active && (
                              <Badge variant="outline" className="text-muted-foreground">
                                Inactivo
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Rol: {RESTAURANT_ROLE_LABELS[person.role]}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          {person.active && !isActive && (
                            <Button
                              variant="outline"
                              className="h-11"
                              onClick={() => {
                                setActive(person.role, person.id);
                                toast.success(`${person.name} queda activo en ${RESTAURANT_ROLE_LABELS[person.role]}.`);
                              }}
                            >
                              <ShieldCheck size={16} /> Usar
                            </Button>
                          )}
                          <button
                            type="button"
                            onClick={() => openEditStaff(person)}
                            className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`Editar ${person.name}`}
                          >
                            <Pencil size={17} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteStaffTarget(person)}
                            className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`Eliminar ${person.name}`}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-foreground">Cuentas de acceso al sistema</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Los usuarios de la lista anterior operan las pantallas del local. Las cuentas con correo y contraseña se
                administran en Usuarios y roles.
              </p>
            </div>
            <Button variant="outline" className="h-11 shrink-0" asChild>
              <Link to="/users-roles">
                Abrir Usuarios y roles <ArrowRight size={17} />
              </Link>
            </Button>
          </section>
        </div>
      )}

      <Dialog open={tableDialogOpen} onOpenChange={setTableDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTable ? 'Editar mesa' : 'Nueva mesa'}</DialogTitle>
            <DialogDescription>
              El nombre visible es opcional; si lo dejas vacío se usará “Mesa {tableNumber}”.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="table-number">Número</Label>
              <Input
                id="table-number"
                type="number"
                min={1}
                value={tableNumber}
                onChange={event => setTableNumber(event.target.value)}
                className="mt-1 h-11"
              />
            </div>
            <div>
              <Label htmlFor="table-name">Nombre visible</Label>
              <Input
                id="table-name"
                value={tableNameValue}
                onChange={event => setTableNameValue(event.target.value)}
                placeholder={`Mesa ${tableNumber}`}
                className="mt-1 h-11"
                maxLength={40}
              />
            </div>
            <div>
              <Label htmlFor="table-zone">Zona</Label>
              <Input
                id="table-zone"
                value={tableZone}
                onChange={event => setTableZone(event.target.value)}
                className="mt-1 h-11"
                maxLength={40}
              />
            </div>
            <div>
              <Label htmlFor="table-capacity">Capacidad</Label>
              <Input
                id="table-capacity"
                type="number"
                min={1}
                value={tableCapacity}
                onChange={event => setTableCapacity(event.target.value)}
                className="mt-1 h-11"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-11" onClick={() => setTableDialogOpen(false)}>
              Cancelar
            </Button>
            <Button className="h-11" onClick={saveTable} disabled={savingTable}>
              <Save size={17} /> {savingTable ? 'Guardando…' : 'Guardar mesa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={staffDialogOpen} onOpenChange={setStaffDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingStaff ? 'Editar usuario' : 'Nuevo usuario del restaurante'}</DialogTitle>
            <DialogDescription>
              El PIN es opcional. Si lo defines, se pedirá al cambiar de usuario activo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="staff-name">Nombre</Label>
              <Input
                id="staff-name"
                value={staffName}
                onChange={event => setStaffName(event.target.value)}
                className="mt-1 h-11"
                maxLength={60}
                placeholder="Ej. Camila"
              />
            </div>
            <div>
              <Label htmlFor="staff-role">Rol</Label>
              <Select value={staffRole} onValueChange={value => setStaffRole(value as EmpleadoRol)}>
                <SelectTrigger id="staff-role" className="mt-1 h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mesero">Mesero</SelectItem>
                  <SelectItem value="cocina">Cocina</SelectItem>
                  <SelectItem value="admin">Administración</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="staff-pin">PIN opcional</Label>
              <Input
                id="staff-pin"
                type="password"
                inputMode="numeric"
                value={staffPin}
                onChange={event => setStaffPin(event.target.value.replace(/\D/g, ''))}
                className="mt-1 h-11"
                maxLength={8}
                placeholder="4 a 8 dígitos"
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-muted-foreground">Déjalo vacío para no pedir PIN.</p>
            </div>
            {editingStaff && (
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-foreground">
                <Switch checked={staffActiveState} onCheckedChange={setStaffActiveState} />
                Usuario activo
              </label>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-11" onClick={() => setStaffDialogOpen(false)}>
              Cancelar
            </Button>
            <Button className="h-11" onClick={saveStaff}>
              <Save size={17} /> Guardar usuario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={!!deleteTableTarget}
        onOpenChange={open => {
          if (!open) setDeleteTableTarget(null);
        }}
        title="Eliminar mesa"
        description={`Se eliminará ${deleteTableTarget ? settings.tableNames[deleteTableTarget.id] || `Mesa ${deleteTableTarget.number}` : 'la mesa'}. Esta acción no elimina pedidos ya creados.`}
        confirmLabel="Eliminar mesa"
        destructive
        onConfirm={confirmDeleteTable}
      />

      <ConfirmActionDialog
        open={!!deleteStaffTarget}
        onOpenChange={open => {
          if (!open) setDeleteStaffTarget(null);
        }}
        title="Eliminar usuario"
        description={`Se quitará a ${deleteStaffTarget?.name || 'esta persona'} del equipo. Si estaba activo, se elegirá otra persona del mismo rol cuando exista.`}
        confirmLabel="Eliminar usuario"
        destructive
        onConfirm={confirmDeleteStaff}
      />
    </Layout>
  );
}
