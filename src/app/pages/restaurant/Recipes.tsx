import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChefHat, CirclePlus, ClipboardList, Trash2, Save, PencilLine, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../utils/notifications';
import { Layout } from '../../components/Layout';
import { ConfirmActionDialog } from '../../components/ConfirmActionDialog';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { dataService, type DishCostingRecord, type RecipeRecord } from '../../services/dataService';
import type { Product } from '../../utils/types';

const money = (v: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);
type RecipeLine = { ingredientId: string; quantity: string; unit: string };

export function Recipes() {
  const [products, setProducts] = useState<Product[]>([]);
  const [recipes, setRecipes] = useState<RecipeRecord[]>([]);
  const [costing, setCosting] = useState<DishCostingRecord[]>([]);
  const [productId, setProductId] = useState('');
  const [yieldQuantity, setYieldQuantity] = useState('1');
  const [instructions, setInstructions] = useState('');
  const [lines, setLines] = useState<RecipeLine[]>([{ ingredientId: '', quantity: '1', unit: '' }]);
  const [saving, setSaving] = useState(false);
  const [recipeToDelete, setRecipeToDelete] = useState<RecipeRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const saleProducts = useMemo(() => products.filter(p => p.productType !== 'ingredient' && p.productType !== 'supplies'), [products]);
  const ingredients = useMemo(() => products.filter(p => p.productType === 'ingredient'), [products]);
  const ingredientCost = (recipe: RecipeRecord) => recipe.ingredients.reduce((total, item) => total + (products.find(p => p.id === item.ingredientId)?.cost || 0) * item.quantity / recipe.yieldQuantity, 0);

  const load = async () => {
    try {
      const [allProducts, allRecipes] = await Promise.all([dataService.getProducts(), dataService.getRecipes()]);
      setProducts(allProducts); setRecipes(allRecipes);
      try { setCosting(await dataService.getDishCosting()); } catch { setCosting([]); }
    }
    catch (error) { toastError(error, 'No se pudieron cargar las recetas.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const resetForm = () => { setProductId(''); setYieldQuantity('1'); setInstructions(''); setLines([{ ingredientId: '', quantity: '1', unit: '' }]); };
  const loadRecipe = (recipe: RecipeRecord) => { setProductId(recipe.productId); setYieldQuantity(String(recipe.yieldQuantity)); setInstructions(recipe.instructions); setLines(recipe.ingredients.map(i => ({ ingredientId: i.ingredientId, quantity: String(i.quantity), unit: i.unit || '' }))); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const addLine = () => setLines(prev => [...prev, { ingredientId: '', quantity: '1', unit: '' }]);
  const updateLine = (index: number, field: keyof RecipeLine, value: string) => setLines(prev => prev.map((line, i) => i === index ? { ...line, [field]: value } : line));
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!productId) { toast.error('Selecciona el producto que se va a preparar.'); return; }
    if (!lines.length || lines.some(line => !line.ingredientId || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0)) { toast.error('Agrega ingredientes y cantidades válidas.'); return; }
    if (new Set(lines.map(line => line.ingredientId)).size !== lines.length) { toast.error('No repitas ingredientes; edita la cantidad de la línea existente.'); return; }
    const yieldValue = Number(yieldQuantity);
    if (!Number.isFinite(yieldValue) || yieldValue <= 0) { toast.error('El rendimiento debe ser mayor que cero.'); return; }
    setSaving(true);
    try { await dataService.saveRecipe({ productId, yieldQuantity: yieldValue, instructions: instructions.trim(), ingredients: lines.map(line => ({ ingredientId: line.ingredientId, quantity: Number(line.quantity), unit: line.unit })) }); await load(); resetForm(); toast.success('Receta guardada. Las próximas ventas descontarán los ingredientes registrados.'); }
    catch (error) { toastError(error, 'No se pudo guardar la receta.'); }
    finally { setSaving(false); }
  };
  const remove = (recipe: RecipeRecord) => setRecipeToDelete(recipe);
  const confirmRemove = async () => { if (!recipeToDelete) return; try { await dataService.deleteRecipe(recipeToDelete.id); setRecipes(prev => prev.filter(r => r.id !== recipeToDelete.id)); if (productId === recipeToDelete.productId) resetForm(); toast.success('Receta eliminada.'); } catch (error) { toastError(error, 'No se pudo eliminar la receta.'); throw error; } };

  return <Layout><div className="mx-auto max-w-7xl space-y-6">
    <div><p className="text-sm font-semibold uppercase tracking-[.16em] text-orange-600">Negocio de comidas</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Recetas y costos</h1><p className="mt-1 max-w-3xl text-muted-foreground">Define cuánto ingrediente requiere cada producto vendido. Al registrar una venta, Manager Stock descuenta los ingredientes automáticamente, con validación de existencias y trazabilidad.</p></div>
    {ingredients.length === 0 && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Falta registrar la materia prima.</strong> Ve a Productos → Nuevo producto y selecciona el tipo “Ingrediente / materia prima”. Después podrás usar esos registros en las recetas.</div>}
    <div className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]"><Card className="rounded-2xl border-border/70 p-5 shadow-sm sm:p-6"><div className="mb-5 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/40"><ChefHat className="h-5 w-5"/></div><div><h2 className="font-semibold">{recipes.some(r => r.productId === productId) ? 'Editar receta' : 'Configurar receta'}</h2><p className="mt-1 text-sm text-muted-foreground">Las cantidades de ingredientes corresponden al rendimiento indicado.</p></div></div>
      <form onSubmit={save} className="space-y-5"><div className="space-y-2"><Label htmlFor="productId">Producto preparado *</Label><select id="productId" value={productId} onChange={e => { const found = recipes.find(r => r.productId === e.target.value); if (found) loadRecipe(found); else { setProductId(e.target.value); setYieldQuantity('1'); setInstructions(''); setLines([{ ingredientId: '', quantity: '1', unit: '' }]); } }} required className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="">Selecciona un producto del menú…</option>{saleProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div className="space-y-2"><Label htmlFor="yield">Rendimiento de esta receta</Label><Input id="yield" type="number" step="0.001" min="0.001" value={yieldQuantity} onChange={e => setYieldQuantity(e.target.value)} className="h-11 rounded-xl"/><p className="text-xs text-muted-foreground">Ejemplo: 1 significa que las cantidades corresponden a una porción; 10 significa que rinden 10 porciones.</p></div>
        <div><div className="mb-3 flex items-center justify-between"><Label>Ingredientes por lote *</Label><Button type="button" variant="outline" onClick={addLine} className="h-9 rounded-lg"><CirclePlus className="mr-2 h-4 w-4"/>Agregar ingrediente</Button></div><div className="space-y-3">{lines.map((line, index) => { const chosen = ingredients.find(i => i.id === line.ingredientId); const requested = Number(line.quantity || 0); return <div key={index} className="grid gap-2 rounded-xl border border-border/70 p-3 sm:grid-cols-[1fr_110px_90px_36px]"><div className="space-y-1"><select value={line.ingredientId} onChange={e => updateLine(index, 'ingredientId', e.target.value)} required className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="">Selecciona ingrediente…</option>{ingredients.map(ing => <option key={ing.id} value={ing.id}>{ing.name}</option>)}</select>{chosen && <p className={`text-xs ${chosen.stock < requested ? 'text-rose-600' : 'text-muted-foreground'}`}>Disponible: {chosen.stock} {chosen.unit || 'unidad'}</p>}</div><div className="space-y-1"><Input aria-label="Cantidad del ingrediente" type="number" min="0.001" step="0.001" value={line.quantity} onChange={e => updateLine(index, 'quantity', e.target.value)} required className="h-10 rounded-lg"/><p className="text-xs text-muted-foreground">{chosen?.unit || line.unit || 'unidad'}</p></div><div className="space-y-1"><Input aria-label="Unidad del ingrediente" value={line.unit} onChange={e => updateLine(index, 'unit', e.target.value)} placeholder={chosen?.unit || 'unidad'} className="h-10 rounded-lg"/></div><Button type="button" variant="ghost" size="icon" aria-label="Quitar ingrediente" disabled={lines.length === 1} onClick={() => setLines(prev => prev.filter((_, i) => i !== index))} className="text-rose-600"><Trash2 className="h-4 w-4"/></Button></div>; })}</div></div>
        <div className="space-y-2"><Label htmlFor="instructions">Preparación / notas (opcional)</Label><Textarea id="instructions" value={instructions} onChange={e => setInstructions(e.target.value)} rows={3} maxLength={2000} className="rounded-xl" placeholder="Orden de preparación, porciones, notas de cocina…"/></div><div className="flex gap-2 border-t border-border/70 pt-4"><Button type="submit" disabled={saving || ingredients.length === 0} className="flex-1 rounded-xl bg-orange-600 text-white hover:bg-orange-700"><Save className="mr-2 h-4 w-4"/>{saving ? 'Guardando…' : 'Guardar receta'}</Button><Button type="button" variant="outline" onClick={resetForm} className="rounded-xl">Limpiar</Button></div>
      </form></Card>

      <div className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Recetas registradas</h2><p className="mt-1 text-sm text-muted-foreground">{recipes.length} productos con consumo automático</p></div><BookOpen className="h-5 w-5 text-orange-600"/></div>{loading ? <Card className="rounded-2xl p-8 text-center text-muted-foreground">Cargando recetas…</Card> : recipes.length === 0 ? <Card className="rounded-2xl border-dashed p-8 text-center"><ClipboardList className="mx-auto h-9 w-9 text-muted-foreground/50"/><p className="mt-3 font-semibold">Aún no hay recetas</p><p className="mt-1 text-sm text-muted-foreground">Crea la primera para descontar ingredientes desde las ventas.</p></Card> : recipes.map(recipe => <Card key={recipe.id} className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/40"><ChefHat className="h-5 w-5"/></div><div className="min-w-0 flex-1"><h3 className="font-semibold">{recipe.productName}</h3><p className="mt-1 text-xs text-muted-foreground">Rendimiento: {recipe.yieldQuantity} porciones</p></div><Button variant="ghost" size="icon" onClick={() => loadRecipe(recipe)} aria-label="Editar receta"><PencilLine className="h-4 w-4"/></Button><Button variant="ghost" size="icon" onClick={() => void remove(recipe)} aria-label="Eliminar receta" className="text-rose-600"><Trash2 className="h-4 w-4"/></Button></div><div className="mt-4 space-y-2">{recipe.ingredients.map(ingredient => <div key={ingredient.ingredientId} className="flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">{ingredient.name}</span><span className="font-medium">{ingredient.quantity} {ingredient.unit}</span></div>)}</div><div className="mt-4 flex items-center justify-between border-t border-border/70 pt-3"><span className="text-xs text-muted-foreground">Costo estimado de ingredientes / porción</span><span className="font-semibold text-orange-700">{money(ingredientCost(recipe))}</span></div>{recipe.instructions && <p className="mt-3 rounded-lg bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">{recipe.instructions}</p>}</Card>)}</div>
    </div>
    <Card className="rounded-2xl border-border/70 p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="flex items-center gap-2 font-semibold"><TrendingUp className="h-5 w-5 text-orange-600"/>Costeo y margen por plato</h2><p className="mt-1 text-sm text-muted-foreground">Costo de ingredientes por porción frente al precio de venta, con la conversión de unidades aplicada. Detecta platos con margen bajo antes de que afecten la rentabilidad.</p></div><Badge variant="outline" className="w-fit rounded-lg">{costing.length} plato(s)</Badge></div>
      {costing.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">Guarda una receta para ver su costeo y margen.</p> : <div className="mt-4 overflow-x-auto rounded-xl border border-border/60"><table className="w-full min-w-[760px] text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2 font-semibold">Plato</th><th className="px-3 py-2 text-right font-semibold">Costo / porción</th><th className="px-3 py-2 text-right font-semibold">Precio de venta</th><th className="px-3 py-2 text-right font-semibold">Margen</th><th className="px-3 py-2 text-right font-semibold">Margen %</th><th className="px-3 py-2 font-semibold">Ingredientes</th></tr></thead>
        <tbody className="divide-y divide-border/60">{costing.map(item => {
          const tone = item.marginPercent >= 60 ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300' : item.marginPercent >= 30 ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300' : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300';
          return <tr key={item.recipeId}>
            <td className="px-3 py-3"><p className="font-medium">{item.productName}</p><p className="text-xs text-muted-foreground">Rinde {item.yieldQuantity} porción(es)</p></td>
            <td className="px-3 py-3 text-right tabular-nums">{money(item.cost)}</td>
            <td className="px-3 py-3 text-right tabular-nums">{money(item.price)}</td>
            <td className={`px-3 py-3 text-right font-semibold tabular-nums ${item.margin < 0 ? 'text-rose-600' : ''}`}>{money(item.margin)}</td>
            <td className="px-3 py-3 text-right"><Badge variant="outline" className={`rounded-lg ${tone}`}>{item.marginPercent.toFixed(1)}%</Badge></td>
            <td className="max-w-[280px] px-3 py-3"><p className="truncate text-xs text-muted-foreground" title={item.ingredients.map(ingredient => `${ingredient.name}: ${ingredient.quantity} ${ingredient.unit}`).join(' · ')}>{item.ingredients.map(ingredient => ingredient.name).join(', ')}</p></td>
          </tr>;
        })}</tbody>
      </table></div>}
    </Card>
    <ConfirmActionDialog open={Boolean(recipeToDelete)} onOpenChange={open => { if (!open) setRecipeToDelete(null); }} title="Eliminar receta" description={recipeToDelete ? `¿Eliminar la receta de ${recipeToDelete.productName}? Las ventas anteriores no se modificarán.` : ''} confirmLabel="Eliminar receta" destructive onConfirm={confirmRemove}/>
  </div></Layout>;
}
