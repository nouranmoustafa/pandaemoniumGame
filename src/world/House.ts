import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS } from '../config';
import { mulberry32 } from '../core/math';
import { glowTexture } from './Textures';
import { Vine, vineMaterial } from './Vine';

/** Height of the porch and the ground floor above the path. */
export const HOUSE_FLOOR = 0.3;
/** House-local X of the front wall (the door stands in it). */
export const HOUSE_FRONT = -9.05;
/**
 * Stage 5: the window she escapes through, in the side wall that faces the
 * lawn (house-local; the wall is at z = -6.5). Its sill is the hall's sill.
 */
export const ESCAPE_WINDOW = { x: -3, sillY: HOUSE_FLOOR + 0.82, z: 6.62, width: 2.0, height: 2.7 };

export function sidingTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const rand = mulberry32(21);
  g.fillStyle = '#1a1520';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) {
    const v = 22 + rand() * 12;
    g.fillStyle = `rgb(${v + 6},${v},${v + 10})`;
    g.fillRect(0, y, 256, 14);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, y + 14, 256, 2);
    for (let i = 0; i < 12; i++) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(rand() * 256, y + rand() * 12, 10 + rand() * 30, 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function mergeFrame(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts)!;
}

interface WindowLight {
  mesh: THREE.Mesh;
  base: number;
  phase: number;
}

/**
 * The house. Crooked, top-heavy, slightly too tall, and very awake.
 * It deliberately ignores fog so it always reads as a silhouette with warm windows.
 */
export class House {
  readonly group = new THREE.Group();
  readonly door: THREE.Mesh;
  private windows: WindowLight[] = [];
  private time = 0;
  private doorGlow: THREE.Sprite;
  /** Window brightness multiplier (the Demon's mood). */
  glow = 1;
  /** 0..1 — a brief surge of light, decaying. */
  flare = 0;
  private aura!: THREE.Sprite;
  /** 0..1 — how far the front door has opened (ending sequence). */
  doorOpen = 0;
  private doorPivot = new THREE.Group();
  /** Stage 5: 0 = shut, 1 = open — the window she climbs out of. */
  escapeOpen = 0;
  /** Stage 5: the vine that follows her out of the window, and the ones that keep the door. */
  readonly escapeVine: Vine;
  readonly doorVines: Vine[] = [];
  /** The one that reaches out from under the door at the very end. */
  readonly doorReach: Vine;
  private escapeLeaves: THREE.Group[] = [];
  private escapeOpenNow = 0;

  constructor() {
    const rand = mulberry32(13);
    const siding = sidingTexture();
    const wall = new THREE.MeshStandardMaterial({ map: siding, color: 0x6c6080, roughness: 0.95, fog: false });
    const trim = new THREE.MeshStandardMaterial({ color: 0x0b080e, roughness: 0.9, fog: false });
    const roof = new THREE.MeshStandardMaterial({ color: 0x0d0a12, roughness: 0.8, fog: false });
    const glass = new THREE.MeshBasicMaterial({ color: COLORS.amber, fog: false });

    const shear = (m: THREE.Object3D, k: number) => {
      m.updateMatrix();
      const s = new THREE.Matrix4().set(1, k, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
      m.matrix.multiply(s);
      m.matrixAutoUpdate = false;
    };

    const block = (w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0, lean = 0) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * 0.15, uv.getY(i) * h * 0.15);
      const m = new THREE.Mesh(geo, wall);
      m.position.set(x, y + h / 2, z);
      m.rotation.y = rotY;
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      if (lean) shear(m, lean);
      return m;
    };

    const pitchedRoof = (w: number, d: number, h: number, x: number, y: number, z: number, rotY = 0, tilt = 0) => {
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2 - 0.6, 0);
      shape.lineTo(0 + tilt, h);
      shape.lineTo(w / 2 + 0.6, 0);
      shape.lineTo(-w / 2 - 0.6, 0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: d + 1.2, bevelEnabled: false });
      geo.translate(0, 0, -(d + 1.2) / 2);
      const m = new THREE.Mesh(geo, roof);
      m.position.set(x, y, z);
      m.rotation.y = rotY;
      m.castShadow = true;
      this.group.add(m);
      return m;
    };

    const spire = (r: number, h: number, x: number, y: number, z: number, lean = 0) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), roof);
      m.position.set(x, y + h / 2, z);
      m.rotation.z = lean;
      m.castShadow = true;
      this.group.add(m);
    };

    const addWindow = (w: number, h: number, x: number, y: number, z: number, rotY: number, lit: boolean) => {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, h + 0.5, 0.3), trim);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = rotY;
      g.add(frame);
      const paneMat = lit ? glass.clone() : new THREE.MeshBasicMaterial({ color: 0x050308, fog: false });
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), paneMat);
      pane.position.z = 0.17;
      g.add(pane);
      // Mullions.
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, h, 0.1), trim);
      bar.position.z = 0.2;
      g.add(bar);
      const bar2 = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, 0.1), trim);
      bar2.position.set(0, h * 0.15, 0.2);
      g.add(bar2);
      this.group.add(g);
      if (lit) this.windows.push({ mesh: pane, base: 0.65 + rand() * 0.5, phase: rand() * 10 });
    };

    // The hill it sits on.
    const hill = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 1, fog: false }),
    );
    // A low mound: the porch sits at the level of the path, so she can be taken in.
    hill.scale.set(42, 1.1, 40);
    hill.position.set(10, -0.8, 0);
    hill.receiveShadow = true;
    this.group.add(hill);

    // Main body — narrower at the bottom than the top.
    const baseY = HOUSE_FLOOR;
    block(18, 11, 13, 0, baseY, 0, 0, 0.03);
    block(20, 9, 14, 0.8, baseY + 11, -0.3, 0.04, -0.05);
    pitchedRoof(20, 14, 9, 0.8, baseY + 20, -0.3, Math.PI / 2 + 0.04, 0.9);
    // Side wing, crooked — set back to one side so the front door stays clear.
    block(9, 8, 9, -12, baseY, -8.6, -0.12, 0.06);
    pitchedRoof(9, 9, 6, -12, baseY + 8, -8.6, -0.12, -0.6);
    // Tower.
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 26, 6), wall);
    tower.position.set(10.5, baseY + 13, 4);
    tower.rotation.z = -0.05;
    tower.castShadow = true;
    this.group.add(tower);
    spire(4.4, 15, 11.1, baseY + 25.6, 4, -0.12);
    spire(1.6, 8, -4, baseY + 26, -3, 0.15);
    spire(1.3, 7, 6, baseY + 25, -4, -0.2);
    // Chimneys.
    for (const [x, z, h] of [
      [-6, -4, 7],
      [5, -5, 9],
    ] as const) {
      const ch = new THREE.Mesh(new THREE.BoxGeometry(1.4, h, 1.4), trim);
      ch.position.set(x, baseY + 22 + h / 2, z);
      ch.rotation.z = (rand() - 0.5) * 0.15;
      ch.castShadow = true;
      this.group.add(ch);
    }

    // Windows facing the path (house front faces -X, toward the Visitor).
    const front = HOUSE_FRONT;
    const rotFront = -Math.PI / 2;
    addWindow(2.0, 3.4, front, baseY + 6, -3.5, rotFront, true);
    addWindow(2.0, 3.4, front, baseY + 6, 3.5, rotFront, false);
    addWindow(2.4, 3.6, front - 1.2, baseY + 15, -4.5, rotFront, true);
    addWindow(2.4, 3.6, front - 1.2, baseY + 15, 0.6, rotFront, true);
    addWindow(2.4, 3.6, front - 1.2, baseY + 15, 5.4, rotFront, false);
    addWindow(1.4, 2.4, 7.0, baseY + 21, 4, rotFront, true);
    addWindow(1.4, 2.6, 7.2, baseY + 14, 4, rotFront, true);
    addWindow(1.6, 2.4, -16.6, baseY + 4.5, -8.6, rotFront - 0.12, true);
    // The attic window — a single round eye.
    const eye = new THREE.Mesh(new THREE.CircleGeometry(1.3, 24), glass.clone());
    eye.position.set(front - 0.4, baseY + 24, -0.3);
    eye.rotation.y = rotFront;
    this.group.add(eye);
    this.windows.push({ mesh: eye, base: 1.2, phase: 0 });

    // The escape window, in the side wall over the lawn: warm, with two casement leaves.
    {
      const E = ESCAPE_WINDOW;
      const g = new THREE.Group();
      g.position.set(E.x, E.sillY, E.z);
      this.group.add(g);
      const parts: THREE.BufferGeometry[] = [];
      parts.push(new THREE.BoxGeometry(0.16, E.height + 0.3, 0.32).translate(-E.width / 2 - 0.08, E.height / 2, 0));
      parts.push(new THREE.BoxGeometry(0.16, E.height + 0.3, 0.32).translate(E.width / 2 + 0.08, E.height / 2, 0));
      parts.push(new THREE.BoxGeometry(E.width + 0.5, 0.2, 0.36).translate(0, E.height + 0.1, 0));
      parts.push(new THREE.BoxGeometry(E.width + 0.6, 0.12, 0.5).translate(0, -0.06, 0.06));
      const frame = new THREE.Mesh(mergeFrame(parts), trim);
      frame.castShadow = true;
      g.add(frame);
      const inside = new THREE.Mesh(new THREE.PlaneGeometry(E.width, E.height), glass.clone());
      inside.position.set(0, E.height / 2, -0.1);

      g.add(inside);
      this.windows.push({ mesh: inside, base: 0.42, phase: 4 });
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * E.width / 2, 0, 0.04);
        g.add(pivot);
        const w = E.width / 2;
        const cx = (-side * w) / 2;
        const frameGeo = mergeFrame([
          new THREE.BoxGeometry(0.09, E.height, 0.09).translate(cx - w / 2 + 0.045, E.height / 2, 0),
          new THREE.BoxGeometry(0.09, E.height, 0.09).translate(cx + w / 2 - 0.045, E.height / 2, 0),
          new THREE.BoxGeometry(w, 0.1, 0.09).translate(cx, 0.05, 0),
          new THREE.BoxGeometry(w, 0.1, 0.09).translate(cx, E.height - 0.05, 0),
          new THREE.BoxGeometry(w, 0.06, 0.07).translate(cx, E.height * 0.68, 0),
          new THREE.BoxGeometry(0.05, E.height, 0.07).translate(cx, E.height / 2, 0),
        ]);
        pivot.add(new THREE.Mesh(frameGeo, trim));
        // Old glass: dark, catching a little of the warm room behind it.
        const pane = new THREE.Mesh(
          new THREE.PlaneGeometry(w - 0.12, E.height - 0.14),
          new THREE.MeshStandardMaterial({ color: 0x1a1216, emissive: 0x3a2010, roughness: 0.08, metalness: 0.6, transparent: true, opacity: 0.55, fog: false, side: THREE.DoubleSide }),
        );
        pane.position.set(cx, E.height / 2, 0);
        pivot.add(pane);
        this.escapeLeaves.push(pivot);
      }
    }
    const vm = vineMaterial();
    this.escapeVine = new Vine(vm, 0.05, 48, 7, 8);
    this.group.add(this.escapeVine.mesh);
    for (let k = 0; k < 5; k++) {
      const v = new Vine(vm, 0.06 + (k % 2) * 0.02, 32, 7, 6);
      this.group.add(v.mesh);
      this.doorVines.push(v);
    }
    this.doorReach = new Vine(vm, 0.12, 56, 7, 4);
    this.group.add(this.doorReach.mesh);

    // Porch, steps and the door.
    const porch = new THREE.Mesh(new THREE.BoxGeometry(4, baseY, 8), trim);
    porch.position.set(front - 2, baseY / 2, 0);
    porch.receiveShadow = true;
    this.group.add(porch);
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.0, baseY / 2, 4.5), trim);
    step.position.set(front - 4.5, baseY / 4, 0);
    step.receiveShadow = true;
    this.group.add(step);
    for (const z of [-3.6, 3.6]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 5.5, 6), trim);
      post.position.set(front - 3.6, baseY + 2.9, z);
      post.rotation.x = z * 0.01;
      this.group.add(post);
    }
    const awning = new THREE.Mesh(new THREE.BoxGeometry(5, 0.4, 10), roof);
    awning.position.set(front - 2.4, baseY + 5.8, 0);
    awning.rotation.z = 0.18;
    this.group.add(awning);

    const doorLight = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.2), new THREE.MeshBasicMaterial({ color: 0xffb46a, fog: false }));
    doorLight.position.set(front - 0.04, baseY + 2.1, 0);
    doorLight.rotation.y = rotFront;
    this.group.add(doorLight);
    this.doorPivot.position.set(front - 0.1, baseY, -1.2);
    this.group.add(this.doorPivot);
    this.door = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.2, 2.4), new THREE.MeshStandardMaterial({ color: 0x1c0b0d, roughness: 0.6, fog: false }));
    this.door.position.set(0, 2.1, 1.2);
    this.doorPivot.add(this.door);

    this.doorGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture('rgba(255,170,90,0.9)'), blending: THREE.AdditiveBlending, fog: false, depthWrite: false, transparent: true, opacity: 0 }),
    );
    this.doorGlow.position.set(front - 2.5, baseY + 2.4, 0);
    this.doorGlow.scale.setScalar(14);
    this.group.add(this.doorGlow);

    // Warm halo around the whole house, so it reads from far away.
    const aura = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture('rgba(255,150,70,0.22)'), blending: THREE.AdditiveBlending, fog: false, depthWrite: false, transparent: true }),
    );
    aura.position.set(18, baseY + 13, 0);
    this.aura = aura;
    aura.scale.set(90, 70, 1);
    this.group.add(aura);

    // Wrought-iron fence along the front.
    const fenceMat = trim;
    for (let i = -14; i <= 14; i++) {
      if (Math.abs(i) < 3) continue;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6 + (i % 3) * 0.3, 0.12), fenceMat);
      bar.position.set(front - 9, 3.4, i * 1.1);
      bar.rotation.x = (rand() - 0.5) * 0.2;
      this.group.add(bar);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 4), fenceMat);
      spike.position.set(front - 9, 4.9 + (i % 3) * 0.15, i * 1.1);
      this.group.add(spike);
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const w of this.windows) {
      const flicker = 0.85 + 0.15 * Math.sin(this.time * 7 + w.phase) * Math.sin(this.time * 2.3 + w.phase * 2);
      const mat = w.mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(COLORS.amber).multiplyScalar(w.base * flicker * 1.6 * (this.glow + this.flare * 1.5));
    }
    this.flare = Math.max(0, this.flare - dt * 0.35);
    const auraK = this.glow + this.flare * 2;
    this.aura.scale.set(90 * (0.8 + auraK * 0.2), 70 * (0.8 + auraK * 0.2), 1);
    (this.aura.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.7 + this.flare * 0.6 + (this.glow - 1) * 0.5);
    this.doorPivot.rotation.y = -this.doorOpen * 1.6;
    this.escapeOpenNow += (this.escapeOpen - this.escapeOpenNow) * Math.min(1, dt * 2.4);
    // Casements: they open outward, toward the lawn (+Z).
    this.escapeLeaves[0].rotation.y = -this.escapeOpenNow * 1.25;
    this.escapeLeaves[1].rotation.y = this.escapeOpenNow * 1.4;
    (this.doorGlow.material as THREE.SpriteMaterial).opacity = this.doorOpen;
  }
}
