import { MODE_TUNING } from '../config';
import type { PowerKind } from '../core/Events';
import type { CastCheck, CastTarget } from './abilities/Fairness';
import type { DemonContext, DemonDirector } from './DemonDirector';

/**
 * Local 1v1: the second player is the Demon. Their mouse input (via the
 * DemonPanel) becomes casts on the same ability system the AI uses, under the
 * same fairness rules — only the cooldown tuning differs.
 */
export class HumanDemonDirector implements DemonDirector {
  readonly kind = 'human' as const;
  private ctx: DemonContext | null = null;
  casts = 0;

  reset(): void {
    this.casts = 0;
  }

  update(_dt: number, ctx: DemonContext): void {
    this.ctx = ctx;
    ctx.abilities.cooldownScale = MODE_TUNING.human.cooldownScale;
    ctx.abilities.warnScale = 1;
    ctx.abilities.omenChance = ctx.mind.phase === 'desperate' ? 0.5 : 0.3;
  }

  check(kind: PowerKind, t: CastTarget): CastCheck {
    if (!this.ctx) return { ok: false, reason: 'Not now.' };
    return this.ctx.abilities.check(kind, t, 'human', this.ctx.obstacleCtx);
  }

  cast(kind: PowerKind, t: CastTarget): CastCheck {
    if (!this.ctx) return { ok: false, reason: 'Not now.' };
    const r = this.ctx.abilities.cast(kind, t, 'human', this.ctx.obstacleCtx);
    if (r.ok) this.casts++;
    return r;
  }
}
