import * as THREE from 'three';
import type { LaneIndex } from '../config';
import type { Pavement } from '../world/Pavement';
import { GrassAttack } from './GrassAttack';
import type { Obstacle, ObstacleContext } from './Obstacle';
import { type BranchStyle, TreeAttack } from './TreeAttack';

export type ObstacleSpec =
  | { type: 'grass'; x: number; lane: LaneIndex }
  | { type: 'branch'; x: number; style: BranchStyle; lanes: LaneIndex[] };

/** Owns every obstacle on the course; builds them from data, updates and resets them. */
export class ObstacleManager {
  readonly group = new THREE.Group();
  readonly obstacles: Obstacle[] = [];

  constructor(specs: ObstacleSpec[], pavement: Pavement, bark: THREE.Material) {
    specs.forEach((s, i) => {
      const o =
        s.type === 'grass'
          ? new GrassAttack(s.x, s.lane, 500 + i)
          : new TreeAttack(s.x, s.lanes, s.style, pavement.plannedHeight(s.x), bark, 900 + i);
      this.obstacles.push(o);
      this.group.add(o.group);
    });
    this.obstacles.sort((a, b) => a.x - b.x);
  }

  update(dt: number, ctx: ObstacleContext): void {
    for (const o of this.obstacles) o.update(dt, ctx);
  }

  reset(): void {
    // Hidden until their first update poses them (unposed tendrils sit at the world origin,
    // right on the prologue's path); update() decides visibility from then on.
    for (const o of this.obstacles) {
      o.reset();
      o.group.visible = false;
    }
  }
}
