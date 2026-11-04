/**
 * Avisos sonoros del restaurante sin librerías externas.
 *
 * WebAudio puede quedar suspendido hasta el primer gesto del usuario. Las
 * pantallas llaman a primeRestaurantAudio() en el primer clic para que los
 * avisos posteriores (pedido nuevo, pedido listo) sí suenen.
 */

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!audioContext) {
      const Context = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return null;
      audioContext = new Context();
    }
    return audioContext;
  } catch {
    return null;
  }
}

export function primeRestaurantAudio() {
  const context = getAudioContext();
  if (!context) return;
  if (context.state === 'suspended') {
    void context.resume().catch(() => undefined);
  }
}

function playTone(context: AudioContext, frequency: number, start: number, duration: number, volume = 0.055) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function playMelody(notes: Array<{ frequency: number; at: number; duration: number; volume?: number }>) {
  const context = getAudioContext();
  if (!context) return;
  const schedule = () => {
    const start = context.currentTime + 0.02;
    notes.forEach((note) => playTone(context, note.frequency, start + note.at, note.duration, note.volume));
  };
  if (context.state === 'suspended') {
    void context.resume().then(schedule).catch(() => undefined);
  } else {
    schedule();
  }
}

export function playNewOrderChime() {
  playMelody([
    { frequency: 659.25, at: 0, duration: 0.18 },
    { frequency: 880, at: 0.2, duration: 0.26, volume: 0.065 },
  ]);
}

export function playReadyOrderChime() {
  playMelody([
    { frequency: 523.25, at: 0, duration: 0.16 },
    { frequency: 659.25, at: 0.17, duration: 0.16 },
    { frequency: 783.99, at: 0.34, duration: 0.32, volume: 0.06 },
  ]);
}

export function vibrateReadyOrder() {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate([90, 70, 140]);
  } catch {
    // La vibración es un extra; no todos los dispositivos la permiten.
  }
}
