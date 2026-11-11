import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { Button } from './ui/button';
import { cropDataUrl } from '../utils/productImage';
import { toastError } from '../utils/notifications';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

type PhotoCropperProps = {
  /** Foto a ajustar: data URL o URL absoluta. */
  image: string;
  onCancel: () => void;
  /** Recibe la foto final ya recortada en cuadrado (JPEG data URL). */
  onApply: (cropped: string) => void | Promise<void>;
};

/**
 * Recortador cuadrado de fotos: se arrastra la imagen con el dedo o el mouse,
 * se acerca con pellizco o con el control, y lo que queda dentro del marco
 * (con cuadrícula guía) es exactamente la foto que se guarda.
 */
export function PhotoCropper({ image, onCancel, onApply }: PhotoCropperProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameSide, setFrameSide] = useState(0);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const panStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const pinchStart = useRef<{ dist: number; zoom: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = () => setFrameSide(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { if (active) setImgSize({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.src = image;
    return () => { active = false; };
  }, [image]);

  // Escala inicial: la foto cubre el cuadrado completo.
  const fit = imgSize.w > 0 && frameSide > 0 ? frameSide / Math.min(imgSize.w, imgSize.h) : 1;
  const scale = fit * zoom;

  const clampOffset = useCallback((ox: number, oy: number, z: number) => {
    const sc = fit * z;
    const maxX = Math.max(0, (imgSize.w * sc - frameSide) / 2);
    const maxY = Math.max(0, (imgSize.h * sc - frameSide) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, ox)), y: Math.max(-maxY, Math.min(maxY, oy)) };
  }, [fit, frameSide, imgSize.w, imgSize.h]);

  const zoomTo = useCallback((target: number, focus = { x: 0, y: 0 }) => {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, target));
    const k = z / zoom;
    if (k === 1) return;
    setZoom(z);
    setOffset(o => clampOffset(k * o.x + (1 - k) * focus.x, k * o.y + (1 - k) * focus.y, z));
  }, [clampOffset, zoom]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* algunos navegadores la rechazan */ }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      panStart.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
      pinchStart.current = null;
    } else if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      const [a, b] = pts;
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom, ox: offset.x, oy: offset.y };
      panStart.current = null;
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (panStart.current && pointers.current.size === 1) {
      const start = panStart.current;
      setOffset(clampOffset(start.ox + event.clientX - start.x, start.oy + event.clientY - start.y, zoom));
    } else if (pinchStart.current && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const [a, b] = pts;
      const start = pinchStart.current;
      const rect = frameRef.current?.getBoundingClientRect();
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, start.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / start.dist)));
      const k = z / start.zoom;
      const focus = rect
        ? { x: (a.x + b.x) / 2 - (rect.left + rect.width / 2), y: (a.y + b.y) / 2 - (rect.top + rect.height / 2) }
        : { x: 0, y: 0 };
      setZoom(z);
      setOffset(clampOffset(k * start.ox + (1 - k) * focus.x, k * start.oy + (1 - k) * focus.y, z));
    }
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      panStart.current = null;
      pinchStart.current = null;
    } else if (pointers.current.size === 1) {
      const remaining = [...pointers.current.values()][0];
      pinchStart.current = null;
      if (remaining) panStart.current = { x: remaining.x, y: remaining.y, ox: offset.x, oy: offset.y };
    }
  };

  const resetView = () => {
    setZoom(1);
    setOffset(clampOffset(0, 0, 1));
  };

  const handleApply = async () => {
    if (!imgSize.w || !frameSide) { onCancel(); return; }
    setBusy(true);
    try {
      const sc = fit * zoom;
      // Esquina superior izquierda del cuadrado, en píxeles de la imagen original.
      const sx = ((imgSize.w * sc) / 2 - frameSide / 2 - offset.x) / sc;
      const sy = ((imgSize.h * sc) / 2 - frameSide / 2 - offset.y) / sc;
      const side = frameSide / sc;
      const cropped = await cropDataUrl(image, {
        x: sx / imgSize.w,
        y: sy / imgSize.h,
        w: side / imgSize.w,
        h: side / imgSize.h,
      });
      await onApply(cropped);
    } catch (error) {
      toastError(error, 'No se pudo recortar la foto.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overscroll-contain" role="dialog" aria-modal="true" aria-label="Recortar foto del producto">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-2xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold">Ajustar foto</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Arrastra para mover y acerca para enfocar. Lo que ves en el cuadro es la foto final.</p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Cerrar el recorte" onClick={onCancel} disabled={busy}><X className="h-4 w-4" /></Button>
        </div>

        <div
          ref={frameRef}
          className="relative mx-auto mt-4 aspect-square w-full max-w-[320px] cursor-grab touch-none select-none overflow-hidden rounded-2xl bg-black active:cursor-grabbing"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          {imgSize.w > 0 && (
            <img
              src={image}
              alt="Foto del producto para recortar"
              draggable={false}
              className="absolute left-1/2 top-1/2 max-w-none"
              style={{
                width: imgSize.w * scale,
                height: imgSize.h * scale,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              }}
            />
          )}
          {/* Cuadrícula guía (tercios) */}
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute inset-y-0 left-1/3 w-px bg-white/25" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-white/25" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-white/25" />
            <div className="absolute inset-x-0 top-2/3 h-px bg-white/25" />
          </div>
          <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-white/80" aria-hidden="true" />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" aria-label="Alejar la foto" onClick={() => zoomTo(zoom / 1.3)} disabled={busy || zoom <= MIN_ZOOM}><Minus className="h-4 w-4" /></Button>
          <input
            type="range"
            aria-label="Zoom de la foto"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={event => zoomTo(Number(event.target.value))}
            className="h-1.5 flex-1 cursor-pointer accent-[var(--brand-primary)] disabled:opacity-50"
            disabled={busy}
          />
          <Button type="button" variant="outline" size="icon" aria-label="Acercar la foto" onClick={() => zoomTo(zoom * 1.3)} disabled={busy || zoom >= MAX_ZOOM}><Plus className="h-4 w-4" /></Button>
          <Button type="button" variant="outline" size="icon" aria-label="Restablecer la foto" onClick={resetView} disabled={busy}><RotateCcw className="h-4 w-4" /></Button>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button type="button" onClick={() => void handleApply()} disabled={busy || !imgSize.w} className="rounded-xl bg-[var(--brand-primary)] text-white hover:opacity-90">
            <Check className="h-4 w-4" />{busy ? 'Aplicando…' : 'Usar foto'}
          </Button>
        </div>
      </div>
    </div>
  );
}
