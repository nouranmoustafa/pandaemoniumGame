import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math';
import { taperedTube } from './geometry';

export interface TreeOptions {
  seed: number;
  height?: number;
  /** Lean of the trunk toward +Z (positive) or -Z (negative). */
  lean?: number;
  depth?: number;
  /** Fewer branches for attacking trees, so the living limb is the focus. */
  sparse?: boolean;
}

/**
 * Generates tall, skeletal, asymmetrical gothic trees: twisting trunks,
 * crooked limbs and long claw-like twigs. Leafless by design.
 */
export function buildTreeGeometry(opts: TreeOptions): THREE.BufferGeometry {
  const rand = mulberry32(opts.seed);
  const height = opts.height ?? 9 + rand() * 6;
  const lean = opts.lean ?? (rand() - 0.5) * 0.5;
  const maxDepth = opts.depth ?? 4;
  const parts: THREE.BufferGeometry[] = [];

  const branch = (start: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, depth: number) => {
    const pts: THREE.Vector3[] = [start.clone()];
    const d = dir.clone().normalize();
    const p = start.clone();
    const steps = 4;
    for (let i = 1; i <= steps; i++) {
      // Wander, with a gothic tendency to twist back on itself.
      d.x += (rand() - 0.5) * 0.55;
      d.z += (rand() - 0.5) * 0.55;
      d.y += (rand() - 0.42) * 0.35 + (depth === 0 ? 0.25 : -0.04 * depth);
      d.normalize();
      p.addScaledVector(d, length / steps);
      pts.push(p.clone());
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const tipR = depth >= maxDepth ? 0.008 : radius * 0.45;
    // Fine twigs need very few sides; the trunk carries the silhouette.
    parts.push(taperedTube(curve, depth === 0 ? 12 : depth === 1 ? 6 : 4, depth === 0 ? 7 : depth === 1 ? 5 : 3, radius, tipR, 1));
    if (depth >= maxDepth) return;

    const children = depth === 0 ? (opts.sparse ? 3 : 5) : opts.sparse ? 2 : 2 + Math.floor(rand() * 2);
    for (let i = 0; i < children; i++) {
      const t = depth === 0 ? 0.42 + rand() * 0.55 : 0.35 + rand() * 0.6;
      const at = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      const out = new THREE.Vector3(rand() - 0.5, 0, rand() - 0.5).normalize();
      const nd = tangent.clone().multiplyScalar(0.5).add(out.multiplyScalar(0.9));
      nd.y += depth === 0 ? 0.35 + rand() * 0.3 : rand() * 0.4 - 0.15;
      const rAt = THREE.MathUtils.lerp(radius, tipR, t);
      branch(at, nd, length * (0.48 + rand() * 0.22), rAt * 0.62, depth + 1);
    }
  };

  branch(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(lean * 0.3, 1, lean), height, 0.38 + rand() * 0.18, 0);

  // Buttress roots flaring into the ground.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rand();
    const pts = [
      new THREE.Vector3(0, 0.9, 0),
      new THREE.Vector3(Math.cos(a) * 0.5, 0.35, Math.sin(a) * 0.5),
      new THREE.Vector3(Math.cos(a) * 1.3, -0.05, Math.sin(a) * 1.3),
    ];
    parts.push(taperedTube(new THREE.CatmullRomCurve3(pts), 6, 5, 0.22, 0.03));
  }

  const merged = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  return merged;
}
