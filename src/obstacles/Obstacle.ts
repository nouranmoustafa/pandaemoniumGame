import type * as THREE from 'three';
import { LANES, type LaneIndex } from '../config';
import type { EventBus } from '../core/Events';
import type { Visitor } from '../visitor/Visitor';
import type { Pavement } from '../world/Pavement';

export type ObstacleKind = 'grass' | 'branch';

/**
 * Lifecycle: dormant → warning (anticipation) → striking → holding → retracting → spent.
 * Obstacles never decide when to attack — a DemonDirector calls warn()/strike().
 * That keeps the door open for a human-controlled Demon later.
 */
export type ObstacleState = 'dormant' | 'warning' | 'striking' | 'holding' | 'retracting' | 'spent';

export interface ObstacleContext {
  visitor: Visitor;
  pavement: Pavement;
  bus: EventBus;
  time: number;
}

export abstract class Obstacle {
  abstract readonly kind: ObstacleKind;
  readonly group: THREE.Group;
  state: ObstacleState = 'dormant';
  protected stateTime = 0;
  /** Did this obstacle already catch her this pass? */
  protected landed = false;

  constructor(
    readonly x: number,
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

  protected setState(s: ObstacleState): void {
    this.state = s;
    this.stateTime = 0;
  }

  reset(): void {
    this.state = 'dormant';
    this.stateTime = 0;
    this.landed = false;
  }

  /** Lane-aware hit test against the Visitor's current position. */
  protected overlapsVisitor(v: Visitor, halfLength: number, laneTolerance = 1.05): boolean {
    const c = v.controller;
    if (Math.abs(c.x - this.x) > halfLength) return false;
    return this.lanes.some((l) => Math.abs(c.z - LANES[l]) < laneTolerance);
  }

  abstract update(dt: number, ctx: ObstacleContext): void;
}
