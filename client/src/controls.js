import { h } from './dom.js';

const KEYS = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

const JOY_RADIUS = 52;
const DEADZONE = 0.15;
const SEND_INTERVAL_MS = 50; // máx 20 mensajes de movimiento por segundo

// Controles de escritorio (WASD/flechas + clic/espacio) y táctiles (joystick + botón).
// Solo producen intenciones; el servidor decide qué pasa.
export class Controls {
  constructor(root, view, { cooldownMs, sendInput, sendAttack, canAct }) {
    this.root = root;
    this.view = view;
    this.cooldownMs = cooldownMs;
    this.sendInput = sendInput;
    this.sendAttack = sendAttack;
    this.canAct = canAct;
    this.keys = new Set();
    this.joy = { x: 0, z: 0, id: null, ox: 0, oy: 0 };
    this.cursor = null;
    this.lastSent = { x: 0, z: 0 };
    this.lastSentAt = 0;
    this.lastAttackAt = 0;
    this.holding = false;
    this.listeners = [];

    this.buildTouchUi();
    this.bind();
    this.loop = setInterval(() => this.tick(), 16);
  }

  on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.listeners.push(() => target.removeEventListener(type, fn, opts));
  }

  buildTouchUi() {
    this.knob = h('div', { class: 'joy-knob' });
    this.base = h('div', { class: 'joy-base' }, this.knob);
    this.zone = h('div', { class: 'joy-zone' }, this.base);
    this.cd = h('span', { class: 'cd' });
    this.attackBtn = h('button', { class: 'attack-btn', type: 'button', 'aria-label': 'Atacar' }, '¡Cuchillazo!', this.cd);
    this.touchUi = h('div', { class: 'touch-controls' }, this.zone, this.attackBtn);
    this.root.append(this.touchUi);
  }

  bind() {
    // Teclado
    this.on(window, 'keydown', (e) => {
      if (KEYS[e.code]) {
        this.keys.add(e.code);
        e.preventDefault();
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.holding = true;
        this.tryAttack();
      }
    });
    this.on(window, 'keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space') this.holding = false;
    });
    this.on(window, 'blur', () => this.releaseAll());
    this.on(document, 'visibilitychange', () => document.hidden && this.releaseAll());

    // Mouse: apuntar al cursor y clic para atacar
    const canvas = this.view.canvas;
    this.on(canvas, 'pointermove', (e) => {
      if (e.pointerType === 'mouse') this.cursor = { x: e.clientX, y: e.clientY };
    });
    this.on(canvas, 'pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      this.cursor = { x: e.clientX, y: e.clientY };
      this.holding = true;
      this.tryAttack();
    });
    this.on(window, 'pointerup', (e) => {
      if (e.pointerType === 'mouse') this.holding = false;
    });
    this.on(canvas, 'contextmenu', (e) => e.preventDefault());

    // Joystick virtual (mitad izquierda)
    this.on(this.zone, 'pointerdown', (e) => {
      e.preventDefault();
      if (e.pointerType === 'mouse') {
        // Laptop híbrida: un clic de mouse sobre la zona es un ataque normal.
        this.cursor = { x: e.clientX, y: e.clientY };
        this.holding = true;
        this.tryAttack();
        return;
      }
      if (this.joy.id !== null) return;
      this.zone.setPointerCapture?.(e.pointerId);
      this.joy.id = e.pointerId;
      const rect = this.zone.getBoundingClientRect();
      this.joy.ox = e.clientX;
      this.joy.oy = e.clientY;
      this.base.style.left = `${e.clientX - rect.left}px`;
      this.base.style.top = `${e.clientY - rect.top}px`;
      this.base.classList.add('active');
      this.updateJoy(e.clientX, e.clientY);
    });
    this.on(this.zone, 'pointermove', (e) => {
      if (e.pointerId !== this.joy.id) return;
      e.preventDefault();
      this.updateJoy(e.clientX, e.clientY);
    });
    const endJoy = (e) => {
      if (e.pointerId !== this.joy.id) return;
      this.joy.id = null;
      this.joy.x = this.joy.z = 0;
      this.knob.style.transform = '';
      this.base.classList.remove('active');
      this.base.style.left = '';
      this.base.style.top = '';
    };
    this.on(this.zone, 'pointerup', endJoy);
    this.on(this.zone, 'pointercancel', endJoy);

    // Botón de ataque (mantener presionado = ataque continuo)
    this.on(this.attackBtn, 'pointerdown', (e) => {
      e.preventDefault();
      if (e.pointerType !== 'mouse') this.cursor = null; // en táctil se auto-apunta
      this.attackBtn.setPointerCapture?.(e.pointerId);
      this.attackBtn.classList.add('pressed');
      this.holding = true;
      this.tryAttack();
    });
    const endAttack = () => {
      this.attackBtn.classList.remove('pressed');
      this.holding = false;
    };
    this.on(this.attackBtn, 'pointerup', endAttack);
    this.on(this.attackBtn, 'pointercancel', endAttack);
    this.on(this.attackBtn, 'contextmenu', (e) => e.preventDefault());
  }

  updateJoy(x, y) {
    let dx = x - this.joy.ox;
    let dy = y - this.joy.oy;
    const d = Math.hypot(dx, dy);
    if (d > JOY_RADIUS) {
      dx *= JOY_RADIUS / d;
      dy *= JOY_RADIUS / d;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const mag = Math.min(1, d / JOY_RADIUS);
    if (mag < DEADZONE) {
      this.joy.x = this.joy.z = 0;
    } else {
      // La cámara mira hacia -Z: arriba en pantalla = -Z en el mundo.
      this.joy.x = (dx / JOY_RADIUS);
      this.joy.z = (dy / JOY_RADIUS);
    }
  }

  releaseAll() {
    this.keys.clear();
    this.holding = false;
    this.joy.x = this.joy.z = 0;
  }

  moveVector() {
    let x = this.joy.x;
    let z = this.joy.z;
    for (const k of this.keys) {
      x += KEYS[k][0];
      z += KEYS[k][1];
    }
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    return { x, z };
  }

  aimVector() {
    const me = this.view.position(this.view.localId);
    if (!me) return null;
    if (this.cursor) {
      const p = this.view.screenToGround(this.cursor.x, this.cursor.y);
      if (p) {
        const dx = p.x - me.x;
        const dz = p.z - me.z;
        if (Math.hypot(dx, dz) > 0.2) return { x: dx, z: dz };
      }
    }
    return null;
  }

  tryAttack() {
    if (!this.canAct()) return false;
    const now = performance.now();
    if (now - this.lastAttackAt < this.cooldownMs + 15) return false;
    const me = this.view.position(this.view.localId);
    if (!me || !me.alive) return false;
    // Táctil: auto-apunta al enemigo más cercano; si no, hacia donde mira.
    let dir = this.aimVector();
    if (!dir) dir = this.view.nearestEnemy(this.view.localId, 4.5);
    if (!dir) {
      const mv = this.moveVector();
      dir = Math.hypot(mv.x, mv.z) > 0.1 ? mv : { x: Math.sin(me.facing), z: Math.cos(me.facing) };
    }
    const len = Math.hypot(dir.x, dir.z) || 1;
    const out = { x: Math.round((dir.x / len) * 1000) / 1000, z: Math.round((dir.z / len) * 1000) / 1000 };
    this.lastAttackAt = now;
    this.view.setAim(out.x, out.z);
    this.view.localSwing();
    this.sendAttack(out);
    return true;
  }

  tick() {
    const now = performance.now();
    const v = this.canAct() ? this.moveVector() : { x: 0, z: 0 };
    this.view.setLocalInput(v.x, v.z);
    // Apuntado con mouse (para que el personaje mire al cursor)
    const aim = this.aimVector();
    if (aim) this.view.setAim(aim.x, aim.z);
    else if (now - this.lastAttackAt > 400) this.view.setAim(null);

    const changed = Math.abs(v.x - this.lastSent.x) > 0.04 || Math.abs(v.z - this.lastSent.z) > 0.04;
    const stopped = v.x === 0 && v.z === 0 && (this.lastSent.x !== 0 || this.lastSent.z !== 0);
    if ((changed || stopped) && now - this.lastSentAt >= SEND_INTERVAL_MS) {
      const out = { x: Math.round(v.x * 100) / 100, z: Math.round(v.z * 100) / 100 };
      this.sendInput(out);
      this.lastSent = out;
      this.lastSentAt = now;
    }
    if (this.holding) this.tryAttack();

    // Indicador de cooldown en el botón
    const p = Math.max(0, 1 - (now - this.lastAttackAt) / this.cooldownMs);
    this.cd.style.setProperty('--p', `${Math.round(p * 100)}%`);
  }

  dispose() {
    clearInterval(this.loop);
    for (const off of this.listeners) off();
    this.touchUi.remove();
  }
}
