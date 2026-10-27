import { LANES, type LaneIndex, RUN, SLIDE } from '../config';
import type { EventBus } from '../core/Events';
import type { Input } from '../core/Input';
import { clamp, damp, lerp, smoothstep, spring } from '../core/math';

export type VisitorMode = 'idle' | 'run' | 'slide' | 'arrive';

export interface Ground {
  heightAt(x: number, z: number): number;
  slopeAt(x: number, z: number): number;
  rollAngle(): number;
}

/**
 * Pure movement logic for the Visitor: auto-run, tap-to-sprint effort, lane
 * springs, stumbles, slope response and sliding. Knows nothing about meshes,
 * so a human or AI can drive the same rules.
 */
export class VisitorController {
  mode: VisitorMode = 'idle';
  x = 0;
  y = 0;
  z: number = LANES[1];
  lane: LaneIndex = 1;
  laneVel = 0;
  speed = 0;
  effort = 0;
  slope = 0;
  roll = 0;
  /** 0..1, eased in when sliding begins. */
  slideBlend = 0;
  stumbleTime = -1;
  stumbleSide: 'L' | 'R' = 'L';
  invulnerable = 0;
  caughtCount = 0;
  elapsed = 0;
  /** True once the player has used each control (drives the tutorial fade). */
  usedDodge = false;
  sprintTaps = 0;
  /** Inputs are ignored while false (title screen, ending). */
  controllable = false;

  constructor(private bus: EventBus) {}

  reset(x = 0): void {
    this.mode = 'idle';
    this.x = x;
    this.z = LANES[1];
    this.lane = 1;
    this.laneVel = 0;
    this.speed = 0;
    this.effort = 0;
    this.slope = 0;
    this.roll = 0;
    this.slideBlend = 0;
    this.stumbleTime = -1;
    this.invulnerable = 0;
    this.caughtCount = 0;
    this.elapsed = 0;
    this.usedDodge = false;
    this.sprintTaps = 0;
    this.controllable = false;
  }

  start(): void {
    this.mode = 'run';
    this.controllable = true;
    // A small initial push so she visibly sets off.
    this.speed = Math.max(this.speed, 1.5);
  }

  startSlide(): void {
    if (this.mode === 'slide') return;
    this.mode = 'slide';
    this.speed = Math.max(this.speed, SLIDE.minSpeed * 0.8);
    this.bus.emit('visitor:slideStart', {});
  }

  /** Returns true if the hit landed (not during grace period). */
  catch(by: 'grass' | 'branch', side: 'L' | 'R' = 'L'): boolean {
    if (this.invulnerable > 0 || this.mode === 'arrive' || this.mode === 'idle') return false;
    this.stumbleTime = 0;
    this.stumbleSide = side;
    this.invulnerable = RUN.invulnerable;
    this.speed *= this.mode === 'slide' ? 0.7 : RUN.stumbleSpeedFactor;
    this.effort *= 0.5;
    this.caughtCount++;
    this.bus.emit('visitor:caught', { by, x: this.x });
    return true;
  }

  get stumbling(): boolean {
    return this.stumbleTime >= 0 && this.stumbleTime < RUN.stumbleDuration;
  }

  update(dt: number, input: Input, ground: Ground): void {
    if (this.mode !== 'idle') this.elapsed += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    if (this.stumbleTime >= 0) {
      this.stumbleTime += dt;
      if (this.stumbleTime > RUN.stumbleDuration + 0.5) this.stumbleTime = -1;
    }

    // --- Input ---
    if (this.controllable) {
      if (input.consume('up')) this.changeLane(-1);
      if (input.consume('down')) this.changeLane(1);
      if (input.consume('sprint')) {
        this.sprintTaps++;
        const gain = this.stumbling ? RUN.effortPerTap * 0.5 : RUN.effortPerTap;
        this.effort = Math.min(1, this.effort + gain);
        if (this.mode === 'slide') this.speed = Math.min(SLIDE.maxSpeed, this.speed + SLIDE.paddleBoost);
        this.bus.emit('visitor:sprintTap', { effort: this.effort });
      }
    }
    this.effort = Math.max(0, this.effort - RUN.effortDecay * dt);

    // --- Lanes: a stiff spring so dodges are immediate but carry weight. ---
    const stiffness = this.mode === 'slide' ? RUN.laneStiffness * 0.75 : RUN.laneStiffness;
    const damping = this.stumbling ? RUN.laneDamping * 1.6 : RUN.laneDamping;
    [this.z, this.laneVel] = spring(this.z, this.laneVel, LANES[this.lane], stiffness, damping, dt);

    // --- Ground ---
    this.slope = ground.slopeAt(this.x + 0.6, this.z);
    this.roll = ground.rollAngle();

    // --- Speed ---
    switch (this.mode) {
      case 'idle':
        this.speed = damp(this.speed, 0, 4, dt);
        break;
      case 'run': {
        // Effort curve: early taps matter most, the top end needs commitment.
        const e = 1 - Math.pow(1 - this.effort, 1.6);
        let target = lerp(RUN.jogSpeed, RUN.sprintSpeed, e);
        target -= Math.max(0, this.slope) * RUN.slopeDrag;
        target += Math.max(0, -this.slope) * RUN.slopeDrag * 0.6;
        target = Math.max(2.2, target);
        if (this.stumbling) target *= lerp(RUN.stumbleSpeedFactor, 1, smoothstep(0.2, RUN.stumbleDuration, this.stumbleTime));
        const rate = target > this.speed ? RUN.accel : RUN.decel;
        this.speed = damp(this.speed, target, rate, dt);
        break;
      }
      case 'slide': {
        const a = -this.slope * SLIDE.gravity - SLIDE.friction * this.speed + 2.4;
        this.speed = clamp(this.speed + a * dt, SLIDE.minSpeed, SLIDE.maxSpeed);
        break;
      }
      case 'arrive':
        this.speed = damp(this.speed, 0, 1.4, dt);
        break;
    }
    this.slideBlend = damp(this.slideBlend, this.mode === 'slide' ? 1 : 0, 5, dt);

    this.x += this.speed * dt;
    const gy = ground.heightAt(this.x, this.z);
    // Follow the ground tightly; a little lag when sliding over ripples reads as weight.
    this.y = this.mode === 'slide' ? damp(this.y, gy, 18, dt) : damp(this.y, gy, 30, dt);
    if (this.y < gy) this.y = gy;
  }

  private changeLane(dir: -1 | 1): void {
    const next = clamp(this.lane + dir, 0, 2) as LaneIndex;
    if (next === this.lane) {
      // Bump against the edge: a small nudge so the input still feels acknowledged.
      this.laneVel += dir * 1.5;
      return;
    }
    this.lane = next;
    this.usedDodge = true;
    // Kick the spring so the change starts instantly.
    this.laneVel += dir * 4;
    this.bus.emit('visitor:lane', { lane: next });
  }
}
