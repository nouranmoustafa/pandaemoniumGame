import * as THREE from 'three';
import type { BoneSegment } from './CharacterRig';

const tmpAB = new THREE.Vector3();
const tmpAP = new THREE.Vector3();

function distToSegment(p: THREE.Vector3, s: BoneSegment): number {
  tmpAB.subVectors(s.b, s.a);
  tmpAP.subVectors(p, s.a);
  const len2 = tmpAB.lengthSq();
  const t = len2 > 1e-9 ? Math.min(1, Math.max(0, tmpAP.dot(tmpAB) / len2)) : 0;
  return tmpAP.addScaledVector(tmpAB, -t).length();
}

export type Influences = Array<[number, number]>;

/**
 * Distance-based skin weights, restricted to the bones a part may follow.
 * Each vertex gets up to four influences, falling off as 1/d^sharpness from
 * the bone segments, so joints bend as a smooth blend rather than as two
 * rigid pieces meeting.
 */
export function skinByDistance(g: THREE.BufferGeometry, segs: BoneSegment[], sharpness = 6, override?: (p: THREE.Vector3) => Influences | null): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const n = pos.count;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  const p = new THREE.Vector3();
  const scratch: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    let inf = override?.(p) ?? null;
    if (!inf) {
      scratch.length = 0;
      for (const s of segs) {
        const d = distToSegment(p, s) + 0.004;
        scratch.push([s.index, 1 / Math.pow(d, sharpness)]);
      }
      // Several segments may belong to the same bone: merge.
      const merged = new Map<number, number>();
      for (const [b, w] of scratch) merged.set(b, (merged.get(b) ?? 0) + w);
      inf = [...merged.entries()];
    }
    writeInfluences(si, sw, i, inf);
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return g;
}

/** Bind every vertex rigidly to one bone. */
export function skinRigid(g: THREE.BufferGeometry, bone: number): THREE.BufferGeometry {
  return skinByDistance(g, [], 1, () => [[bone, 1]]);
}

export function writeInfluences(si: Uint16Array, sw: Float32Array, i: number, inf: Influences): void {
  const top = inf
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  let sum = 0;
  for (const [, w] of top) sum += w;
  for (let k = 0; k < 4; k++) {
    const e = top[k];
    si[i * 4 + k] = e ? e[0] : 0;
    sw[i * 4 + k] = e && sum > 0 ? e[1] / sum : 0;
  }
  if (sum === 0) sw[i * 4] = 1;
}
