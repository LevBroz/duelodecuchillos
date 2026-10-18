import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CHARACTER_TYPES, COLORS, findById } from '../../../shared/index.js';
import { buildWeapon } from './weapons.js';

// Personajes cartoon hechos con primitivas. Miran hacia +Z y tienen los pies en y = 0.

const HAIR = '#3b2414';
const MOUNT_IDLE = 0.15; // arma casi horizontal con el brazo abajo
const MOUNT_SWING = Math.PI / 2; // +Z del arma → a lo largo del brazo
const FUR = { fox: '#e8742e', bear: '#8b5a2b', rabbit: '#ece6dc', wolf: '#8d96a3', cat: '#f0a64b', owl: '#9c6b3c' };
const ALIEN_SKIN = '#8be36b';
const METAL = '#a3aebb';

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...opts });
}

function mesh(geo, material, { shadow = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = shadow;
  m.receiveShadow = false;
  return m;
}

const sphere = (r, ws = 20, hs = 14) => new THREE.SphereGeometry(r, ws, hs);
const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 14);

function eye(r = 0.055) {
  const g = new THREE.Group();
  const ball = mesh(sphere(r, 12, 10), mat('#111111', { roughness: 0.25 }), { shadow: false });
  ball.scale.z = 0.6;
  const shine = mesh(sphere(r * 0.32, 8, 6), mat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.6 }), { shadow: false });
  shine.position.set(r * 0.35, r * 0.35, r * 0.45);
  g.add(ball, shine);
  return g;
}

// Pone un objeto sobre la superficie de una esfera de radio r, en ángulos (yaw, pitch).
function onSphere(obj, r, yaw, pitch) {
  obj.position.set(Math.sin(yaw) * Math.cos(pitch) * r, Math.sin(pitch) * r, Math.cos(yaw) * Math.cos(pitch) * r);
  obj.lookAt(obj.position.clone().multiplyScalar(2));
  return obj;
}

// ---------- Cabezas ----------
// Cada constructor devuelve { group, top, eyeY, front, radius } relativos al centro de la cabeza.

function humanHead(c) {
  const skinOpt = findById(findById(CHARACTER_TYPES, 'human').variantGroups[0].options, c.variants.skin);
  const skin = mat(skinOpt?.hex || '#e0ac7e');
  const r = 0.33;
  const g = new THREE.Group();
  g.add(mesh(sphere(r), skin));
  const eL = onSphere(eye(), r, -0.32, 0.05);
  const eR = onSphere(eye(), r, 0.32, 0.05);
  const nose = onSphere(mesh(sphere(0.05, 10, 8), skin), r, 0, -0.12);
  g.add(eL, eR, nose);
  const earL = mesh(sphere(0.07, 10, 8), skin);
  earL.position.set(-r, 0, 0);
  const earR = earL.clone();
  earR.position.x = r;
  g.add(earL, earR);

  const hairMat = mat(HAIR, { roughness: 0.85 });
  const hair = c.variants.hair;
  if (hair !== 'bald') {
    const cap = mesh(new THREE.SphereGeometry(r * 1.06, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), hairMat);
    cap.rotation.x = -0.25;
    g.add(cap);
  }
  if (hair === 'long') {
    const back = mesh(new RoundedBoxGeometry(0.62, 0.55, 0.22, 3, 0.1), hairMat);
    back.position.set(0, -0.12, -0.2);
    g.add(back);
  } else if (hair === 'mohawk') {
    for (let i = 0; i < 5; i++) {
      const spike = mesh(new THREE.ConeGeometry(0.06, 0.24, 8), hairMat);
      const a = -0.5 + i * 0.32;
      spike.position.set(0, Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05);
      spike.rotation.x = a;
      g.add(spike);
    }
  } else if (hair === 'bun') {
    const bun = mesh(sphere(0.13, 12, 10), hairMat);
    bun.position.set(0, r * 0.85, -r * 0.55);
    g.add(bun);
  }
  return { group: g, top: r * (hair === 'mohawk' ? 1.25 : 1.04), eyeY: 0.02, front: r, radius: r };
}

function animalHead(c) {
  const species = c.variants.species;
  const fur = mat(FUR[species] || '#999999', { roughness: 0.85 });
  const light = mat('#fff3e6', { roughness: 0.85 });
  const dark = mat('#2a1a10', { roughness: 0.6 });
  const r = species === 'bear' ? 0.36 : 0.33;
  const g = new THREE.Group();
  const head = mesh(sphere(r), fur);
  g.add(head);
  let eyeYaw = 0.34;
  let eyeScale = 1;

  const ear = (geo, x, y, z, rz = 0, material = fur) => {
    const e = mesh(geo, material);
    e.position.set(x, y, z);
    e.rotation.z = rz;
    g.add(e);
    return e;
  };

  if (species === 'fox' || species === 'wolf' || species === 'cat') {
    const h = species === 'cat' ? 0.2 : 0.28;
    const w = species === 'cat' ? 0.11 : 0.12;
    ear(new THREE.ConeGeometry(w, h, 4), -0.2, r * 0.85, 0, 0.35);
    ear(new THREE.ConeGeometry(w, h, 4), 0.2, r * 0.85, 0, -0.35);
    const snoutLen = species === 'cat' ? 0.12 : species === 'fox' ? 0.24 : 0.22;
    const snout = mesh(new THREE.ConeGeometry(0.13, snoutLen, 12), species === 'wolf' ? mat('#c9ced6') : light);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, -0.08, r + snoutLen / 2 - 0.06);
    g.add(snout);
    const nose = mesh(sphere(0.04, 8, 6), dark);
    nose.position.set(0, -0.06, r + snoutLen - 0.05);
    g.add(nose);
    if (species === 'cat') {
      for (const side of [-1, 1]) {
        for (const tilt of [-0.15, 0.15]) {
          const whisker = mesh(new THREE.BoxGeometry(0.22, 0.008, 0.008), dark, { shadow: false });
          whisker.position.set(side * 0.16, -0.08, r - 0.02);
          whisker.rotation.z = side * tilt;
          g.add(whisker);
        }
      }
    }
  } else if (species === 'bear') {
    ear(sphere(0.1, 12, 10), -0.25, r * 0.8, 0);
    ear(sphere(0.1, 12, 10), 0.25, r * 0.8, 0);
    const snout = mesh(sphere(0.14, 14, 10), light);
    snout.scale.set(1, 0.75, 0.8);
    snout.position.set(0, -0.1, r - 0.04);
    g.add(snout);
    const nose = mesh(sphere(0.05, 8, 6), dark);
    nose.position.set(0, -0.05, r + 0.07);
    g.add(nose);
  } else if (species === 'rabbit') {
    for (const side of [-1, 1]) {
      const e = mesh(capsule(0.07, 0.38), fur);
      e.position.set(side * 0.12, r + 0.22, -0.04);
      e.rotation.z = -side * 0.15;
      g.add(e);
      const inner = mesh(capsule(0.04, 0.3), mat('#ffb3c1'));
      inner.position.set(side * 0.12, r + 0.22, 0.01);
      inner.rotation.z = -side * 0.15;
      g.add(inner);
    }
    const nose = mesh(sphere(0.045, 8, 6), mat('#ff7f9e'));
    nose.position.set(0, -0.06, r - 0.01);
    g.add(nose);
    const teeth = mesh(new THREE.BoxGeometry(0.08, 0.07, 0.02), mat('#ffffff'));
    teeth.position.set(0, -0.15, r - 0.04);
    g.add(teeth);
  } else if (species === 'owl') {
    eyeScale = 1.5;
    eyeYaw = 0.36;
    for (const side of [-1, 1]) {
      const disc = mesh(new THREE.CircleGeometry(0.13, 20), light, { shadow: false });
      onSphere(disc, r + 0.005, side * 0.36, 0.06);
      g.add(disc);
      const tuft = mesh(new THREE.ConeGeometry(0.07, 0.2, 6), fur);
      tuft.position.set(side * 0.2, r * 0.9, 0);
      tuft.rotation.z = -side * 0.5;
      g.add(tuft);
    }
    const beak = mesh(new THREE.ConeGeometry(0.06, 0.15, 8), mat('#f2b134'));
    beak.rotation.x = Math.PI / 2 + 0.6;
    beak.position.set(0, -0.08, r + 0.03);
    g.add(beak);
  }
  const eL = onSphere(eye(0.055 * eyeScale), r, -eyeYaw, 0.08);
  const eR = onSphere(eye(0.055 * eyeScale), r, eyeYaw, 0.08);
  g.add(eL, eR);
  const top = species === 'rabbit' ? r + 0.45 : r * 1.1;
  return { group: g, top, eyeY: 0.03, front: r, radius: r, earsTall: species === 'rabbit' };
}

function robotHead(c) {
  const metal = mat(METAL, { metalness: 0.85, roughness: 0.3 });
  const glow = mat('#55f1ff', { emissive: '#55f1ff', emissiveIntensity: 2.2 });
  const g = new THREE.Group();
  const w = 0.56;
  g.add(mesh(new RoundedBoxGeometry(w, 0.5, 0.5, 4, 0.08), metal));
  const head = c.variants.head;
  if (head === 'antenna') {
    const rod = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 8), metal);
    rod.position.y = 0.36;
    const bulb = mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), mat('#ff4d4d', { emissive: '#ff4d4d', emissiveIntensity: 1.5 }));
    bulb.position.y = 0.5;
    g.add(rod, bulb);
    for (const x of [-0.12, 0.12]) {
      const e = mesh(new THREE.BoxGeometry(0.1, 0.1, 0.02), glow, { shadow: false });
      e.position.set(x, 0.03, 0.255);
      g.add(e);
    }
  } else if (head === 'leds') {
    for (const x of [-0.13, 0.13]) {
      const e = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.04, 16), glow, { shadow: false });
      e.rotation.x = Math.PI / 2;
      e.position.set(x, 0.04, 0.26);
      g.add(e);
    }
  } else {
    const visor = mesh(new RoundedBoxGeometry(0.5, 0.14, 0.06, 2, 0.03), glow, { shadow: false });
    visor.position.set(0, 0.04, 0.24);
    g.add(visor);
  }
  const mouth = mesh(new THREE.BoxGeometry(0.22, 0.03, 0.02), mat('#222831'), { shadow: false });
  mouth.position.set(0, -0.13, 0.255);
  g.add(mouth);
  for (const x of [-w / 2, w / 2]) {
    const bolt = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 10), metal);
    bolt.rotation.z = Math.PI / 2;
    bolt.position.x = x;
    g.add(bolt);
  }
  return { group: g, top: head === 'antenna' ? 0.56 : 0.26, eyeY: 0.04, front: 0.26, radius: 0.3 };
}

function alienHead(c) {
  const skin = mat(ALIEN_SKIN, { roughness: 0.4 });
  const g = new THREE.Group();
  const form = c.variants.form;
  const r = 0.33;
  const head = mesh(sphere(r), skin);
  g.add(head);
  let top = r;
  if (form === 'longHead') {
    head.scale.set(0.95, 1.5, 1.05);
    head.position.set(0, 0.12, -0.06);
    head.rotation.x = -0.35;
    top = r * 1.6;
    g.add(onSphere(eye(0.08), r, -0.3, 0.02), onSphere(eye(0.08), r, 0.3, 0.02));
  } else if (form === 'threeEyes') {
    g.add(onSphere(eye(0.06), r, -0.38, 0.02), onSphere(eye(0.06), r, 0.38, 0.02), onSphere(eye(0.075), r, 0, 0.32));
  } else {
    for (const side of [-1, 1]) {
      const stalk = mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.32, 8), skin);
      stalk.position.set(side * 0.13, r + 0.12, 0.05);
      stalk.rotation.z = -side * 0.3;
      const ball = mesh(sphere(0.07, 12, 10), mat('#ffffff'));
      ball.position.set(side * 0.18, r + 0.28, 0.07);
      const pupil = eye(0.04);
      pupil.position.set(side * 0.18, r + 0.28, 0.13);
      g.add(stalk, ball, pupil);
    }
    top = r + 0.36;
  }
  const mouth = mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 16, Math.PI), mat('#1d3b14'), { shadow: false });
  onSphere(mouth, r, 0, -0.3);
  mouth.rotateZ(Math.PI);
  g.add(mouth);
  return { group: g, top, eyeY: 0.02, front: r, radius: r };
}

// ---------- Accesorios ----------
function addAccessory(id, headInfo, mainHex, parentHead, body) {
  const { top, eyeY, front, radius } = headInfo;
  if (id === 'hat') {
    const dark = mat('#2b2320', { roughness: 0.8 });
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(radius * 1.35, radius * 1.35, 0.04, 24), dark));
    const crown = mesh(new THREE.CylinderGeometry(radius * 0.8, radius * 0.85, 0.26, 20), dark);
    crown.position.y = 0.14;
    const band = mesh(new THREE.CylinderGeometry(radius * 0.86, radius * 0.86, 0.06, 20), mat(mainHex));
    band.position.y = 0.05;
    g.add(crown, band);
    g.position.y = Math.min(top, radius * 1.05) - 0.02;
    g.rotation.z = 0.12;
    parentHead.add(g);
  } else if (id === 'glasses') {
    const frame = mat('#111111', { metalness: 0.4, roughness: 0.3 });
    const lens = mat('#9fe3ff', { transparent: true, opacity: 0.35, metalness: 0.2, roughness: 0.05 });
    const g = new THREE.Group();
    for (const x of [-0.12, 0.12]) {
      const ring = mesh(new THREE.TorusGeometry(0.085, 0.018, 8, 20), frame, { shadow: false });
      ring.position.x = x;
      const glass = mesh(new THREE.CircleGeometry(0.08, 16), lens, { shadow: false });
      glass.position.set(x, 0, 0.005);
      g.add(ring, glass);
    }
    const bridge = mesh(new THREE.BoxGeometry(0.08, 0.018, 0.018), frame, { shadow: false });
    g.add(bridge);
    g.position.set(0, eyeY, front + 0.03);
    parentHead.add(g);
  } else if (id === 'scarf') {
    const color = mainHex.toLowerCase() === '#e63946' ? '#f1f1f1' : '#e63946';
    const m = mat(color, { roughness: 0.9 });
    const ring = mesh(new THREE.TorusGeometry(0.25, 0.08, 10, 24), m);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.3;
    const tail = mesh(new RoundedBoxGeometry(0.13, 0.36, 0.06, 2, 0.03), m);
    tail.position.set(0.14, 1.12, 0.26);
    tail.rotation.z = 0.15;
    body.add(ring, tail);
  } else if (id === 'crown') {
    const goldM = mat('#f0b429', { metalness: 1, roughness: 0.25 });
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.12, 20, 1, true), goldM));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const spike = mesh(new THREE.ConeGeometry(0.045, 0.13, 6), goldM);
      spike.position.set(Math.sin(a) * 0.19, 0.12, Math.cos(a) * 0.19);
      g.add(spike);
      const gem = mesh(sphere(0.025, 8, 6), mat(i % 2 ? '#ff3b6b' : '#3bd1ff', { emissive: i % 2 ? '#ff3b6b' : '#3bd1ff', emissiveIntensity: 0.6 }), { shadow: false });
      gem.position.set(Math.sin(a) * 0.2, 0.0, Math.cos(a) * 0.2);
      g.add(gem);
    }
    g.position.y = (headInfo.earsTall ? radius : Math.min(top, radius * 1.6)) + 0.02;
    g.rotation.z = -0.1;
    parentHead.add(g);
  }
}

// ---------- Rig ----------
export class CharacterRig {
  constructor(character) {
    this.character = character;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.mats = [];
    this.walkPhase = Math.random() * 10;
    this.swingT = 1;
    this.flashT = 0;
    this.deadT = -1;
    this.fall = false;
    this.time = Math.random() * 10;
    this.build(character);
    this.root.traverse((o) => {
      if (o.material && !this.mats.includes(o.material)) this.mats.push(o.material);
    });
    for (const m of this.mats) m.userData.baseEmissive = m.emissive ? m.emissive.clone() : null;
    for (const m of this.mats) m.userData.baseEmissiveIntensity = m.emissiveIntensity ?? 1;
  }

  build(c) {
    const mainHex = findById(COLORS, c.color)?.hex || '#3a86ff';
    const main = mat(mainHex, { roughness: 0.55 });
    const isGhost = c.type === 'ghost';
    this.isGhost = isGhost;

    let limb;
    if (c.type === 'human') {
      const skinOpt = findById(findById(CHARACTER_TYPES, 'human').variantGroups[0].options, c.variants.skin);
      limb = mat(skinOpt?.hex || '#e0ac7e');
    } else if (c.type === 'animal') limb = mat(FUR[c.variants.species] || '#999', { roughness: 0.85 });
    else if (c.type === 'robot') limb = mat(METAL, { metalness: 0.85, roughness: 0.3 });
    else if (c.type === 'alien') limb = mat(ALIEN_SKIN, { roughness: 0.4 });
    else limb = main;

    let headInfo;
    if (isGhost) {
      headInfo = this.buildGhost(c, mainHex);
    } else {
      // Piernas
      const legMat = c.type === 'robot' ? limb : c.type === 'human' ? mat('#2c3e66', { roughness: 0.8 }) : limb;
      this.legs = [-0.15, 0.15].map((x) => {
        const pivot = new THREE.Group();
        pivot.position.set(x, 0.45, 0);
        const leg = mesh(capsule(0.11, 0.24), legMat);
        leg.position.y = -0.24;
        const foot = mesh(sphere(0.12, 12, 8), mat('#2a1a12', { roughness: 0.9 }));
        foot.scale.set(1, 0.6, 1.4);
        foot.position.set(0, -0.42, 0.04);
        pivot.add(leg, foot);
        this.body.add(pivot);
        return pivot;
      });
      // Torso
      const torsoGeo = c.type === 'robot' ? new RoundedBoxGeometry(0.66, 0.66, 0.46, 4, 0.12) : capsule(0.33, 0.32);
      const torso = mesh(torsoGeo, c.type === 'robot' ? mat(mainHex, { metalness: 0.5, roughness: 0.35 }) : main);
      torso.position.y = 0.85;
      this.body.add(torso);
      if (c.type === 'animal' || c.type === 'human') {
        const belly = mesh(sphere(0.22, 14, 10), c.type === 'animal' ? mat('#fff3e6', { roughness: 0.9 }) : mat('#ffffff', { roughness: 0.7 }));
        belly.scale.set(1, 1.1, 0.5);
        belly.position.set(0, 0.85, 0.2);
        if (c.type === 'animal') this.body.add(belly);
      }
      if (c.type === 'robot') {
        const neck = mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.2, 12), limb);
        neck.position.y = 1.24;
        this.body.add(neck);
        const panel =mesh(new THREE.BoxGeometry(0.3, 0.18, 0.02), mat('#1d2630', { emissive: '#3dff9a', emissiveIntensity: 0.4 }), { shadow: false });
        panel.position.set(0, 0.92, 0.235);
        this.body.add(panel);
      }
      if (c.type === 'animal') {
        const tailLen = c.variants.species === 'rabbit' || c.variants.species === 'bear' ? 0 : 0.42;
        const tail =
          tailLen > 0
            ? mesh(capsule(c.variants.species === 'fox' ? 0.1 : 0.06, tailLen), limb)
            : mesh(sphere(0.1, 10, 8), mat('#ffffff', { roughness: 0.95 }));
        tail.position.set(0, 0.6, -0.36);
        tail.rotation.x = tailLen > 0 ? -1.0 : 0;
        this.body.add(tail);
        this.tail = tail;
      }
      // Cabeza
      const head = new THREE.Group();
      head.position.y = 1.5;
      const info =
        c.type === 'human' ? humanHead(c) : c.type === 'animal' ? animalHead(c) : c.type === 'robot' ? robotHead(c) : alienHead(c);
      head.add(info.group);
      this.body.add(head);
      this.head = head;
      headInfo = info;
      // Brazos
      this.buildArms(limb, 1.12, 0.42);
    }

    addAccessory(c.accessory, headInfo, mainHex, this.head, this.body);

    // Arma en la mano derecha
    const weapon = buildWeapon(c.weapon);
    // En reposo el arma apunta al frente; al golpear se alinea con el brazo (ver update).
    const mount = new THREE.Group();
    mount.rotation.x = MOUNT_IDLE;
    weapon.position.z = 0.11; // la mano queda al centro de la empuñadura
    mount.add(weapon);
    this.hand.add(mount);
    this.mount = mount;
    this.weapon = weapon;
    this.tip = weapon.userData.tip;

    // Sombra de contacto suave (barata) bajo los pies
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 24),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.012;
    blob.renderOrder = 1;
    this.root.add(blob);
    this.blob = blob;

    this.headTop = 1.5 + (headInfo?.top ?? 0.35);
  }

  buildArms(material, shoulderY, len) {
    const makeArm = (x) => {
      const swing = new THREE.Group();
      swing.position.set(x, shoulderY, 0);
      const pivot = new THREE.Group();
      swing.add(pivot);
      const arm = mesh(capsule(0.085, len - 0.12), material);
      arm.position.y = -len / 2;
      const hand = new THREE.Group();
      hand.position.y = -len;
      const fist = mesh(sphere(0.1, 12, 10), material);
      hand.add(fist);
      pivot.add(arm, hand);
      this.body.add(swing);
      return { swing, pivot, hand };
    };
    this.armL = makeArm(0.42);
    this.armR = makeArm(-0.42);
    this.armL.pivot.rotation.z = 0.15;
    this.armR.pivot.rotation.z = -0.15;
    this.hand = this.armR.hand;
  }

  buildGhost(c, mainHex) {
    const style = c.variants.style;
    const sheetColor = new THREE.Color('#f4f1ff').lerp(new THREE.Color(mainHex), style === 'hood' ? 0.85 : 0.22);
    if (style === 'hood') sheetColor.multiplyScalar(0.55);
    const sheet = mat(sheetColor, { roughness: 0.8, transparent: style !== 'hood', opacity: style === 'hood' ? 1 : 0.9 });
    // Perfil de campana con borde ondulado (Lathe)
    const pts = [];
    pts.push(new THREE.Vector2(0.0, 1.95));
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const y = 1.95 - t * 1.75;
      const r = Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) * 0.42 + t * 0.08;
      pts.push(new THREE.Vector2(r, y));
    }
    pts.push(new THREE.Vector2(0.5, 0.18));
    const geo = new THREE.LatheGeometry(pts, 28);
    // borde ondulado
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < 0.3) {
        const a = Math.atan2(pos.getZ(i), pos.getX(i));
        pos.setY(i, y + Math.sin(a * 7) * 0.06);
      }
    }
    geo.computeVertexNormals();
    const body = mesh(geo, sheet);
    body.material.side = THREE.DoubleSide;
    this.body.add(body);
    this.ghostBody = body;

    const head = new THREE.Group();
    head.position.y = 1.5;
    this.body.add(head);
    this.head = head;

    if (style === 'hood') {
      const face = mesh(sphere(0.27, 18, 12), mat('#07060a', { roughness: 1 }), { shadow: false });
      face.scale.set(1, 1, 0.5);
      face.position.set(0, 0.0, 0.28);
      head.add(face);
      const glow = mat(mainHex, { emissive: mainHex, emissiveIntensity: 3 });
      for (const x of [-0.09, 0.09]) {
        const e = mesh(sphere(0.045, 10, 8), glow, { shadow: false });
        e.position.set(x, 0.03, 0.38);
        head.add(e);
      }
      const light = new THREE.PointLight(mainHex, 1.2, 2.2, 2);
      light.position.set(0, 0.0, 0.5);
      head.add(light);
      const tip = mesh(new THREE.ConeGeometry(0.2, 0.35, 16), sheet);
      tip.position.set(0, 0.42, -0.1);
      tip.rotation.x = -0.5;
      head.add(tip);
    } else {
      for (const x of [-0.13, 0.13]) {
        const e = mesh(sphere(0.07, 12, 10), mat('#111111', { roughness: 0.3 }), { shadow: false });
        e.scale.set(0.8, 1.2, 0.5);
        e.position.set(x, 0.05, 0.4);
        head.add(e);
      }
      const mouth = mesh(sphere(0.06, 10, 8), mat('#111111'), { shadow: false });
      mouth.scale.set(1, 1.3, 0.4);
      mouth.position.set(0, -0.14, 0.41);
      head.add(mouth);
    }
    // Bracitos de tela
    this.buildArms(sheet, 1.05, 0.34);
    return { top: 0.47, eyeY: 0.05, front: 0.42, radius: 0.4 };
  }

  // ---------- Animación ----------
  swing() {
    this.swingT = 0;
  }

  hitFlash() {
    this.flashT = 0.16;
  }

  die(fall = false) {
    if (this.deadT >= 0) return;
    this.deadT = 0;
    this.fall = fall;
  }

  revive() {
    this.deadT = -1;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.root.visible = true;
    this.blob.visible = true;
  }

  get isSwinging() {
    return this.swingT < 1;
  }

  update(dt, moving = false) {
    this.time += dt;
    const SWING = 0.26;

    // Caminar / respirar
    if (moving) this.walkPhase += dt * 11;
    const walk = moving ? Math.sin(this.walkPhase) : 0;
    const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.07 : Math.sin(this.time * 2.2) * 0.012;
    if (this.isGhost) {
      this.body.position.y = 0.12 + Math.sin(this.time * 2.5) * 0.08;
      this.body.rotation.z = walk * 0.06;
    } else if (this.deadT < 0) {
      this.body.position.y = bob;
      this.legs[0].rotation.x = walk * 0.7;
      this.legs[1].rotation.x = -walk * 0.7;
      if (this.tail) this.tail.rotation.z = Math.sin(this.time * 6) * 0.3;
    }
    this.armL.pivot.rotation.x = -walk * 0.6;

    // Golpe: brazo al frente y barrido horizontal de derecha a izquierda
    if (this.swingT < 1) {
      this.swingT = Math.min(1, this.swingT + dt / SWING);
      const t = this.swingT;
      const wind = t < 0.25 ? t / 0.25 : 1;
      const slash = t < 0.25 ? 0 : (t - 0.25) / 0.75;
      const ease = 1 - Math.pow(1 - slash, 3);
      this.armR.pivot.rotation.x = -Math.PI / 2 * (0.6 + 0.4 * wind) * (t > 0.85 ? (1 - t) / 0.15 + 0.0001 : 1);
      this.armR.swing.rotation.y = 0.2 - wind * 1.2 + ease * 2.6;
      this.body.rotation.y = (-wind * 0.25 + ease * 0.5) * (1 - t);
      this.mount.rotation.x = MOUNT_IDLE + (MOUNT_SWING - MOUNT_IDLE) * Math.min(1, t * 5);
    } else {
      this.mount.rotation.x = damp0(this.mount.rotation.x, MOUNT_IDLE, dt);
      this.armR.pivot.rotation.x = damp0(this.armR.pivot.rotation.x, -0.45 + walk * 0.4, dt);
      this.armR.swing.rotation.y = damp0(this.armR.swing.rotation.y, 0, dt);
      this.body.rotation.y = damp0(this.body.rotation.y, 0, dt);
    }

    // Destello al recibir daño
    if (this.flashT > 0) {
      this.flashT -= dt;
      const on = this.flashT > 0;
      for (const m of this.mats) {
        if (!m.emissive) continue;
        if (on) {
          m.emissive.set('#ff2a2a');
          m.emissiveIntensity = 0.9;
        } else {
          m.emissive.copy(m.userData.baseEmissive);
          m.emissiveIntensity = m.userData.baseEmissiveIntensity;
        }
      }
    }

    // Eliminado: se cae (o se va al vacío)
    if (this.deadT >= 0) {
      this.deadT += dt;
      const t = Math.min(1, this.deadT / 0.5);
      if (this.fall) {
        this.body.position.y -= dt * (2 + this.deadT * 12);
        this.body.rotation.x += dt * 4;
        if (this.deadT > 1.6) this.root.visible = false;
      } else {
        this.body.rotation.x = -t * (Math.PI / 2) * 0.95;
        this.body.position.y = t * 0.25;
      }
      this.blob.visible = !this.fall && this.deadT < 0.3;
    }
  }
}

function damp0(v, target, dt) {
  return v + (target - v) * (1 - Math.exp(-14 * dt));
}

export function buildCharacter(character) {
  return new CharacterRig(character);
}
