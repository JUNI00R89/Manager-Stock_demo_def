// Busca el nombre de un producto por su código de barras en Open Food Facts
// (base de datos abierta y gratuita, sin llave). Solo sugiere el nombre: si no hay
// Internet, el código no está registrado o tarda, devuelve null y se escribe a mano.

const LOOKUP_URL = 'https://world.openfoodfacts.org/api/v2/product/';
const TIMEOUT_MS = 4000;

interface OpenFoodFactsResponse {
  status?: number;
  product?: { product_name_es?: string; product_name?: string; brands?: string };
}

/** Solo códigos EAN/UPC (8 a 14 dígitos); un SKU interno no se consulta afuera. */
export function isRetailBarcode(code: string): boolean {
  return /^\d{8,14}$/.test(code.trim());
}

export async function lookupProductName(code: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const barcode = code.trim();
  if (!isRetailBarcode(barcode)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${LOOKUP_URL}${barcode}.json?fields=product_name_es,product_name,brands`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as OpenFoodFactsResponse;
    if (data.status !== 1 || !data.product) return null;
    const name = (data.product.product_name_es || data.product.product_name || '').trim();
    if (!name) return null;
    const brand = (data.product.brands || '').split(',')[0].trim();
    const full = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${name} ${brand}` : name;
    return full.slice(0, 120);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
