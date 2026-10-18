import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const isLowEnd = () =>
  (navigator.hardwareConcurrency || 4) <= 4 || Math.min(screen.width, screen.height) < 500;

export function createRenderer(canvas, { shadows = true, alpha = false } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isLowEnd() || window.devicePixelRatio < 2,
    alpha,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isLowEnd() ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

// Mapa de entorno para que el metal de las armas brille.
const envCache = new WeakMap();
export function environmentFor(renderer) {
  if (envCache.has(renderer)) return envCache.get(renderer);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  envCache.set(renderer, env);
  return env;
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const key of ['map', 'emissiveMap', 'roughnessMap', 'normalMap']) m[key]?.dispose?.();
        m.dispose();
      }
    }
  });
}

export const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));

export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
