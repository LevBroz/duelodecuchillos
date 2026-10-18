import * as THREE from 'three';
import { GAME } from '../../../shared/index.js';

// Textura de arena procedural (canvas) para no depender de imágenes.
function sandTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.5);
  grad.addColorStop(0, '#e9c48a');
  grad.addColorStop(0.75, '#d9ab6c');
  grad.addColorStop(0.93, '#b98450');
  grad.addColorStop(1, '#8a5a32');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  // granitos
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const l = Math.random();
    g.fillStyle = l > 0.5 ? `rgba(255,240,210,${0.08 + Math.random() * 0.12})` : `rgba(90,50,20,${0.06 + Math.random() * 0.1})`;
    g.fillRect(x, y, 1.5, 1.5);
  }
  // marcas de pelea (rayones suaves)
  g.strokeStyle = 'rgba(120,70,30,0.12)';
  g.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * size * 0.35;
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r;
    g.beginPath();
    g.arc(x, y, 10 + Math.random() * 30, Math.random() * 6, Math.random() * 6);
    g.stroke();
  }
  // círculo central + cuchillos cruzados
  g.strokeStyle = 'rgba(110,55,20,0.35)';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.13, 0, Math.PI * 2);
  g.stroke();
  g.save();
  g.translate(size / 2, size / 2);
  g.fillStyle = 'rgba(110,55,20,0.3)';
  for (const rot of [Math.PI / 4, -Math.PI / 4]) {
    g.save();
    g.rotate(rot);
    g.beginPath();
    g.moveTo(-6, size * 0.1);
    g.lineTo(6, size * 0.1);
    g.lineTo(6, -size * 0.04);
    g.lineTo(0, -size * 0.1);
    g.lineTo(-6, -size * 0.04);
    g.closePath();
    g.fill();
    g.fillRect(-14, size * 0.03, 28, 6);
    g.restore();
  }
  g.restore();
  // franja de peligro en el borde
  g.strokeStyle = 'rgba(160,40,20,0.35)';
  g.lineWidth = size * 0.012;
  g.setLineDash([size * 0.03, size * 0.02]);
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.47, 0, Math.PI * 2);
  g.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#2b1640');
  grad.addColorStop(0.45, '#a8432a');
  grad.addColorStop(0.75, '#f08a3c');
  grad.addColorStop(1, '#ffd08a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildArena(scene, { lowEnd = false } = {}) {
  const R = GAME.RING_RADIUS;
  scene.background = skyTexture();
  scene.fog = new THREE.Fog('#4a2416', 26, 60);

  // Luz cálida de atardecer
  const hemi = new THREE.HemisphereLight('#ffd7a8', '#3b1d10', 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffb36b', 2.6);
  sun.position.set(14, 18, 8);
  sun.castShadow = true;
  const sm = lowEnd ? 1024 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -R - 3;
  cam.right = cam.top = R + 3;
  cam.near = 1;
  cam.far = 60;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 4;
  scene.add(sun);
  const rim = new THREE.DirectionalLight('#8a6cff', 0.5);
  rim.position.set(-12, 8, -10);
  scene.add(rim);

  // Suelo alrededor (más abajo: si te caés, te vas al hoyo)
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(80, 48),
    new THREE.MeshStandardMaterial({ color: '#3a2015', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2.2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Decoración alrededor: piedras y cactus (instanciados, baratos)
  const decoRocks = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.8, 0),
    new THREE.MeshStandardMaterial({ color: '#6e5440', roughness: 1 }),
    lowEnd ? 18 : 36,
  );
  const cactusMat = new THREE.MeshStandardMaterial({ color: '#4f8a3c', roughness: 0.8 });
  const cactusGeo = new THREE.CapsuleGeometry(0.35, 1.8, 4, 10);
  const armGeo = new THREE.CapsuleGeometry(0.22, 0.7, 4, 8);
  const tmp = new THREE.Object3D();
  for (let i = 0; i < decoRocks.count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = R + 3 + Math.random() * 16;
    tmp.position.set(Math.cos(a) * r, -2.1, Math.sin(a) * r);
    tmp.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    tmp.scale.setScalar(0.5 + Math.random() * 1.4);
    tmp.updateMatrix();
    decoRocks.setMatrixAt(i, tmp.matrix);
  }
  decoRocks.receiveShadow = true;
  scene.add(decoRocks);
  for (let i = 0; i < (lowEnd ? 5 : 9); i++) {
    const a = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
    const r = R + 5 + Math.random() * 10;
    const cactus = new THREE.Group();
    const trunk = new THREE.Mesh(cactusGeo, cactusMat);
    trunk.position.y = 1.2;
    cactus.add(trunk);
    for (const side of [-1, 1]) {
      if (Math.random() < 0.3) continue;
      const arm = new THREE.Mesh(armGeo, cactusMat);
      arm.position.set(side * 0.55, 1.2 + Math.random() * 0.6, 0);
      cactus.add(arm);
    }
    cactus.position.set(Math.cos(a) * r, -2.2, Math.sin(a) * r);
    cactus.scale.setScalar(0.8 + Math.random() * 0.6);
    cactus.traverse((o) => (o.castShadow = true));
    scene.add(cactus);
  }

  // Plataforma del ring
  const ringMat = new THREE.MeshStandardMaterial({ map: sandTexture(lowEnd ? 512 : 1024), roughness: 0.95 });
  const sideMat = new THREE.MeshStandardMaterial({ color: '#7a5236', roughness: 0.9 });
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.96, 2, 72, 1), [sideMat, ringMat, sideMat]);
  platform.position.y = -1;
  platform.receiveShadow = true;
  scene.add(platform);

  // Piedras en el costado
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#8c7a6a', roughness: 0.9 });
  const stoneGeo = new THREE.DodecahedronGeometry(0.45, 0);
  const stones = new THREE.InstancedMesh(stoneGeo, stoneMat, 40);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, 0));
    const s = 0.8 + Math.random() * 0.5;
    m4.compose(
      new THREE.Vector3(Math.cos(a) * (R * 0.99), -1.2 + Math.random() * 0.5, Math.sin(a) * (R * 0.99)),
      q,
      new THREE.Vector3(s, s * 0.8, s),
    );
    stones.setMatrixAt(i, m4);
  }
  stones.castShadow = true;
  scene.add(stones);

  // Borde de madera
  const woodMat = new THREE.MeshStandardMaterial({ color: '#7a4a26', roughness: 0.8 });
  const rimMesh = new THREE.Mesh(new THREE.TorusGeometry(R, 0.14, 10, 120), woodMat);
  rimMesh.rotation.x = Math.PI / 2;
  rimMesh.position.y = 0.04;
  rimMesh.castShadow = true;
  rimMesh.receiveShadow = true;
  scene.add(rimMesh);

  // Postes con antorchas y cuerda (decorativos, por fuera del borde)
  const posts = 10;
  const postGeo = new THREE.CylinderGeometry(0.12, 0.15, 1.3, 10);
  const metal = new THREE.MeshStandardMaterial({ color: '#5a5f66', metalness: 0.9, roughness: 0.35 });
  const flameMat = new THREE.MeshStandardMaterial({ color: '#ffb347', emissive: '#ff7a1a', emissiveIntensity: 2.5 });
  const flames = [];
  const torchLights = [];
  const ropePoints = [];
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    const x = Math.cos(a) * (R + 0.35);
    const z = Math.sin(a) * (R + 0.35);
    const post = new THREE.Mesh(postGeo, woodMat);
    post.position.set(x, 0.45, z);
    post.castShadow = true;
    scene.add(post);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.1, 0.18, 10), metal);
    cup.position.set(x, 1.15, z);
    scene.add(cup);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 8), flameMat);
    flame.position.set(x, 1.42, z);
    scene.add(flame);
    flames.push(flame);
    if (!lowEnd && i % 2 === 0) {
      const l = new THREE.PointLight('#ff8a3d', 3, 7, 2);
      l.position.set(x, 1.7, z);
      scene.add(l);
      torchLights.push(l);
    }
    ropePoints.push(new THREE.Vector3(x, 0.8, z));
  }
  ropePoints.push(ropePoints[0].clone());
  const rope = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ropePoints, true), 120, 0.035, 6, true),
    new THREE.MeshStandardMaterial({ color: '#c9a36b', roughness: 1 }),
  );
  scene.add(rope);

  let t = 0;
  return {
    update(dt) {
      t += dt;
      flames.forEach((f, i) => {
        const s = 1 + Math.sin(t * 12 + i * 1.7) * 0.12;
        f.scale.set(s, 1 + Math.sin(t * 9 + i) * 0.2, s);
      });
      torchLights.forEach((l, i) => (l.intensity = 2.6 + Math.sin(t * 14 + i * 2) * 0.5));
    },
  };
}
