import { type LaneIndex, MODE_TUNING, POWERS } from '../config';
import type { DemonPhase, PowerKind } from '../core/Events';
import { POWER_ORDER } from './abilities/DemonAbilitySystem';
import type { DemonContext, DemonDirector } from './DemonDirector';

/** How much each personality likes each power. Amused prefers the subtle ones. */
const PHASE_WEIGHT: Record<DemonPhase, Record<PowerKind, number>> = {
  amused: { grass: 1.0, wind: 0.65, water: 0.85, fire: 0.25 },
  irritated: { grass: 1.0, wind: 1.0, water: 1.0, fire: 0.9 },
  desperate: { grass: 1.05, wind: 1.15, water: 0.95, fire: 1.2 },
};

/** Seconds between decisions, before adaptive intensity. */
const PHASE_INTERVAL: Record<DemonPhase, number> = { amused: 4.5, irritated: 3.0, desperate: 2.2 };

interface Candidate {
  kind: PowerKind;
  lane: LaneIndex;
  x: number;
  score: number;
}

/**
 * Single-player Demon. Not a random spawner: at each decision it scores every
 * (power, lane, distance) it could legally use against what it has observed —
 * her lane habits, where she is about to dodge, how hard she's tapping, what
 * is already waiting ahead — then picks among the best with a little
 * unpredictability. Everything goes through the shared fairness rules.
 */
export class AIDemonDirector implements DemonDirector {
  readonly kind = 'ai' as const;
  private timer = 4;
  private rng = Math.random;
  /** Last decision, exposed for debugging and tests. */
  lastDecision: Candidate | null = null;
  decisions = 0;

  reset(): void {
    this.timer = 4;
    this.lastDecision = null;
    this.decisions = 0;
  }

  update(dt: number, ctx: DemonContext): void {
    const v = ctx.visitor.controller;
    const { abilities, mind } = ctx;
    abilities.cooldownScale = MODE_TUNING.ai.cooldownScale * (mind.phase === 'desperate' ? 0.8 : mind.phase === 'amused' ? 1.15 : 0.95);
    abilities.warnScale = mind.warnScale;
    abilities.omenChance = mind.phase === 'desperate' ? 0.6 : 0.25;
    if (v.mode !== 'run' && v.mode !== 'slide') return;
    // Let her learn the controls before it starts paying attention.
    if (v.x < 30) return;
    if (ctx.peaceful) return;

    this.timer -= dt;
    if (this.timer > 0) return;

    const choice = this.decide(ctx);
    if (choice) {
      const res = abilities.cast(choice.kind, { x: choice.x, lane: choice.lane }, 'ai', ctx.obstacleCtx);
      if (res.ok) {
        this.lastDecision = choice;
        this.decisions++;
      }
    }
    const interval = PHASE_INTERVAL[mind.phase] / mind.intensity + (mind.mercy > 0 ? 1.5 : 0);
    this.timer = choice ? interval * (0.8 + this.rng() * 0.4) : 0.7;
  }

  private decide(ctx: DemonContext): Candidate | null {
    const { abilities, mind } = ctx;
    const v = ctx.visitor.controller;
    const oc = ctx.obstacleCtx;
    const candidates: Candidate[] = [];

    for (const kind of POWER_ORDER) {
      if (abilities.cooldownLeft(kind) > 0) continue;
      const lead = abilities.minLead(kind, oc);
      for (const extra of [1.5, 6, 12]) {
        const x = v.x + lead + extra + (kind === 'wind' ? POWERS.wind.footprint * 0.5 : 0);
        for (let lane = 0 as LaneIndex; lane <= 2; lane = (lane + 1) as LaneIndex) {
          const score = this.score(kind, lane, x, extra, ctx);
          if (score > 0.05) candidates.push({ kind, lane, x, score });
        }
      }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);

    // Pick among the strongest options, weighted — intelligent, not predictable.
    const pool = candidates.slice(0, 8);
    const temp = mind.phase === 'desperate' ? 0.25 : 0.4;
    while (pool.length) {
      const weights = pool.map((c) => Math.exp((c.score - pool[0].score) / temp));
      const total = weights.reduce((a, b) => a + b, 0);
      let r = this.rng() * total;
      let i = 0;
      while (r > weights[i] && i < pool.length - 1) r -= weights[i++];
      const c = pool[i];
      if (abilities.check(c.kind, { x: c.x, lane: c.lane }, 'ai', oc).ok) return c;
      pool.splice(i, 1);
    }
    return null;
  }

  private score(kind: PowerKind, lane: LaneIndex, x: number, extra: number, ctx: DemonContext): number {
    const { observer: obs, mind, abilities } = ctx;
    const v = ctx.visitor.controller;
    const obstacles = abilities.obstacles;
    const predicted = obs.predictLane(x);
    const dl = Math.abs(lane - predicted);
    let s = dl === 0 ? 1 : dl === 1 ? 0.45 : 0.12;

    // Is something already waiting near x? Then she'll be dodging here.
    const nearThreat = obstacles.find((o) => o.threatening && o.blocksLanes && Math.abs(o.x - x) < 9);
    const tapRate = obs.tapRate;

    switch (kind) {
      case 'grass':
        s += 0.45 * obs.laneStability;
        if (nearThreat && lane === predicted && mind.phase !== 'amused') s += 0.6; // wait where she'll dodge to
        break;
      case 'water':
        // Puddles punish sprinting: wet stone and a burst of spray.
        s += 0.35 * Math.min(1, tapRate / 4) + (v.speed > 10 ? 0.3 : 0);
        break;
      case 'fire':
        if (mind.phase === 'amused') s -= 0.4;
        if (nearThreat && lane === predicted) s += 0.8; // misdirection: burn the escape route
        if (extra < 3) s -= 0.2; // fire reads better from a distance
        break;
      case 'wind': {
        // The best gust herds her into something already waiting just past the zone.
        const fp = POWERS.wind.footprint;
        const trap = obstacles.find(
          (o) => o.threatening && o.blocksLanes && o.lanes.includes(lane) && o.x > x + fp * 0.3 && o.x < x + fp + 18,
        );
        s = 0.15;
        if (trap && lane !== v.lane) s += 1.3;
        else if (lane === v.lane && tapRate > 2.5) s += 0.35; // a headwind to blunt a sprint
        if (v.mode === 'slide') s -= 0.2;
        break;
      }
    }

    // Variety: it gets bored of its own tricks.
    if (abilities.lastCast === kind) s -= 0.7;
    s -= abilities.recentCasts(15).filter((k) => k === kind).length * 0.25;

    // Adaptive difficulty: when she's struggling, prefer pushes over walls.
    const blocking = kind !== 'wind';
    if (mind.intensity < 0.85 && blocking) s *= 0.65;
    if (mind.intensity > 1.1 && blocking) s += (mind.intensity - 1) * 0.6;

    // Distance taste: amused plays from afar; desperate crowds her.
    if (mind.phase === 'amused' && extra > 10) s += 0.2;
    if (mind.phase === 'desperate' && extra < 3) s += 0.2;

    return s * PHASE_WEIGHT[mind.phase][kind];
  }
}
