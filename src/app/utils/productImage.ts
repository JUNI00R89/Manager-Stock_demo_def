import type { BusinessConfig } from '../context/BusinessContext';
import { API_ORIGIN } from '../services/dataService';

/** Absolute URL of an uploaded product photo, or null (no photo, legacy icon key, or photos switched off). */
export function productImageUrl(image: string | undefined | null, enabled: boolean): string | null {
  return enabled && image?.startsWith('/uploads/') ? `${API_ORIGIN}${image}` : null;
}

/** Photos show unless the owner turned the switch off (missing = on). */
export function imagesEnabled(config: BusinessConfig | null): boolean {
  return config?.features.productImages !== false;
}

/** Shrinks a picked photo in the browser (longest side <= 400 px, JPEG 0.8) so uploads stay ~30 KB. */
export function resizeImage(file: File, maxSide = 400): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff'; // JPEG has no transparency: cut-out PNGs would turn black
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}

/** Size that fits inside maxSide × maxSide keeping the proportion; never enlarges. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Crops an image (data URL, http(s) URL or raw base64) to the given rect (fractions 0..1, clamped), then shrinks it to maxSide. */
export function cropDataUrl(source: string, rect: { x: number; y: number; w: number; h: number }, maxSide = 400): Promise<string> {
  return new Promise((resolve, reject) => {
    const isHttp = /^https?:\/\//i.test(source);
    const src = source.startsWith('data:') || isHttp ? source : `data:image/png;base64,${source}`;
    const img = new Image();
    if (isHttp) img.crossOrigin = 'anonymous';
    img.onload = () => {
      const x = Math.max(0, Math.min(rect.x, 1));
      const y = Math.max(0, Math.min(rect.y, 1));
      const w = Math.max(0, Math.min(rect.w, 1 - x));
      const h = Math.max(0, Math.min(rect.h, 1 - y));
      const canvas = document.createElement('canvas');
      const size = fitWithin(img.width * w, img.height * h, maxSide);
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff'; // JPEG has no transparency
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, Math.round(x * img.width), Math.round(y * img.height), Math.round(w * img.width), Math.round(h * img.height), 0, 0, canvas.width, canvas.height);
      }
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    img.src = src;
  });
}
