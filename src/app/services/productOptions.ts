import { api } from './dataService';
import { isDesktopMode } from './desktop';

/** One choice inside a group ("Doble", "Queso"); priceDelta is added to the product price per unit. */
export interface ProductOption {
  id: string;
  name: string;
  priceDelta: number;
  ingredientId?: string | null;
  ingredientQuantity?: number;
}

/** A group of choices linked to menu products ("Tamaño": choose 1; "Adicionales": up to 3). */
export interface OptionGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: ProductOption[];
  productIds: string[];
}

/** What an order or sale line shows for each chosen option (a snapshot taken when it was ordered). */
export interface ChosenOption {
  id: string;
  group: string;
  name: string;
  priceDelta: number;
}

/** New options have no id yet; existing ones keep theirs so past choices stay linked. */
export type OptionGroupInput = Omit<OptionGroup, 'id' | 'productIds' | 'options'> & {
  options: (Omit<ProductOption, 'id'> & { id?: string })[];
};

const SERVER_ONLY = 'Las opciones del menú necesitan conexión con el servidor.';

export async function listOptionGroups(): Promise<OptionGroup[]> {
  // The desktop demo has no server: products simply have no options there.
  if (isDesktopMode()) return [];
  return api<OptionGroup[]>('/product-options');
}

export async function saveOptionGroup(input: OptionGroupInput & { id?: string }): Promise<OptionGroup> {
  if (isDesktopMode()) throw new Error(SERVER_ONLY);
  return api<OptionGroup>(input.id ? `/product-options/${encodeURIComponent(input.id)}` : '/product-options', {
    method: input.id ? 'PUT' : 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteOptionGroup(id: string): Promise<void> {
  if (isDesktopMode()) throw new Error(SERVER_ONLY);
  await api(`/product-options/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function setProductOptionGroups(productId: string, groupIds: string[]): Promise<void> {
  if (isDesktopMode()) throw new Error(SERVER_ONLY);
  await api(`/product-options/links/${encodeURIComponent(productId)}`, {
    method: 'PUT',
    body: JSON.stringify({ groupIds }),
  });
}

/** The product's groups, required ones first (the size before the extras); otherwise in the menu's order. */
export function groupsForProduct(groups: OptionGroup[], productId: string): OptionGroup[] {
  return groups
    .filter(group => group.productIds.includes(productId))
    .sort((a, b) => Number(b.minSelect > 0) - Number(a.minSelect > 0));
}

/** The first rule a selection breaks, in group order, or null when it can be ordered. Mirrors the server check. */
export function selectionError(groups: OptionGroup[], selected: string[]): string | null {
  for (const group of groups) {
    const count = group.options.filter(option => selected.includes(option.id)).length;
    if (count < group.minSelect) return `Elige ${group.minSelect} en «${group.name}».`;
    if (count > group.maxSelect) return `Máximo ${group.maxSelect} en «${group.name}».`;
  }
  return null;
}

/** Selected options in group order, as the line and the kitchen should read them. */
export function chosenOptions(groups: OptionGroup[], selected: string[]): ChosenOption[] {
  return groups.flatMap(group =>
    group.options
      .filter(option => selected.includes(option.id))
      .map(option => ({ id: option.id, group: group.name, name: option.name, priceDelta: option.priceDelta })),
  );
}

export function optionsPrice(groups: OptionGroup[], selected: string[]): number {
  return chosenOptions(groups, selected).reduce((sum, option) => sum + option.priceDelta, 0);
}

export function optionsLabel(groups: OptionGroup[], selected: string[]): string {
  return chosenOptions(groups, selected)
    .map(option => option.name)
    .join(', ');
}
