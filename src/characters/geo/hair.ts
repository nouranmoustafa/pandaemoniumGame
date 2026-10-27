import * as THREE from 'three';
import { mulberry32 } from '../../core/math';
import type { HairKind } from '../design';
import type { BoneName, CharacterRig, ChainSpec } from '../rig/CharacterRig';
import { skinByDistance, skinRigid } from '../rig/skinning';
import { HEAD_SCALE } from './head';

const sstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * A tapered lock of hair: an elliptical tube along a curve, flattened so it
 * reads as a ribbon of strands. u runs around, v along, matching the strand
 * texture.
 */
export function lock(points: THREE.Vector3[], width: number, thick: number, opts: { seg?: number; radial?: number; taper?: number; up?: THREE.Vector3 } = {}): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const seg = opts.seg ?? 14;
  const radial = opts.radial ?? 8;
  const taper = opts.taper ?? 0.85;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const up = opts.up ?? new THREE.Vector3(0, 0, 1);
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  const P = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    // Ribbon faces "up" (away from the scalp) as much as the curve allows.
    B.crossVectors(T, up);
    if (B.lengthSq() < 1e-6) B.set(1, 0, 0);
    B.normalize();
    N.crossVectors(B, T).normalize();
    const k = (1 - Math.pow(t, 1.6) * taper) * (0.7 + 0.3 * Math.sin(Math.min(1, t * 3) * Math.PI * 0.5));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const cw = Math.cos(a) * width * k;
      const sw = Math.sin(a) * thick * k;
      pos.push(P.x + B.x * cw + N.x * sw, P.y + B.y * cw + N.y * sw, P.z + B.z * cw + N.z * sw);
      uv.push(j / radial, 1 - t);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Spring chains each hairstyle needs, in head-bone space. */
export function hairChains(kind: HairKind, R: number, c: THREE.Vector3): ChainSpec[] {
  const S = { x: HEAD_SCALE.x * R, y: HEAD_SCALE.y * R, z: HEAD_SCALE.z * R };
  switch (kind) {
    case 'visitor':
      // A low, loose ponytail at the nape.
      return [{ prefix: 'hair', parent: 'head', origin: [0, c.y - 0.45 * S.y, c.z - 0.98 * S.z], step: [0, -0.07, -0.012], count: 4 }];
    case 'long':
      return [
        { prefix: 'hair', parent: 'head', origin: [0, c.y - 0.2 * S.y, c.z - 1.02 * S.z], step: [0, -0.11, -0.012], count: 4 },
      ];
    case 'asym':
      return [{ prefix: 'hair', parent: 'head', origin: [-1.02 * S.x, c.y + 0.1 * S.y, c.z - 0.15 * S.z], step: [-0.008, -0.07, 0.004], count: 3 }];
    case 'curly':
      return [];
  }
}

interface ScalpFrame {
  /** Point on the scalp (head space) for a unit direction. */
  at(dir: THREE.Vector3, lift?: number): THREE.Vector3;
}

/**
 * Builds a hairstyle: a scalp shell trimmed to a hairline, plus locks.
 * Returns geometry already skinned to the head and any hair chains.
 */
export function buildHair(kind: HairKind, rig: CharacterRig, R: number, center: THREE.Vector3): THREE.BufferGeometry[] {
  const S = new THREE.Vector3(HEAD_SCALE.x * R, HEAD_SCALE.y * R, HEAD_SCALE.z * R);
  const headBone = rig.index('head');
  const headPos = rig.bindPos.get('head')!;
  // Hair is built in head-bone space; skinning needs model space.
  const toModel = (g: THREE.BufferGeometry) => g.translate(headPos.x, headPos.y, headPos.z);
  const frame: ScalpFrame = {
    at: (d, lift = 1.06) => new THREE.Vector3(center.x + d.x * S.x * lift, center.y + d.y * S.y * lift, center.z + d.z * S.z * lift),
  };
  const rand = mulberry32(kind.length * 31 + 5);
  const out: THREE.BufferGeometry[] = [];
  const rigid = (g: THREE.BufferGeometry) => {
    toModel(g);
    skinRigid(g, headBone);
    out.push(g);
  };
  const chained = (g: THREE.BufferGeometry, chainStart: string, sharp = 4) => {
    toModel(g);
    const chain = rig.chains.get(chainStart) ?? [];
    skinByDistance(g, [rig.segment('head', 'neck'), ...chain.map((b) => rig.segment(b as BoneName))], sharp, (p) => {
      // Locks stay pinned at the scalp, then hand over to the chain.
      const hp = new THREE.Vector3().subVectors(p, headPos).sub(center);
      const inside = hp.x * hp.x / (S.x * S.x * 1.3) + hp.y * hp.y / (S.y * S.y * 1.3) + hp.z * hp.z / (S.z * S.z * 1.3);
      return inside < 1 ? [[headBone, 1]] : null;
    });
    out.push(g);
  };

  // --- Scalp shell with a hairline ---
  /** Signed distance above the hairline (negative = face). */
  const hairline = (d: THREE.Vector3): number => {
    const ax = Math.abs(d.x);
    // Forehead line, lower at the temples, then down in front of the ears.
    const line = 0.5 - 0.35 * sstep(0.1, 0.75, ax) - 0.3 * sstep(0.75, 0.95, ax) + (kind === 'asym' && d.x > 0 ? 0.05 : 0);
    const faceSide = sstep(-0.05, 0.25, d.z);
    return d.y - line * faceSide - (1 - faceSide) * -2;
  };
  const shellLift = kind === 'curly' ? 1.1 : kind === 'long' ? 1.06 : 1.065;
  {
    const lon = 64;
    const lat = 40;
    const pos: number[] = [];
    const uv: number[] = [];
    const keep: boolean[] = [];
    const d = new THREE.Vector3();
    for (let i = 0; i <= lat; i++) {
      const th = (i / lat) * Math.PI * 0.78;
      for (let j = 0; j <= lon; j++) {
        const ph = -Math.PI + (j / lon) * Math.PI * 2;
        d.set(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph));
        const above = hairline(d);
        keep.push(above > -0.25);
        // Shell hugs the skull at the hairline, gains volume over the crown.
        let lift = shellLift + 0.03 * sstep(0.2, 0.9, d.y);
        if (kind === 'asym' && d.x > 0.3) lift = 1.035; // the cropped side
        if (kind === 'long') lift += 0.02 * sstep(0.2, -0.6, d.z);
        // At the hairline the shell dips beneath the skin, so the edge is the
        // smooth curve where the two surfaces meet.
        lift = 0.9 + (lift - 0.9) * sstep(-0.12, 0.1, above);
        const p = frame.at(d, lift);
        pos.push(p.x, p.y, p.z);
        uv.push(j / lon, 1 - i / lat);
      }
    }
    const cols = lon + 1;
    const idx: number[] = [];
    for (let i = 0; i < lat; i++) {
      for (let j = 0; j < lon; j++) {
        const a = i * cols + j;
        const b = a + cols;
        if (keep[a] && keep[b] && keep[a + 1] && keep[b + 1]) idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    rigid(g);
  }

  const dir = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize();
  const H = rig.p.height;

  if (kind === 'visitor') {
    // Side-swept fringe: long locks from a left parting falling across the forehead to the right.
    for (let i = 0; i < 7; i++) {
      const k = i / 6;
      const root = frame.at(dir(0.3 - k * 0.15, 0.95, 0.25 + k * 0.25), 1.07);
      const mid = frame.at(dir(-0.05 - k * 0.4, 0.62 - k * 0.1, 0.85), 1.1);
      const end = frame.at(dir(-0.7 - k * 0.25, 0.42 - k * 0.2, 0.6 - k * 0.25), 1.08);
      rigid(lock([root, mid, end], 0.03 * R * 2.4, 0.009 * R * 2.4, { seg: 12 }));
    }
    // Shoulder-length sides that frame the face.
    for (const s of [1, -1]) {
      for (let i = 0; i < 9; i++) {
        const k = i / 8;
        const a = 0.95 + k * 1.5;
        const root = frame.at(dir(s * Math.sin(a) * 0.7, 0.7, Math.cos(a) * 0.7), 1.06);
        const mid = frame.at(dir(s * Math.sin(a) * 1.05, -0.2, Math.cos(a) * 0.95), 1.1);
        const end = frame.at(dir(s * Math.sin(a) * 1.0, -1.0, Math.cos(a) * 0.75 - 0.15), 1.2);
        end.y -= 0.04 * H * (0.6 + rand() * 0.3);
        end.x += s * 0.015 * H;
        rigid(lock([root, mid, end], 0.028 * R * 2.4, 0.01 * R * 2.4, { seg: 14 }));
      }
    }
    // The low ponytail.
    const chain = rig.chains.get('hair0')!;
    const pts = chain.map((b) => rig.bindPos.get(b)!.clone().sub(headPos));
    pts.push(rig.segment(chain[chain.length - 1]).b.clone().sub(headPos));
    for (let i = 0; i < 9; i++) {
      const off = new THREE.Vector3((rand() - 0.5) * 0.03 * H, 0, (rand() - 0.5) * 0.02 * H);
      const lp = pts.map((p, j) => p.clone().addScaledVector(off, 0.4 + j * 0.25));
      lp.unshift(frame.at(dir((rand() - 0.5) * 0.6, -0.1 + rand() * 0.2, -1), 1.02));
      chained(lock(lp, 0.022 * R * 2.4, 0.016 * R * 2.4, { seg: 16, taper: 0.8 }), 'hair0');
    }
    // Hair tie.
    const tie = new THREE.TorusGeometry(0.012 * H, 0.004 * H, 6, 14);
    tie.translate(pts[0].x, pts[0].y, pts[0].z);
    toModel(tie);
    skinRigid(tie, rig.index(chain[0]));
    out.push(tie);
  }

  if (kind === 'long') {
    // Long, straight, centre-parted — a curtain from the crown to mid-back.
    for (let i = 0; i < 34; i++) {
      const k = i / 33;
      const a = Math.PI * 0.3 + k * Math.PI * 1.4; // from beside her left cheek, around the back, to her right
      const sx = Math.sin(a);
      const cz = Math.cos(a);
      const front = cz > 0.2;
      const root = frame.at(dir(sx * 0.35, 0.95, cz * 0.35 + 0.05), 1.06);
      const mid = frame.at(dir(sx * 1.0, 0.1, cz * 0.95), 1.1);
      const shoulder = frame.at(dir(sx * 1.05, -0.9, cz * 0.9), 1.18);
      const len = front ? 0.16 : 0.3;
      const end = shoulder.clone().add(new THREE.Vector3(sx * 0.02 * H, -len * H * (0.9 + rand() * 0.15), cz < 0 ? -0.03 * H : 0.015 * H));
      const pts = [root, mid, shoulder, end];
      chained(lock(pts, 0.04 * R * 2.4, 0.01 * R * 2.4, { seg: 20, taper: 0.55 }), 'hair0', 5);
    }
  }

  if (kind === 'curly') {
    // A short, voluminous bob of curls ending at the jaw, with a curly fringe.
    const curlGeo = (r: number) => {
      const g = new THREE.IcosahedronGeometry(r, 1);
      return g;
    };
    for (let i = 0; i < 280; i++) {
      const u = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const d = dir(Math.sqrt(1 - u * u) * Math.sin(a), u, Math.sqrt(1 - u * u) * Math.cos(a));
      if (d.y < -0.55) continue;
      if (d.z > 0.45 && d.y < 0.45 && Math.abs(d.x) < 0.72) continue; // keep the face clear
      const lift = 1.08 + rand() * 0.07 + (d.y < 0 ? 0.07 : 0);
      const p = frame.at(d, lift);
      const g = curlGeo(R * (0.1 + rand() * 0.06));
      g.scale(1, 1.25, 1);
      g.translate(p.x, p.y, p.z);
      rigid(g);
    }
    for (let i = 0; i < 9; i++) {
      const x = -0.5 + i / 8;
      const p = frame.at(dir(x, 0.62 + Math.abs(x) * 0.1 - (i % 2) * 0.05, 0.78), 1.12);
      const g = curlGeo(R * 0.11);
      g.scale(1.1, 1.3, 0.8);
      g.translate(p.x, p.y, p.z);
      rigid(g);
    }
  }

  if (kind === 'asym') {
    // Cropped on her left; on her right a long sweep from the crown past the jaw.
    const chain = rig.chains.get('hair0')!;
    const cp = chain.map((b) => rig.bindPos.get(b)!.clone().sub(headPos));
    cp.push(rig.segment(chain[chain.length - 1]).b.clone().sub(headPos));
    for (let i = 0; i < 16; i++) {
      const k = i / 15;
      const root = frame.at(dir(0.25 - k * 0.2, 0.97, 0.1 + k * 0.5 - 0.3), 1.07);
      const over = frame.at(dir(-0.8, 0.55 - k * 0.1, 0.15 - k * 0.6), 1.12);
      const pts = [root, over];
      for (let j = 0; j < cp.length; j++) {
        const p = cp[j].clone();
        p.z += (k - 0.65) * 0.07 * H * (0.5 + j * 0.15);
        p.x -= 0.006 * H * j;
        pts.push(p);
      }
      chained(lock(pts, 0.036 * R * 2.4, 0.01 * R * 2.4, { seg: 18, taper: 0.7 }), 'hair0', 5);
    }
    // The fringe that falls over her right eye.
    for (let i = 0; i < 4; i++) {
      const root = frame.at(dir(0.2 - i * 0.05, 0.95, 0.3), 1.07);
      const mid = frame.at(dir(-0.15, 0.55, 0.85), 1.12);
      const end = frame.at(dir(-0.42 - i * 0.04, 0.05 - i * 0.03, 0.9), 1.14);
      rigid(lock([root, mid, end], 0.03 * R * 2.4, 0.008 * R * 2.4, { seg: 12 }));
    }
  }
  return out;
}
