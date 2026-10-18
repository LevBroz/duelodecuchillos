import * as THREE from 'three';
import { createRenderer, disposeObject, environmentFor } from './common.js';
import { buildCharacter } from './character.js';

// Vista previa 3D del personaje en la pantalla de selección.
export class CharacterPreview {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    container.append(this.canvas);
    this.renderer = createRenderer(this.canvas, { alpha: true });
    this.renderer.setClearColor(0x000000, 0); // se ve el degradado CSS de fondo
    this.scene = new THREE.Scene();
    this.scene.environment = environmentFor(this.renderer);
    this.scene.environmentIntensity = 0.55;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.camera.position.set(0, 1.9, 5.2);
    this.camera.lookAt(0, 1.05, 0);

    this.scene.add(new THREE.HemisphereLight('#ffe2c0', '#40200f', 1.3));
    const key = new THREE.DirectionalLight('#ffb36b', 2.4);
    key.position.set(3, 5, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 4;
    this.scene.add(key);
    const back = new THREE.DirectionalLight('#9a7cff', 0.9);
    back.position.set(-3, 3, -4);
    this.scene.add(back);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.2, 0.2, 48),
      new THREE.MeshStandardMaterial({ color: '#d9ab6c', roughness: 0.95 }),
    );
    pedestal.position.y = -0.1;
    pedestal.receiveShadow = true;
    this.scene.add(pedestal);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.12, 0.06, 8, 64),
      new THREE.MeshStandardMaterial({ color: '#7a4a26', roughness: 0.8 }),
    );
    rim.rotation.x = Math.PI / 2;
    this.scene.add(rim);

    this.yaw = 0.5;
    this.autoSpin = true;
    this.rig = null;
    this.clock = new THREE.Clock();
    this.idleSwing = 2.5;

    // Arrastrar para girar
    let dragging = false;
    let lastX = 0;
    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      this.autoSpin = false;
    });
    window.addEventListener('pointerup', (this._up = () => (dragging = false)));
    this.canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.yaw += (e.clientX - lastX) * 0.012;
      lastX = e.clientX;
    });

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = this.container.clientWidth || 300;
    const h = this.container.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // En pantallas muy angostas, alejar la cámara
    this.camera.position.z = w / h < 0.8 ? 6.4 : 5.2;
    this.camera.updateProjectionMatrix();
  }

  setCharacter(character) {
    const key = JSON.stringify(character);
    if (key === this.key) return;
    this.key = key;
    if (this.rig) {
      this.scene.remove(this.rig.root);
      disposeObject(this.rig.root);
    }
    this.rig = buildCharacter(character);
    this.rig.root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    this.scene.add(this.rig.root);
  }

  swing() {
    this.rig?.swing();
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.autoSpin) this.yaw += dt * 0.6;
    if (this.rig) {
      this.rig.root.rotation.y = this.yaw;
      this.idleSwing -= dt;
      if (this.idleSwing <= 0) {
        this.rig.swing();
        this.idleSwing = 3 + Math.random() * 2;
      }
      this.rig.update(dt, false);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObs.disconnect();
    window.removeEventListener('pointerup', this._up);
    if (this.rig) disposeObject(this.rig.root);
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.canvas.remove();
  }
}
