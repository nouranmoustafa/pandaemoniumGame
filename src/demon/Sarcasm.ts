import type { EventBus } from '../core/Events';
import type { VisitorController } from '../visitor/VisitorController';
import type { Inscriptions } from '../world/Inscriptions';
import type { Bench } from '../world/props/Bench';
import type { Signpost } from '../world/props/Signpost';
import type { VisitorObserver } from './VisitorObserver';

export const REMARKS = {
  wrong: 'A remarkable commitment to being wrong.',
  effort: 'All that effort. Impressive, really.',
  personal: "You're making this unnecessarily personal.",
  slow: 'Take your time. Apparently we have all night.',
  difficult: 'You seem determined to make this difficult.',
} as const;

export type RemarkId = keyof typeof REMARKS;

/**
 * The Demon rarely speaks, and only when she has earned it. Each remark is
 * tied to something she actually did, is said at most once, is spaced far
 * apart, and is written onto a surface in the park — a plaque, the pavement —
 * never floated over her head.
 */
export class Sarcasm {
  /** At most this many remarks per run. */
  static readonly BUDGET = 3;
  private said = new Set<RemarkId>();
  private lastTime = -99;
  private time = 0;
  readonly log: RemarkId[] = [];

  constructor(
    private bus: EventBus,
    private inscriptions: Inscriptions,
    private surfaces: { sign: () => Signpost; bench: () => Bench },
  ) {}

  reset(): void {
    this.said.clear();
    this.log.length = 0;
    this.lastTime = -99;
    this.time = 0;
  }

  /** Long gaps between remarks; nothing in the first stretch of the run. */
  canSpeak(id: RemarkId): boolean {
    // The incline remark belongs to a deliberate trick, so it may follow sooner.
    const gap = id === 'effort' ? 10 : 24;
    return !this.said.has(id) && this.said.size < Sarcasm.BUDGET && this.time > 14 && this.time - this.lastTime > gap;
  }

  /** Write a remark. Returns false if it isn't the moment. */
  say(id: RemarkId, v: VisitorController, at?: number): boolean {
    if (!this.canSpeak(id)) return false;
    const text = REMARKS[id];
    const sign = this.surfaces.sign();
    const bench = this.surfaces.bench();
    const ahead = (x: number) => x - v.x > 12 && x - v.x < 45;
    if (id === 'difficult' && ahead(sign.x)) sign.engrave(text);
    else if (id === 'slow' && ahead(bench.x)) bench.engrave(text);
    else this.inscriptions.write(text, at ?? v.x + Math.max(30, v.speed * 3.6));
    this.said.add(id);
    this.log.push(id);
    this.lastTime = this.time;
    this.bus.emit('demon:remark', { id, text });
    return true;
  }

  update(dt: number, v: VisitorController, obs: VisitorObserver): void {
    if (v.mode !== 'run' && v.mode !== 'slide') return;
    this.time += dt;
    if (this.said.size >= Sarcasm.BUDGET) return;
    // Running into trouble, repeatedly.
    if (obs.recentIntoDanger(20) >= 2 || obs.recentHits(20) >= 3) this.say('wrong', v);
    // Dodging everything it throws.
    else if (obs.dodgeStreak >= 5) this.say('personal', v);
    // Dawdling.
    else if (obs.slowTime > 6) this.say('slow', v);
    // Refusing to be herded.
    else if (obs.braced >= 2) this.say('difficult', v);
  }
}
