import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANES } from '../../config';
import { mulberry32 } from '../../core/math';
import { taperedTube } from '../../world/geometry';

interface Debris {
  x: number;
  lanes: number[];
  hit: boolean;
}

/** World X positions and blocked lanes. Placed well before her friends, never in all three lanes. */
const LAYOUT: Debris[] = [
  { x: 526, lanes: [0, 1], hit: false },
  { x: 497, lanes: [2], hit: false },
  { x: 470, lanes: [1, 2], hit: false },
  { x: 452, lanes: [0], hit: false },
];

/**
 * The final run's only obstacles: a fallen log, a stone, a branch, things
 * any park leaves on a path at night. They do not move, warn or strike;
 * running into one only trips her. The park has stopped trying.
 */
export class CalmPath {
  readonly group = new THREE.Group();
  private items = LAYOUT.map((d) => ({ ...d }));

  constructor(bark: THREE.Material) {
    const rand = mulberry32(55);
    const stone = new THREE.MeshStandardMaterial({ color: 0x3a3840, roughness: 0.95, flatShading: true });
    for (const d of this.items) {
      const z0 = LANES[d.lanes[0] as 0 | 1 | 2];
      const z1 = LANES[d.lanes[d.lanes.length - 1] as 0 | 1 | 2];
      if (d.lanes.length === 1 && d.x === 497) {
        // A stone, half sunk.
        const geo = new THREE.DodecahedronGeometry(0.55, 0);
        geo.scale(1.1, 0.6, 0.9);
        const m = new THREE.Mesh(geo, stone);
        m.position.set(d.x, 0.15, z0);
        m.rotation.set(rand(), rand() * 3, rand());
        m.castShadow = m.receiveShadow = true;
        this.group.add(m);
        continue;
      }
      // A fallen limb lying across the lanes it blocks, with a few dead twigs.
      const half = Math.abs(z1 - z0) / 2 + 1.0;
      const zc = (z0 + z1) / 2;
      const pts = [new THREE.Vector3(d.x - 0.3, 0.22, zc - half), new THREE.Vector3(d.x + 0.1, 0.3, zc - half * 0.3), new THREE.Vector3(d.x - 0.15, 0.26, zc + half * 0.4), new THREE.Vector3(d.x + 0.25, 0.18, zc + half)];
      const parts = [taperedTube(new THREE.CatmullRomCurve3(pts), 16, 7, 0.24, 0.1)];
      for (let k = 0; k < 4; k++) {
        const z = zc - half * 0.7 + k * half * 0.45;
        const a = new THREE.Vector3(d.x, 0.3, z);
        const b = a.clone().add(new THREE.Vector3((rand() - 0.5) * 0.8, 0.4 + rand() * 0.4, (rand() - 0.5) * 0.4));
        parts.push(taperedTube(new THREE.CatmullRomCurve3([a, a.clone().lerp(b, 0.5).add(new THREE.Vector3(0.1, 0, 0)), b]), 5, 4, 0.05, 0.01));
      }
      const m = new THREE.Mesh(mergeGeometries(parts)!, bark);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }
    this.group.visible = false;
  }

  reset(): void {
    for (const d of this.items) d.hit = false;
  }

  /** True once, when she runs into a piece in her lane. */
  hit(x: number, lane: number): boolean {
    for (const d of this.items) {
      if (d.hit || Math.abs(x - d.x) > 0.5 || !d.lanes.includes(lane)) continue;
      d.hit = true;
      return true;
    }
    return false;
  }
}
