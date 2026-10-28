import * as THREE from 'three';

const gauss = (d: number, w: number) => Math.exp(-(d / w) * (d / w));
const sstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Facial structure: who she is. Values are around 1 for "average". */
export interface FaceShape {
  jaw: number;
  chin: number;
  cheek: number;
  nose: number;
  noseWidth: number;
  lips: number;
  eyeSize: number;
  eyeSpacing: number;
  /** Eye tilt: positive = upturned outer corners. */
  eyeTilt: number;
  browHeight: number;
}

export const HEAD_SCALE = { x: 0.84, y: 1.0, z: 0.95 };

/**
 * Front-centred spherical mapping shared by the sculpt, the painted face
 * texture and the morph regions: u spans the front hemisphere, so features
 * get texture resolution and the back of the head clamps to plain skin.
 */
export function faceUV(x: number, y: number, z: number): [number, number] {
  const phi = Math.atan2(x, z);
  const v = 0.5 + Math.asin(Math.max(-1, Math.min(1, y))) / Math.PI;
  return [0.5 + phi / Math.PI, v];
}

export function eyeCenter(f: FaceShape, side: 1 | -1): THREE.Vector3 {
  const ex = 0.35 * f.eyeSpacing * side;
  const ey = 0.02;
  const ez = Math.sqrt(1 - ex * ex - ey * ey) - 0.2 * f.eyeSize;
  return new THREE.Vector3(ex, ey, ez);
}

/** Sculpt a unit-sphere point into a stylized face (unit space). */
function sculpt(x: number, y: number, z: number, f: FaceShape): [number, number, number] {
  const front = sstep(-0.05, 0.55, z);
  const ax = Math.abs(x);
  const sx = Math.sign(x) || 1;
  // Jaw narrows toward a soft, pointed chin.
  const jawT = Math.pow(sstep(-0.2, -1.0, y), 1.25);
  x *= lerp(1, 0.64 * f.jaw, jawT * (0.45 + 0.55 * front) + jawT * 0.2 * (1 - front));
  // A rounder chin and fuller lower cheeks than a pure taper gives.
  x *= 1 + 0.06 * gauss(y + 0.55, 0.2) * front;
  // Flatten under the jaw (where it meets the neck).
  if (y < -0.6) y = lerp(y, -0.6 - (y + 0.6) * 0.75, sstep(0.2, -0.4, z));
  // Cranium: fuller at the back and top.
  z -= 0.07 * sstep(-0.1, 0.6, y) * sstep(0.15, -0.6, z);
  if (y > 0) y *= 0.92;
  // Chin.
  z += 0.1 * f.chin * gauss(y + 0.86, 0.16) * gauss(x, 0.3) * front;
  // Cheekbones, and the soft fullness below them.
  z += 0.035 * f.cheek * gauss(ax - 0.5, 0.16) * gauss(y + 0.12, 0.14) * front;
  x += sx * 0.03 * f.cheek * gauss(y + 0.1, 0.2) * gauss(z - 0.55, 0.3);
  z += 0.03 * gauss(ax - 0.32, 0.12) * gauss(y + 0.42, 0.12) * front;
  // Temples.
  x -= sx * 0.03 * gauss(y - 0.25, 0.2) * gauss(z - 0.45, 0.3);
  // Brow ridge and eye sockets.
  const by = 0.2 * f.browHeight;
  z += 0.03 * gauss(y - by, 0.07) * gauss(ax - 0.32, 0.2) * front;
  const e = eyeCenter(f, 1);
  const ed = Math.hypot(ax - e.x, (y - e.y) * 1.25);
  z -= 0.11 * f.eyeSize * gauss(ed, 0.2 * f.eyeSize) * front;
  // Nose: bridge → tip → under, with soft wings.
  const n = f.nose;
  const tipY = -0.27;
  const t = sstep(0.06, tipY, y);
  const width = lerp(0.07, 0.12, t) * f.noseWidth;
  let prof = y > tipY ? 0.012 + 0.11 * n * Math.pow(t, 1.8) : 0.122 * n * sstep(tipY - 0.08, tipY, y);
  prof += 0.026 * n * gauss(Math.hypot(x, y - tipY - 0.01), 0.05);
  z += prof * gauss(x, width) * front;
  z += 0.016 * n * gauss(Math.hypot(ax - 0.09 * f.noseWidth, y - tipY + 0.035), 0.042) * front;
  // Philtrum and lips.
  z += 0.012 * gauss(y + 0.4, 0.04) * gauss(x, 0.06) * front;
  const L = f.lips;
  z += 0.032 * L * gauss(y + 0.465, 0.04) * gauss(x, 0.2) * front;
  z += 0.04 * L * gauss(y + 0.565, 0.045) * gauss(x, 0.16) * front;
  z -= 0.014 * gauss(y + 0.508, 0.018) * gauss(x, 0.19) * front;
  z -= 0.018 * gauss(y + 0.67, 0.04) * gauss(x, 0.12) * front;
  return [x, y, z];
}

export interface HeadParts {
  head: THREE.Mesh;
  /** Indices into morphTargetInfluences. */
  morph: { smile: number; jawOpen: number; frown: number; browUp: number; browKnit: number; wide: number };
  eyes: [THREE.Mesh, THREE.Mesh];
  lidsUpper: [THREE.Mesh, THREE.Mesh];
  lidsLower: [THREE.Mesh, THREE.Mesh];
  eyeGroup: [THREE.Group, THREE.Group];
  ears: THREE.Mesh[];
  /** Head-space centre of the skull (for hair builders). */
  center: THREE.Vector3;
  scale: THREE.Vector3;
}

/**
 * Build a sculpted head with morph targets, eyeballs and eyelids.
 * `R` is the head radius; the result is positioned in head-bone space.
 */
export function buildHead(R: number, center: THREE.Vector3, f: FaceShape, skin: THREE.Material, eyeMat: THREE.Material, lidMat: THREE.Material): HeadParts {
  const lon = 128;
  const lat = 112;
  const cols = lon + 1;
  const S = new THREE.Vector3(HEAD_SCALE.x * R, HEAD_SCALE.y * R, HEAD_SCALE.z * R);
  const pos: number[] = [];
  const uv: number[] = [];
  const unit: number[] = [];
  for (let i = 0; i <= lat; i++) {
    const th = (i / lat) * Math.PI;
    for (let j = 0; j <= lon; j++) {
      // Seam at the back of the head; the front is φ = 0.
      const ph = -Math.PI + (j / lon) * Math.PI * 2;
      const ux = Math.sin(th) * Math.sin(ph);
      const uy = Math.cos(th);
      const uz = Math.sin(th) * Math.cos(ph);
      unit.push(ux, uy, uz);
      const [sx, sy, sz] = sculpt(ux, uy, uz, f);
      pos.push(center.x + sx * S.x, center.y + sy * S.y, center.z + sz * S.z);
      const [u, v] = faceUV(ux, uy, uz);
      uv.push(u, v);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      const a = i * cols + j;
      const b = a + cols;
      if (i > 0) idx.push(a, b, a + 1);
      if (i < lat - 1) idx.push(a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();

  // --- Morph targets (deltas from the sculpted rest shape) ---
  const n = pos.length / 3;
  const targets: Record<string, Float32Array> = {};
  const names = ['smile', 'jawOpen', 'frown', 'browUp', 'browKnit', 'wide'] as const;
  for (const k of names) targets[k] = new Float32Array(n * 3);
  const pivot = new THREE.Vector3(0, -0.15, -0.3);
  for (let i = 0; i < n; i++) {
    const ux = unit[i * 3];
    const uy = unit[i * 3 + 1];
    const uz = unit[i * 3 + 2];
    const [x, y, z] = sculpt(ux, uy, uz, f);
    const front = sstep(0.0, 0.6, uz);
    const ax = Math.abs(x);
    const sxn = Math.sign(x) || 1;
    const set = (k: string, dx: number, dy: number, dz: number) => {
      targets[k][i * 3] = dx * S.x;
      targets[k][i * 3 + 1] = dy * S.y;
      targets[k][i * 3 + 2] = dz * S.z;
    };
    // Smile: corners up and out, cheeks lift, a hint of squint beneath the eyes.
    const corner = gauss(Math.hypot(ax - 0.21, (y + 0.51) * 1.2), 0.11) * front;
    const cheek = gauss(Math.hypot(ax - 0.36, y + 0.26), 0.17) * front;
    const mouthBand = gauss(y + 0.51, 0.09) * gauss(x, 0.24) * front;
    set('smile', sxn * (0.03 * corner + 0.025 * mouthBand * ax * 3), 0.055 * corner + 0.03 * cheek, 0.025 * cheek - 0.012 * corner);
    // Frown: corners down, chin bunches, the lower lip pushes out.
    set('frown', -sxn * 0.008 * corner, -0.045 * corner + 0.015 * gauss(y + 0.75, 0.1) * front, 0.012 * gauss(y + 0.57, 0.05) * gauss(x, 0.15) * front);
    // Jaw: everything under the lip line rotates down about the jaw hinge.
    const jw = sstep(-0.5, -0.6, y) * sstep(-0.6, 0.2, z) * (1 - sstep(0.75, 1.0, ax));
    if (jw > 0) {
      const a = 0.2 * jw;
      const dy0 = y - pivot.y;
      const dz0 = z - pivot.z;
      const ny = pivot.y + dy0 * Math.cos(a) - dz0 * Math.sin(a);
      const nz = pivot.z + dy0 * Math.sin(a) + dz0 * Math.cos(a);
      set('jawOpen', 0, ny - y, nz - z);
    }
    // Brows (the painted brows ride on this skin).
    const brow = gauss(y - 0.22 * f.browHeight, 0.12) * front;
    const inner = gauss(ax - 0.16, 0.12);
    set('browUp', 0, 0.04 * brow * (0.6 + inner * 0.6), 0);
    set('browKnit', -sxn * 0.02 * brow * inner, -0.025 * brow * inner, 0.01 * brow * inner);
    // Wide: fear stretches the mouth sideways and draws the cheeks down.
    set('wide', sxn * 0.04 * corner + sxn * 0.02 * mouthBand * ax * 3, -0.02 * corner - 0.012 * cheek, -0.01 * corner);
  }
  g.morphAttributes.position = names.map((k) => new THREE.Float32BufferAttribute(targets[k], 3));
  g.morphTargetsRelative = true;

  const head = new THREE.Mesh(g, skin);
  head.castShadow = true;
  head.receiveShadow = true;
  head.morphTargetInfluences = names.map(() => 0);
  const morph = Object.fromEntries(names.map((k, i) => [k, i])) as HeadParts['morph'];

  // --- Eyes and lids ---
  const eyeR = 0.19 * f.eyeSize * S.x;
  const eyeGeo = new THREE.SphereGeometry(eyeR, 32, 24);
  eyeGeo.rotateX(Math.PI / 2); // texture pole (iris) faces +Z
  const upperGeo = lidGeometry(eyeR * 1.07, true);
  // Upper lashes: a thin dark fringe along the lid edge, flicking outward at the corners.
  const lashGeo = new THREE.TorusGeometry(eyeR * 1.1, eyeR * 0.05, 4, 24, Math.PI * 0.9);
  lashGeo.rotateX(Math.PI / 2);
  lashGeo.rotateY(-Math.PI * 0.05);
  lashGeo.scale(1, 0.6, 1.08);
  const lashMat = new THREE.MeshStandardMaterial({ color: 0x0c0708, roughness: 0.7 });
  const lowerGeo = lidGeometry(eyeR * 1.05, false);
  const eyes: THREE.Mesh[] = [];
  const groups: THREE.Group[] = [];
  const ups: THREE.Mesh[] = [];
  const lows: THREE.Mesh[] = [];
  for (const side of [1, -1] as const) {
    const ec = eyeCenter(f, side);
    const grp = new THREE.Group();
    grp.position.set(center.x + ec.x * S.x, center.y + ec.y * S.y, center.z + ec.z * S.z);
    // Eyes sit in the curve of the face: turn slightly outward, tilt with the eye shape.
    grp.rotation.set(0, side * 0.2, -side * f.eyeTilt * 0.25);
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    grp.add(eye);
    const up = new THREE.Mesh(upperGeo, lidMat);
    up.add(new THREE.Mesh(lashGeo, lashMat));
    const low = new THREE.Mesh(lowerGeo, lidMat);
    up.castShadow = false;
    grp.add(up, low);
    head.add(grp);
    eyes.push(eye);
    groups.push(grp);
    ups.push(up);
    lows.push(low);
  }

  // Ears: a flattened, curled shell on each side.
  const ears: THREE.Mesh[] = [];
  for (const side of [1, -1]) {
    const eg = new THREE.SphereGeometry(1, 16, 12, 0, Math.PI * 2, 0, Math.PI);
    eg.scale(0.035 * R * 1.6, 0.13 * R * 1.6, 0.085 * R * 1.6);
    const ear = new THREE.Mesh(eg, skin);
    ear.position.set(center.x + side * 0.93 * S.x, center.y - 0.06 * S.y, center.z - 0.08 * S.z);
    ear.rotation.set(0, side * -0.35, side * 0.1);
    head.add(ear);
    ears.push(ear);
  }

  return {
    head,
    morph,
    eyes: eyes as [THREE.Mesh, THREE.Mesh],
    lidsUpper: ups as [THREE.Mesh, THREE.Mesh],
    lidsLower: lows as [THREE.Mesh, THREE.Mesh],
    eyeGroup: groups as [THREE.Group, THREE.Group],
    ears,
    center,
    scale: S,
  };
}

/** A hemispherical lid shell with a dark lash line along its edge. */
function lidGeometry(r: number, upper: boolean): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 28, 10, 0, Math.PI * 2, upper ? 0 : Math.PI / 2, Math.PI / 2);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / r;
    // Distance from the rim (the equator).
    const rim = Math.abs(y);
    const lash = upper ? 1 - sstep(0.0, 0.2, rim) : 1 - sstep(0.0, 0.08, rim);
    const k = 1 - lash * (upper ? 0.93 : 0.55);
    col[i * 3] = k;
    col[i * 3 + 1] = k * 0.96;
    col[i * 3 + 2] = k * 0.97;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
