import { storage } from './dom.js';

// Efectos de sonido sintetizados con Web Audio (sin archivos que descargar).
// El AudioContext se crea/reanuda con el primer toque o tecla (requisito de iOS y Chrome).

const MIN_GAP_MS = { swing: 45, hit: 35, clash: 80, poof: 60, fall: 120, step: 0 };

class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = storage.get('duelo:muted', '0') === '1';
    this.last = {};
    this.noiseBuf = null;
  }

  // Llamar desde un gesto del usuario.
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.7;
        // Compresor para que 8 luchadores pegando a la vez no saturen
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 6;
        this.master.connect(comp).connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m) {
    this.muted = m;
    storage.set('duelo:muted', m ? '1' : '0');
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.02);
  }

  ready(kind) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return false;
    const now = performance.now();
    const gap = MIN_GAP_MS[kind] ?? 0;
    if (gap && now - (this.last[kind] || 0) < gap) return false;
    this.last[kind] = now;
    return true;
  }

  // ---------- Piezas básicas ----------
  out(pan = 0, vol = 1) {
    const g = this.ctx.createGain();
    g.gain.value = vol;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  noise() {
    if (!this.noiseBuf) {
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    return src;
  }

  env(gain, t, attack, hold, release, peak = 1) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.setValueAtTime(peak, t + attack + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return t + attack + hold + release;
  }

  tone(type, f0, f1, dur, { pan = 0, vol = 0.4, at = 0, attack = 0.005 } = {}) {
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    const end = this.env(g, t, attack, 0, dur, 1);
    o.connect(g).connect(this.out(pan, vol));
    o.start(t);
    o.stop(end + 0.05);
  }

  burst(filterType, f0, f1, dur, { pan = 0, vol = 0.4, at = 0, q = 1 } = {}) {
    const t = this.ctx.currentTime + at;
    const src = this.noise();
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = this.ctx.createGain();
    const end = this.env(g, t, 0.004, 0, dur, 1);
    src.connect(f).connect(g).connect(this.out(pan, vol));
    src.start(t, Math.random());
    src.stop(end + 0.05);
  }

  // ---------- Efectos del juego ----------
  swing(pan = 0, near = true) {
    if (!this.ready('swing')) return;
    const r = 0.85 + Math.random() * 0.3;
    this.burst('bandpass', 2600 * r, 500 * r, 0.16, { pan, vol: near ? 0.35 : 0.15, q: 2.5 });
  }

  // "¡Shlick!" + "splat" acuoso. Más grave y largo con armas pesadas.
  hit(pan = 0, { heavy = false, kill = false } = {}) {
    if (!this.ready('hit')) return;
    const r = 0.9 + Math.random() * 0.25;
    this.burst('highpass', 5000 * r, 2500 * r, 0.07, { pan, vol: 0.35 });
    this.tone('sine', (heavy ? 260 : 340) * r, 70, heavy ? 0.22 : 0.16, { pan, vol: 0.55 });
    this.burst('lowpass', 1400, 200, 0.18, { pan, vol: 0.45, at: 0.02, q: 4 }); // squish
    if (kill) this.tone('square', 180, 60, 0.35, { pan, vol: 0.18, at: 0.05 });
  }

  clash(pan = 0) {
    if (!this.ready('clash')) return;
    for (const f of [1530, 2210, 3180, 4370]) {
      this.tone('triangle', f * (0.97 + Math.random() * 0.06), f * 0.98, 0.5, { pan, vol: 0.09 });
    }
    this.burst('highpass', 6000, 4000, 0.05, { pan, vol: 0.3 });
  }

  // Silbato que cae + golpe seco al fondo
  fall(pan = 0) {
    if (!this.ready('fall')) return;
    this.tone('sine', 1400, 180, 0.9, { pan, vol: 0.25, attack: 0.02 });
    this.tone('sine', 90, 40, 0.35, { pan, vol: 0.7, at: 0.95 });
    this.burst('lowpass', 600, 80, 0.3, { pan, vol: 0.5, at: 0.95 });
  }

  poof(pan = 0) {
    if (!this.ready('poof')) return;
    this.burst('lowpass', 2400, 150, 0.45, { pan, vol: 0.45, q: 0.7 });
    this.tone('square', 520, 900, 0.12, { pan, vol: 0.08 });
  }

  // Trombón triste: wah wah wah waaah
  sadTrombone() {
    if (!this.ready('sad')) return;
    const notes = [392, 370, 349, 330];
    notes.forEach((f, i) => {
      const last = i === notes.length - 1;
      const t = this.ctx.currentTime + i * 0.42;
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      if (last) {
        // vibrato al final
        const lfo = this.ctx.createOscillator();
        const lg = this.ctx.createGain();
        lfo.frequency.value = 6;
        lg.gain.value = 7;
        lfo.connect(lg).connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + 1.3);
      }
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const g = this.ctx.createGain();
      const end = this.env(g, t, 0.04, last ? 0.8 : 0.25, last ? 0.4 : 0.1, 1);
      o.connect(lp).connect(g).connect(this.out(0, 0.22));
      o.start(t);
      o.stop(end + 0.05);
    });
  }

  beep(high = false) {
    if (!this.ready('beep')) return;
    this.tone('square', high ? 1046 : 523, high ? 1046 : 523, high ? 0.35 : 0.15, { vol: 0.15 });
  }

  levelUp() {
    if (!this.ready('level')) return;
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone('square', f, f, 0.12, { vol: 0.12, at: i * 0.07 }));
    this.burst('bandpass', 400, 4000, 0.5, { vol: 0.2, q: 1.5 });
  }

  fanfare(win = true) {
    if (!this.ready('fanfare')) return;
    const seq = win
      ? [
          [523, 0],
          [659, 0.13],
          [784, 0.26],
          [1046, 0.42],
          [784, 0.62],
          [1046, 0.75],
        ]
      : [
          [523, 0],
          [494, 0.2],
          [466, 0.4],
        ];
    for (const [f, at] of seq) {
      this.tone('square', f, f, 0.22, { vol: 0.12, at });
      this.tone('triangle', f / 2, f / 2, 0.25, { vol: 0.15, at });
    }
  }
}

export const sfx = new Sfx();

// Preferencia de sangre de caricatura (por defecto, sí)
export const gore = {
  get on() {
    return storage.get('duelo:gore', '1') === '1';
  },
  set(v) {
    storage.set('duelo:gore', v ? '1' : '0');
  },
};
