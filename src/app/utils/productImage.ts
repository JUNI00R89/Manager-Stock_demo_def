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

/** Shrinks a picked photo in the browser (longest side ≤ 400 px, JPEG 0.8) so uploads stay ~30 KB. */
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
