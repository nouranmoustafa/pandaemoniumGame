import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, damp, mulberry32, noise1, smoothstep } from '../core/math';
import { glowTexture } from './Textures';

/**
 * Where the interior set stands in the world. It is a closed room, built
 * well away from the park (which is hidden while she is inside), so the two
 * never share a frame.
 */
export const INTERIOR_ORIGIN = new THREE.Vector3(300, 0, 700);

/** Room layout, in set-local metres: the aisle runs along +X from the front door. */
export const ROOM = {
  length: 19,
  halfWidth: 4.2,
  height: 5.2,
  /** Where she stands for the gown, under the arch. */
  altarX: 14.2,
  archX: 14.2,
  mirrorX: 18.5,
  /** Candle stands either side of the aisle. */
  candleXs: [2.4, 4.4, 6.4, 8.4, 10.4, 12.4],
  candleZ: 1.15,
};

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, rx: number, ry: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  return t;
}

/** Faded damask: a plum ground with a darker repeating medallion, water stains low down. */
function damask(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = '#3a2230';
  g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(20,8,16,0.55)';
  const medallion = (x: number, y: number) => {
    g.save();
    g.translate(x, y);
    for (let k = 0; k < 4; k++) {
      g.rotate(Math.PI / 2);
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(18, -10, 34, 8, 0, 52);
      g.bezierCurveTo(-34, 8, -18, -10, 0, 0);
      g.fill();
    }
    g.beginPath();
    g.ellipse(0, 0, 10, 16, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  for (const [x, y] of [
    [64, 64],
    [192, 192],
    [192, -64],
    [-64, 192],
    [192, 64 + 256],
    [64 + 256, 64],
    [64, 64 + 256],
    [64 - 256, 64],
  ])
    medallion(x, y);
  g.strokeStyle = 'rgba(200,150,120,0.08)';
  g.lineWidth = 1;
  for (let x = 0; x < S; x += 32) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, S);
    g.stroke();
  }
  return tex(c, 6, 2);
}

/** Old floorboards. */
function boards(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const rand = mulberry32(5);
  for (let y = 0; y < S; y += 32) {
    const v = 34 + rand() * 14;
    g.fillStyle = `rgb(${v + 10},${v},${v - 6})`;
    g.fillRect(0, y, S, 30);
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect(0, y + 30, S, 2);
    const joint = rand() * S;
    g.fillRect(joint, y, 2, 30);
    for (let i = 0; i < 18; i++) {
      g.fillStyle = `rgba(0,0,0,${0.08 + rand() * 0.12})`;
      g.fillRect(rand() * S, y + rand() * 28, 20 + rand() * 60, 1);
    }
  }
  return tex(c, 5, 3);
}

/** The aisle runner: worn crimson with a gold-ish border. */
function runner(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 256);
  g.fillStyle = '#4a0c14';
  g.fillRect(0, 0, 64, 256);
  g.fillStyle = '#6a4a22';
  g.fillRect(0, 0, 6, 256);
  g.fillRect(58, 0, 6, 256);
  const rand = mulberry32(9);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(0,0,0,${rand() * 0.2})`;
    g.fillRect(rand() * 64, rand() * 256, 2 + rand() * 4, 1);
  }
  return tex(c, 1, 5);
}

interface Candle {
  flame: THREE.Mesh;
  glow: THREE.Sprite;
  x: number;
  z: number;
  lit: number;
  target: number;
  phase: number;
}

/**
 * Inside the house: a front hall laid out as a wedding with no guests.
 * Rows of empty chairs face a dead-rose arch; candles stand along a crimson
 * aisle and light themselves; a tall mirror at the end hangs under a sheet.
 *
 * All the light is the house's own: candles (one moving warm light follows
 * the lit ones), a chandelier, a cold spill from the windows and a key
 * light over the arch that throws her shadow.
 */
export class HouseInterior {
  readonly group = new THREE.Group();
  /** World position of the door's centre at floor level. */
  readonly doorWorld = new THREE.Vector3();
  private candles: Candle[] = [];
  private chandelier: Candle[] = [];
  private doorPivot = new THREE.Group();
  private sheet: THREE.Mesh;
  private sheetBase: Float32Array;
  private mirrorGlow: THREE.MeshBasicMaterial;
  private aisleLight: THREE.PointLight;
  private altarLight: THREE.PointLight;
  private key: THREE.SpotLight;
  private hemi: THREE.HemisphereLight;
  private time = 0;
  /** 0 = open, 1 = shut. */
  doorShut = 0;
  /** 0 = hanging, 1 = slipped down (a sliver of the glass shows). */
  sheetSlip = 0;
  /** 0..1 how far the mirror's own glow has woken. */
  mirrorWake = 0;
  /** A surge of candlelight (the gown's reveal). */
  flare = 0;

  constructor() {
    const g = this.group;
    g.position.copy(INTERIOR_ORIGIN);
    g.visible = false;
    const { length: L, halfWidth: W, height: H } = ROOM;

    const wallMat = new THREE.MeshStandardMaterial({ map: damask(), color: 0x9a8890, roughness: 0.9 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x24140e, roughness: 0.65 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(L, W * 2), new THREE.MeshStandardMaterial({ map: boards(), roughness: 0.7 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(L / 2, 0, 0);
    floor.receiveShadow = true;
    g.add(floor);
    // Runner: its texture's long axis lies along the aisle.
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(1.3, ROOM.altarX + 1.6).rotateZ(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: runner(), roughness: 0.95 }));
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set((ROOM.altarX + 1.6) / 2, 0.006, 0);
    carpet.receiveShadow = true;
    g.add(carpet);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(L, W * 2), new THREE.MeshStandardMaterial({ color: 0x140c10, roughness: 1 }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(L / 2, H, 0);
    g.add(ceiling);

    const wall = (w: number, x: number, z: number, ry: number) => {
      const geo = new THREE.PlaneGeometry(w, H);
      const m = new THREE.Mesh(geo, wallMat);
      m.position.set(x, H / 2, z);
      m.rotation.y = ry;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    // Long walls (the far one has two tall windows cut by their frames), end wall, door wall.
    wall(L, L / 2, -W, 0);
    wall(L, L / 2, W, Math.PI);
    wall(W * 2, L, 0, -Math.PI / 2);
    wall(W - 1.2, 0, -(W + 1.2) / 2, Math.PI / 2);
    wall(W - 1.2, 0, (W + 1.2) / 2, Math.PI / 2);
    const lintel = new THREE.Mesh(new THREE.PlaneGeometry(2.4, H - 3.2), wallMat);
    lintel.position.set(0, 3.2 + (H - 3.2) / 2, 0);
    lintel.rotation.y = Math.PI / 2;
    g.add(lintel);
    // Wainscot and skirting.
    for (const z of [-W + 0.03, W - 0.03]) {
      const pan = new THREE.Mesh(new THREE.BoxGeometry(L, 1.05, 0.06), wood);
      pan.position.set(L / 2, 0.52, z);
      pan.receiveShadow = true;
      g.add(pan);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.07, 0.12), wood);
      rail.position.set(L / 2, 1.06, z);
      g.add(rail);
    }

    // The front door, seen from inside, on a pivot so it can slam.
    this.doorPivot.position.set(0.04, 0, -1.2);
    g.add(this.doorPivot);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.2, 2.4), new THREE.MeshStandardMaterial({ color: 0x1c0b0d, roughness: 0.55 }));
    door.position.set(0, 1.6, 1.2);
    door.castShadow = door.receiveShadow = true;
    this.doorPivot.add(door);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshStandardMaterial({ color: 0x8a6a3a, metalness: 0.9, roughness: 0.3 }));
    knob.position.set(0.1, 1.05, 2.1);
    this.doorPivot.add(knob);
    for (const z of [-1.28, 1.28]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.3, 0.16), wood);
      jamb.position.set(0.05, 1.65, z);
      g.add(jamb);
    }
    this.doorWorld.copy(INTERIOR_ORIGIN);

    // Windows on the far wall: night outside, cold light in.
    const winMat = new THREE.MeshBasicMaterial({ color: 0x24304a });
    for (const x of [5.6, 11.6]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.7, 3.0, 0.1), wood);
      frame.position.set(x, 2.5, -W + 0.06);
      g.add(frame);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.7), winMat);
      pane.position.set(x, 2.5, -W + 0.12);
      g.add(pane);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.7, 0.06), wood);
      bar.position.set(x, 2.5, -W + 0.15);
      g.add(bar);
      const bar2 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.06), wood);
      bar2.position.set(x, 2.9, -W + 0.15);
      g.add(bar2);
    }

    // Chairs: rows either side of the aisle, all facing the arch. Nobody else was invited.
    const chairGeo = this.chairGeometry();
    const chairMat = new THREE.MeshStandardMaterial({ color: 0x2a1a14, roughness: 0.6 });
    const rows = [3.2, 4.8, 6.4, 8.0, 9.6, 11.2];
    const seats = [-3.3, -2.5, 2.5, 3.3];
    const chairs = new THREE.InstancedMesh(chairGeo, chairMat, rows.length * seats.length);
    const rand = mulberry32(31);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let i = 0;
    for (const x of rows)
      for (const z of seats) {
        // A few have been nudged, as if someone just got up.
        q.setFromEuler(new THREE.Euler(0, Math.PI / 2 + (rand() - 0.5) * 0.25, 0));
        m.compose(new THREE.Vector3(x + (rand() - 0.5) * 0.15, 0, z + (rand() - 0.5) * 0.1), q, new THREE.Vector3(1, 1, 1));
        chairs.setMatrixAt(i++, m);
      }
    chairs.castShadow = chairs.receiveShadow = true;
    g.add(chairs);

    // The arch: a hoop of dead roses.
    const archMat = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.8 });
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.06, 8, 40, Math.PI), archMat);
    arch.rotation.y = Math.PI / 2;
    arch.position.set(ROOM.archX, 1.35, 0);
    arch.castShadow = true;
    g.add(arch);
    for (const z of [-1.45, 1.45]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.35, 8), archMat);
      post.position.set(ROOM.archX, 0.675, z);
      g.add(post);
    }
    const roseGeos: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 46; k++) {
      const a = (k / 45) * Math.PI;
      const r = 1.45 + (rand() - 0.5) * 0.12;
      const s = new THREE.IcosahedronGeometry(0.07 + rand() * 0.05, 0);
      s.translate(ROOM.archX + (rand() - 0.5) * 0.15, 1.35 + Math.sin(a) * r, Math.cos(a) * r);
      roseGeos.push(s);
    }
    const roses = new THREE.Mesh(mergeGeometries(roseGeos)!, new THREE.MeshStandardMaterial({ color: 0x3a0a10, roughness: 0.9, flatShading: true }));
    roses.castShadow = true;
    g.add(roses);
    // Petals on the floor below.
    const petalGeos: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 70; k++) {
      const p = new THREE.CircleGeometry(0.035 + rand() * 0.02, 5);
      p.rotateX(-Math.PI / 2);
      p.translate(ROOM.archX - 1.6 + rand() * 2.2, 0.008 + k * 0.0001, (rand() - 0.5) * 3.2);
      petalGeos.push(p);
    }
    g.add(new THREE.Mesh(mergeGeometries(petalGeos)!, new THREE.MeshStandardMaterial({ color: 0x4a0c14, roughness: 0.9, side: THREE.DoubleSide })));

    // The mirror at the end, tall and covered.
    const mirrorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.2, 1.6), new THREE.MeshStandardMaterial({ color: 0x3a2a14, metalness: 0.6, roughness: 0.4 }));
    mirrorFrame.position.set(ROOM.mirrorX, 1.75, 0);
    g.add(mirrorFrame);
    this.mirrorGlow = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 2.96), this.mirrorGlow);
    glass.rotation.y = -Math.PI / 2;
    glass.position.set(ROOM.mirrorX - 0.09, 1.75, 0);
    g.add(glass);
    const sheetGeo = new THREE.PlaneGeometry(1.9, 3.4, 12, 20);
    sheetGeo.rotateY(-Math.PI / 2);
    this.sheetBase = Float32Array.from(sheetGeo.getAttribute('position').array);
    this.sheet = new THREE.Mesh(sheetGeo, new THREE.MeshStandardMaterial({ color: 0xc8c0b4, roughness: 0.95, side: THREE.DoubleSide }));
    this.sheet.position.set(ROOM.mirrorX - 0.2, 1.85, 0);
    this.sheet.castShadow = true;
    g.add(this.sheet);

    // Candles along the aisle.
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    const flameGeo = new THREE.ConeGeometry(0.018, 0.07, 8);
    flameGeo.translate(0, 0.035, 0);
    const glowTex = glowTexture('rgba(255,180,100,0.85)');
    const standGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.03, 0.035, 1.2, 8).translate(0, 0.6, 0),
      new THREE.CylinderGeometry(0.16, 0.2, 0.05, 12).translate(0, 0.025, 0),
      new THREE.CylinderGeometry(0.07, 0.05, 0.04, 12).translate(0, 1.2, 0),
    ])!;
    const standMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, metalness: 0.7, roughness: 0.45 });
    const waxMat = new THREE.MeshStandardMaterial({ color: 0xece4d4, roughness: 0.6, emissive: 0x2a2014 });
    const addCandle = (parent: THREE.Object3D, x: number, y: number, z: number, list: Candle[], height = 0.24) => {
      const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, height, 10), waxMat);
      wax.position.set(x, y + height / 2, z);
      parent.add(wax);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(x, y + height + 0.012, z);
      flame.visible = false;
      parent.add(flame);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      glow.position.copy(flame.position).add(new THREE.Vector3(0, 0.04, 0));
      glow.scale.setScalar(0.55);
      parent.add(glow);
      list.push({ flame, glow, x, z, lit: 0, target: 0, phase: rand() * 10 });
    };
    for (const x of ROOM.candleXs)
      for (const z of [-ROOM.candleZ, ROOM.candleZ]) {
        const stand = new THREE.Mesh(standGeo, standMat);
        stand.position.set(x, 0, z);
        stand.castShadow = true;
        g.add(stand);
        addCandle(g, x, 1.22, z, this.candles, 0.26);
      }
    // A chandelier over the altar end, unlit until the gown.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.025, 6, 32), standMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(ROOM.altarX - 0.6, 3.6, 0);
    g.add(ring);
    for (let k = 0; k < 4; k++) {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.6, 4), standMat);
      const a = (k / 4) * Math.PI * 2;
      chain.position.set(ROOM.altarX - 0.6 + Math.cos(a) * 0.37, 4.4, Math.sin(a) * 0.37);
      chain.rotation.set(Math.sin(a) * 0.43, 0, -Math.cos(a) * 0.43);
      g.add(chain);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      addCandle(g, ROOM.altarX - 0.6 + Math.cos(a) * 0.75, 3.62, Math.sin(a) * 0.75, this.chandelier, 0.16);
    }

    // Light. Candlelight follows the lit stands; a cold spill from the windows.
    this.hemi = new THREE.HemisphereLight(0x3a3a58, 0x1a0c0a, 0.7);
    g.add(this.hemi);
    this.aisleLight = new THREE.PointLight(0xffa860, 0, 12, 1.4);
    this.aisleLight.position.set(2, 1.9, 0);
    g.add(this.aisleLight);
    this.altarLight = new THREE.PointLight(0xffb878, 0, 10, 1.3);
    this.altarLight.position.set(ROOM.altarX - 0.6, 3.2, 0);
    g.add(this.altarLight);
    const moon = new THREE.SpotLight(0x6a7ab8, 9, 18, 0.8, 0.8, 1.2);
    moon.position.set(9, 3.4, -W - 3);
    moon.target.position.set(6, 0, 1);
    g.add(moon, moon.target);
    this.key = new THREE.SpotLight(0xffd2a0, 0, 12, 0.5, 0.7, 1.1);
    // In front of her as she stands under the arch, high, from the mirror side.
    this.key.position.set(ROOM.altarX + 2.6, 4.7, 1.4);
    this.key.target.position.set(ROOM.altarX, 0.9, 0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0008;
    this.key.shadow.normalBias = 0.02;
    g.add(this.key, this.key.target);
  }

  private chairGeometry(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => parts.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
    box(0.44, 0.05, 0.42, 0, 0.46, 0);
    for (const [x, z] of [
      [-0.19, -0.18],
      [0.19, -0.18],
      [-0.19, 0.18],
      [0.19, 0.18],
    ])
      box(0.04, 0.46, 0.04, x, 0.23, z);
    // Back (behind the sitter: -Z before the instance turns it to face +X).
    box(0.04, 0.52, 0.04, -0.19, 0.74, -0.19);
    box(0.04, 0.52, 0.04, 0.19, 0.74, -0.19);
    box(0.42, 0.14, 0.03, 0, 0.92, -0.19);
    box(0.06, 0.4, 0.02, 0, 0.68, -0.19);
    return mergeGeometries(parts)!;
  }

  /** Local set position → world. */
  toWorld(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(x, y, z).add(INTERIOR_ORIGIN);
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  /** Light the aisle candles nearest the door first, `count` pairs of them. */
  lightPairs(count: number): void {
    this.candles.forEach((c, i) => (c.target = Math.floor(i / 2) < count ? 1 : 0));
  }

  lightChandelier(): void {
    for (const c of this.chandelier) c.target = 1;
  }

  /** Back to the dark, unlit room with the door open and the sheet in place. */
  reset(): void {
    for (const c of [...this.candles, ...this.chandelier]) {
      c.lit = c.target = 0;
      c.flame.visible = false;
      (c.glow.material as THREE.SpriteMaterial).opacity = 0;
    }
    this.doorShut = 0;
    this.sheetSlip = 0;
    this.mirrorWake = 0;
    this.flare = 0;
    this.time = 0;
    this.applySheet();
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.time += dt;
    const t = this.time;
    let sum = 0;
    let sumX = 0;
    const flicker = (c: Candle) => 0.82 + 0.18 * noise1(t * 7 + c.phase, 3);
    for (const c of this.candles) {
      // Each candle catches with a small flare, then settles.
      c.lit = damp(c.lit, c.target, c.target > c.lit ? 5 : 3, dt);
      c.flame.visible = c.lit > 0.05;
      const f = flicker(c);
      c.flame.scale.set(1, c.lit * f * (1 + this.flare * 0.6), 1);
      (c.glow.material as THREE.SpriteMaterial).opacity = c.lit * f * (0.6 + this.flare * 0.5);
      sum += c.lit;
      sumX += c.lit * c.x;
    }
    let chand = 0;
    for (const c of this.chandelier) {
      c.lit = damp(c.lit, c.target, 2.2, dt);
      c.flame.visible = c.lit > 0.05;
      const f = flicker(c);
      c.flame.scale.set(1, c.lit * f, 1);
      (c.glow.material as THREE.SpriteMaterial).opacity = c.lit * f * 0.7;
      chand += c.lit / this.chandelier.length;
    }
    // One warm light rides along the lit stretch of the aisle; it brightens with each pair.
    const n = this.candles.length;
    if (sum > 0.01) this.aisleLight.position.x = sumX / sum;
    this.aisleLight.intensity = (sum / n) * 11 * (0.92 + 0.08 * noise1(t * 9, 4)) * (1 + this.flare * 0.5);
    this.aisleLight.distance = 6 + (sum / n) * 9;
    this.altarLight.intensity = chand * 9 * (0.9 + 0.1 * noise1(t * 8, 5)) + this.flare * 4;
    this.key.intensity = (smoothstep(0.4, 1, sum / n) * 7 + chand * 9) * (1 + this.flare * 0.3);
    this.hemi.intensity = 0.7 + (sum / n) * 0.3;
    this.flare = Math.max(0, this.flare - dt * 0.4);

    this.doorPivot.rotation.y = -(1 - clamp(this.doorShut, 0, 1)) * 1.45;
    this.mirrorGlow.color.setRGB(0.36, 0.35, 0.38).multiplyScalar(this.mirrorWake * (0.8 + 0.2 * noise1(t * 2, 8)));
    this.applySheet();
  }

  /** The dust sheet: hangs in folds over the frame, and slips by `sheetSlip`. */
  private applySheet(): void {
    const pos = this.sheet.geometry.getAttribute('position') as THREE.BufferAttribute;
    const B = this.sheetBase;
    const slip = smoothstep(0, 1, this.sheetSlip);
    for (let i = 0; i < pos.count; i++) {
      const y = B[i * 3 + 1];
      const z = B[i * 3 + 2];
      const top = smoothstep(-1.7, 1.7, y);
      // Folds, deeper toward the floor; the sheet drops and its top edge sags off one corner.
      const fold = (Math.sin(z * 9 + y * 0.6) * 0.07 + Math.sin(z * 23 - y * 1.7) * 0.025) * (1 - top * 0.5) + (1 - top) * 0.1 * Math.abs(z);
      const drop = slip * (0.75 + 0.35 * (z / 0.95)) * top;
      pos.setXYZ(i, B[i * 3] - fold - 0.04 * top, y - drop - slip * 0.1, z * (1 + 0.05 * (1 - top)));
    }
    pos.needsUpdate = true;
    this.sheet.geometry.computeVertexNormals();
  }
}
