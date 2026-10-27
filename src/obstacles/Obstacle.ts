import * as THREE from 'three';
import { LANES, type LaneIndex } from '../config';
import type { EventBus, HazardKind } from '../core/Events';
import type { Visitor } from '../visitor/Visitor';
import type { Pavement } from '../world/Pavement';

export type ObstacleKind = HazardKind;

/**
 * Lifecycle: dormant → warning (anticipation) → striking → holding → retracting → spent.
 * Obstacles never decide when to attack — a director calls warn()/strike().
 * That keeps the door open for a human-controlled Demon.
 */
export type ObstacleState = 'dormant' | 'warning' | 'striking' | 'holding' | 'retracting' | 'spent';

export interface ObstacleContext {
  visitor: Visitor;
  pavement: Pavement;
  bus: EventBus;
  time: number;
  camera: THREE.Camera;
}

export abstract class Obstacle {
  abstract readonly kind: ObstacleKind;
  readonly group: THREE.Group;
  state: ObstacleState = 'dormant';
  protected stateTime = 0;
  /** Did this obstacle already catch her this pass? */
  landed = false;
  /** She has already run past it (used for dodge feedback). */
  passed = false;
  /** Spawned by a Demon power and removed when spent, rather than placed by the course. */
  dynamic = false;
  /** Runs its own timeline after warn() instead of striking when she approaches. */
  selfTimed = false;
  /** Half the length along X that this hazard occupies. */
  halfLength = 1.4;
  /** Whether it physically closes its lanes (wind and puddles don't). */
  blocksLanes = true;

  constructor(
    public x: number,
    /** Lanes this obstacle threatens once it strikes. */
    readonly lanes: LaneIndex[],
    group: THREE.Group,
  ) {
    this.group = group;
  }

  /** Seconds of anticipation this obstacle wants before striking. */
  abstract readonly windup: number;
  /** Seconds before the Visitor arrives that the strike must begin. */
  abstract readonly strikeLead: number;

  warn(ctx: ObstacleContext): void {
    if (this.state !== 'dormant') return;
    this.setState('warning');
    ctx.bus.emit('obstacle:warn', { kind: this.kind, x: this.x });
  }

  strike(ctx: ObstacleContext): void {
    if (this.state !== 'dormant' && this.state !== 'warning') return;
    this.setState('striking');
    ctx.bus.emit('obstacle:strike', { kind: this.kind, x: this.x });
  }

  /** Seconds spent in the current state. */
  get elapsed(): number {
    return this.stateTime;
  }

  /** Still a threat to its lanes (for fairness checks). */
  get threatening(): boolean {
    return this.state === 'dormant' || this.state === 'warning' || this.state === 'striking' || this.state === 'holding';
  }

  /** Could catch her right now (used to decide whether running past counts as a dodge). */
  get dangerous(): boolean {
    return this.state === 'striking' || this.state === 'holding';
  }

  protected setState(s: ObstacleState): void {
    this.state = s;
    this.stateTime = 0;
  }

  reset(): void {
    this.state = 'dormant';
    this.stateTime = 0;
    this.landed = false;
    this.passed = false;
  }

  /** Lane-aware hit test against the Visitor's current position. */
  protected overlapsVisitor(v: Visitor, halfLength: number, laneTolerance = 1.05): boolean {
    const c = v.controller;
    if (Math.abs(c.x - this.x) > halfLength) return false;
    return this.lanes.some((l) => Math.abs(c.z - LANES[l]) < laneTolerance);
  }

  abstract update(dt: number, ctx: ObstacleContext): void;

  /** Release GPU resources owned by this obstacle (shared geometry is left alone). */
  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach((mat) => {
        if (mat.userData.shared) return;
        mat.dispose();
      });
    });
  }
}
