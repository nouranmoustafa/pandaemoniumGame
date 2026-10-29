import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, damp, mulberry32, noise1 } from '../core/math';
import { groundGrass, glowTexture, moonTexture } from './Textures';
import { buildTreeGeometry } from './TreeBuilder';
import { Vine, vineMaterial } from './Vine';
import { WindowFog } from './WindowFog';

/**
 * The tall window in the hall, between the arch and the mirror, in
 * set-local metres. x is its centre along the room; it is cut into the
 * far wall (z = -halfWidth) and looks out over the lawn to the park.
 */
export const WINDOW = { x: 16.4, width: 2.0, sill: 0.82, height: 2.7 };
/** The lawn outside sits below the house's raised floor. */
export const LAWN_Y = -0.3;

/**
 * Stage 5: the window and the night beyond it.
 *
 * Two casement leaves hinged at the jambs open outward; the condensation
 * (WindowFog) lives on their glass, so it swings with them. Heavy drapes
 * hang either side and stir when the house is uneasy. Vines wait inside
 * the frame. Outside: a lawn running down to the park's iron fence,
 * crooked trees beyond it, a single lamp — where her friends stand — and
 * the sky. It is all part of the closed interior set, lit by its own lamp
 * and moon, so the room and the park still never share a frame.
 */
export class HouseWindow {
  readonly group = new THREE.Group();
  readonly fog: WindowFog;
  /** Frame vines (they catch the gown during the escape). */
  readonly vines: Vine[] = [];
  /** 0 = shut, 1 = wide open. */
  open = 0;
  /** 0..1 — the drapes stirring though the air is still. */
  stir = 0;
  /** 0..1 — the drapes thrashing. */
  violence = 0;
  /** Glass plane (set-local z) and the window's left jamb / sill (set-local), for projecting onto it. */
  readonly glassZ: number;
  readonly left: number;
  private leaves: THREE.Group[] = [];
  private openNow = 0;
  private curtains: { mesh: THREE.Mesh; base: Float32Array; side: 1 | -1; moved: boolean }[] = [];
  private lamp: THREE.PointLight;
  private time = 0;

  constructor(halfWidth: number, wood: THREE.Material) {
    const { x: X, width: Wd, sill: S, height: Ht } = WINDOW;
    const W = halfWidth;
    this.left = X - Wd / 2;
    const hingeZ = -W - 0.06;
    this.glassZ = hingeZ + 0.008;
    this.fog = new WindowFog(Wd, Ht);
    const g = this.group;

    // --- The frame ---
    const frameParts: THREE.BufferGeometry[] = [];
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => frameParts.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
    box(0.14, Ht + 0.28, 0.3, X - Wd / 2 - 0.07, S + Ht / 2, -W - 0.06);
    box(0.14, Ht + 0.28, 0.3, X + Wd / 2 + 0.07, S + Ht / 2, -W - 0.06);
    box(Wd + 0.42, 0.16, 0.32, X, S + Ht + 0.08, -W - 0.06);
    // The sill juts into the room: she will kneel on it.
    box(Wd + 0.5, 0.08, 0.48, X, S - 0.04, -W + 0.02);
    box(Wd + 0.3, S - 0.08, 0.06, X, (S - 0.08) / 2, -W + 0.02);
    const frame = new THREE.Mesh(mergeGeometries(frameParts)!, wood);
    frame.castShadow = frame.receiveShadow = true;
    g.add(frame);

    // --- The leaves: frame bars, glass, and the condensation on the glass ---
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x8a96a8, transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
    const half = Wd / 2;
    for (const side of [0, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side === 0 ? X - half : X + half, S, hingeZ);
      g.add(pivot);
      this.leaves.push(pivot);
      const dir = side === 0 ? 1 : -1;
      const cx = (dir * half) / 2;
      const bars: THREE.BufferGeometry[] = [];
      const bar = (w: number, h: number, x: number, y: number) => bars.push(new THREE.BoxGeometry(w, h, 0.06).translate(x, y, 0));
      bar(0.06, Ht, dir * 0.03, Ht / 2);
      bar(0.04, Ht, dir * (half - 0.02), Ht / 2);
      bar(half, 0.07, cx, 0.035);
      bar(half, 0.07, cx, Ht - 0.035);
      // One transom, high up: the glass below it is clear for the faces.
      bar(half, 0.045, cx, Ht * 0.8);
      const leafFrame = new THREE.Mesh(mergeGeometries(bars)!, wood);
      leafFrame.castShadow = true;
      pivot.add(leafFrame);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(half, Ht), glass);
      pane.position.set(cx, Ht / 2, 0);
      pane.renderOrder = 3;
      pivot.add(pane);
      // The fog's plane: the leaf's half of the shared mask, a hair inside the glass.
      const x0 = side === 0 ? 0 : half;
      const fogMesh = new THREE.Mesh(this.fog.leafGeometry(x0, x0 + half), this.fog.material);
      fogMesh.position.set(cx, Ht / 2, 0.008);
      fogMesh.renderOrder = 4;
      pivot.add(fogMesh);
    }
    // The latch, on the right leaf's meeting edge.
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.04), new THREE.MeshStandardMaterial({ color: 0x6a5230, metalness: 0.9, roughness: 0.35 }));
    latch.position.set(-half + 0.05, Ht * 0.45, 0.05);
    this.leaves[1].add(latch);

    // --- Drapes ---
    const drape = new THREE.MeshStandardMaterial({ color: 0x3a0c18, roughness: 0.85, side: THREE.DoubleSide });
    for (const side of [-1, 1] as const) {
      const geo = new THREE.PlaneGeometry(0.75, Ht + 0.9, 10, 16);
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      // Gathered folds.
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 24) * 0.05);
      const mesh = new THREE.Mesh(geo, drape);
      mesh.position.set(X + side * (half + 0.42), S + Ht / 2 - 0.2, -W + 0.2);
      mesh.castShadow = true;
      g.add(mesh);
      this.curtains.push({ mesh, base: Float32Array.from(pos.array), side, moved: false });
    }
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, Wd + 2.2, 8), new THREE.MeshStandardMaterial({ color: 0x2a2018, metalness: 0.7, roughness: 0.4 }));
    rod.rotation.z = Math.PI / 2;
    rod.position.set(X, S + Ht + 0.3, -W + 0.2);
    g.add(rod);

    // --- Vines asleep in the frame ---
    const vm = vineMaterial();
    for (let k = 0; k < 5; k++) {
      const v = new Vine(vm, k < 2 ? 0.055 : 0.045, 40, 7, 8);
      g.add(v.mesh);
      this.vines.push(v);
    }

    // --- Outside: the lawn, the park's fence, its trees, a lamp, the sky ---
    const out = new THREE.Group();
    g.add(out);
    const lawnTex = groundGrass(17);
    lawnTex.repeat.set(10, 8);
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), new THREE.MeshStandardMaterial({ map: lawnTex, color: 0x6a7a68, roughness: 1 }));
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.set(X, LAWN_Y, -W - 35);
    lawn.receiveShadow = true;
    out.add(lawn);
    // The house's own wall, seen at the edge of the frame from outside shots.
    const rand = mulberry32(71);
    const iron = new THREE.MeshStandardMaterial({ color: 0x0b090c, roughness: 0.6, metalness: 0.4 });
    const fence: THREE.BufferGeometry[] = [];
    for (let x = X - 22; x <= X + 22; x += 0.55) {
      const h = 1.7 + (Math.round(x / 0.55) % 3) * 0.12;
      fence.push(new THREE.CylinderGeometry(0.025, 0.025, h, 5).translate(x, LAWN_Y + h / 2, -W - 15));
      fence.push(new THREE.ConeGeometry(0.05, 0.16, 4).translate(x, LAWN_Y + h + 0.08, -W - 15));
    }
    fence.push(new THREE.BoxGeometry(44, 0.05, 0.05).translate(X, LAWN_Y + 1.5, -W - 15));
    fence.push(new THREE.BoxGeometry(44, 0.05, 0.05).translate(X, LAWN_Y + 0.25, -W - 15));
    out.add(new THREE.Mesh(mergeGeometries(fence)!, iron));
    const bark = new THREE.MeshStandardMaterial({ color: 0x15111a, roughness: 0.95 });
    const trees: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 9; k++) {
      const geo = buildTreeGeometry({ seed: 300 + k, height: 9 + rand() * 7, depth: 3 });
      const a = rand() * Math.PI * 2;
      geo.rotateY(a);
      geo.translate(X - 26 + k * 6.5 + (rand() - 0.5) * 3, LAWN_Y, -W - 20 - rand() * 14);
      trees.push(geo);
    }
    out.add(new THREE.Mesh(mergeGeometries(trees)!, bark));
    // The lamp the friends stand by.
    const post = new THREE.Mesh(
      mergeGeometries([
        new THREE.CylinderGeometry(0.05, 0.07, 3.2, 8).translate(0, 1.6, 0),
        new THREE.CylinderGeometry(0.16, 0.1, 0.3, 6).translate(0, 3.3, 0),
        new THREE.ConeGeometry(0.2, 0.18, 6).translate(0, 3.52, 0),
      ])!,
      iron,
    );
    post.position.set(X + 3.4, LAWN_Y, -W - 9.6);
    out.add(post);
    const bulb = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,190,110,0.9)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    bulb.position.set(X + 3.4, LAWN_Y + 3.3, -W - 9.6);
    bulb.scale.setScalar(1.6);
    out.add(bulb);
    this.lamp = new THREE.PointLight(0xffb070, 9, 16, 1.3);
    this.lamp.position.set(X + 3.0, LAWN_Y + 3.1, -W - 9.0);
    out.add(this.lamp);
    // The hall's own light, spilling out of the window onto the lawn: it finds their faces.
    const spill = new THREE.SpotLight(0xffc896, 22, 22, 0.5, 0.8, 1.2);
    spill.position.set(X, S + Ht + 0.5, -W - 0.4);
    spill.target.position.set(X, LAWN_Y + 1.0, -W - 8);
    out.add(spill, spill.target);
    // Cold moonlight over the lawn, from behind the trees.
    const moon = new THREE.SpotLight(0x8090c8, 14, 60, 0.45, 0.7, 1.0);
    moon.position.set(X - 6, 14, -W - 34);
    moon.target.position.set(X, LAWN_Y, -W - 8);
    out.add(moon, moon.target);
    // The sky: a gradient backdrop with the moon in it (it ignores the fog).
    const skyC = document.createElement('canvas');
    skyC.width = 8;
    skyC.height = 256;
    const sg = skyC.getContext('2d')!;
    const grad = sg.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#05040b');
    grad.addColorStop(0.62, '#1d1735');
    grad.addColorStop(1, '#3a2c50');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 8, 256);
    const skyTex = new THREE.CanvasTexture(skyC);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(220, 70), new THREE.MeshBasicMaterial({ map: skyTex, fog: false }));
    sky.position.set(X, LAWN_Y + 30, -W - 70);
    out.add(sky);
    const moonDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), fog: false, transparent: true }));
    moonDisc.position.set(X - 9, LAWN_Y + 19, -W - 66);
    moonDisc.scale.setScalar(6);
    out.add(moonDisc);
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    this.openNow = damp(this.openNow, this.open, 3.2, dt);
    const o = clamp(this.openNow, 0, 1);
    // The left leaf opens a little later and less, caught on the frame.
    this.leaves[0].rotation.y = o * 1.15 + Math.sin(t * 1.3) * 0.02 * o;
    this.leaves[1].rotation.y = -o * 1.35 - Math.sin(t * 1.1 + 1) * 0.02 * o;
    // Drapes: they breathe with the house, and thrash when it is desperate.
    for (const c of this.curtains) {
      const pos = c.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const B = c.base;
      const amp = this.stir * 0.07 + this.violence * 0.32;
      if (amp < 0.001 && !c.moved) continue;
      c.moved = amp >= 0.001;
      for (let i = 0; i < pos.count; i++) {
        const x = B[i * 3];
        const y = B[i * 3 + 1];
        const hang = clamp((1.8 - y) / 3.6, 0, 1);
        const wave = noise1(t * (0.7 + this.violence * 2.6) + y * 0.9 + c.side * 3, 61) + Math.sin(t * (1.1 + this.violence * 5) + y * 2.1 + x * 3) * 0.4;
        pos.setXYZ(i, x + c.side * wave * amp * 0.5 * hang, y, B[i * 3 + 2] + wave * amp * hang);
      }
      pos.needsUpdate = true;
      c.mesh.geometry.computeVertexNormals();
    }
    this.lamp.intensity = 9 * (0.94 + 0.06 * noise1(t * 3, 72));
    this.fog.update(dt);
  }

  reset(): void {
    this.open = this.openNow = 0;
    this.stir = this.violence = 0;
    this.leaves[0].rotation.y = this.leaves[1].rotation.y = 0;
    for (const c of this.curtains) {
      const pos = c.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      (pos.array as Float32Array).set(c.base);
      pos.needsUpdate = true;
      c.moved = false;
      c.mesh.geometry.computeVertexNormals();
    }
    for (const v of this.vines) {
      v.extent = 0;
      v.update();
    }
    this.fog.reset();
  }

  /**
   * Where a world point appears on the glass, seen from `eye`: the ray
   * from the eye through the point, cut by the glass plane. Returns
   * window-local metres (x from the left jamb, y up from the sill) and how
   * many metres on the glass one metre at the point covers.
   */
  project(eyeLocal: THREE.Vector3, pointLocal: THREE.Vector3): { x: number; y: number; scale: number } {
    const dz = pointLocal.z - eyeLocal.z;
    const k = (this.glassZ - eyeLocal.z) / dz;
    return {
      x: eyeLocal.x + (pointLocal.x - eyeLocal.x) * k - this.left,
      y: eyeLocal.y + (pointLocal.y - eyeLocal.y) * k - WINDOW.sill,
      scale: k,
    };
  }
}
