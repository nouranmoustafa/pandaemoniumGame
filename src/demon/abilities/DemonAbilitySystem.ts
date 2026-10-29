import * as THREE from 'three';
import { ahead, POWERS } from '../../config';
import type { Caster, EventBus, PowerKind } from '../../core/Events';
import { mulberry32 } from '../../core/math';
import { FireLine } from '../../obstacles/FireLine';
import { GrassAttack } from '../../obstacles/GrassAttack';
import type { Obstacle, ObstacleContext } from '../../obstacles/Obstacle';
import { WaterHazard } from '../../obstacles/WaterHazard';
import { WindGust } from '../../obstacles/WindGust';
import { type CastCheck, type CastTarget, checkCast, minLead } from './Fairness';

export const POWER_ORDER: PowerKind[] = ['grass', 'wind', 'water', 'fire'];

/**
 * The Demon's hands. Owns the four powers, their cooldowns, the hazards they
 * spawn, and the fairness rules. AI and human Demons both act only through
 * check()/cast(), so they play by identical rules on identical systems.
 *
 * It also drives proximity-triggered strikes and detects clean dodges for
 * every hazard on the course, scripted or summoned.
 */
export class DemonAbilitySystem {
  readonly group = new THREE.Group();
  readonly hazards: Obstacle[] = [];
  /** Multiplies cooldowns (AI and human modes are tuned separately). */
  cooldownScale = 1;
  /** >1 lengthens required warnings (adaptive difficulty). */
  warnScale = 1;
  /** Chance a puddle shows the figures in its reflection. */
  omenChance = 0.3;
  dodgeStreak = 0;

  private cooldown: Record<PowerKind, number> = { grass: 0, wind: 0, water: 0, fire: 0 };
  private cooldownTotal: Record<PowerKind, number> = { grass: 1, wind: 1, water: 1, fire: 1 };
  private history: Array<{ kind: PowerKind; caster: Caster; t: number }> = [];
  private time = 0;
  private lastHitTime = -99;
  private lastCastTime = -99;
  private seed = 1;
  private rand = mulberry32(4242);
  private fireLights: THREE.PointLight[] = [];
  private all: Obstacle[] = [];

  constructor(
    scene: THREE.Scene,
    private bus: EventBus,
    private courseObstacles: readonly Obstacle[],
  ) {
    scene.add(this.group);
    // A fixed pool: adding lights at runtime would recompile every shader.
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0x9fd6ff, 0, 10, 1.6);
      this.fireLights.push(l);
      this.group.add(l);
    }
    bus.on('visitor:caught', () => {
      this.lastHitTime = this.time;
      this.dodgeStreak = 0;
    });
  }

  /** Weak GPUs: fewer real fire lights (each one is paid for on every lit pixel, even at zero). */
  trimFireLights(n: number): void {
    for (const l of this.fireLights.splice(n)) l.removeFromParent();
  }

  /** Every hazard currently on the course: scripted and summoned. */
  get obstacles(): readonly Obstacle[] {
    this.all.length = 0;
    for (const o of this.courseObstacles) this.all.push(o);
    for (const o of this.hazards) this.all.push(o);
    return this.all;
  }

  cooldownLeft(kind: PowerKind): number {
    return this.cooldown[kind];
  }

  /** 0 = ready, 1 = just used. */
  cooldownFraction(kind: PowerKind): number {
    return this.cooldown[kind] / this.cooldownTotal[kind];
  }

  get secondsSinceHit(): number {
    return this.time - this.lastHitTime;
  }

  get lastCast(): PowerKind | null {
    return this.history.length ? this.history[this.history.length - 1].kind : null;
  }

  recentCasts(seconds: number): PowerKind[] {
    return this.history.filter((h) => this.time - h.t < seconds).map((h) => h.kind);
  }

  minLead(kind: PowerKind, ctx: ObstacleContext): number {
    return minLead(kind, ctx.visitor.controller, this.warnScale);
  }

  check(kind: PowerKind, target: CastTarget, caster: Caster, ctx: ObstacleContext): CastCheck {
    return checkCast(kind, target, caster, {
      visitor: ctx.visitor.controller,
      obstacles: this.obstacles,
      time: this.time,
      lastHitTime: this.lastHitTime,
      lastCastTime: this.lastCastTime,
      history: this.history,
      cooldownLeft: this.cooldown[kind],
      activeDynamic: this.hazards.filter((h) => h.threatening).length,
      warnScale: this.warnScale,
    });
  }

  cast(kind: PowerKind, target: CastTarget, caster: Caster, ctx: ObstacleContext): CastCheck {
    const res = this.check(kind, target, caster, ctx);
    if (!res.ok) return res;
    const seed = this.seed++ * 97 + 13;
    let h: Obstacle;
    switch (kind) {
      case 'grass':
        h = new GrassAttack(target.x, target.lane, seed);
        h.dynamic = true;
        break;
      case 'wind':
        h = new WindGust(target.x, target.lane, seed);
        break;
      case 'water':
        h = new WaterHazard(target.x, target.lane, seed, this.rand() < this.omenChance);
        break;
      case 'fire':
        h = new FireLine(target.x, target.lane, seed, POWERS.fire.windup * Math.max(1, this.warnScale));
        break;
    }
    this.hazards.push(h);
    this.group.add(h.group);
    h.warn(ctx);
    const cd = POWERS[kind].cooldown * this.cooldownScale;
    this.cooldown[kind] = cd;
    this.cooldownTotal[kind] = cd;
    this.lastCastTime = this.time;
    this.history.push({ kind, caster, t: this.time });
    if (this.history.length > 20) this.history.shift();
    this.bus.emit('demon:cast', { kind, x: target.x, lane: target.lane, caster });
    return res;
  }

  /**
   * Strike when she gets close enough: the strike lands as she arrives, after
   * a warning she has already seen for a while.
   */
  driveProximity(o: Obstacle, ctx: ObstacleContext): void {
    if (o.state !== 'warning' || o.selfTimed) return;
    const v = ctx.visitor.controller;
    const eta = ahead(v.x, o.x) / Math.max(v.speed, 1);
    if (eta <= o.strikeLead && o.elapsed > 0.45) o.strike(ctx);
  }

  update(dt: number, ctx: ObstacleContext): void {
    this.time += dt;
    for (const k of Object.keys(this.cooldown) as PowerKind[]) this.cooldown[k] = Math.max(0, this.cooldown[k] - dt);

    for (const h of this.hazards) {
      this.driveProximity(h, ctx);
      h.update(dt, ctx);
    }
    // Remove spent hazards.
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      if (h.state === 'spent' || ahead(h.x, ctx.visitor.controller.x) > 60) {
        h.dispose();
        this.hazards.splice(i, 1);
      }
    }

    this.detectDodges(ctx);
    this.assignFireLights();
  }

  private detectDodges(ctx: ObstacleContext): void {
    const v = ctx.visitor.controller;
    for (const o of this.obstacles) {
      if (o.passed || ahead(o.x, v.x) < o.halfLength + 0.3) continue;
      o.passed = true;
      if (o.blocksLanes && o.dangerous && !o.landed) {
        this.dodgeStreak++;
        v.rewardDodge();
        this.bus.emit('visitor:dodge', { kind: o.kind, x: o.x, streak: this.dodgeStreak });
      }
    }
  }

  private assignFireLights(): void {
    const fires = this.hazards.filter((h): h is FireLine => h instanceof FireLine && h.lightIntensity > 0.01);
    fires.sort((a, b) => b.lightIntensity - a.lightIntensity);
    this.fireLights.forEach((l, i) => {
      const f = fires[i];
      l.intensity = f ? f.lightIntensity : 0;
      if (f) l.position.copy(f.lightPos);
    });
  }

  /**
   * Compile every hazard's shaders (and prefilter the puddle reflections) at
   * load, so the first fountain or fire mid-chase doesn't stall a frame.
   */
  prewarm(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const probes: Obstacle[] = [
      new GrassAttack(0, 1, 1),
      new WindGust(0, 1, 2),
      new WaterHazard(0, 1, 3, true),
      new FireLine(0, 1, 4),
    ];
    for (const p of probes) {
      p.group.position.set(-500, -50, 0);
      p.group.traverse((o) => (o.visible = true));
      scene.add(p.group);
    }
    renderer.compile(scene, camera);
    // Detach but never dispose: their materials keep the compiled programs
    // alive in the renderer's cache, so real casts reuse them.
    for (const p of probes) p.group.removeFromParent();
    this.warmProbes = probes;
  }
  /** Held only to keep their compiled programs cached. */
  warmProbes: Obstacle[] = [];

  reset(): void {
    for (const h of this.hazards) h.dispose();
    this.hazards.length = 0;
    for (const k of Object.keys(this.cooldown) as PowerKind[]) this.cooldown[k] = 0;
    this.history.length = 0;
    this.time = 0;
    this.lastHitTime = -99;
    this.lastCastTime = -99;
    this.dodgeStreak = 0;
    this.warnScale = 1;
    this.fireLights.forEach((l) => (l.intensity = 0));
  }
}
