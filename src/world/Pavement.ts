import * as THREE from 'three';
import { COURSE, PATH_HALF_WIDTH } from '../config';
import { clamp, damp, invLerp, lerp, noise1, smoothstep } from '../core/math';
import type { EventBus } from '../core/Events';
import { cobblestone } from './Textures';

const X0 = -60;
const X1 = 660;
const STEP = 0.8;
const SURFACE_ROWS = 15;
const SKIRT_DEPTH = -0.5;

export type PavementPhase = 'dormant' | 'rising' | 'sliding';

/**
 * The crooked park path, built as a height field so that a section of it can
 * physically rise into a hill, roll, tilt, and finally fold into a slide that
 * carries the Visitor toward the house.
 *
 * heightAt() is the single source of truth for the ground: the Visitor,
 * obstacles and camera all query it, so the deformation is never just visual.
 */
export class Pavement {
  readonly mesh: THREE.Mesh;
  phase: PavementPhase = 'dormant';

  /** 0..1 — how far the hill has risen. */
  rise = 0;
  /** 0..1 — how far the far side of the hill has folded into a slide. */
  slide = 0;
  private time = 0;
  private riseTarget = 0;
  private slideTarget = 0;

  private geo: THREE.BufferGeometry;
  private cols: number;
  private colX: Float32Array;
  private colHalf: Float32Array;
  private colCenter: Float32Array;
  private deformFrom: number;
  private deformTo: number;
  private bumps: Array<{ x0: number; length: number; height: number; amp: number; target: number }> = [];
  private wasDeformed = false;

  constructor(private bus: EventBus) {
    this.cols = Math.floor((X1 - X0) / STEP) + 1;
    const rows = SURFACE_ROWS + 2;
    this.colX = new Float32Array(this.cols);
    this.colHalf = new Float32Array(this.cols);
    this.colCenter = new Float32Array(this.cols);

    const pos = new Float32Array(this.cols * rows * 3);
    const uv = new Float32Array(this.cols * rows * 2);
    const col = new Float32Array(this.cols * rows * 3);
    const idx: number[] = [];

    for (let c = 0; c < this.cols; c++) {
      const x = X0 + c * STEP;
      this.colX[c] = x;
      this.colHalf[c] = Pavement.halfWidth(x);
      this.colCenter[c] = Pavement.centerOffset(x);
      for (let r = 0; r < rows; r++) {
        const i = c * rows + r;
        const z = this.rowZ(c, r);
        pos[i * 3] = x;
        pos[i * 3 + 1] = 0;
        pos[i * 3 + 2] = z;
        uv[i * 2] = x / 4.2;
        uv[i * 2 + 1] = z / 4.2;
        const wall = r === 0 || r === rows - 1;
        // Darken the walls and the worn path edges.
        const edge = Math.abs(z - this.colCenter[c]) / this.colHalf[c];
        const shade = wall ? 0.35 : lerp(1.0, 0.6, Math.pow(edge, 4));
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = shade;
      }
    }
    for (let c = 0; c < this.cols - 1; c++) {
      for (let r = 0; r < rows - 1; r++) {
        const a = c * rows + r;
        const b = (c + 1) * rows + r;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geo.setIndex(idx);
    this.applyHeights(0, this.cols - 1);

    const tex = cobblestone();
    const mat = new THREE.MeshStandardMaterial({
      map: tex.map,
      bumpMap: tex.bump,
      bumpScale: 2.2,
      roughnessMap: tex.rough,
      roughness: 0.85,
      metalness: 0.05,
      vertexColors: true,
      color: 0x9c93ad,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.name = 'pavement';

    const from = Math.floor((COURSE.pavementStart - 4 - X0) / STEP);
    const to = Math.ceil((COURSE.pavementEnd + 4 - X0) / STEP);
    this.deformFrom = clamp(from, 0, this.cols - 1);
    this.deformTo = clamp(to, 0, this.cols - 1);
  }

  static halfWidth(x: number): number {
    return PATH_HALF_WIDTH + 0.35 * noise1(x * 0.13, 1) + 0.12 * noise1(x * 0.9, 4);
  }

  static centerOffset(x: number): number {
    return 0.3 * noise1(x * 0.045, 9);
  }

  private rowZ(c: number, r: number): number {
    const half = this.colHalf[c];
    const center = this.colCenter[c];
    const s = clamp(r - 1, 0, SURFACE_ROWS - 1) / (SURFACE_ROWS - 1);
    return center - half + s * half * 2;
  }

  /** Height the path will have at x once fully risen (used to size trees placed on the hill). */
  plannedHeight(x: number): number {
    const [r, s] = [this.rise, this.slide];
    this.rise = 1;
    this.slide = x > COURSE.hillCrest - 20 ? 1 : 0;
    const h = x < COURSE.pavementStart || x > COURSE.pavementEnd ? 0 : this.profile(x);
    this.rise = r;
    this.slide = s;
    return h;
  }

  reset(): void {
    this.phase = 'dormant';
    this.rise = this.slide = 0;
    this.riseTarget = this.slideTarget = 0;
    this.time = 0;
    this.bumps.length = 0;
    this.applyHeights(0, this.cols - 1);
    this.wasDeformed = false;
  }

  /** Scripted: the Demon (or the course) asks the pavement to rise. */
  beginRise(): void {
    if (this.phase !== 'dormant') return;
    this.phase = 'rising';
    this.riseTarget = 1;
    this.bus.emit('pavement:rise', {});
  }

  beginSlide(): void {
    if (this.phase === 'sliding') return;
    this.phase = 'sliding';
    this.riseTarget = 1;
    this.slideTarget = 1;
    this.bus.emit('pavement:slide', {});
  }

  get active(): boolean {
    return this.rise > 0.001 || this.slide > 0.001;
  }

  /**
   * The sarcastic pavement: tilt a stretch of path ahead uphill, gradually.
   * Separate from the scripted hill/slide, which stays a directed event.
   */
  raiseIncline(x0: number, length: number, height: number): void {
    this.bumps.push({ x0, length, height, amp: 0, target: 1 });
  }

  /** Let every incline sink back down. */
  lowerInclines(): void {
    for (const b of this.bumps) b.target = 0;
  }

  get inclineActive(): boolean {
    return this.bumps.some((b) => b.target > 0);
  }

  private bumpHeight(x: number): number {
    let h = 0;
    for (const b of this.bumps) {
      if (b.amp <= 0.0001 || x < b.x0 || x > b.x0 + b.length) continue;
      const t = (x - b.x0) / b.length;
      // A long, gentle climb, then a short drop back to level.
      const shape = t < 0.75 ? smoothstep(0, 0.75, t) : 1 - smoothstep(0.75, 1, t);
      h += shape * b.height * b.amp;
    }
    return h;
  }

  update(dt: number): void {
    this.time += dt;
    this.rise = damp(this.rise, this.riseTarget, 0.9, dt);
    this.slide = damp(this.slide, this.slideTarget, 1.3, dt);
    let dirty = false;
    if (this.active) {
      this.applyHeights(this.deformFrom, this.deformTo, false);
      this.wasDeformed = true;
      dirty = true;
    } else if (this.wasDeformed) {
      this.applyHeights(this.deformFrom, this.deformTo, false);
      this.wasDeformed = false;
      dirty = true;
    }
    for (let i = this.bumps.length - 1; i >= 0; i--) {
      const b = this.bumps[i];
      const prev = b.amp;
      b.amp = damp(b.amp, b.target, b.target > b.amp ? 0.9 : 1.6, dt);
      if (b.target === 0 && b.amp < 0.002) b.amp = 0;
      if (prev !== b.amp) {
        this.applyHeights(this.colOf(b.x0 - 1), this.colOf(b.x0 + b.length + 1), false);
        dirty = true;
      }
      if (b.target === 0 && b.amp === 0) this.bumps.splice(i, 1);
    }
    if (dirty) this.finishHeights();
  }

  private colOf(x: number): number {
    return clamp(Math.round((x - X0) / STEP), 0, this.cols - 1);
  }

  /** Large-scale shape of the hill/slide (no waves) along the course. */
  private profile(x: number): number {
    const { pavementStart: P0, hillCrest: crest, pavementEnd: P1 } = COURSE;
    const peak = 9;
    if (x < P0 + 6 || x > P1) return 0;
    const climb = smoothstep(P0 + 6, crest, x) * peak;
    if (x <= crest) return climb * this.rise;
    const mound = (1 - smoothstep(crest, crest + 32, x)) * peak;
    const chute =
      peak - 4.6 * smoothstep(crest, crest + 34, x) - 4.4 * invLerp(crest + 34, P1 - 14, x);
    return lerp(mound * this.rise, chute, this.slide) * smoothstep(P1, P1 - 14, x);
  }

  heightAt(x: number, z: number): number {
    const b = this.bumps.length ? this.bumpHeight(x) : 0;
    return this.sectionHeight(x, z) + b;
  }

  /** The scripted hill/slide section. */
  private sectionHeight(x: number, z: number): number {
    const { pavementStart: P0, pavementEnd: P1, hillCrest: crest } = COURSE;
    if (x < P0 || x > P1 || !this.active) return 0;
    const t = this.time;
    const w = smoothstep(P0, P0 + 12, x) * (1 - smoothstep(P1 - 14, P1, x));
    let h = this.profile(x);

    // Rolling swells while the hill is waking up.
    const awake = this.rise * (1 - this.slide * 0.6);
    h += awake * w * 0.42 * Math.sin(x * 0.55 - t * 3.1) * smoothstep(P0, P0 + 30, x);
    // Ripples racing toward the house once it becomes a slide.
    h += this.slide * w * 0.32 * Math.sin(x * 0.32 - t * 5.5) * smoothstep(crest, crest + 20, x);

    // The surface tilts side to side — like something breathing underneath.
    const roll = this.rollAngle() * w;
    h += Math.tan(roll) * z;

    // Slide trough: edges lift so it reads as a chute.
    const trough = this.slide * smoothstep(crest - 12, crest + 10, x);
    const e = Math.abs(z) / PATH_HALF_WIDTH;
    h += trough * 1.5 * e * e * e;

    // Never sink below the surrounding ground.
    return Math.max(0, h);
  }

  /** Current side-to-side tilt in radians (positive lifts the near side). */
  rollAngle(): number {
    const t = this.time;
    const a = this.rise * (1 - this.slide * 0.5);
    return a * (0.075 * Math.sin(t * 1.05) + 0.035 * Math.sin(t * 2.4 + 1.3));
  }

  /** Forward slope dh/dx at a point (positive = uphill). */
  slopeAt(x: number, z: number): number {
    const e = 0.4;
    return (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
  }

  private applyHeights(from: number, to: number, finish = true): void {
    const rows = SURFACE_ROWS + 2;
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const uvAttr = this.geo.getAttribute('uv') as THREE.BufferAttribute;
    const uvs = uvAttr.array as Float32Array;
    for (let c = from; c <= to; c++) {
      const x = this.colX[c];
      for (let r = 0; r < rows; r++) {
        const vi = c * rows + r;
        const i = vi * 3;
        const wall = r === 0 || r === rows - 1;
        const z = arr[i + 2];
        if (wall) {
          arr[i + 1] = SKIRT_DEPTH;
          // Walls share z with the edge row, so map V by height instead of z
          // to avoid stretched stripes when the slab rises.
          const h = this.heightAt(x, z) - SKIRT_DEPTH;
          uvs[vi * 2 + 1] = z / 4.2 + (r === 0 ? h : -h) / 4.2;
        } else {
          arr[i + 1] = this.heightAt(x, z) + 0.02;
        }
      }
    }
    pos.needsUpdate = true;
    uvAttr.needsUpdate = true;
    if (finish) this.finishHeights();
  }

  private finishHeights(): void {
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }
}
