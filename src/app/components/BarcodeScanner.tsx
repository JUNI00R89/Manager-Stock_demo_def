import { useRef, useState, useEffect, useCallback } from 'react';
import {
  X, Keyboard, Zap, CameraOff, RotateCcw, Camera, Loader2, ShieldAlert, Lock,
  Package, ShoppingCart, PackagePlus, ClipboardList, AlertTriangle,
  CheckCircle2, Search, Barcode as BarcodeIcon
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { motion, AnimatePresence } from 'motion/react';
import type { Product } from '../utils/types';
import { toast } from 'sonner';

const money = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);

type ScannerState = 'scanning' | 'detected' | 'not_found' | 'typing';
type ScannerContext = 'pos' | 'receive' | 'count' | 'products';

/**
 * Estado de la cámara (separado del flujo de escaneo):
 *  checking  → averiguando si ya hay permiso
 *  ask       → aún no se ha pedido: mostramos un botón para que el navegador pregunte
 *  starting  → abriendo la cámara
 *  live      → cámara funcionando
 *  blocked   → el navegador la tiene bloqueada para este sitio
 *  busy      → otra app o pestaña la está usando
 *  nocamera  → el equipo no tiene cámara
 *  insecure  → la página no es https ni localhost (el navegador no deja usar la cámara)
 *  error     → cualquier otro fallo
 */
type CamStatus = 'checking' | 'ask' | 'starting' | 'live' | 'blocked' | 'busy' | 'nocamera' | 'insecure' | 'error';
type Engine = 'loading' | 'native' | 'zxing' | 'none';

interface BarcodeScannerProps {
  onScan?: (code: string, product: Product | null) => void;
  products?: Product[];
  onSell?: (product: Product) => void;
  onReceive?: (product: Product) => void;
  onCount?: (product: Product) => void;
  mode?: 'single' | 'continuous';
  context?: ScannerContext;
  onClose: () => void;
}

// ─── Lectura de códigos ──────────────────────────────────────────────────────
// 1) Si el navegador trae BarcodeDetector (Chrome/Edge en Android y otros) se usa: es rápido y no descarga nada.
// 2) Si no, se carga ZXing desde internet solo cuando hace falta (no requiere instalar nada).

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code'];
const ZXING_URLS = [
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js',
  'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js',
];

let zxingPromise: Promise<any> | null = null;
function loadZXing(): Promise<any> {
  const w = window as any;
  if (w.ZXing) return Promise.resolve(w.ZXing);
  if (zxingPromise) return zxingPromise;
  const tryLoad = (i: number): Promise<any> =>
    new Promise((resolve, reject) => {
      if (i >= ZXING_URLS.length) return reject(new Error('zxing-load'));
      const s = document.createElement('script');
      s.src = ZXING_URLS[i];
      s.async = true;
      s.onload = () => (w.ZXing ? resolve(w.ZXing) : reject(new Error('zxing-missing')));
      s.onerror = () => { s.remove(); tryLoad(i + 1).then(resolve, reject); };
      document.head.appendChild(s);
    });
  zxingPromise = tryLoad(0).catch(e => { zxingPromise = null; throw e; });
  return zxingPromise;
}

function makeZxingDecoder(Z: any) {
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
    Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E,
    Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.ITF, Z.BarcodeFormat.QR_CODE,
  ]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader();
  reader.setHints(hints);
  const canvas = document.createElement('canvas');
  return (video: HTMLVideoElement): string | null => {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    try {
      const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
      return reader.decode(bitmap).getText();
    } catch {
      return null; // no hay código en este cuadro
    }
  };
}

function beep() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = 1760;
    g.gain.value = 0.05;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 90);
  } catch { /* sin audio */ }
}

// ─── Pantalla de ayuda de cámara (a nivel de módulo: no se recrea en cada render) ───

interface CamOverlayProps {
  cam: CamStatus;
  detail: string;
  onAllow: () => void;
  onRetry: () => void;
  onType: () => void;
}

function CamOverlay({ cam, detail, onAllow, onRetry, onType }: CamOverlayProps) {
  if (cam === 'live') return null;

  if (cam === 'checking' || cam === 'starting') {
    return (
      <div className="absolute inset-0 bg-gray-950 flex flex-col items-center justify-center gap-3 text-center p-6" role="status">
        <Loader2 className="animate-spin text-orange-400" size={36} />
        <p className="text-white font-medium">{cam === 'starting' ? 'Abriendo la cámara…' : 'Preparando el escáner…'}</p>
        {cam === 'starting' && <p className="text-gray-400 text-sm max-w-xs">Si el navegador pregunta, elige "Permitir".</p>}
      </div>
    );
  }

  const content: Record<Exclude<CamStatus, 'live' | 'checking' | 'starting'>, {
    icon: React.ReactNode; title: string; body: React.ReactNode; primary?: { label: string; run: () => void };
  }> = {
    ask: {
      icon: <Camera className="text-orange-400" size={52} />,
      title: 'Usa la cámara para escanear',
      body: <>Solo se usa para leer códigos de barras. No se guarda ninguna imagen. El navegador te va a pedir permiso.</>,
      primary: { label: 'Permitir cámara', run: onAllow },
    },
    blocked: {
      icon: <Lock className="text-red-400" size={52} />,
      title: 'La cámara está bloqueada',
      body: (
        <div className="text-left space-y-3">
          <p className="text-center">El navegador no deja usar la cámara en este sitio. Para activarla:</p>
          <ol className="list-decimal list-inside space-y-1.5 text-gray-300">
            <li>Toca el candado (o el ícono de cámara) junto a la dirección.</li>
            <li>En <span className="text-white font-medium">Cámara</span>, elige <span className="text-white font-medium">Permitir</span>.</li>
            <li>Vuelve aquí y toca <span className="text-white font-medium">Reintentar</span>.</li>
          </ol>
          <p className="text-xs text-gray-500 flex gap-2">
            <ShieldAlert size={14} className="flex-shrink-0 mt-0.5" />
            Si ya la habías permitido, en Windows revisa Configuración, Privacidad y seguridad, Cámara, y activa el acceso para aplicaciones de escritorio.
          </p>
        </div>
      ),
      primary: { label: 'Reintentar', run: onRetry },
    },
    busy: {
      icon: <CameraOff className="text-amber-400" size={52} />,
      title: 'La cámara está en uso',
      body: <>Otra aplicación o pestaña (Zoom, Teams, otra ventana del navegador) la está usando. Ciérrala y toca Reintentar. El permiso no es el problema.</>,
      primary: { label: 'Reintentar', run: onRetry },
    },
    nocamera: {
      icon: <CameraOff className="text-gray-400" size={52} />,
      title: 'No encontramos una cámara',
      body: <>Este equipo no tiene cámara disponible. Puedes usar un lector USB o Bluetooth (funciona solo) o escribir el código.</>,
      primary: { label: 'Buscar de nuevo', run: onRetry },
    },
    insecure: {
      icon: <ShieldAlert className="text-amber-400" size={52} />,
      title: 'La cámara necesita una conexión segura',
      body: <>Los navegadores solo dejan usar la cámara en <span className="text-white font-medium">https</span> o en <span className="text-white font-medium">localhost</span>. Abre la app desde una de esas direcciones, o escribe el código.</>,
    },
    error: {
      icon: <AlertTriangle className="text-red-400" size={52} />,
      title: 'No se pudo abrir la cámara',
      body: <>{detail || 'Ocurrió un error inesperado.'}</>,
      primary: { label: 'Reintentar', run: onRetry },
    },
  };

  const c = content[cam];
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 bg-gray-950 flex flex-col items-center justify-center p-6 text-center overflow-y-auto"
      role="alertdialog"
      aria-labelledby="cam-title"
    >
      <div className="mb-4">{c.icon}</div>
      <h3 id="cam-title" className="text-white text-xl font-bold mb-3">{c.title}</h3>
      <div className="text-gray-400 text-sm mb-6 max-w-sm leading-relaxed">{c.body}</div>
      <div className="flex flex-col sm:flex-row gap-2 w-full max-w-sm">
        {c.primary && (
          <Button onClick={c.primary.run} className="flex-1 h-12 bg-orange-500 hover:bg-orange-600 text-white">
            {c.primary.label}
          </Button>
        )}
        <Button onClick={onType} variant="outline" className="flex-1 h-12 border-gray-600 bg-transparent text-gray-200 hover:bg-gray-800 hover:text-white">
          <Keyboard size={16} className="mr-2" />
          Escribir código
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

export function BarcodeScanner({
  onScan,
  products = [],
  onSell,
  onReceive,
  onCount,
  mode = 'single',
  context = 'pos',
  onClose,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const openIdRef = useRef(0); // cada intento de abrir la cámara tiene un número; los que llegan tarde se descartan
  const keyboardBufferRef = useRef<string>('');
  const keyboardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const typingInputRef = useRef<HTMLInputElement>(null);
  const lastScanRef = useRef(0);
  const lastCamCodeRef = useRef<{ code: string; t: number }>({ code: '', t: 0 });
  const nativeRef = useRef<any>(null);
  const zxingRef = useRef<((v: HTMLVideoElement) => string | null) | null>(null);

  const [scannerState, setScannerState] = useState<ScannerState>('scanning');
  const [detectedProduct, setDetectedProduct] = useState<Product | null>(null);
  const [scannedCode, setScannedCode] = useState('');
  const [typingCode, setTypingCode] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cam, setCam] = useState<CamStatus>('checking');
  const [camDetail, setCamDetail] = useState('');
  const [engine, setEngine] = useState<Engine>('loading');

  const facingRef = useRef(facingMode);
  facingRef.current = facingMode;
  const camRef = useRef(cam);
  camRef.current = cam;

  const processCode = useCallback((code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;

    const now = Date.now();
    // Modo continuo: evita lecturas repetidas muy seguidas
    if (mode === 'continuous' && now - lastScanRef.current < 1500) return;
    lastScanRef.current = now;

    setScannedCode(trimmed);
    // Solo productos reales del negocio: nunca el catálogo demo, que vendería productos inexistentes.
    const product = products.find(p => p.barcode === trimmed || p.sku?.toLowerCase() === trimmed.toLowerCase() || p.codigosBarras?.includes(trimmed));
    beep();
    try { navigator.vibrate?.(60); } catch { /* sin vibración */ }

    if (product) {
      setDetectedProduct(product);
      setScannerState('detected');

      if (mode === 'continuous' && context === 'pos') {
        onSell?.(product);
        toast.success(`${product.name} añadido`, { description: money(product.price), duration: 1500 });
        setTimeout(() => {
          setScannerState('scanning');
          setDetectedProduct(null);
          setScannedCode('');
        }, 1200);
      }
    } else {
      setDetectedProduct(null);
      setScannerState('not_found');
    }

    onScan?.(trimmed, product);
  }, [mode, context, onScan, onSell, products]);

  const processRef = useRef(processCode);
  processRef.current = processCode;

  // ── Cámara ────────────────────────────────────────────────────────────────

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  const openCamera = useCallback(async (facing: 'environment' | 'user') => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCam('insecure');
      return;
    }
    const myId = ++openIdRef.current;
    stopStream();
    setCam('starting');
    setCamDetail('');

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e: any) {
        // Si la cámara no soporta esas restricciones, probamos sin ellas
        if (e?.name === 'OverconstrainedError' || e?.name === 'ConstraintNotSatisfiedError') {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } else {
          throw e;
        }
      }

      // Llegó tarde (se cerró el escáner o se pidió otro intento): se libera de inmediato
      if (myId !== openIdRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => { /* autoplay lo resuelve */ });
      }
      const track = stream.getVideoTracks()[0];
      try { setTorchSupported(!!(track?.getCapabilities?.() as any)?.torch); } catch { setTorchSupported(false); }
      setCam('live');
    } catch (e: any) {
      if (myId !== openIdRef.current) return;
      const name: string = e?.name ?? '';
      const message: string = e?.message ?? '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        // Cerrar el aviso sin elegir también llega como NotAllowedError: no es un bloqueo real
        setCam(/dismiss/i.test(message) ? 'ask' : 'blocked');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setCam('nocamera');
      } else if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
        setCam('busy');
      } else if (name === 'SecurityError') {
        setCam('insecure');
      } else {
        setCam('error');
        setCamDetail(message || name);
      }
    }
  }, [stopStream]);

  // Al montar: si el permiso ya está dado se abre sola; si no, se pregunta con un botón
  useEffect(() => {
    let status: PermissionStatus | null = null;
    let dead = false;

    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setCam('insecure');
        return;
      }
      try {
        status = await navigator.permissions.query({ name: 'camera' as PermissionName });
        if (dead) return;
        const apply = () => {
          if (!status || dead) return;
          if (status.state === 'granted') {
            if (camRef.current !== 'live' && camRef.current !== 'starting') openCamera(facingRef.current);
          } else if (status.state === 'denied') {
            stopStream();
            setCam('blocked');
          } else if (camRef.current !== 'live' && camRef.current !== 'starting') {
            setCam('ask');
          }
        };
        apply();
        // Si la persona cambia el permiso desde el candado, reaccionamos sin recargar
        status.onchange = apply;
      } catch {
        // Safari y otros no exponen el permiso: se pregunta con el botón
        if (!dead) setCam('ask');
      }
    })();

    return () => {
      dead = true;
      if (status) status.onchange = null;
      openIdRef.current++; // invalida cualquier apertura pendiente
      stopStream();
    };
  }, [openCamera, stopStream]);

  // ── Motor de lectura ──────────────────────────────────────────────────────

  useEffect(() => {
    let dead = false;
    (async () => {
      const BD = (window as any).BarcodeDetector;
      if (BD) {
        try {
          const supported: string[] = (await BD.getSupportedFormats?.()) ?? [];
          const wanted = NATIVE_FORMATS.filter(f => supported.includes(f));
          if (wanted.length > 0) {
            nativeRef.current = new BD({ formats: wanted });
            if (!dead) setEngine('native');
            return;
          }
        } catch { /* se usa ZXing */ }
      }
      try {
        const Z = await loadZXing();
        zxingRef.current = makeZxingDecoder(Z);
        if (!dead) setEngine('zxing');
      } catch {
        if (!dead) setEngine('none');
      }
    })();
    return () => { dead = true; };
  }, []);

  // Bucle de lectura: solo mientras la cámara está viva y se está escaneando
  useEffect(() => {
    if (cam !== 'live' || scannerState !== 'scanning' || engine === 'loading' || engine === 'none') return;
    let stopped = false;
    let busy = false;

    const tick = async () => {
      const video = videoRef.current;
      if (stopped || busy || !video || video.readyState < 2) return;
      busy = true;
      try {
        let code: string | null = null;
        if (nativeRef.current) {
          const found = await nativeRef.current.detect(video);
          code = found?.[0]?.rawValue ?? null;
        } else if (zxingRef.current) {
          code = zxingRef.current(video);
        }
        if (code && !stopped) {
          const now = Date.now();
          const last = lastCamCodeRef.current;
          // el mismo código frente a la cámara no se repite durante 2.5 s
          if (code !== last.code || now - last.t > 2500) {
            lastCamCodeRef.current = { code, t: now };
            processRef.current(code);
          }
        }
      } catch { /* cuadro sin código */ } finally {
        busy = false;
      }
    };

    const id = setInterval(tick, 220);
    return () => { stopped = true; clearInterval(id); };
  }, [cam, scannerState, engine]);

  // ── Lector USB / Bluetooth (emula teclado) ─────────────────────────────────

  const handleHiddenKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const code = keyboardBufferRef.current;
      keyboardBufferRef.current = '';
      if (code.length > 3) processCode(code);
      return;
    }
    if (keyboardTimerRef.current) clearTimeout(keyboardTimerRef.current);
    keyboardBufferRef.current += e.key.length === 1 ? e.key : '';
    // los lectores escriben muy rápido; si hay pausa larga se descarta
    keyboardTimerRef.current = setTimeout(() => { keyboardBufferRef.current = ''; }, 100);
  }, [processCode]);

  useEffect(() => {
    const keepFocus = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (scannerState === 'scanning' && hiddenInputRef.current && t !== hiddenInputRef.current && t !== typingInputRef.current && !t?.closest('button')) {
        hiddenInputRef.current.focus();
      }
    };
    document.addEventListener('click', keepFocus);
    return () => document.removeEventListener('click', keepFocus);
  }, [scannerState]);

  useEffect(() => {
    if (scannerState === 'scanning') hiddenInputRef.current?.focus();
    if (scannerState === 'typing') typingInputRef.current?.focus();
  }, [scannerState]);

  // Esc cierra el escáner
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ── Acciones ──────────────────────────────────────────────────────────────

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as any] });
      setTorchOn(t => !t);
    } catch {
      toast.error('Linterna no disponible en este dispositivo');
    }
  };

  const switchCamera = () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    openCamera(next);
  };

  const handleTypingSubmit = () => {
    processCode(typingCode);
    setTypingCode('');
  };

  // Volver a escanear: la cámara sigue abierta, solo se limpia el resultado
  const handleReset = () => {
    setScannerState('scanning');
    setDetectedProduct(null);
    setScannedCode('');
    setTypingCode('');
    lastCamCodeRef.current = { code: '', t: Date.now() };
  };

  const stockColor = (product: Product) => {
    if (product.stock === 0) return 'text-red-500';
    if (product.stock < product.minStock) return 'text-amber-500';
    return 'text-green-500';
  };

  const live = cam === 'live';
  const showCamHelp = scannerState === 'scanning' && !live;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" role="dialog" aria-label="Escáner de códigos de barras">
      {/* Campo oculto para lectores USB/Bluetooth */}
      <input
        ref={hiddenInputRef}
        className="opacity-0 absolute top-0 left-0 w-px h-px"
        onKeyDown={handleHiddenKeyDown}
        readOnly
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* ── Vista de cámara ── */}
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />

        {/* Marco de guía */}
        {live && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-0 bg-black/45" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative w-72 max-w-[80vw] h-48">
                {[
                  'top-0 left-0 border-t-4 border-l-4 rounded-tl-lg',
                  'top-0 right-0 border-t-4 border-r-4 rounded-tr-lg',
                  'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-lg',
                  'bottom-0 right-0 border-b-4 border-r-4 rounded-br-lg',
                ].map((cls, i) => (
                  <div key={i} className={`absolute w-8 h-8 border-orange-400 ${cls}`} />
                ))}
                {scannerState === 'scanning' && (
                  <div
                    className="absolute left-2 right-2 h-0.5 bg-orange-400 shadow-[0_0_8px_2px_rgba(251,146,60,0.8)]"
                    style={{ animation: 'scanLine 2s ease-in-out infinite' }}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        <style>{`
          @keyframes scanLine { 0% { top: 8px; } 50% { top: calc(100% - 10px); } 100% { top: 8px; } }
          @media (prefers-reduced-motion: reduce) { [style*="scanLine"] { animation: none !important; top: 50%; } }
        `}</style>

        {/* Permiso / errores de cámara */}
        {showCamHelp && (
          <CamOverlay
            cam={cam}
            detail={camDetail}
            onAllow={() => openCamera(facingMode)}
            onRetry={() => openCamera(facingMode)}
            onType={() => setScannerState('typing')}
          />
        )}

        {/* Indicación mientras escanea */}
        {scannerState === 'scanning' && live && (
          <div className="absolute bottom-6 left-0 right-0 flex flex-col items-center gap-2 pointer-events-none px-4">
            <div className="bg-black/65 px-4 py-2 rounded-full text-sm text-white flex items-center gap-2">
              {engine === 'loading' ? (
                <><Loader2 size={16} className="animate-spin text-orange-400" /> Preparando el lector…</>
              ) : engine === 'none' ? (
                <><AlertTriangle size={16} className="text-amber-400" /> Lector automático no disponible</>
              ) : (
                <><BarcodeIcon size={16} className="text-orange-400" /> Apunta al código de barras</>
              )}
            </div>
            {engine === 'none' && (
              <p className="bg-black/65 rounded-lg px-3 py-2 text-xs text-gray-200 text-center max-w-xs">
                No se pudo cargar el lector (¿sin internet?). Escribe el código o usa un lector USB.
              </p>
            )}
          </div>
        )}

        {/* Modo escritura */}
        <AnimatePresence>
          {scannerState === 'typing' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute inset-0 bg-gray-950/95 flex flex-col items-center justify-center p-6"
            >
              <BarcodeIcon className="text-orange-400 mb-4" size={48} />
              <h3 className="text-white text-lg font-bold mb-2">Ingresar código</h3>
              <p className="text-gray-400 text-sm mb-6 text-center">
                Escribe o pega el código de barras y presiona Enter
              </p>
              <div className="w-full max-w-xs space-y-3">
                <Input
                  ref={typingInputRef}
                  value={typingCode}
                  onChange={e => setTypingCode(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleTypingSubmit()}
                  placeholder="Ej: 7501234567890"
                  aria-label="Código de barras"
                  className="bg-gray-800 border-gray-600 text-white placeholder:text-gray-500 text-center font-mono text-lg h-12"
                  autoFocus
                />
                <Button
                  onClick={handleTypingSubmit}
                  disabled={typingCode.length < 2}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white h-12"
                >
                  <Search size={18} className="mr-2" />
                  Buscar producto
                </Button>
                {!live && cam !== 'checking' && cam !== 'starting' && (
                  <button
                    onClick={() => { setScannerState('scanning'); if (cam === 'ask') openCamera(facingMode); }}
                    className="w-full text-center text-sm text-orange-400 hover:text-orange-300 py-1"
                  >
                    Volver a la cámara
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Controles superiores */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pb-2" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
          <button
            onClick={onClose}
            aria-label="Cerrar escáner"
            className="w-11 h-11 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80 transition-colors"
          >
            <X size={22} />
          </button>

          <div className="flex gap-2">
            {live && torchSupported && (
              <button
                onClick={toggleTorch}
                aria-label={torchOn ? 'Apagar linterna' : 'Encender linterna'}
                aria-pressed={torchOn}
                className={`w-11 h-11 rounded-full flex items-center justify-center text-white transition-colors ${torchOn ? 'bg-amber-500' : 'bg-black/60 hover:bg-black/80'}`}
              >
                <Zap size={18} />
              </button>
            )}
            {live && (
              <button
                onClick={switchCamera}
                aria-label="Cambiar de cámara"
                className="w-11 h-11 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80 transition-colors"
              >
                <RotateCcw size={18} />
              </button>
            )}
            <button
              onClick={() => setScannerState(s => (s === 'typing' ? 'scanning' : 'typing'))}
              aria-label="Escribir código manualmente"
              aria-pressed={scannerState === 'typing'}
              className={`w-11 h-11 rounded-full flex items-center justify-center text-white transition-colors ${scannerState === 'typing' ? 'bg-orange-500' : 'bg-black/60 hover:bg-black/80'}`}
            >
              <Keyboard size={18} />
            </button>
          </div>
        </div>

        {mode === 'continuous' && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-xs font-bold px-3 py-1 rounded-full pointer-events-none">
            Modo continuo
          </div>
        )}
      </div>

      {/* ── Panel inferior ── */}
      <div className="bg-gray-950 flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <AnimatePresence mode="wait">
          {scannerState === 'not_found' && (
            <motion.div
              key="not_found"
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              className="p-5"
            >
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-xl bg-red-900/40 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="text-red-400" size={28} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-white font-bold">Producto no encontrado</h3>
                  <p className="text-gray-400 text-sm mt-1 font-mono break-all">{scannedCode}</p>
                  <div className="flex gap-2 mt-4">
                    <Button onClick={handleReset} variant="outline" className="flex-1 border-gray-600 bg-transparent text-gray-300 hover:bg-gray-800 hover:text-white">
                      Escanear otro
                    </Button>
                    <Button
                      className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                      onClick={() => {
                        onClose();
                        toast.info(`Crea el producto con código: ${scannedCode}`);
                      }}
                    >
                      <Package size={14} className="mr-1" />
                      Crear producto
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {scannerState === 'detected' && detectedProduct && (
            <motion.div
              key="detected"
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="p-5"
            >
              <div className="flex items-start gap-4 mb-4">
                <div className="w-16 h-16 rounded-xl bg-orange-900/40 border border-orange-800/50 flex items-center justify-center flex-shrink-0">
                  <Package className="text-orange-400" size={30} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="text-green-400 flex-shrink-0" size={16} />
                    <span className="text-green-400 text-xs font-semibold">Producto encontrado</span>
                  </div>
                  <h3 className="text-white font-bold text-base leading-tight">{detectedProduct.name}</h3>
                  <p className="text-gray-400 text-sm">SKU: {detectedProduct.sku}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-2xl font-bold text-orange-400">{money(detectedProduct.price)}</span>
                    <span className={`text-sm font-semibold ${stockColor(detectedProduct)}`}>
                      Stock: {detectedProduct.stock}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-gray-800/60 rounded-lg p-3 mb-4 text-xs text-gray-300">
                <p className="font-semibold text-gray-200 mb-1">Stock por sucursal:</p>
                <div className="grid grid-cols-2 gap-1">
                  <span>Sucursal Principal: {Math.round(detectedProduct.stock * 0.6)}</span>
                  <span>Sucursal Norte: {Math.round(detectedProduct.stock * 0.4)}</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(context === 'pos' || !context) && (
                  <Button
                    onClick={() => { onSell?.(detectedProduct); if (mode === 'single') { onClose(); } else { handleReset(); } }}
                    className="bg-green-600 hover:bg-green-700 text-white flex flex-col h-16 gap-1"
                  >
                    <ShoppingCart size={18} />
                    <span className="text-xs">Vender</span>
                  </Button>
                )}
                {(context === 'receive' || context === 'pos') && (
                  <Button
                    onClick={() => { onReceive?.(detectedProduct); handleReset(); }}
                    className="bg-blue-600 hover:bg-blue-700 text-white flex flex-col h-16 gap-1"
                  >
                    <PackagePlus size={18} />
                    <span className="text-xs">Recibir</span>
                  </Button>
                )}
                <Button
                  onClick={() => { onCount?.(detectedProduct); handleReset(); }}
                  variant="outline"
                  className="border-gray-600 bg-transparent text-gray-300 hover:bg-gray-800 hover:text-white flex flex-col h-16 gap-1"
                >
                  <ClipboardList size={18} />
                  <span className="text-xs">Contar</span>
                </Button>
              </div>

              <button onClick={handleReset} className="w-full mt-3 text-center text-xs text-gray-400 hover:text-gray-200 py-2">
                Escanear otro código
              </button>
            </motion.div>
          )}

          {scannerState === 'scanning' && (
            <motion.div key="scanning" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-5 text-center">
              <p className="text-gray-300 text-sm">
                {live ? 'Apunta la cámara al código de barras o usa un lector USB/Bluetooth' : 'También puedes usar un lector USB/Bluetooth o escribir el código'}
              </p>
              <p className="text-gray-500 text-xs mt-1">El lector USB funciona automáticamente: solo escanea</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
