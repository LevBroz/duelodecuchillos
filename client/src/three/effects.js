import * as THREE from 'three';

// Puntos redondos con alfa por partícula (para que se desvanezcan bien).
const VERT = /* glsl */ `
  attribute vec3 color;
  attribute float alpha;
  uniform float uSize;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (0.6 + 0.4 * alpha) * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uSoft;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = 1.0 - smoothstep(1.0 - uSoft, 1.0, d);
    if (a * vAlpha < 0.01) discard;
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`;

// Sistema de partículas simple con Points (un draw call por sistema).
class Particles {
  constructor(scene, { capacity, size, additive, gravity, drag }) {
    this.capacity = capacity;
    this.gravity = gravity;
    this.drag = drag;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity).fill(1);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uSize: { value: size }, uScale: { value: 600 }, uSoft: { value: additive ? 0.9 : 0.25 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    for (let i = 0; i < capacity; i++) this.pos[i * 3 + 1] = -999;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, color, life) {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    // ShaderMaterial no convierte colores: pasamos sRGB directo.
    const c = color.clone().convertLinearToSRGB();
    this.col.set([c.r, c.g, c.b], i * 3);
    this.alpha[i] = 1;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  setScale(v) {
    this.material.uniforms.uScale.value = v;
  }

  update(dt) {
    const { pos, vel, life, alpha, maxLife } = this;
    const dragF = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.capacity; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const j = i * 3;
      if (life[i] <= 0) {
        pos[j + 1] = -999;
        alpha[i] = 0;
        continue;
      }
      vel[j + 1] -= this.gravity * dt;
      vel[j] *= dragF;
      vel[j + 1] *= dragF;
      vel[j + 2] *= dragF;
      pos[j] += vel[j] * dt;
      pos[j + 1] += vel[j + 1] * dt;
      pos[j + 2] += vel[j + 2] * dt;
      if (pos[j + 1] < 0.02 && pos[j + 1] > -0.5) {
        pos[j + 1] = 0.02;
        vel[j + 1] *= -0.3;
      }
      alpha[i] = life[i] / maxLife[i];
    }
    const attrs = this.points.geometry.attributes;
    attrs.position.needsUpdate = true;
    attrs.color.needsUpdate = true;
    attrs.alpha.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

// Estela del arma durante el golpe (cinta que se desvanece).
class SwingTrail {
  constructor(scene, color = '#ffffff') {
    this.samples = 12;
    this.base = [];
    this.tip = [];
    this.age = [];
    const verts = new Float32Array(this.samples * 2 * 3);
    const cols = new Float32Array(this.samples * 2 * 3);
    const idx = [];
    for (let i = 0; i < this.samples - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    this.color = new THREE.Color(color);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  push(base, tip) {
    this.base.unshift(base.clone());
    this.tip.unshift(tip.clone());
    this.age.unshift(0);
    if (this.base.length > this.samples) {
      this.base.pop();
      this.tip.pop();
      this.age.pop();
    }
  }

  update(dt) {
    for (let i = 0; i < this.age.length; i++) this.age[i] += dt;
    while (this.age.length && this.age[this.age.length - 1] > 0.18) {
      this.base.pop();
      this.tip.pop();
      this.age.pop();
    }
    const n = this.base.length;
    this.mesh.visible = n >= 2;
    if (n < 2) return;
    const pos = this.mesh.geometry.attributes.position.array;
    const col = this.mesh.geometry.attributes.color.array;
    for (let i = 0; i < this.samples; i++) {
      const k = Math.min(i, n - 1);
      const b = this.base[k];
      const t = this.tip[k];
      const fade = i < n ? Math.max(0, 1 - this.age[k] / 0.18) * (1 - i / this.samples) : 0;
      pos.set([b.x, b.y, b.z, t.x, t.y, t.z], i * 6);
      col.set(
        [this.color.r * fade * 0.2, this.color.g * fade * 0.2, this.color.b * fade * 0.2, this.color.r * fade, this.color.g * fade, this.color.b * fade],
        i * 6,
      );
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// ---------- Sangre de caricatura: manchas en la arena ----------
// Texturas de "splat" hechas en canvas: mancha irregular + gotitas, rojo brillante con brillo.
function splatTexture(seed) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let s = seed * 9973 + 1;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const blob = (cx, cy, r, color) => {
    g.fillStyle = color;
    g.beginPath();
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.75 + rnd() * 0.45);
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y);
      else g.quadraticCurveTo(cx + Math.cos(a - 0.2) * rr * 1.15, cy + Math.sin(a - 0.2) * rr * 1.15, x, y);
    }
    g.fill();
  };
  const drops = [];
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 26 + rnd() * 30;
    drops.push([S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 3 + rnd() * 6]);
  }
  // sombra oscura, cuerpo rojo y brillo: estilo caricatura
  for (const [color, grow] of [
    ['#7a0016', 2],
    ['#d4142f', 0],
  ]) {
    blob(S / 2, S / 2, 26 + grow, color);
    for (const [x, y, r] of drops) blob(x, y, r + grow * 0.5, color);
  }
  g.fillStyle = 'rgba(255,170,180,0.55)';
  g.beginPath();
  g.ellipse(S / 2 - 8, S / 2 - 9, 9, 5, -0.6, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class BloodSplats {
  constructor(scene, { max = 60, ringRadius = 10 } = {}) {
    this.scene = scene;
    this.max = max;
    this.ringRadius = ringRadius;
    this.textures = [1, 2, 3, 4].map(splatTexture);
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.geo.rotateX(-Math.PI / 2);
    this.items = [];
    this.layer = 0;
  }

  // (x, z) posición, (dx, dz) dirección del golpe, size en unidades
  add(x, z, dx, dz, size, life = 14) {
    if (Math.hypot(x, z) > this.ringRadius - 0.15) return; // fuera del ring se cae al vacío
    const mat = new THREE.MeshStandardMaterial({
      map: this.textures[Math.floor(Math.random() * this.textures.length)],
      transparent: true,
      depthWrite: false,
      roughness: 0.25,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const m = new THREE.Mesh(this.geo, mat);
    // Estirada en la dirección del golpe
    m.scale.set(size, 1, size * (1.2 + Math.random() * 0.5));
    m.rotation.y = Math.atan2(dx, dz) + (Math.random() - 0.5) * 0.4;
    this.layer = (this.layer + 1) % 50;
    m.position.set(x, 0.004 + this.layer * 0.0002, z);
    m.renderOrder = 0;
    m.receiveShadow = true;
    this.scene.add(m);
    this.items.push({ mesh: m, age: 0, life, grow: 0 });
    while (this.items.length > this.max) this.remove(this.items.shift());
  }

  remove(it) {
    this.scene.remove(it.mesh);
    it.mesh.material.dispose();
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      // "Splash": crece rápido al aparecer
      if (it.grow < 1) {
        it.grow = Math.min(1, it.grow + dt * 9);
        const k = 0.4 + 0.6 * it.grow;
        it.mesh.scale.x = it.mesh.scale.x / (it.prevK || 1) * k;
        it.mesh.scale.z = it.mesh.scale.z / (it.prevK || 1) * k;
        it.prevK = k;
      }
      const fade = it.life - it.age;
      if (fade < 3) it.mesh.material.opacity = Math.max(0, fade / 3);
      if (it.age >= it.life) {
        this.remove(it);
        this.items.splice(i, 1);
      }
    }
  }

  clear() {
    for (const it of this.items) this.remove(it);
    this.items = [];
  }

  dispose() {
    this.clear();
    this.geo.dispose();
    for (const t of this.textures) t.dispose();
  }
}

const SPARK = [new THREE.Color('#fff6c9'), new THREE.Color('#ffd25a'), new THREE.Color('#ff9a3d')];
const BLOOD = [new THREE.Color('#e0163a'), new THREE.Color('#b30c27'), new THREE.Color('#ff3b5c')];
const DUST = new THREE.Color('#b98a5a');

export class Effects {
  constructor(scene, { lowEnd = false } = {}) {
    this.scene = scene;
    this.lowEnd = lowEnd;
    this.sparks = new Particles(scene, { capacity: lowEnd ? 200 : 400, size: 0.16, additive: true, gravity: 9, drag: 2.5 });
    this.puffs = new Particles(scene, { capacity: lowEnd ? 200 : 400, size: 0.42, additive: false, gravity: -0.6, drag: 3 });
    this.drops = new Particles(scene, { capacity: lowEnd ? 150 : 300, size: 0.16, additive: false, gravity: 14, drag: 1 });
    this.splats = new BloodSplats(scene, { max: lowEnd ? 30 : 60 });
    this.trails = new Map();
    this.shake = 0;
  }

  // Salpicadura de caricatura: gotas que vuelan en la dirección del golpe + mancha en el suelo.
  blood(x, z, dx, dz, amount = 1) {
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len;
    const nz = dz / len;
    const n = Math.round((this.lowEnd ? 7 : 14) * Math.min(2, amount));
    for (let i = 0; i < n; i++) {
      const spread = (Math.random() - 0.5) * 1.6;
      const s = 2 + Math.random() * 3.5;
      const vx = (nx + -nz * spread) * s;
      const vz = (nz + nx * spread) * s;
      this.drops.emit(x, 1.0 + Math.random() * 0.4, z, vx, 1.5 + Math.random() * 2.5, vz, BLOOD[i % 3], 0.6 + Math.random() * 0.3);
    }
    // Mancha principal un poco detrás de la víctima + gotitas más lejos
    const size = 1.0 + 0.6 * Math.min(1.6, amount);
    this.splats.add(x + nx * 0.4, z + nz * 0.4, nx, nz, size);
    const extra = amount > 1.2 ? 4 : 3;
    for (let i = 0; i < extra; i++) {
      const d = 1.0 + Math.random() * 1.4;
      const side = (Math.random() - 0.5) * 0.9;
      this.splats.add(x + (nx + -nz * side) * d, z + (nz + nx * side) * d, nx, nz, 0.35 + Math.random() * 0.35);
    }
  }

  // Charco cuando alguien queda eliminado a cuchillazos
  pool(x, z) {
    this.splats.add(x, z, Math.random() - 0.5, Math.random() - 0.5, 2.6, 20);
  }

  trailFor(id, color) {
    if (!this.trails.has(id)) this.trails.set(id, new SwingTrail(this.scene, color));
    return this.trails.get(id);
  }

  sparksAt(p, count = 18, power = 5) {
    const n = this.lowEnd ? Math.ceil(count / 2) : count;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = power * (0.4 + Math.random());
      this.sparks.emit(p.x, p.y, p.z, Math.cos(a) * s, 1.5 + Math.random() * power, Math.sin(a) * s, SPARK[i % 3], 0.25 + Math.random() * 0.35);
    }
  }

  // Partículas cartoon de daño: confeti del color del bando.
  hitBurst(p, colorHex, count = 14) {
    const color = new THREE.Color(colorHex);
    const n = this.lowEnd ? Math.ceil(count / 2) : count;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * 2.5;
      this.puffs.emit(p.x, p.y, p.z, Math.cos(a) * s, 1 + Math.random() * 3, Math.sin(a) * s, i % 3 === 0 ? new THREE.Color('#ffffff') : color, 0.5 + Math.random() * 0.3);
    }
  }

  poof(p, colorHex) {
    const color = new THREE.Color(colorHex);
    const grey = new THREE.Color('#d8d0c8');
    for (let i = 0; i < (this.lowEnd ? 16 : 32); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 2;
      this.puffs.emit(p.x, p.y + Math.random(), p.z, Math.cos(a) * s, 0.5 + Math.random() * 1.5, Math.sin(a) * s, i % 2 ? grey : color, 0.8 + Math.random() * 0.5);
    }
    this.sparksAt(p, 24, 6);
  }

  dust(x, z) {
    if (Math.random() > (this.lowEnd ? 0.15 : 0.35)) return;
    this.puffs.emit(x + (Math.random() - 0.5) * 0.3, 0.08, z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.5, 0.4, (Math.random() - 0.5) * 0.5, DUST, 0.45);
  }

  shoveDust(x, z) {
    for (let i = 0; i < (this.lowEnd ? 5 : 10); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.8 + Math.random() * 1.2;
      this.puffs.emit(x, 0.1, z, Math.cos(a) * s, 0.3 + Math.random() * 0.5, Math.sin(a) * s, DUST, 0.5 + Math.random() * 0.3);
    }
  }

  addShake(amount) {
    this.shake = Math.min(0.6, this.shake + amount);
  }

  update(dt) {
    this.sparks.update(dt);
    this.puffs.update(dt);
    this.drops.update(dt);
    this.splats.update(dt);
    for (const t of this.trails.values()) t.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.8);
  }

  dispose() {
    this.sparks.dispose();
    this.puffs.dispose();
    this.drops.dispose();
    this.splats.dispose();
    for (const t of this.trails.values()) t.dispose();
  }
}
