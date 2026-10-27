import { COURSE, FAIRNESS, type LaneIndex, POWERS } from '../../config';
import type { Caster, PowerKind } from '../../core/Events';
import type { Obstacle } from '../../obstacles/Obstacle';
import type { VisitorController } from '../../visitor/VisitorController';

export interface CastTarget {
  x: number;
  lane: LaneIndex;
}

export interface CastCheck {
  ok: boolean;
  /** Why not — written for the Demon player to read. */
  reason?: string;
}

export interface FairnessState {
  visitor: VisitorController;
  obstacles: readonly Obstacle[];
  time: number;
  lastHitTime: number;
  lastCastTime: number;
  history: ReadonlyArray<{ kind: PowerKind; caster: Caster }>;
  cooldownLeft: number;
  activeDynamic: number;
  /** Extra warning multiplier (adaptive difficulty: >1 when she is struggling). */
  warnScale: number;
}

/** Hazards that physically close their lane. Wind only pushes; it never blocks. */
const BLOCKS: Record<PowerKind, boolean> = { grass: true, wind: false, water: true, fire: true };

/**
 * Speed used for warning-time maths. Assumes she might speed up after the cast,
 * so a warning that's fair at a jog stays fair at a sprint.
 */
function fairSpeed(v: VisitorController): number {
  return Math.max(v.speed, 6) + 1.5;
}

/** Nearest distance ahead a power may be placed so she still gets a readable warning. */
export function minLead(kind: PowerKind, v: VisitorController, warnScale = 1): number {
  const s = fairSpeed(v);
  const warn = FAIRNESS.minWarning * warnScale + FAIRNESS.reaction;
  const fp = POWERS[kind].footprint;
  switch (kind) {
    case 'grass':
      return s * (warn + 0.42) + fp;
    case 'water':
      return s * (warn + 0.38) + fp;
    case 'fire':
      return s * warn + fp;
    case 'wind':
      return s * FAIRNESS.minWarning * warnScale + fp;
  }
}

/**
 * The rules. Every Demon — AI or human — goes through this, so neither can
 * build an unavoidable trap, stun-lock her, or spam one trick.
 */
export function checkCast(kind: PowerKind, t: CastTarget, caster: Caster, s: FairnessState): CastCheck {
  const v = s.visitor;
  if (v.mode === 'idle' || v.mode === 'arrive') return { ok: false, reason: 'Not now.' };
  if (s.cooldownLeft > 0) return { ok: false, reason: `Still gathering itself — ${s.cooldownLeft.toFixed(1)}s.` };
  if (s.time - s.lastCastTime < FAIRNESS.castSpacing) return { ok: false, reason: 'Patience.' };
  if (s.time - s.lastHitTime < FAIRNESS.graceAfterHit || v.stumbling)
    return { ok: false, reason: 'Let her stand up first. Even you have standards.' };
  if (v.x > COURSE.finish - FAIRNESS.noCastBeforeFinish || t.x > COURSE.finish - 6)
    return { ok: false, reason: 'The house is already opening the door.' };
  if (s.activeDynamic >= FAIRNESS.maxActive) return { ok: false, reason: 'The park can only hold so much malice at once.' };

  const mine = s.history.filter((h) => h.caster === caster);
  const lastN = mine.slice(-FAIRNESS.maxRepeat);
  if (lastN.length === FAIRNESS.maxRepeat && lastN.every((h) => h.kind === kind))
    return { ok: false, reason: 'The park refuses to repeat itself. Try something else.' };

  const dist = t.x - v.x;
  if (dist < 0) return { ok: false, reason: "She's already past that." };
  if (dist < minLead(kind, v, s.warnScale)) return { ok: false, reason: "Too close — she'd have no warning." };
  if (dist > FAIRNESS.maxRange) return { ok: false, reason: "Too far — the park can't reach that yet." };

  const fp = POWERS[kind].footprint;
  if (kind === 'wind' && s.obstacles.some((o) => o.kind === 'wind' && o.threatening))
    return { ok: false, reason: 'The wind is already busy.' };

  // Stacking two hazards in the same spot is pointless and unreadable; two in
  // quick succession in one lane would catch her again before she can recover.
  for (const o of s.obstacles) {
    if (!o.threatening || o.kind === 'wind' || kind === 'wind' || !o.lanes.includes(t.lane)) continue;
    const gap = Math.abs(o.x - t.x) - o.halfLength - fp;
    if (gap < 1) return { ok: false, reason: 'Something is already waiting there.' };
    if (BLOCKS[kind] && o.blocksLanes && gap < FAIRNESS.sameLaneGap)
      return { ok: false, reason: "Too close to the last trap — she'd never get back up." };
  }

  // At least one lane must stay open around every hazard.
  if (BLOCKS[kind]) {
    const window = FAIRNESS.laneWindow + v.speed * 0.3;
    const blocked = new Set<number>([t.lane]);
    for (const o of s.obstacles) {
      if (!o.threatening || !o.blocksLanes) continue;
      if (Math.abs(o.x - t.x) < o.halfLength + fp + window) o.lanes.forEach((l) => blocked.add(l));
    }
    if (blocked.size >= 3) return { ok: false, reason: 'That would close every path. Even I play fair.' };
  }

  return { ok: true };
}
