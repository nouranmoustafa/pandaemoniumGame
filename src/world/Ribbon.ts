import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math';

const SEGMENTS = 64;

/** One shared satin look for every ribbon in the house. */
let satin: THREE.MeshPhysicalMaterial | null = null;
function satinMaterial(): THREE.MeshPhysicalMaterial {
  satin ??= new THREE.MeshPhysicalMaterial({
    color: 0xf3ede4,
    emissive: 0x100f0e,
    roughness: 0.35,
    sheen: 1,
    sheenColor: new THREE.Color(0xffffff),
    sheenRoughness: 0.3,
    side: THREE.DoubleSide,
  });
  return satin;
}

/**
 * A length of white silk ribbon: a flat strip laid along a curve through
 * control points the script moves every frame. `extent` (0..1) is how much
 * of it exists, measured from the root, so a ribbon can reach out of a
 * doorway or withdraw into the dark. It twists and flutters along its
 * length, and tapers at the free end.
 */
export class Ribbon {
  readonly mesh: THREE.Mesh;
  /** 0..1 of the curve that is drawn, from the root. */
  extent = 0;
  width: number;
  private curve = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)], false, 'centripetal');
  private pos: Float32Array;
  private geo = new THREE.BufferGeometry();
  private phase: number;
  private p = new THREE.Vector3();
  private tan = new THREE.Vector3();
  private side = new THREE.Vector3();
  private nrm = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(width = 0.07, phase = 0) {
    this.width = width;
    this.phase = phase;
    const n = (SEGMENTS + 1) * 2;
    this.pos = new Float32Array(n * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(n * 2);
    const idx: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      uv.set([i / SEGMENTS, 0, i / SEGMENTS, 1], i * 4);
      if (i < SEGMENTS) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, satinMaterial());
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.visible = false;
  }

  /** Lay the ribbon along these points (root first). The array is copied. */
  setPath(points: THREE.Vector3[]): void {
    const cp = this.curve.points;
    while (cp.length < points.length) cp.push(new THREE.Vector3());
    cp.length = points.length;
    for (let i = 0; i < points.length; i++) cp[i].copy(points[i]);
  }

  update(time: number): void {
    const e = clamp(this.extent, 0, 1);
    this.mesh.visible = e > 0.002;
    if (!this.mesh.visible) return;
    const P = this.pos;
    for (let i = 0; i <= SEGMENTS; i++) {
      const u = (i / SEGMENTS) * e;
      this.curve.getPointAt(u, this.p);
      this.curve.getTangentAt(u, this.tan);
      // A side vector across the strip, rolled by a slow travelling twist.
      this.side.crossVectors(this.tan, this.up);
      if (this.side.lengthSq() < 1e-4) this.side.set(1, 0, 0);
      this.side.normalize();
      this.nrm.crossVectors(this.side, this.tan).normalize();
      const twist = Math.sin(u * 9 - time * 2.2 + this.phase) * 0.9 + Math.sin(u * 23 + time * 3.7 + this.phase * 2) * 0.25;
      const c = Math.cos(twist);
      const s = Math.sin(twist);
      const sx = this.side.x * c + this.nrm.x * s;
      const sy = this.side.y * c + this.nrm.y * s;
      const sz = this.side.z * c + this.nrm.z * s;
      // Taper at the free end, so the tip reads as a loose end, not a cut.
      const along = i / SEGMENTS;
      const w = this.width * 0.5 * (1 - 0.65 * smoothstep(0.8, 1, along) * (e < 0.999 ? 1 : 0.6));
      const flutter = Math.sin(time * 6.5 + u * 14 + this.phase) * 0.012 * along;
      const k = i * 6;
      P[k] = this.p.x - sx * w + this.nrm.x * flutter;
      P[k + 1] = this.p.y - sy * w + this.nrm.y * flutter;
      P[k + 2] = this.p.z - sz * w + this.nrm.z * flutter;
      P[k + 3] = this.p.x + sx * w + this.nrm.x * flutter;
      P[k + 4] = this.p.y + sy * w + this.nrm.y * flutter;
      P[k + 5] = this.p.z + sz * w + this.nrm.z * flutter;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}
