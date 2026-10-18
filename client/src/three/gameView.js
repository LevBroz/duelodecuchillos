import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { GAME } from '../../../shared/index.js';
import { createRenderer, damp, disposeObject, environmentFor, isLowEnd, lerpAngle } from './common.js';
import { buildArena } from './arena.js';
import { buildCharacter } from './character.js';
import { Effects } from './effects.js';

const INTERP_DELAY_MS = 110;
const CHAR_SCALE = 1.45; // un poco más grandes que su hitbox para que se lean bien desde arriba
const CAM_ELEV = 54; // grados sobre el horizonte
const R = GAME.RING_RADIUS;

// Escena del ring: personajes, cámara, interpolación y efectos.
// No decide nada del juego: solo dibuja lo que manda el servidor.
export class GameView {
  constructor(container, { players, options, localId, tickRate = GAME.TICK_RATE }) {
    this.container = container;
    this.localId = localId;
    this.tickRate = tickRate;
    this.lowEnd = isLowEnd();
    this.options = new Map(options.map((o) => [o.id, o]));

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gl';
    container.append(this.canvas);
    this.renderer = createRenderer(this.canvas, { shadows: true });
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'label-layer';
    container.append(this.labels.domElement);

    this.scene = new THREE.Scene();
    this.scene.environment = environmentFor(this.renderer);
    this.scene.environmentIntensity = 0.45;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.camTarget = new THREE.Vector3();
    this.arena = buildArena(this.scene, { lowEnd: this.lowEnd });
    this.effects = new Effects(this.scene, { lowEnd: this.lowEnd });

    this.entities = new Map();
    for (const p of players) this.addEntity(p);
    this.gore = true; // sangre de caricatura (se puede apagar desde el HUD)
    this.onSwing = null; // callback para el sonido de los golpes de los demás

    this.snapshots = [];
    this.serverOffset = null;
    this.localInput = { x: 0, z: 0 };
    this.localAim = null;
    this.rtt = 100;
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.8);
    this.raycaster = new THREE.Raycaster();

    this.clock = new THREE.Clock();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.placeCamera(1);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  addEntity(p) {
    const rig = buildCharacter(p.character);
    rig.root.scale.setScalar(CHAR_SCALE);
    this.scene.add(rig.root);
    const option = this.options.get(p.optionId);
    const color = option?.color || '#ffffff';

    const tag = document.createElement('div');
    tag.className = `nametag ${p.id === this.localId ? 'me' : ''}`;
    tag.style.color = color;
    const nameEl = document.createElement('span');
    nameEl.className = 'n';
    nameEl.textContent = p.nick;
    const hp = document.createElement('span');
    hp.className = 'hpmini';
    const hpFill = document.createElement('i');
    hpFill.style.width = '100%';
    hp.append(hpFill);
    tag.append(nameEl, hp);
    const label = new CSS2DObject(tag);
    label.position.set(0, rig.headTop + 0.35, 0);
    rig.root.add(label);

    // Anillo del color del bando bajo los pies
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: p.id === this.localId ? 0.95 : 0.6, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    rig.root.add(ring);

    const e = {
      id: p.id,
      nick: p.nick,
      optionId: p.optionId,
      color,
      rig,
      label,
      tag,
      hpFill,
      ring,
      x: 0,
      z: 0,
      facing: 0,
      hp: GAME.MAX_HP,
      alive: true,
      moving: false,
      attackSeq: 0,
      trail: this.effects.trailFor(p.id, '#fff2c4'),
      // predicción local
      px: null,
      pz: null,
    };
    this.entities.set(p.id, e);
    return e;
  }

  // ---------- Red ----------
  pushSnapshot(snap) {
    const now = performance.now();
    const serverMs = (snap.n / this.tickRate) * 1000;
    const offset = now - serverMs;
    // Offset suavizado (tomamos el menor reciente para no acumular retraso).
    if (this.serverOffset === null || offset < this.serverOffset) this.serverOffset = offset;
    else this.serverOffset += (offset - this.serverOffset) * 0.02;
    snap.serverMs = serverMs;
    snap.recv = now;
    this.phase = snap.phase;
    this.snapshots.push(snap);
    if (this.snapshots.length > 40) this.snapshots.shift();

    for (const s of snap.players) {
      const e = this.entities.get(s.id);
      if (!e) continue;
      e.latest = s;
      if (s.hp !== e.hp) {
        e.hp = s.hp;
        e.hpFill.style.width = `${Math.max(0, s.hp)}%`;
      }
      if (s.a !== e.attackSeq) {
        // El local ya animó (y sonó) su golpe al hacer clic.
        if (s.id !== this.localId || !e.rig.isSwinging) {
          e.rig.swing();
          if (s.id !== this.localId) this.onSwing?.(s.id, s.x);
        }
        e.attackSeq = s.a;
      }
    }
  }

  setRtt(ms) {
    this.rtt = this.rtt * 0.7 + ms * 0.3;
  }

  setLocalInput(x, z) {
    this.localInput.x = x;
    this.localInput.z = z;
  }

  setAim(x, z) {
    this.localAim = x === null ? null : { x, z };
  }

  localSwing() {
    this.entities.get(this.localId)?.rig.swing();
  }

  setGore(on) {
    this.gore = on;
    if (!on) this.effects.splats.clear();
  }

  // Paneo estéreo según la posición en pantalla (-1 izquierda, 1 derecha)
  panFor(x) {
    return Math.max(-1, Math.min(1, (x - this.camTarget.x) / R));
  }

  // Eventos del servidor (golpes, eliminaciones...) para efectos.
  handleEvent(ev) {
    if (ev.type === 'hit') {
      const victim = this.entities.get(ev.v);
      if (!victim) return;
      const p = new THREE.Vector3(ev.x, 1.1, ev.z);
      this.effects.sparksAt(p, 16, 4.5);
      this.effects.shoveDust(ev.x, ev.z); // polvo del empujón
      const attacker = this.entities.get(ev.a);
      if (this.gore) {
        // La sangre vuela del atacante hacia afuera
        const dx = attacker ? ev.x - attacker.x : Math.random() - 0.5;
        const dz = attacker ? ev.z - attacker.z : Math.random() - 0.5;
        this.effects.blood(ev.x, ev.z, dx, dz, ev.kill ? 1.8 : 0.8 + Math.min(0.8, ev.d / 20));
      } else {
        this.effects.hitBurst(p, victim.color);
      }
      victim.rig.hitFlash();
      this.damageNumber(victim, ev.d, ev.kill);
      if (ev.v === this.localId) this.effects.addShake(0.35);
      else if (ev.a === this.localId) this.effects.addShake(0.12);
    } else if (ev.type === 'clash') {
      this.effects.sparksAt(new THREE.Vector3(ev.x, 1.2, ev.z), 40, 7);
      this.effects.addShake(0.2);
    } else if (ev.type === 'elim') {
      const e = this.entities.get(ev.v);
      if (!e) return;
      e.alive = false;
      e.rig.die(ev.cause === 'ring');
      e.ring.visible = false;
      e.tag.style.opacity = '0.4';
      this.effects.poof(new THREE.Vector3(e.x, 0.8, e.z), e.color);
      if (this.gore && ev.cause === 'hit') this.effects.pool(e.x, e.z);
      this.effects.addShake(ev.v === this.localId ? 0.6 : 0.25);
    }
  }

  damageNumber(e, amount, big) {
    // CSS2DRenderer posiciona con `transform` en el contenedor; la animación va en el hijo
    // (si animáramos el mismo elemento, la animación pisaría la posición).
    const el = document.createElement('div');
    const num = document.createElement('div');
    num.className = `dmg-num ${big ? 'big' : ''}`;
    num.textContent = big ? '¡FUERA!' : `-${amount}`;
    el.append(num);
    const obj = new CSS2DObject(el);
    obj.position.set(e.x + (Math.random() - 0.5) * 0.6, 2.4, e.z);
    this.scene.add(obj);
    setTimeout(() => {
      this.scene.remove(obj);
      el.remove();
    }, 900);
  }

  // ---------- Utilidades para controles ----------
  screenToGround(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, hit) ? { x: hit.x, z: hit.z } : null;
  }

  // Convierte un vector de pantalla (joystick/teclas) a mundo: la cámara mira hacia -Z.
  screenVectorToWorld(sx, sy) {
    return { x: sx, z: sy };
  }

  position(id) {
    const e = this.entities.get(id);
    return e ? { x: e.x, z: e.z, facing: e.facing, alive: e.alive } : null;
  }

  nearestEnemy(id, maxDist = 6) {
    const me = this.entities.get(id);
    if (!me) return null;
    let best = null;
    let bestD = maxDist;
    for (const e of this.entities.values()) {
      if (!e.alive || e.id === id || e.optionId === me.optionId) continue;
      const d = Math.hypot(e.x - me.x, e.z - me.z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best ? { x: best.x - me.x, z: best.z - me.z } : null;
  }

  // ---------- Render ----------
  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    // En vertical abrimos el FOV para que quepa el ring.
    this.camera.fov = this.camera.aspect < 1 ? 62 : 48;
    this.camera.updateProjectionMatrix();
    const scale = (this.renderer.getDrawingBufferSize(new THREE.Vector2()).y * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.effects.sparks.setScale(scale);
    this.effects.puffs.setScale(scale);
    this.camDistance = this.fitDistance();
  }

  fitDistance() {
    const elev = THREE.MathUtils.degToRad(CAM_ELEV);
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const margin = this.camera.aspect < 1 ? 0.6 : 1.6;
    const need = R + margin;
    const byW = need / Math.tan(hfov / 2);
    const byH = (need * Math.sin(elev) + 1) / Math.tan(vfov / 2);
    return Math.max(byW, byH) * (this.camera.aspect < 1 ? 0.92 : 1);
  }

  placeCamera(t) {
    const me = this.entities.get(this.localId);
    // Sigue al jugador local sin perder de vista el ring (en vertical casi no hay margen).
    const follow = me && me.alive ? (this.camera.aspect < 1 ? 0.15 : 0.3) : 0;
    const tx = me ? me.x * follow : 0;
    const tz = me ? me.z * follow : 0;
    this.camTarget.x = damp(this.camTarget.x, tx, 4, t);
    this.camTarget.z = damp(this.camTarget.z, tz, 4, t);
    const elev = THREE.MathUtils.degToRad(CAM_ELEV);
    const d = this.camDistance;
    const shake = this.effects.shake;
    this.camera.position.set(
      this.camTarget.x + (Math.random() - 0.5) * shake,
      Math.sin(elev) * d + (Math.random() - 0.5) * shake,
      this.camTarget.z + Math.cos(elev) * d,
    );
    this.camera.lookAt(this.camTarget.x, 0, this.camTarget.z - 0.6);
  }

  interpolate(now) {
    const snaps = this.snapshots;
    if (!snaps.length || this.serverOffset === null) return;
    const renderMs = now - this.serverOffset - INTERP_DELAY_MS;
    let a = snaps[0];
    let b = snaps[snaps.length - 1];
    for (let i = snaps.length - 1; i > 0; i--) {
      if (snaps[i - 1].serverMs <= renderMs) {
        a = snaps[i - 1];
        b = snaps[i];
        break;
      }
    }
    const span = b.serverMs - a.serverMs;
    const t = span > 0 ? THREE.MathUtils.clamp((renderMs - a.serverMs) / span, 0, 1) : 1;
    const bMap = new Map(b.players.map((p) => [p.id, p]));
    for (const pa of a.players) {
      const pb = bMap.get(pa.id) || pa;
      const e = this.entities.get(pa.id);
      if (!e || e.id === this.localId) continue;
      e.x = pa.x + (pb.x - pa.x) * t;
      e.z = pa.z + (pb.z - pa.z) * t;
      e.facing = lerpAngle(pa.f, pb.f, t);
      e.moving = !!pb.mv;
    }
  }

  // Predicción del jugador local: se mueve al instante y se corrige hacia el servidor.
  predictLocal(dt, now) {
    const e = this.entities.get(this.localId);
    if (!e || !e.latest) return;
    const s = e.latest;
    if (e.px === null) {
      e.px = s.x;
      e.pz = s.z;
    }
    const playing = this.phase === 'main' || this.phase === 'sudden';
    const ix = this.localInput.x;
    const iz = this.localInput.z;
    const len = Math.hypot(ix, iz);
    if (e.alive && playing && len > 0.01) {
      const k = Math.min(1, len) / len;
      e.px += ix * k * GAME.MAX_SPEED * dt;
      e.pz += iz * k * GAME.MAX_SPEED * dt;
      const d = Math.hypot(e.px, e.pz);
      const max = R - GAME.PLAYER_RADIUS;
      if (d > max) {
        e.px *= max / d;
        e.pz *= max / d;
      }
    }
    // Objetivo: posición del servidor adelantada por la latencia con el input actual.
    const lead = playing && e.alive ? (this.rtt / 2 + (now - (this.snapshots.at(-1)?.recv || now))) / 1000 : 0;
    const k = len > 0.01 ? Math.min(1, len) / len : 0;
    let tx = s.x + ix * k * GAME.MAX_SPEED * lead;
    let tz = s.z + iz * k * GAME.MAX_SPEED * lead;
    const td = Math.hypot(tx, tz);
    const tmax = Math.max(R - GAME.PLAYER_RADIUS, Math.hypot(s.x, s.z));
    if (td > tmax) {
      tx *= tmax / td;
      tz *= tmax / td;
    }
    const err = Math.hypot(tx - e.px, tz - e.pz);
    if (err > 2.5 || !e.alive) {
      e.px = tx;
      e.pz = tz;
    } else {
      const lambda = len > 0.01 ? 3 : 9;
      e.px = damp(e.px, tx, lambda, dt);
      e.pz = damp(e.pz, tz, lambda, dt);
    }
    e.x = e.px;
    e.z = e.pz;
    e.moving = len > 0.01 && e.alive && playing;
    if (this.localAim) e.facing = Math.atan2(this.localAim.x, this.localAim.z);
    else if (e.moving) e.facing = Math.atan2(ix, iz);
    else e.facing = lerpAngle(e.facing, s.f, 0.2);
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const now = performance.now();
    this.interpolate(now);
    this.predictLocal(dt, now);

    for (const e of this.entities.values()) {
      const root = e.rig.root;
      root.position.x = e.x;
      root.position.z = e.z;
      root.rotation.y = lerpAngle(root.rotation.y, e.facing, 1 - Math.exp(-18 * dt));
      e.rig.update(dt, e.moving);
      if (e.moving && e.alive) this.effects.dust(e.x, e.z);
      if (e.rig.isSwinging && e.alive) {
        const base = new THREE.Vector3();
        const tip = new THREE.Vector3();
        e.rig.hand.getWorldPosition(base);
        e.rig.tip.getWorldPosition(tip);
        e.trail.push(base.lerp(tip, 0.35), tip);
      }
    }
    this.arena.update(dt);
    this.effects.update(dt);
    this.placeCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObs.disconnect();
    this.effects.dispose();
    disposeObject(this.scene);
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.canvas.remove();
    this.labels.domElement.remove();
  }
}
