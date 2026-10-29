import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, mulberry32, smoothstep } from '../core/math';
import type { GeneratedCharacter } from './GeneratedCharacter';
import { BodyBuilder } from './geo/body';
import { normalizeAttributes } from './geo/loft';
import { fabric } from './textures';

/** Slots of her everyday clothes that the gown replaces (legs and shoes stay, under the skirt). */
const REPLACED = ['top', 'collar', 'under', 'belt', 'buttons', 'lining'];

type RevealUniforms = Record<string, THREE.IUniform>;

/**
 * Model-space reveal field shared by the gown (appearing) and the coat
 * (dissolving). Bind-pose positions, so the pattern stays on the cloth
 * whatever she is doing: it starts at the right wrist (the first ribbon's
 * grip) and the waist, and spreads in two bands winding up and down her.
 */
const REVEAL_PARS = /* glsl */ `
varying vec3 vBind;
uniform float uReveal; uniform float uWaist; uniform float uRange; uniform vec3 uWristL; uniform vec3 uWristR; uniform float uNeckY; uniform float uH;
uniform float uTear; uniform float uDirt;
// Stage 5: where the window frame tore the skirt away — a ragged line, deepest at the back.
float tearCut(vec3 p) {
  float th = atan(p.x, p.z);
  float back = smoothstep(-0.1, 0.85, -cos(th - 0.45));
  float jag = abs(fract(th * 2.6 + 0.3) - 0.5) * 2.0 + 0.35 * sin(th * 17.0) + 0.2 * sin(th * 41.0);
  return uTear * uH * (0.035 + 0.03 * jag + back * (0.2 + 0.07 * jag));
}
float revealField(vec3 p) {
  float d = length((p - vec3(0.0, uWaist, 0.0)) * vec3(0.85, 1.0, 0.85)) / uRange;
  d = min(d, 0.1 + length(p - uWristR) / uRange * 1.5);
  d = min(d, 0.28 + length(p - uWristL) / uRange * 1.5);
  float th = atan(p.x, p.z);
  float spiral = 0.5 + 0.5 * sin(th * 2.0 - p.y / uH * 26.0);
  float n = fract(sin(dot(floor(p / uH * 70.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  return min(d, 1.4) * 0.72 + spiral * 0.2 + n * 0.05;
}
float laceMask(vec3 p) {
  float collar = step(uNeckY - 0.035 * uH, p.y);
  float cuff = step(length(p - uWristL), 0.075 * uH) + step(length(p - uWristR), 0.075 * uH);
  float th = atan(p.x, p.z);
  // Bodice: from her right shoulder down across to the left hip.
  float bod = step(uWaist, p.y) * smoothstep(-0.012, 0.012, p.x / uH + (p.y - uWaist) / uH * 0.55 - 0.05);
  // Skirt: one sweep from the left hip spiralling down to the right of the hem.
  float sk = (1.0 - step(uWaist, p.y)) * smoothstep(0.05, 0.3, sin(th - 0.9 - (uWaist - p.y) / uH * 2.4));
  return clamp(collar + cuff + bod + sk, 0.0, 1.0);
}`;

/** Upper limit of revealField(), so reveal = 1 means "everything". */
const FIELD_MAX = 1.3;

function patch(mat: THREE.Material, uniforms: RevealUniforms, mode: 'in' | 'out' | 'lace'): void {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
    const test =
      mode === 'out'
        ? // The coat whitens just ahead of the front, then is gone.
          `float rvF = revealField(vBind); float rvL = uReveal * ${FIELD_MAX.toFixed(2)};
           if (uReveal > 0.0 && rvF < rvL - 0.1) discard;
           float rvEdge = uReveal > 0.0 ? smoothstep(0.14, 0.0, rvF - (rvL - 0.1)) : 0.0;`
        : `float rvF = revealField(vBind); float rvL = uReveal * ${FIELD_MAX.toFixed(2)};
           if (rvF > rvL) discard;
           ${mode === 'lace' ? 'if (laceMask(vBind) < 0.5) discard;' : ''}
           float tcut = tearCut(vBind);
           if (uTear > 0.0 && vBind.y < tcut) discard;
           float tEdge = uTear > 0.0 ? smoothstep(0.035 * uH, 0.0, vBind.y - tcut) : 0.0;
           float dirtN = fract(sin(dot(floor(vBind / uH * 34.0), vec3(3.1, 7.7, 1.3))) * 913.1);
           float dirt = uDirt * (1.0 - smoothstep(0.0, 0.32 * uH, vBind.y)) * (0.45 + 0.55 * dirtN);
           float rvEdge = smoothstep(0.07, 0.0, rvL - rvF) * step(uReveal, 0.999);`;
    const light =
      mode === 'out'
        ? 'outgoingLight = mix(outgoingLight, vec3(0.62, 0.6, 0.58), rvEdge * 0.75);'
        : 'outgoingLight += vec3(0.9, 0.86, 0.8) * rvEdge * 0.9; outgoingLight *= (1.0 - tEdge * 0.5) * (1.0 - dirt * 0.55) * mix(vec3(1.0), vec3(0.82, 0.9, 0.72), dirt);';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + REVEAL_PARS)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + test)
      .replace('#include <opaque_fragment>', light + '\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => `dress-${mode}`;
  mat.needsUpdate = true;
}

/** Machine lace: a fine net with rosettes and scalloped bands, as an alpha map. */
function laceTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rand = mulberry32(77);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 1;
  for (let i = -S; i < S * 2; i += 9) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + S, S);
    g.moveTo(i, S);
    g.lineTo(i + S, 0);
    g.stroke();
  }
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  const rosette = (x: number, y: number, r: number) => {
    g.lineWidth = 2.2;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.beginPath();
      g.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.42, r * 0.2, a, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.arc(x, y, r * 0.2, 0, Math.PI * 2);
    g.fill();
  };
  for (const [x, y] of [
    [64, 64],
    [192, 64],
    [0, 192],
    [128, 192],
    [256, 192],
    [64, 320 - 256],
  ]) {
    rosette(x, y, 30 + rand() * 4);
    // Tile the edges.
    rosette(x + (x < 128 ? S : -S), y, 30);
  }
  // Tendrils between the rosettes.
  g.lineWidth = 2;
  for (let i = 0; i < 18; i++) {
    const x = rand() * S;
    const y = rand() * S;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + 20, y - 18, x + 30, y + 18, x + 46, y + 4);
    g.stroke();
  }
  // A scalloped band across the middle.
  g.lineWidth = 3;
  for (let x = 0; x < S; x += 32) {
    g.beginPath();
    g.arc(x + 16, 128, 16, 0, Math.PI);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(9, 6);
  return t;
}

/** Tulle: a sheer hexagonal net, with an embroidered border along the hem and sides. */
function tulleTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(120,120,120)';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  for (let y = 0; y < S; y += 6) {
    g.beginPath();
    for (let x = 0; x <= S; x += 6) g.lineTo(x, y + ((x / 6) % 2 ? 3 : 0));
    g.stroke();
  }
  // Border: scallops and small flowers at the bottom (v → 1) and both sides.
  const border = (draw: (k: number) => [number, number, number]) => {
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let k = 0; k < 24; k++) {
      const [x, y, a] = draw(k);
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x, y, 11, a, a + Math.PI);
      g.stroke();
      g.beginPath();
      g.arc(x, y - Math.sin(a + Math.PI / 2) * 16, 3.5, 0, Math.PI * 2);
      g.fill();
    }
  };
  border((k) => [k * 22 + 11, S - 14, 0]);
  border((k) => [12, k * 22 + 11, -Math.PI / 2]);
  border((k) => [S - 12, k * 22 + 11, Math.PI / 2]);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillRect(0, S - 4, S, 4);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/**
 * The veil: a small verlet cloth (a grid of particles with distance
 * constraints) hanging from a pearl comb on the back of her head. It
 * collides with a sphere for the head, a capsule for the torso and a cone
 * for the skirt. This is a real (if modest) cloth simulation, limited to
 * the veil; the gown itself is skinned to her skeleton.
 */
class VeilCloth {
  readonly mesh: THREE.Mesh;
  readonly comb: THREE.Mesh;
  private cols = 13;
  private rows = 22;
  private pos: Float32Array;
  private prev: Float32Array;
  private geo: THREE.BufferGeometry;
  private anchorsLocal: THREE.Vector3[] = [];
  private headCenterLocal: THREE.Vector3;
  private headR: number;
  private acc = 0;
  private time = 0;
  private live = false;
  /** World length of the veil; may change while it hangs (the reflection's grows). */
  length = 1.15;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(private char: GeneratedCharacter) {
    const p = char.design.proportions;
    const R = p.height * 0.064 * p.head;
    this.headR = R;
    this.headCenterLocal = new THREE.Vector3(0, R * 1.02, R * 0.12);
    // Anchors: an arc across the back of the crown, ear to ear.
    for (let i = 0; i < this.cols; i++) {
      const a = -1.75 + (3.5 * i) / (this.cols - 1);
      this.anchorsLocal.push(new THREE.Vector3(Math.sin(a) * R * 1.02, R * 1.02 + R * 0.42 + Math.cos(a) * R * 0.2, R * 0.12 - Math.cos(a) * R * 0.92));
    }
    const n = this.cols * this.rows;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(n * 2);
    const idx: number[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        uv[(r * this.cols + c) * 2] = c / (this.cols - 1);
        uv[(r * this.cols + c) * 2 + 1] = 1 - r / (this.rows - 1);
        if (r < this.rows - 1 && c < this.cols - 1) {
          const a = r * this.cols + c;
          idx.push(a, a + this.cols, a + 1, a + 1, a + this.cols, a + this.cols + 1);
        }
      }
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    const tulle = tulleTexture();
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshStandardMaterial({
        color: 0xf6f2ec,
        alphaMap: tulle,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
        roughness: 0.7,
        emissive: 0x2a2826,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    // The comb: a curved band of pearls the veil hangs from.
    const curve = new THREE.CatmullRomCurve3(this.anchorsLocal.map((v) => v.clone()));
    this.comb = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 40, R * 0.06, 6, false),
      new THREE.MeshPhysicalMaterial({ color: 0xf2ece2, roughness: 0.25, clearcoat: 1, sheen: 0.6, sheenColor: new THREE.Color(0xffffff) }),
    );
    this.comb.matrixAutoUpdate = false;
    this.comb.visible = false;
  }

  private anchorWorld(i: number, lift: number, out: THREE.Vector3): THREE.Vector3 {
    this.char.rig.bone('head').localToWorld(out.copy(this.anchorsLocal[i]));
    out.y += lift;
    return out;
  }

  /** Start hanging from anchors `lift` metres above her head. */
  begin(lift: number): void {
    this.live = true;
    this.mesh.visible = true;
    this.comb.visible = true;
    this.char.object.updateMatrixWorld(true);
    const seg = this.length / (this.rows - 1);
    for (let c = 0; c < this.cols; c++) {
      const a = this.anchorWorld(c, lift, this.tmp);
      for (let r = 0; r < this.rows; r++) {
        const i = (r * this.cols + c) * 3;
        this.pos[i] = a.x;
        this.pos[i + 1] = a.y - r * seg;
        this.pos[i + 2] = a.z;
      }
    }
    this.prev.set(this.pos);
  }

  hide(): void {
    this.live = false;
    this.mesh.visible = false;
    this.comb.visible = false;
  }

  get active(): boolean {
    return this.live;
  }

  update(dt: number, lift: number): void {
    if (!this.live) return;
    this.time += dt;
    const head = this.char.rig.bone('head');
    const m = this.tmp2.set(0, lift, 0);
    // Comb follows the head (in world space so it can descend from above).
    this.comb.matrix.copy(head.matrixWorld);
    this.comb.matrix.elements[13] += m.y;
    this.comb.matrixWorldNeedsUpdate = true;
    this.comb.updateMatrixWorld(true);

    this.acc += Math.min(dt, 0.1);
    const h = 1 / 90;
    let steps = 0;
    while (this.acc >= h && steps < 6) {
      this.acc -= h;
      steps++;
      this.step(h, lift);
    }
    const attr = this.geo.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  private step(h: number, lift: number): void {
    const P = this.pos;
    const Q = this.prev;
    const n = this.cols * this.rows;
    const g = -9.8 * h * h;
    const flutter = 0.35 * h * h;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const r = Math.floor(i / this.cols);
      const vx = (P[k] - Q[k]) * 0.985;
      const vy = (P[k + 1] - Q[k + 1]) * 0.985;
      const vz = (P[k + 2] - Q[k + 2]) * 0.985;
      Q[k] = P[k];
      Q[k + 1] = P[k + 1];
      Q[k + 2] = P[k + 2];
      const f = Math.sin(this.time * 2.1 + i * 0.37) * flutter * (r / this.rows);
      P[k] += vx + f;
      P[k + 1] += vy + g;
      P[k + 2] += vz + f * 0.6;
    }
    const seg = this.length / (this.rows - 1);
    const width = this.headR * 1.14 * 2.2;
    const cseg = width / (this.cols - 1);
    for (let it = 0; it < 4; it++) {
      // Row 0 is pinned to the comb.
      for (let c = 0; c < this.cols; c++) {
        const a = this.anchorWorld(c, lift, this.tmp);
        P[c * 3] = a.x;
        P[c * 3 + 1] = a.y;
        P[c * 3 + 2] = a.z;
      }
      for (let r = 0; r < this.rows; r++)
        for (let c = 0; c < this.cols; c++) {
          const i = r * this.cols + c;
          if (r > 0) this.satisfy(i, i - this.cols, seg, r === 1);
          // Hem spreads a little wider than the comb.
          if (c > 0) this.satisfy(i, i - 1, cseg * (1 + (r / this.rows) * 0.55), r === 0);
        }
      this.collide();
    }
  }

  private satisfy(a: number, b: number, rest: number, pinB: boolean): void {
    const P = this.pos;
    const ia = a * 3;
    const ib = b * 3;
    const dx = P[ia] - P[ib];
    const dy = P[ia + 1] - P[ib + 1];
    const dz = P[ia + 2] - P[ib + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const diff = (d - rest) / d;
    const wa = pinB ? 1 : 0.5;
    const wb = pinB ? 0 : 0.5;
    P[ia] -= dx * diff * wa;
    P[ia + 1] -= dy * diff * wa;
    P[ia + 2] -= dz * diff * wa;
    P[ib] += dx * diff * wb;
    P[ib + 1] += dy * diff * wb;
    P[ib + 2] += dz * diff * wb;
  }

  private collide(): void {
    const P = this.pos;
    const ch = this.char;
    const s = ch.design.scale;
    const head = ch.rig.bone('head').localToWorld(this.tmp.copy(this.headCenterLocal));
    const hr = this.headR * s * 1.18;
    const neck = ch.rig.bone('neck').getWorldPosition(this.tmp2);
    const hips = ch.rig.bone('hips').getWorldPosition(new THREE.Vector3());
    const base = ch.object.position;
    const tr = 0.17 * s;
    for (let i = this.cols; i < this.cols * this.rows; i++) {
      const k = i * 3;
      // Head.
      let dx = P[k] - head.x;
      let dy = P[k + 1] - head.y;
      let dz = P[k + 2] - head.z;
      let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < hr && d > 1e-5) {
        P[k] = head.x + (dx / d) * hr;
        P[k + 1] = head.y + (dy / d) * hr;
        P[k + 2] = head.z + (dz / d) * hr;
      }
      const y = P[k + 1];
      if (y < neck.y && y > hips.y) {
        // Torso capsule (vertical enough to treat per height).
        const t = (neck.y - y) / Math.max(1e-3, neck.y - hips.y);
        const cx = neck.x + (hips.x - neck.x) * t;
        const cz = neck.z + (hips.z - neck.z) * t;
        dx = P[k] - cx;
        dz = P[k + 2] - cz;
        d = Math.hypot(dx, dz);
        const rr = tr * (1 + 0.15 * Math.sin(t * Math.PI));
        if (d < rr && d > 1e-5) {
          P[k] = cx + (dx / d) * rr;
          P[k + 2] = cz + (dz / d) * rr;
        }
      } else if (y <= hips.y) {
        // The skirt bells out toward the floor.
        const t = clamp((hips.y - y) / Math.max(0.2, hips.y - base.y), 0, 1);
        const rr = (0.19 + 0.43 * Math.pow(t, 1.3)) * s;
        dx = P[k] - base.x;
        dz = P[k + 2] - base.z;
        d = Math.hypot(dx, dz);
        if (d < rr && d > 1e-5) {
          P[k] = base.x + (dx / d) * rr;
          P[k + 2] = base.z + (dz / d) * rr;
        }
      }
      if (P[k + 1] < base.y + 0.01) P[k + 1] = base.y + 0.01;
    }
  }
}

/**
 * The house's wedding gown for one character: skinned to the same skeleton
 * as her everyday clothes, so face, hair, proportions and animation are
 * untouched. `reveal` (0..1) drives a continuous transformation: the gown
 * appears and the coat whitens and dissolves along the same field. The veil
 * descends (`veilDrop` 0..1) and then hangs as cloth.
 */
export class WeddingDress {
  readonly uniforms: RevealUniforms;
  readonly veil: VeilCloth;
  private gown: THREE.SkinnedMesh[] = [];
  private replaced: THREE.SkinnedMesh[] = [];
  private _reveal = 0;
  veilDrop = 0;
  private veilStarted = false;
  /** Metres above her head the veil starts from. */
  private veilLift = 1.5;

  constructor(
    readonly char: GeneratedCharacter,
    worldParent: THREE.Object3D,
  ) {
    const rig = char.rig;
    const H = char.design.proportions.height;
    const waist = rig.m.hipJointY + 0.36 * (rig.m.neckBaseY - rig.m.hipJointY);
    this.uniforms = {
      uReveal: { value: 0 },
      uWaist: { value: waist },
      uRange: { value: waist },
      uWristL: { value: rig.bindPos.get('wristL')!.clone() },
      uWristR: { value: rig.bindPos.get('wristR')!.clone() },
      uNeckY: { value: rig.bindPos.get('neck')!.y },
      uH: { value: H },
      uTear: { value: 0 },
      uDirt: { value: 0 },
    };

    const silk = fabric('silk');
    const map = silk.map.clone();
    const bump = silk.bump.clone();
    for (const t of [map, bump]) {
      t.repeat.set(6, 5);
      t.needsUpdate = true;
    }
    const mats: Record<string, THREE.Material> = {
      gown: new THREE.MeshPhysicalMaterial({
        color: 0xeee6da,
        map,
        bumpMap: bump,
        bumpScale: 0.6,
        roughness: 0.42,
        sheen: 1,
        sheenColor: new THREE.Color(0xffffff),
        sheenRoughness: 0.32,
        clearcoat: 0.12,
        clearcoatRoughness: 0.5,
      }),
      gownLace: new THREE.MeshPhysicalMaterial({
        color: 0xf8f4ee,
        alphaMap: laceTexture(),
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        roughness: 0.75,
        sheen: 0.5,
        sheenColor: new THREE.Color(0xffffff),
      }),
      gownTrim: new THREE.MeshPhysicalMaterial({ color: 0xf2ebe0, roughness: 0.3, sheen: 1, sheenColor: new THREE.Color(0xffffff), clearcoat: 0.3 }),
      gownPearl: new THREE.MeshPhysicalMaterial({ color: 0xf4efe6, roughness: 0.2, clearcoat: 1, iridescence: 0.5 }),
      gownLining: new THREE.MeshStandardMaterial({ color: 0xb8afa3, roughness: 0.9, side: THREE.DoubleSide }),
    };
    for (const [slot, m] of Object.entries(mats)) patch(m, this.uniforms, slot === 'gownLace' ? 'lace' : 'in');

    const parts = new BodyBuilder(rig, char.outfit).buildGown();
    const bySlot = new Map<string, THREE.BufferGeometry[]>();
    for (const p of parts) {
      const list = bySlot.get(p.slot) ?? [];
      list.push(normalizeAttributes(p.geo));
      bySlot.set(p.slot, list);
    }
    for (const [slot, geos] of bySlot) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = char.addSkinned(merged, mats[slot], slot);
      mesh.visible = false;
      mesh.castShadow = false;
      mesh.layers.mask = char.object.layers.mask;
      this.gown.push(mesh);
    }
    // Her own clothes dissolve along the same field.
    for (const mesh of char.clothing) {
      if (!REPLACED.includes(mesh.name)) continue;
      this.replaced.push(mesh);
      const mat = char.materials.get(mesh.name);
      if (mat) patch(mat, this.uniforms, 'out');
    }

    this.veil = new VeilCloth(char);
    worldParent.add(this.veil.mesh);
    worldParent.add(this.veil.comb);
  }

  /** Match the character's render layers (the mirror shows one body, the room another). */
  setLayers(mask: number): void {
    this.veil.mesh.layers.mask = mask;
    this.veil.comb.layers.mask = mask;
    for (const m of this.gown) m.layers.mask = mask;
  }

  get reveal(): number {
    return this._reveal;
  }

  set reveal(v: number) {
    this._reveal = clamp(v, 0, 1);
    this.uniforms.uReveal.value = this._reveal;
    const r = this._reveal;
    for (const m of this.gown) {
      m.visible = r > 0;
      // Lace would throw its unmasked pattern as a shadow onto the silk.
      m.castShadow = r > 0.35 && m.name !== 'gownLace';
    }
    for (const m of this.replaced) {
      m.visible = r < 1;
      m.castShadow = r < 0.65;
    }
  }

  update(dt: number): void {
    if (this.veilDrop > 0 && !this.veilStarted) {
      this.veilStarted = true;
      this.veil.begin(this.veilLift);
    }
    if (this.veil.active) {
      this.char.object.updateMatrixWorld(true);
      const k = smoothstep(0, 1, this.veilDrop);
      this.veil.update(dt, (1 - k) * this.veilLift);
    }
  }

  /** Stage 5: 0..1, how much of the skirt the window frame tore away. */
  set tear(v: number) {
    this.uniforms.uTear.value = clamp(v, 0, 1);
  }

  get tear(): number {
    return this.uniforms.uTear.value as number;
  }

  /** Stage 5: grass and earth on the hem after the fall. */
  set dirt(v: number) {
    this.uniforms.uDirt.value = clamp(v, 0, 1);
  }

  /** Back to her own clothes. */
  reset(): void {
    this.tear = 0;
    this.dirt = 0;
    this.reveal = 0;
    this.veilDrop = 0;
    this.veilStarted = false;
    this.veil.hide();
    this.veil.length = 1.15;
  }

  /** Fully dressed, veil already settled (debug jumps and the reflection's set-up). */
  wearNow(): void {
    this.reveal = 1;
    this.veilDrop = 1;
    this.veilStarted = true;
    this.veil.begin(0);
    // Let the veil settle before anyone sees it.
    for (let i = 0; i < 90; i++) this.veil.update(1 / 60, 0);
  }
}
