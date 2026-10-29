import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const SIDE = new THREE.Vector3(1, 0, 0);

/**
 * A living tendril: a tapered tube laid along a curve the script moves
 * every frame, drawn out from its root by `extent` (0 = not yet grown, 1 =
 * the whole curve). Thorny bumps ride along it. Used for the vines in the
 * window frame, the one that follows her out of the house, the vine at the
 * door, and — in black — the shadow limbs of the third friend.
 */
export class Vine {
  readonly mesh: THREE.Mesh;
  /** 0..1 — how far along its path it has grown. */
  extent = 0;
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private nor: Float32Array;
  private curve = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)], false, 'centripetal');
  private samples: THREE.Vector3[];
  private tangent = new THREE.Vector3();
  private normal = new THREE.Vector3();
  private binormal = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  constructor(
    material: THREE.Material,
    private radius = 0.03,
    private segments = 48,
    private radial = 7,
    /** Thorn bumps per metre (0 = smooth). */
    private thorns = 9,
  ) {
    const rings = segments + 1;
    const vcount = rings * (radial + 1) + 1;
    this.pos = new Float32Array(vcount * 3);
    this.nor = new Float32Array(vcount * 3);
    const uv = new Float32Array(vcount * 2);
    const idx: number[] = [];
    for (let i = 0; i < segments; i++)
      for (let j = 0; j < radial; j++) {
        const a = i * (radial + 1) + j;
        const b = a + radial + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    for (let i = 0; i < rings; i++)
      for (let j = 0; j <= radial; j++) {
        uv[(i * (radial + 1) + j) * 2] = j / radial;
        uv[(i * (radial + 1) + j) * 2 + 1] = i / segments;
      }
    // The tip: a cone point capping the last ring.
    const tip = rings * (radial + 1);
    for (let j = 0; j < radial; j++) idx.push(segments * (radial + 1) + j, tip, segments * (radial + 1) + j + 1);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.visible = false;
    this.samples = Array.from({ length: rings }, () => new THREE.Vector3());
  }

  setPath(points: THREE.Vector3[]): void {
    this.curve.points = points;
    this.curve.updateArcLengths();
  }

  /** Rebuild the tube along the grown part of the path. `time` animates the thorns' slight writhing. */
  update(time = 0): void {
    const e = Math.min(1, Math.max(0, this.extent));
    this.mesh.visible = e > 0.002;
    if (!this.mesh.visible) return;
    const n = this.segments;
    const R = this.radial;
    const len = this.curve.getLength() * e;
    for (let i = 0; i <= n; i++) this.curve.getPointAt((i / n) * e, this.samples[i]);
    // Parallel-transported frames, so the tube never twists on a bend.
    this.tangent.subVectors(this.samples[1], this.samples[0]).normalize();
    this.normal.crossVectors(this.tangent, Math.abs(this.tangent.y) > 0.9 ? SIDE : UP).normalize();
    for (let i = 0; i <= n; i++) {
      const p = this.samples[i];
      const prev = this.samples[Math.max(0, i - 1)];
      const next = this.samples[Math.min(n, i + 1)];
      const t = this.tmp.subVectors(next, prev);
      if (t.lengthSq() > 1e-10) {
        t.normalize();
        // Transport the normal onto the new tangent.
        this.normal.addScaledVector(t, -this.normal.dot(t)).normalize();
        this.tangent.copy(t);
      }
      this.binormal.crossVectors(this.tangent, this.normal);
      const f = i / n;
      const s = f * len;
      const thorn = this.thorns > 0 ? Math.pow(Math.max(0, Math.sin(s * this.thorns * Math.PI * 2 + time * 0.7)), 12) * 0.9 : 0;
      const r = this.radius * (1 - f * 0.88) * (1 + thorn);
      for (let j = 0; j <= R; j++) {
        const a = (j / R) * Math.PI * 2;
        const cx = Math.cos(a);
        const sy = Math.sin(a);
        const k = (i * (R + 1) + j) * 3;
        const nx = this.normal.x * cx + this.binormal.x * sy;
        const ny = this.normal.y * cx + this.binormal.y * sy;
        const nz = this.normal.z * cx + this.binormal.z * sy;
        this.pos[k] = p.x + nx * r;
        this.pos[k + 1] = p.y + ny * r;
        this.pos[k + 2] = p.z + nz * r;
        this.nor[k] = nx;
        this.nor[k + 1] = ny;
        this.nor[k + 2] = nz;
      }
    }
    const tip = (n + 1) * (R + 1) * 3;
    const end = this.samples[n];
    this.pos[tip] = end.x + this.tangent.x * this.radius * 0.8;
    this.pos[tip + 1] = end.y + this.tangent.y * this.radius * 0.8;
    this.pos[tip + 2] = end.z + this.tangent.z * this.radius * 0.8;
    this.nor[tip] = this.tangent.x;
    this.nor[tip + 1] = this.tangent.y;
    this.nor[tip + 2] = this.tangent.z;
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** World position of the grown tip. */
  tip(out: THREE.Vector3): THREE.Vector3 {
    return this.curve.getPointAt(Math.min(1, Math.max(0, this.extent)), out);
  }
}

/** The house's vine material: near-black bark-green with a wet sheen. */
export function vineMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x34422a, roughness: 0.45, metalness: 0.05, emissive: 0x0b1207 });
}
