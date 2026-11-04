import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Product } from '../utils/mockData';
import { dataService } from '../services/dataService';
import { createScopedLocalStore, useScopedLocalStore } from './restaurantStorage';

export interface CatalogOverride {
  active?: boolean;
  directSale?: boolean;
}

export type CatalogOverrides = Record<string, CatalogOverride>;

export interface RestaurantCatalogProduct extends Product {
  active: boolean;
  directSale: boolean;
  isSaleItem: boolean;
}

const catalogStore = createScopedLocalStore<CatalogOverrides>(
  'manager_stock_restaurant_catalog_v1_',
  () => ({}),
  (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: CatalogOverrides = {};
    Object.entries(value as Record<string, unknown>).forEach(([productId, entry]) => {
      if (!entry || typeof entry !== 'object') return;
      const input = entry as CatalogOverride;
      result[productId] = {
        ...(typeof input.active === 'boolean' ? { active: input.active } : {}),
        ...(typeof input.directSale === 'boolean' ? { directSale: input.directSale } : {}),
      };
    });
    return result;
  },
);

const DIRECT_SALE_PATTERN = /\b(bebida|bebidas|gaseosa|agua|jugo|jugos|caf[eé]|cerveza|cervezas|vino|vinos|licor|licores|c[oó]ctel|coctel|refresco|refrescos|soda|malteada|limonada|t[eé]|drink|beverage)\b/i;

export function defaultDirectSale(product: Pick<Product, 'name' | 'category'>): boolean {
  return DIRECT_SALE_PATTERN.test(`${product.category} ${product.name}`);
}

export function isMenuProduct(product: Product): boolean {
  return !product.productType || product.productType === 'sale_item';
}

export function useCatalogOverrides(scope: string) {
  const overrides = useScopedLocalStore(catalogStore, scope);
  const setActive = (productId: string, active: boolean) => {
    catalogStore.update(scope, (current) => ({
      ...current,
      [productId]: { ...current[productId], active },
    }));
  };
  const setDirectSale = (productId: string, directSale: boolean) => {
    catalogStore.update(scope, (current) => ({
      ...current,
      [productId]: { ...current[productId], directSale },
    }));
  };
  return { overrides, setActive, setDirectSale };
}

export function useRestaurantCatalog(scope: string) {
  const { overrides, setActive, setDirectSale } = useCatalogOverrides(scope);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    dataService.getProducts()
      .then((rows) => {
        if (!active) return;
        setProducts(Array.isArray(rows) ? rows : []);
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'No se pudo cargar el menú.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [reloadToken]);

  const catalog = useMemo<RestaurantCatalogProduct[]>(() => products.map((product) => {
    const override = overrides[product.id] ?? {};
    return {
      ...product,
      isSaleItem: isMenuProduct(product),
      active: override.active ?? true,
      directSale: override.directSale ?? (isMenuProduct(product) ? defaultDirectSale(product) : false),
    };
  }), [products, overrides]);

  const activeMenu = useMemo(
    () => catalog.filter((product) => product.isSaleItem && product.active),
    [catalog],
  );

  return {
    products: catalog,
    activeMenu,
    loading,
    error,
    refresh,
    setActive,
    setDirectSale,
  };
}
