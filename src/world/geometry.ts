import * as THREE from 'three';

/**
 * A tube whose radius tapers along a curve. Three's TubeGeometry has a constant
 * radius, which reads as "pipe" rather than "branch".
 */
export function taperedTube(
  curve: THREE.Curve<THREE.Vector3>,
  segments: number,
  radial: number,
  r0: number,
  r1: number,
  vScale = 1,
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(segments, false);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const length = curve.getLength();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, p);
    const r = THREE.MathUtils.lerp(r0, r1, Math.pow(t, 0.85));
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const s = Math.sin(a);
      const c = -Math.cos(a);
      n.set(c * N.x + s * B.x, c * N.y + s * B.y, c * N.z + s * B.z).normalize();
      pos.push(p.x + r * n.x, p.y + r * n.y, p.z + r * n.z);
      nor.push(n.x, n.y, n.z);
      uv.push(j / radial, (t * length * vScale) / 2);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = (i + 1) * (radial + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** A single grass blade, pivoting at its base, tip at y = 1. */
export function bladeGeometry(width = 0.07): THREE.BufferGeometry {
  const segs = 4;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = width * (1 - t) * (1 - t * 0.2);
    const bend = t * t * 0.12;
    pos.push(-w, t, bend, w, t, bend);
    const c = THREE.MathUtils.lerp(0.25, 1, t);
    col.push(c, c, c, c, c, c);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpDir = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

let segGeo: THREE.BufferGeometry | null = null;
let knotGeo: THREE.BufferGeometry | null = null;

/**
 * A chain of tapered segments that can be posed from an arbitrary list of
 * points every frame without reallocating geometry. Used for grasping roots,
 * attacking branches and twig "fingers".
 *
 * Segments and joints are two InstancedMeshes, so a whole chain costs two
 * draw calls no matter how many segments it has.
 */
export class Tendril {
  readonly group = new THREE.Group();
  readonly points: THREE.Vector3[];
  private segs: THREE.InstancedMesh;
  private knots: THREE.InstancedMesh;
  private count: number;

  constructor(
    count: number,
    material: THREE.Material,
    private r0: number,
    private r1: number,
    castShadow = true,
  ) {
    // Unit cylinder with its base at the origin, growing along +Y.
    if (!segGeo) {
      segGeo = new THREE.CylinderGeometry(1, 1, 1, 7, 1, false);
      segGeo.translate(0, 0.5, 0);
    }
    knotGeo ??= new THREE.SphereGeometry(1, 8, 6);
    this.count = count;
    this.points = [];
    for (let i = 0; i <= count; i++) this.points.push(new THREE.Vector3());
    this.segs = new THREE.InstancedMesh(segGeo, material, count);
    this.knots = new THREE.InstancedMesh(knotGeo, material, count);
    for (const m of [this.segs, this.knots]) {
      m.castShadow = castShadow;
      // Points move every frame anywhere in the world; skip stale bounds.
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  /** Re-orient segments to follow this.points (world space). */
  sync(thickness = 1): void {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const a = this.points[i];
      const b = this.points[i + 1];
      tmpDir.subVectors(b, a);
      const len = tmpDir.length();
      const ra = THREE.MathUtils.lerp(this.r0, this.r1, i / n) * thickness;
      const rb = THREE.MathUtils.lerp(this.r0, this.r1, (i + 1) / n) * thickness;
      if (len < 1e-4) {
        this.segs.setMatrixAt(i, ZERO);
        this.knots.setMatrixAt(i, ZERO);
        continue;
      }
      tmpQ.setFromUnitVectors(UP, tmpDir.multiplyScalar(1 / len));
      const r = (ra + rb) / 2;
      this.segs.setMatrixAt(i, tmpM.compose(a, tmpQ, tmpS.set(r, len, r)));
      this.knots.setMatrixAt(i, tmpM.compose(a, tmpQ, tmpS.setScalar(ra * 1.12)));
    }
    this.segs.instanceMatrix.needsUpdate = true;
    this.knots.instanceMatrix.needsUpdate = true;
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }
}

/** Evaluate a quadratic Bézier. */
export function bezier(a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const u = 1 - t;
  return out.set(
    u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    u * u * a.z + 2 * u * t * c.z + t * t * b.z,
  );
}
