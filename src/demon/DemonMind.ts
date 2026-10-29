import { chaseProgress } from '../config';
import type { DemonPhase, EventBus } from '../core/Events';
import { clamp, damp } from '../core/math';
import type { VisitorController } from '../visitor/VisitorController';
import type { VisitorObserver } from './VisitorObserver';

/**
 * The Demon's temperament.
 *
 *   AMUSED     — curious, condescending; subtle tricks, long gaps.
 *   IRRITATED  — she keeps getting away; physical, sharper.
 *   DESPERATE  — she might actually escape; forceful, anxious.
 *
 * Phase comes from real chase progress AND her performance, and never steps
 * back down. "Intensity" is the adaptive difficulty: it climbs while she
 * dodges cleanly and drops (with longer warnings) when she keeps failing.
 */
export class DemonMind {
  phase: DemonPhase = 'amused';
  /** Adaptive difficulty, ~0.55 (merciful) .. 1.35 (pressing hard). */
  intensity = 1;
  /** 0..1 — how worried it is. Drives desperate atmosphere. */
  anxiety = 0;
  /** Seconds of deliberate mercy remaining after repeated failures. */
  mercy = 0;

  constructor(private bus: EventBus) {}

  reset(): void {
    this.phase = 'amused';
    this.intensity = 1;
    this.anxiety = 0;
    this.mercy = 0;
  }

  /** Extra warning multiplier for fairness (longer warnings when she struggles). */
  get warnScale(): number {
    return 1 + Math.max(0, 1 - this.intensity) * 0.9 + (this.mercy > 0 ? 0.3 : 0);
  }

  update(dt: number, v: VisitorController, obs: VisitorObserver): void {
    if (v.mode === 'idle') return;
    const progress = chaseProgress(v.x);

    // --- Adaptive difficulty ---
    const hits = obs.recentHits(12);
    let target = 1 + Math.min(obs.dodgeStreak, 6) * 0.06 - hits * 0.22;
    if (this.phase === 'desperate') target += 0.1;
    target = clamp(target, 0.55, 1.35);
    this.intensity = damp(this.intensity, target, target < this.intensity ? 2.5 : 0.6, dt);
    if (hits >= 2 && this.mercy <= 0) this.mercy = 4;
    this.mercy = Math.max(0, this.mercy - dt);

    // --- Phase ---
    let next: DemonPhase = this.phase;
    const performingWell = obs.recentHits(30) <= 1 && obs.dodges >= 5;
    if (progress >= 0.64 || (progress >= 0.5 && performingWell)) next = 'desperate';
    else if (this.phase === 'amused' && (progress >= 0.24 || (obs.dodges >= 4 && progress >= 0.1))) next = 'irritated';
    if (next !== this.phase && rank(next) > rank(this.phase)) {
      this.phase = next;
      this.bus.emit('demon:phase', { phase: next });
    }

    const anxTarget = this.phase === 'desperate' ? 0.55 + progress * 0.45 : this.phase === 'irritated' ? 0.2 : 0;
    this.anxiety = damp(this.anxiety, anxTarget, 0.8, dt);
  }
}

function rank(p: DemonPhase): number {
  return p === 'amused' ? 0 : p === 'irritated' ? 1 : 2;
}
