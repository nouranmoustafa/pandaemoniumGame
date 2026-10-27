import * as THREE from 'three';

/**
 * A horizontal cross-section of a lofted body part. Shapes are elliptical
 * with separate front and back depth, so a single ring can describe a bust,
 * a shoulder blade or the back of a calf.
 */
export interface Ring {
  y: number;
  /** Half-width (model X). */
  rx: number;
  /** Depth toward the front (+Z). */
  zf: number;
  /** Depth toward the back (-Z). */
  zb: number;
  cx?: number;
  cz?: number;
  /** Superellipse exponent: 2 = ellipse, higher = boxier. */
  sq?: number;
  /** Cloth folds: radial ripple amplitude (fraction of radius) and count around. */
  fold?: number;
  folds?: number;
}

export interface LoftOptions {
  segments?: number;
  /** Angular range (radians from the front, clockwise seen from above). Full ring by default. */
  arc?: [number, number];
  capTop?: boolean;
  capBottom?: boolean;
  /** Extra subdivisions between rings (Catmull-Rom interpolated). */
  subdiv?: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Smoothly resample rings so silhouettes curve rather than kink. */
function refine(rings: Ring[], subdiv: number): Ring[] {
  if (subdiv <= 1 || rings.length < 2) return rings;
  const out: Ring[] = [];
  const keys: Array<keyof Ring> = ['y', 'rx', 'zf', 'zb', 'cx', 'cz', 'sq', 'fold'];
  for (let i = 0; i < rings.length - 1; i++) {
    const r0 = rings[Math.max(0, i - 1)];
    const r1 = rings[i];
    const r2 = rings[i + 1];
    const r3 = rings[Math.min(rings.length - 1, i + 2)];
    for (let s = 0; s < subdiv; s++) {
      const t = s / subdiv;
      const r = {} as Ring;
      for (const k of keys) {
        const v = (x: Ring) => (x[k] as number | undefined) ?? (k === 'sq' ? 2 : 0);
        (r as unknown as Record<string, number>)[k] = k === 'y' ? lerp(v(r1), v(r2), t) : catmull(v(r0), v(r1), v(r2), v(r3), t);
      }
      r.folds = r1.folds;
      out.push(r);
    }
  }
  out.push(rings[rings.length - 1]);
  return out;
}

export function ringPoint(r: Ring, theta: number, out = new THREE.Vector3()): THREE.Vector3 {
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const e = 2 / (r.sq ?? 2);
  const sx = Math.sign(s) * Math.pow(Math.abs(s), e);
  const cz = Math.sign(c) * Math.pow(Math.abs(c), e);
  // Folds: soft rounded ridges, sharper valleys (as hanging cloth falls).
  const f = r.fold ? 1 + r.fold * (Math.pow(0.5 + 0.5 * Math.sin(theta * (r.folds ?? 9) + r.y * 3), 0.6) - 0.5) : 1;
  return out.set((r.cx ?? 0) + r.rx * sx * f, r.y, (r.cz ?? 0) + (c >= 0 ? r.zf : r.zb) * cz * f);
}

/**
 * Loft rings along Y into a smooth tube with seam-safe normals and UVs
 * (u around, v along).
 */
export function loft(input: Ring[], opts: LoftOptions = {}): THREE.BufferGeometry {
  const rings = refine(input, opts.subdiv ?? 1);
  const seg = opts.segments ?? 24;
  const [a0, a1] = opts.arc ?? [-Math.PI, Math.PI];
  const closed = !opts.arc;
  const cols = seg + 1;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  // Arc length along the profile for v.
  const lens = [0];
  for (let i = 1; i < rings.length; i++) {
    const d = Math.hypot(rings[i].y - rings[i - 1].y, rings[i].rx - rings[i - 1].rx);
    lens.push(lens[i - 1] + d);
  }
  const total = lens[lens.length - 1] || 1;
  for (let i = 0; i < rings.length; i++) {
    for (let j = 0; j < cols; j++) {
      const th = lerp(a0, a1, j / seg);
      ringPoint(rings[i], th, p);
      pos.push(p.x, p.y, p.z);
      uv.push(j / seg, 1 - lens[i] / total);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * cols + j;
      const b = a + cols;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const addCap = (ri: number, top: boolean) => {
    const r = rings[ri];
    const ci = pos.length / 3;
    pos.push(r.cx ?? 0, r.y, r.cz ?? 0);
    uv.push(0.5, top ? 1 : 0);
    for (let j = 0; j < seg; j++) {
      const a = ri * cols + j;
      if (top) idx.push(ci, a, a + 1);
      else idx.push(ci, a + 1, a);
    }
  };
  if (opts.capTop) addCap(0, true);
  if (opts.capBottom) addCap(rings.length - 1, false);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  orientOutward(g, rings, seg);
  g.computeVertexNormals();
  if (closed) weldSeamNormals(g, rings.length, cols);
  return g;
}

/** Flip winding if the first quad faces inward (ring order may run up or down). */
function orientOutward(g: THREE.BufferGeometry, rings: Ring[], seg: number): void {
  const pos = g.getAttribute('position');
  const index = g.getIndex()!;
  const mid = Math.floor(rings.length / 2) - 1;
  const t = (Math.max(0, mid) * (seg + 1) + Math.floor(seg / 4)) * 6;
  if (t + 2 >= index.count) return;
  const va = new THREE.Vector3().fromBufferAttribute(pos, index.getX(t));
  const vb = new THREE.Vector3().fromBufferAttribute(pos, index.getX(t + 1));
  const vc = new THREE.Vector3().fromBufferAttribute(pos, index.getX(t + 2));
  const n = new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va));
  const r = rings[Math.max(0, mid)];
  const radial = new THREE.Vector3(va.x - (r.cx ?? 0), 0, va.z - (r.cz ?? 0));
  if (n.dot(radial) < 0) {
    const arr = index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const tmp = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = tmp;
    }
  }
}

function weldSeamNormals(g: THREE.BufferGeometry, rows: number, cols: number): void {
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const w = new THREE.Vector3();
  for (let i = 0; i < rows; i++) {
    const a = i * cols;
    const b = a + cols - 1;
    v.fromBufferAttribute(n, a);
    w.fromBufferAttribute(n, b);
    v.add(w).normalize();
    n.setXYZ(a, v.x, v.y, v.z);
    n.setXYZ(b, v.x, v.y, v.z);
  }
}

/** Ensure the attributes every character part shares exist (for merging). */
export function normalizeAttributes(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g;
  if (!ng.index) ng.setIndex([...Array(ng.getAttribute('position').count).keys()]);
  if (!ng.getAttribute('uv')) {
    ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.getAttribute('position').count * 2), 2));
  }
  if (!ng.getAttribute('normal')) ng.computeVertexNormals();
  for (const k of Object.keys(ng.attributes)) {
    if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'color'].includes(k)) ng.deleteAttribute(k);
  }
  return ng;
}

/** Ellipsoid helper for small details (buttons, curls, knuckles). */
export function ellipsoid(rx: number, ry: number, rz: number, w = 12, h = 8): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  return g;
}

/** Bends a vertical part's vertices along a curve: x/z offset as a function of y. */
export function bend(g: THREE.BufferGeometry, fn: (y: number) => [number, number]): THREE.BufferGeometry {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const [dx, dz] = fn(p.getY(i));
    p.setXYZ(i, p.getX(i) + dx, p.getY(i), p.getZ(i) + dz);
  }
  g.computeVertexNormals();
  return g;
}
