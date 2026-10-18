import * as THREE from 'three';

// Todas las armas se construyen a lo largo de +Z, con la empuñadura en el origen.
// `tip` marca la punta (sirve para los trazos del golpe).

const steel = () =>
  new THREE.MeshStandardMaterial({ color: '#e3e9f0', metalness: 1, roughness: 0.16, envMapIntensity: 1.4 });
const gold = () => new THREE.MeshStandardMaterial({ color: '#e0a92a', metalness: 1, roughness: 0.3 });
const wood = () => new THREE.MeshStandardMaterial({ color: '#7a4422', roughness: 0.75 });
const black = () => new THREE.MeshStandardMaterial({ color: '#1d1d22', roughness: 0.5, metalness: 0.2 });
const leather = () => new THREE.MeshStandardMaterial({ color: '#4a2a17', roughness: 0.9 });

const BLADES = {
  // espalda recta, filo curvo
  knife(L, w) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(-w / 2, L * 0.92);
    s.lineTo(-w * 0.35, L);
    s.quadraticCurveTo(w * 0.7, L * 0.55, w / 2, 0);
    s.lineTo(-w / 2, 0);
    return s;
  },
  // doble filo simétrico
  dagger(L, w) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(w * 0.3, L * 0.8);
    s.lineTo(0, L);
    s.lineTo(-w * 0.3, L * 0.8);
    s.lineTo(-w / 2, 0);
    return s;
  },
  // punta recortada
  switchblade(L, w) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(w / 2, L * 0.82);
    s.lineTo(0, L);
    s.lineTo(-w / 2, L * 0.72);
    s.lineTo(-w / 2, 0);
    return s;
  },
  shortsword(L, w) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(w * 0.42, L * 0.86);
    s.lineTo(0, L);
    s.lineTo(-w * 0.42, L * 0.86);
    s.lineTo(-w / 2, 0);
    return s;
  },
};

function bladeMesh(kind, L, w) {
  const depth = 0.022;
  const geo = new THREE.ExtrudeGeometry(BLADES[kind](L, w), {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 1,
    curveSegments: 8,
  });
  geo.translate(0, 0, -depth / 2);
  geo.rotateX(Math.PI / 2); // largo en +Z, plano horizontal
  const mesh = new THREE.Mesh(geo, steel());
  mesh.castShadow = true;
  return mesh;
}

function handleMesh(len, r, material) {
  const geo = new THREE.CylinderGeometry(r, r * 1.1, len, 10);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, -len / 2);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  return m;
}

function box(w, hgt, d, material, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), material);
  m.position.z = z;
  m.castShadow = true;
  return m;
}

const SPECS = {
  knife: { L: 0.46, w: 0.1, handle: 0.22, r: 0.035, handleMat: wood },
  dagger: { L: 0.36, w: 0.11, handle: 0.17, r: 0.03, handleMat: black },
  switchblade: { L: 0.4, w: 0.075, handle: 0.24, r: 0.03, handleMat: black },
  shortsword: { L: 0.82, w: 0.13, handle: 0.22, r: 0.035, handleMat: leather },
};

export function buildWeapon(id) {
  const spec = SPECS[id] || SPECS.knife;
  const group = new THREE.Group();
  group.name = `weapon-${id}`;
  const blade = bladeMesh(id in BLADES ? id : 'knife', spec.L, spec.w);
  blade.position.z = 0.015;
  group.add(blade);
  // Empuñadura centrada en la mano
  const handle = handleMesh(spec.handle, spec.r, spec.handleMat());
  handle.position.z = spec.handle / 2;
  const grip = new THREE.Group();
  grip.add(handle);
  grip.position.z = -spec.handle / 2;
  group.add(grip);

  if (id === 'dagger') {
    group.add(box(0.22, 0.04, 0.04, gold(), 0));
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), gold());
    pommel.position.z = -spec.handle;
    group.add(pommel);
  } else if (id === 'shortsword') {
    group.add(box(0.32, 0.05, 0.05, gold(), 0));
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), gold());
    pommel.position.z = -spec.handle - 0.02;
    group.add(pommel);
    // acanaladura
    const fuller = box(0.025, 0.035, spec.L * 0.6, new THREE.MeshStandardMaterial({ color: '#9aa6b5', metalness: 1, roughness: 0.3 }), spec.L * 0.35);
    group.add(fuller);
  } else if (id === 'switchblade') {
    group.add(box(0.09, 0.07, 0.05, steel(), -0.01));
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.08, 8), gold());
    pin.position.z = -0.03;
    group.add(pin);
  } else {
    group.add(box(0.11, 0.06, 0.03, steel(), 0));
  }

  const tip = new THREE.Object3D();
  tip.position.z = spec.L + 0.015;
  group.add(tip);
  group.userData.tip = tip;
  group.userData.length = spec.L;
  return group;
}
