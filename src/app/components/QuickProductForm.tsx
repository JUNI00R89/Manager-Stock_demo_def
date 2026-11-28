import { useEffect, useState } from 'react';
import { Loader2, PackagePlus } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { dataService, getProductCategories, type ProductCategoryRecord } from '../services/dataService';
import type { Product } from '../utils/types';
import { toastError } from '../utils/notifications';
import { lookupProductName } from '../utils/productLookup';

interface QuickProductFormProps {
  barcode: string;
  onCreated: (product: Product) => void;
  onCancel: () => void;
  /** Para pruebas: búsqueda del nombre por código. */
  lookupName?: (code: string) => Promise<string | null>;
}

const fieldClass = 'bg-gray-800 border-gray-600 text-white placeholder:text-gray-500';
const labelClass = 'block text-xs font-medium text-gray-300 mb-1';

/** Ficha corta para crear, desde el escáner, un producto cuyo código no existe. */
export function QuickProductForm({
  barcode,
  onCreated,
  onCancel,
  lookupName = lookupProductName,
}: QuickProductFormProps) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('1');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<ProductCategoryRecord[]>([]);
  const [lookingUp, setLookingUp] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getProductCategories()
      .then(list => {
        if (!active) return;
        const usable = list.filter(c => c.active !== false);
        setCategories(usable);
        setCategory(current => current || usable[0]?.name || '');
      })
      .catch(() => {
        /* sin categorías: el botón queda deshabilitado */
      });
    lookupName(barcode)
      .then(found => {
        if (active && found) setName(current => current || found);
      })
      .finally(() => {
        if (active) setLookingUp(false);
      });
    return () => {
      active = false;
    };
  }, [barcode, lookupName]);

  const save = async () => {
    const priceValue = Number(price);
    const stockValue = Number(stock);
    if (name.trim().length < 2) return setError('Escribe el nombre del producto.');
    if (!price || !Number.isFinite(priceValue) || priceValue <= 0) return setError('Escribe el precio de venta.');
    if (!Number.isInteger(stockValue) || stockValue < 1) return setError('Las existencias deben ser 1 o más.');
    if (!category) return setError('Elige una categoría.');
    setError('');
    setSaving(true);
    try {
      const created = await dataService.createProduct({
        name: name.trim(),
        sku: '',
        category,
        price: priceValue,
        stock: stockValue,
        minStock: 0,
        description: '',
        image: 'food',
        barcode,
      } as Parameters<typeof dataService.createProduct>[0]);
      onCreated(created);
    } catch (err) {
      toastError(err, 'No se pudo crear el producto.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={event => {
        event.preventDefault();
        void save();
      }}
    >
      <div>
        <label htmlFor="quick-name" className={labelClass}>
          Nombre {lookingUp && <span className="text-gray-500">(buscando…)</span>}
        </label>
        <Input
          id="quick-name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Ej.: Gaseosa 400 ml"
          maxLength={120}
          className={fieldClass}
          autoFocus
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="quick-price" className={labelClass}>
            Precio de venta
          </label>
          <Input
            id="quick-price"
            type="number"
            inputMode="decimal"
            min="0"
            value={price}
            onChange={e => setPrice(e.target.value)}
            placeholder="0"
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="quick-stock" className={labelClass}>
            Existencias
          </label>
          <Input
            id="quick-stock"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={stock}
            onChange={e => setStock(e.target.value)}
            className={fieldClass}
          />
        </div>
      </div>
      <div>
        <label htmlFor="quick-category" className={labelClass}>
          Categoría
        </label>
        <select
          id="quick-category"
          value={category}
          onChange={e => setCategory(e.target.value)}
          className={`h-9 w-full rounded-md border px-3 text-sm ${fieldClass}`}
        >
          {categories.map(c => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="flex-1 border-gray-600 bg-transparent text-gray-300 hover:bg-gray-800 hover:text-white"
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={saving || !categories.length}
          className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
        >
          {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : <PackagePlus size={14} className="mr-1" />}
          Guardar
        </Button>
      </div>
    </form>
  );
}
