import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, Boxes, Check, PackageCheck, Plus, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../utils/notifications';
import { Layout } from '../components/Layout';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Switch } from '../components/ui/switch';
import { dataService, getProductCategories, createProductCategory, type ProductCategoryRecord, type InventoryLocationRecord } from '../services/dataService';
import type { Product, Supplier } from '../utils/types';
import { useBusiness, type BusinessType } from '../context/BusinessContext';
import { cropDataUrl, productImageUrl, resizeImage } from '../utils/productImage';
import { formatMoney as money } from '../utils/restaurantFormat';

const CATEGORY_PRESETS: Record<BusinessType, string[]> = {
  retail: ['Bebidas', 'Alimentos', 'Aseo', 'Accesorios', 'Tecnología', 'Ropa', 'Otros'],
  restaurant: ['Comidas rápidas', 'Hamburguesas', 'Salchipapas', 'Empanadas', 'Almuerzos', 'Bebidas', 'Postres', 'Adicionales', 'Otros'],
  hotel: ['Minibar', 'Bebidas', 'Artículos de aseo', 'Productos complementarios', 'Otros'],
  warehouse: ['Materias primas', 'Mercancía', 'Empaques', 'Herramientas', 'Repuestos', 'Otros'],
  services: ['Servicios principales', 'Servicios complementarios', 'Productos relacionados', 'Otros'],
};
const DISCRETE_UNITS = new Set(['unidad', 'porción', 'porcion', 'paquete', 'tajada', 'caja', 'pieza', 'par', 'botella', 'lata', 'servicio']);
type ProductForm = { name: string; sku: string; category: string; price: string; cost: string; stock: string; minStock: string; description: string; productType: 'sale_item' | 'ingredient' | 'supplies'; unit: string; supplierId: string; barcode: string; trackLots: boolean; defaultLocationId: string };
const emptyForm: ProductForm = { name: '', sku: '', category: '', price: '', cost: '', stock: '0', minStock: '5', description: '', productType: 'sale_item', unit: 'unidad', supplierId: '', barcode: '', trackLots: false, defaultLocationId: '' };

export function NewProduct() {
  const navigate = useNavigate();
  const { config, isFoodBusiness } = useBusiness();
  const { id } = useParams();
  const isEditing = Boolean(id);
  const [formData, setFormData] = useState<ProductForm>(emptyForm);
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<ProductCategoryRecord[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(true);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [categoryDescription, setCategoryDescription] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<InventoryLocationRecord[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Saved photo path, and the pending change: undefined = keep, data URL = new photo, null = remove.
  const [currentImage, setCurrentImage] = useState('');
  const [newPhoto, setNewPhoto] = useState<string | null | undefined>(undefined);
  const photoPreview = newPhoto === null ? null : newPhoto ?? productImageUrl(currentImage, true);
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      const resized = await resizeImage(file);
      setNewPhoto(resized);
      setCropRect({ x: 0, y: 0, w: 1, h: 1 });
      setCropOpen(true);
    } catch (error) { toastError(error, 'No se pudo leer la foto.'); }
  };

  const openPhotoPicker = () => fileInputRef.current?.click();

  const handlePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void pickPhoto(file);
    // Se limpia el input para permitir elegir el mismo archivo otra vez.
    event.target.value = '';
  };

  const [cropOpen, setCropOpen] = useState(false);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 1, h: 1 });
  const cropDrag = useRef<{ ox: number; oy: number; sx: number; sy: number } | null>(null);

  const applyCrop = async () => {
    if (!newPhoto || !cropOpen) return;
    const cropped = await cropDataUrl(newPhoto, cropRect);
    setNewPhoto(cropped);
    setCropOpen(false);
  };

  const closeCrop = () => { cropDrag.current = null; setCropOpen(false); };

  const discreteQuantity = useMemo(() => DISCRETE_UNITS.has(formData.unit.trim().toLocaleLowerCase('es')), [formData.unit]);

  useEffect(() => {
    let active = true;
    setCategoryLoading(true);
    getProductCategories().then(rows => { if (active) setCategories(rows.filter(row => row.active)); })
      .catch(() => {
        const type = config?.type ?? 'retail';
        if (active) setCategories(CATEGORY_PRESETS[type].map((name, index) => ({ id: `fallback-${index}`, name, description: '', active: true, custom: false })));
      })
      .finally(() => { if (active) setCategoryLoading(false); });
    return () => { active = false; };
  }, [config?.type]);

  useEffect(() => {
    let active = true;
    const loadReferences = async () => {
      try { setSuppliers(await dataService.getSuppliers()); setLocations(await dataService.getInventoryLocations()); }
      catch { /* el catálogo no debe bloquear el alta del producto */ }
    };
    void loadReferences();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!id) return;
    let active = true;
    void dataService.getProduct(id).then(product => {
      if (!active) return;
      if (!product) { toast.error('El producto no existe.'); navigate('/products', { replace: true }); return; }
      setCurrentImage(product.image || '');
      setFormData({ name: product.name, sku: product.sku, category: product.category, price: String(product.price), cost: String(product.cost || 0), stock: String(product.stock), minStock: String(product.minStock), description: product.description || '', productType: isFoodBusiness ? 'sale_item' : (product.productType || 'sale_item'), unit: product.unit || 'unidad', supplierId: product.supplierId || '', barcode: product.barcode || '', trackLots: Boolean(product.trackLots), defaultLocationId: product.defaultLocationId || '' });
    }).catch(error => toastError(error, 'No se pudo cargar el producto.')).finally(() => setLoading(false));
    return () => { active = false; };
  }, [id, navigate, isFoodBusiness]);

  useEffect(() => {
    if (!isEditing && !formData.category && categories.length) {
      setFormData(prev => ({ ...prev, category: categories[0].name }));
    }
  }, [categories, formData.category, isEditing]);

  const handleChange = (field: keyof ProductForm, value: string | boolean) => setFormData(prev => ({ ...prev, [field]: value }));
  const handleCreateCategory = async () => {
    const name = categoryName.trim();
    if (name.length < 2) { toast.error('El nombre de la categoría debe tener al menos dos caracteres.'); return; }
    if (categories.some(category => category.name.trim().localeCompare(name, 'es', { sensitivity: 'base' }) === 0)) {
      toast.error('Ya existe una categoría con ese nombre.'); return;
    }
    setSavingCategory(true);
    try {
      const created = await createProductCategory({ name, description: categoryDescription.trim() });
      setCategories(previous => [...previous.filter(item => item.id !== created.id), created].sort((a, b) => a.name.localeCompare(b.name, 'es')));
      setFormData(previous => ({ ...previous, category: created.name }));
      setCategoryName(''); setCategoryDescription(''); setShowCategoryForm(false);
      toast.success('Categoría creada y seleccionada.');
    } catch (error) {
      toastError(error, 'No se pudo crear la categoría.');
    } finally { setSavingCategory(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const price = Number(formData.price); const cost = Number(formData.cost || 0); const stock = Number(formData.stock); const minStock = Number(formData.minStock);
    if (!formData.name.trim() || !formData.sku.trim() || !formData.category) { toast.error('Completa nombre, SKU y categoría.'); return; }
    if ([price, cost, stock, minStock].some(n => !Number.isFinite(n) || n < 0)) { toast.error('Precio, costo y existencias deben ser valores iguales o mayores que cero.'); return; }
    if (discreteQuantity && (!Number.isInteger(stock) || !Number.isInteger(minStock))) { toast.error('Para esta unidad, las existencias y el stock mínimo deben ser enteros. Cambia la unidad si necesitas fracciones.'); return; }
    if (!categories.some(category => category.name === formData.category) && !isEditing) { toast.error('Selecciona una categoría válida o crea una nueva.'); return; }
    setSaving(true);
    const productType = isFoodBusiness ? 'sale_item' : formData.productType;
    const payload = { name: formData.name.trim(), sku: formData.sku.trim().toUpperCase(), category: formData.category, price, cost, stock, minStock, description: formData.description.trim(), image: productType === 'ingredient' ? 'ingredient' : 'food', productType, unit: formData.unit, supplierId: formData.supplierId || undefined, barcode: formData.barcode.trim(), trackLots: formData.trackLots, defaultLocationId: formData.defaultLocationId || undefined };
    try {
      const saved = id ? await dataService.updateProduct(id, payload) : await dataService.createProduct(payload);
      try {
        if (typeof newPhoto === 'string') await dataService.uploadProductImage(saved.id, newPhoto);
        else if (newPhoto === null && currentImage.startsWith('/uploads/')) await dataService.removeProductImage(saved.id);
      } catch (error) { toastError(error, 'El producto se guardó, pero la foto no se pudo actualizar.'); }
      toast.success(isEditing ? 'Producto actualizado correctamente.' : 'Producto guardado en el inventario.');
      navigate('/products');
    } catch (error) { toastError(error, 'No se pudo guardar el producto.'); }
    finally { setSaving(false); }
  };

  const selectCategory = (value: string) => {
    if (value === '__create_category__') { setShowCategoryForm(true); return; }
    setFormData(previous => ({ ...previous, category: value }));
    setShowCategoryForm(false);
  };

  return <Layout><div className="mx-auto max-w-5xl space-y-6">
    <div className="flex items-center gap-3"><Button variant="outline" size="icon" className="rounded-xl" onClick={() => navigate('/products')}><ArrowLeft className="h-4 w-4"/></Button><div><p className="text-sm font-semibold uppercase tracking-[.16em] text-orange-600">Catálogo e inventario</p><h1 className="mt-1 text-3xl font-bold tracking-tight">{isEditing ? 'Editar producto' : 'Nuevo producto'}</h1><p className="mt-1 text-muted-foreground">Registra el precio, el costo y las existencias iniciales.</p></div></div>
    {loading ? <Card className="rounded-2xl p-12 text-center text-muted-foreground">Cargando producto…</Card> : <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <Card className="space-y-6 rounded-2xl border-border/70 p-6 shadow-sm sm:p-8">
        <div><h2 className="font-semibold">Información principal</h2><p className="mt-1 text-sm text-muted-foreground">Los campos con * son obligatorios.</p></div>
        <div className="grid gap-5 sm:grid-cols-2"><div className="space-y-2 sm:col-span-2"><Label htmlFor="name">Nombre del producto *</Label><Input id="name" value={formData.name} onChange={e => handleChange('name', e.target.value)} placeholder="Ej. Producto de venta" required maxLength={120} className="h-11 rounded-xl"/></div>
          <div className="space-y-2"><Label htmlFor="sku">SKU / código interno *</Label><Input id="sku" value={formData.sku} onChange={e => handleChange('sku', e.target.value)} placeholder="SKU-001" required maxLength={60} className="h-11 rounded-xl uppercase"/><p className="text-xs text-muted-foreground">Debe ser único para cada producto.</p></div>
          <div className="space-y-2"><Label htmlFor="category">Categoría *</Label><select id="category" value={showCategoryForm ? '__create_category__' : formData.category} onChange={e => selectCategory(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm" required={!showCategoryForm} disabled={categoryLoading}><option value="" disabled>{categoryLoading ? 'Cargando categorías…' : 'Selecciona una categoría'}</option>{categories.map(category => <option key={category.id} value={category.name}>{category.name}{category.custom ? ' · Personalizada' : ''}</option>)}{formData.category && !categories.some(category => category.name === formData.category) && <option value={formData.category}>{formData.category} · Existente</option>}<option value="__create_category__">＋ Crear nueva categoría…</option></select></div>
          {!isFoodBusiness ? <div className="space-y-2"><Label htmlFor="type">Tipo de registro</Label><select id="type" value={formData.productType} onChange={e => handleChange('productType', e.target.value as ProductForm['productType'])} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="sale_item">Producto para vender</option><option value="ingredient">Ingrediente / materia prima</option><option value="supplies">Suministro del negocio</option></select><p className="text-xs text-muted-foreground">Los ingredientes y suministros se mantienen fuera del punto de venta.</p></div> : <div className="rounded-xl border border-[var(--brand-primary)]/20 bg-[var(--brand-soft)] p-3 text-sm text-foreground"><strong>Producto de venta</strong><p className="mt-1 text-xs leading-5 text-muted-foreground">Cada plato o bebida se maneja como producto individual. No necesitas registrar recetas ni ingredientes.</p></div>}
          <div className="space-y-2"><Label htmlFor="unit">Unidad de medida</Label><select id="unit" value={formData.unit} onChange={e => handleChange('unit', e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">{['unidad','porción','kg','g','litro','ml','paquete','tajada','caja','servicio'].map(unit => <option key={unit}>{unit}</option>)}</select><p className="text-xs text-muted-foreground">{discreteQuantity ? 'Las cantidades se ajustan de una en una.' : 'Permite cantidades fraccionarias para esta unidad.'}</p></div>
          {!isFoodBusiness ? <div className="space-y-2"><Label htmlFor="supplier">Proveedor principal</Label><select id="supplier" value={formData.supplierId} onChange={e => handleChange('supplierId', e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="">Sin proveedor</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.company || supplier.name}</option>)}</select><p className="text-xs text-muted-foreground">Se usa para compras, entradas y historial de precios.</p></div> : <div className="hidden" />}
          <div className="space-y-2"><Label htmlFor="barcode">Código de barras / SKU externo</Label><Input id="barcode" value={formData.barcode} onChange={e => handleChange('barcode', e.target.value)} placeholder="Ej. 7501234567890" maxLength={120} className="h-11 rounded-xl"/><p className="text-xs text-muted-foreground">Permite buscar el producto al escanear en el punto de venta o en bodega.</p></div>
          {!isFoodBusiness ? <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 p-3"><div><Label htmlFor="trackLots" className="text-sm">Trazar por lotes</Label><p className="text-xs text-muted-foreground">Registra lotes y vencimientos para ventas y salidas.</p></div><Switch id="trackLots" checked={formData.trackLots} onCheckedChange={value => handleChange('trackLots', Boolean(value))} className="data-[state=checked]:bg-orange-600"/></div> : <div className="hidden" />}
          {locations.length > 0 ? <div className="space-y-2"><Label htmlFor="location">Ubicación por defecto</Label><select id="location" value={formData.defaultLocationId} onChange={e => handleChange('defaultLocationId', e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="">Sin ubicación predeterminada</option>{locations.map(location => <option key={location.id} value={location.id}>{location.code} · {location.label}</option>)}</select></div> : <div className="hidden" />}
        </div>
        {showCategoryForm && <section className="rounded-2xl border border-[var(--brand-primary)]/30 bg-[var(--brand-soft)] p-4 sm:p-5" aria-labelledby="new-category-heading"><div className="flex items-start gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] text-white"><Boxes className="h-5 w-5"/></div><div className="min-w-0 flex-1"><h3 id="new-category-heading" className="font-semibold">Crear categoría nueva</h3><p className="mt-1 text-sm text-muted-foreground">La categoría estará disponible para este negocio, según los permisos de tu cuenta.</p></div><Button type="button" variant="ghost" size="icon" aria-label="Cerrar formulario de categoría" onClick={() => setShowCategoryForm(false)}><X className="h-4 w-4"/></Button></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="new-category-name">Nombre *</Label><Input id="new-category-name" value={categoryName} onChange={e => setCategoryName(e.target.value)} maxLength={80} placeholder="Ej. Accesorios" className="bg-card"/></div><div className="space-y-2"><Label htmlFor="new-category-description">Descripción (opcional)</Label><Input id="new-category-description" value={categoryDescription} onChange={e => setCategoryDescription(e.target.value)} maxLength={400} placeholder="Descripción breve" className="bg-card"/></div></div><div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={() => setShowCategoryForm(false)}><X className="h-4 w-4"/>Cancelar</Button><Button type="button" onClick={() => void handleCreateCategory()} disabled={savingCategory} className="bg-[var(--brand-primary)] text-white hover:opacity-90"><Check className="h-4 w-4"/>{savingCategory ? 'Guardando…' : 'Crear y seleccionar'}</Button></div></section>}
        <div className="border-t border-border/70 pt-6"><h2 className="font-semibold">Precios y stock</h2><div className="mt-4 grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="price">Precio de venta (COP) *</Label><Input id="price" type="number" min="0" step="1" value={formData.price} onChange={e => handleChange('price', e.target.value)} placeholder="18000" required className="h-11 rounded-xl"/></div><div className="space-y-2"><Label htmlFor="cost">Costo estimado (COP)</Label><Input id="cost" type="number" min="0" step="1" value={formData.cost} onChange={e => handleChange('cost', e.target.value)} placeholder="7200" className="h-11 rounded-xl"/><p className="text-xs text-muted-foreground">Sirve para estimar margen y rentabilidad.</p></div><div className="space-y-2"><Label htmlFor="stock">Existencias iniciales *</Label><Input id="stock" type="number" min="0" step={discreteQuantity ? '1' : '0.01'} value={formData.stock} onChange={e => handleChange('stock', e.target.value)} required className="h-11 rounded-xl" aria-describedby="stock-help"/><p id="stock-help" className="text-xs text-muted-foreground">{discreteQuantity ? 'Unidades enteras; las flechas incrementan de 1 en 1.' : 'Esta unidad admite cantidades fraccionarias.'}</p></div><div className="space-y-2"><Label htmlFor="minStock">Alerta de stock mínimo *</Label><Input id="minStock" type="number" min="0" step={discreteQuantity ? '1' : '0.01'} value={formData.minStock} onChange={e => handleChange('minStock', e.target.value)} required className="h-11 rounded-xl" aria-describedby="min-stock-help"/><p id="min-stock-help" className="text-xs text-muted-foreground">{discreteQuantity ? 'Número entero de unidades para activar la alerta.' : 'Se puede expresar en fracciones según la unidad.'}</p></div></div></div>
        <div className="space-y-2">
          <Label htmlFor="product-photo">Foto (opcional)</Label>
          <div className="flex items-center gap-4">
            {photoPreview
              ? <img src={photoPreview} alt="Vista previa de la foto del producto" className="h-20 w-20 rounded-xl border border-border object-cover" />
              : <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted-foreground">Sin foto</div>}
            <div className="flex flex-wrap gap-2">
              <input ref={fileInputRef} id="product-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoChange} className="hidden" />
              <Button type="button" variant="outline" className="rounded-xl" onClick={openPhotoPicker}>Cambiar foto</Button>
              {photoPreview && <Button type="button" variant="outline" className="rounded-xl" onClick={() => setNewPhoto(null)}>Quitar foto</Button>}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Se reduce automáticamente antes de subirla. Se muestra en el punto de venta si está activado en Configuración.</p>
        </div>
        {cropOpen && newPhoto && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Recortar foto del producto">
            <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-4 shadow-2xl">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">Recortar foto</h3>
                <Button variant="ghost" size="icon" aria-label="Cerrar recorte" onClick={closeCrop}><X className="h-4 w-4"/></Button>
              </div>
              <div
                className="relative mt-3 h-64 w-full overflow-hidden rounded-xl border border-border bg-black"
                onMouseDown={(e) => {
                  if (!cropOpen) return;
                  const area = e.currentTarget.getBoundingClientRect();
                  const x = Math.max(0, Math.min((e.clientX - area.left) / area.width, 1));
                  const y = Math.max(0, Math.min((e.clientY - area.top) / area.height, 1));
                  setCropRect({ x: 0, y: 0, w: x, h: y });
                }}
                onMouseMove={(e) => {
                  if (!cropOpen) return;
                  const area = e.currentTarget.getBoundingClientRect();
                  const x = Math.max(0, Math.min((e.clientX - area.left) / area.width, 1));
                  const y = Math.max(0, Math.min((e.clientY - area.top) / area.height, 1));
                  setCropRect({ x: 0, y: 0, w: x, h: y });
                }}
                onMouseUp={() => { cropDrag.current = null; }}
              >
                <img src={newPhoto} alt="Previsualizacion para recorte" className="h-full w-full object-contain" draggable={false} />
                <div
                  className="absolute border-2 border-[var(--brand-primary)] bg-[var(--brand-primary)]/20"
                  style={{ left: `${cropRect.x * 100}%`, top: '0px', width: `${cropRect.w * 100}%`, height: `${cropRect.h * 100}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Arrastra dentro de la imagen para elegir el area que se veera en el recorte.</p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" className="rounded-xl" onClick={closeCrop}>Cancelar</Button>
                <Button className="rounded-xl bg-[var(--brand-primary)] text-white hover:opacity-90" onClick={() => void applyCrop()}>Aplicar recorte</Button>
              </div>
            </div>
          </div>
        )}
        <div className="space-y-2"><Label htmlFor="description">Descripción / notas</Label><Textarea id="description" value={formData.description} onChange={e => handleChange('description', e.target.value)} placeholder="Tamaño, presentación o notas…" rows={4} maxLength={1000} className="rounded-xl"/></div>
        <div className="flex flex-col-reverse gap-3 border-t border-border/70 pt-5 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={() => navigate('/products')} className="rounded-xl">Cancelar</Button><Button type="submit" disabled={saving || showCategoryForm} className="rounded-xl bg-[var(--brand-primary)] text-white hover:opacity-90"><Save className="mr-2 h-4 w-4"/>{saving ? 'Guardando…' : isEditing ? 'Guardar cambios' : 'Guardar producto'}</Button></div>
      </Card>
      <div className="space-y-4"><Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-primary)]"><PackageCheck className="h-5 w-5"/></div><div><h3 className="font-semibold">Vista previa de precios</h3><p className="text-xs text-muted-foreground">Valores expresados en pesos colombianos</p></div></div><div className="mt-5 space-y-4"><div><p className="text-sm text-muted-foreground">Precio de venta</p><p className="mt-1 text-2xl font-bold">{money(Number(formData.price) || 0)}</p></div><div><p className="text-sm text-muted-foreground">Costo estimado</p><p className="mt-1 text-lg font-semibold">{money(Number(formData.cost) || 0)}</p></div><div className="border-t border-border pt-4"><p className="text-sm text-muted-foreground">Margen estimado por unidad</p><p className={`mt-1 text-xl font-bold ${(Number(formData.price) || 0) >= (Number(formData.cost) || 0) ? 'text-emerald-700' : 'text-rose-700'}`}>{money((Number(formData.price) || 0) - (Number(formData.cost) || 0))}</p></div></div></Card><Card className="rounded-2xl border-border/70 p-5 shadow-sm"><h3 className="font-semibold">Consejos para el inventario</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Define el stock mínimo para recibir alertas antes de agotar existencias. Para productos contables por unidad usa cantidades enteras; para peso o volumen puedes usar fracciones.</p></Card></div>
    </form>}
  </div></Layout>;
}
