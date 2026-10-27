import { COURSE } from '../config';
import type { EventBus } from '../core/Events';
import type { DemonContext, DemonDirector } from './DemonDirector';
import { DemonVoice, PARK_LINES } from './DemonVoice';

/**
 * Scripted Demon for the park chase. It times every obstacle against the
 * Visitor's actual speed (so the warning window is fair at jog or sprint),
 * drives the pavement set-piece, whips up gusts, and comments.
 */
export class AIDemonDirector implements DemonDirector {
  readonly voice: DemonVoice;
  private unsub: Array<() => void> = [];
  private gustTimer = 0;
  private gustHold = 0;

  constructor(bus: EventBus) {
    this.voice = new DemonVoice(bus);
    this.unsub.push(
      bus.on('visitor:caught', ({ by }) => this.voice.quip(by === 'grass' ? PARK_LINES.caughtGrass : PARK_LINES.caughtBranch)),
    );
  }

  reset(): void {
    this.voice.reset();
    this.gustTimer = 0;
    this.gustHold = 0;
  }

  update(dt: number, ctx: DemonContext): void {
    const v = ctx.visitor.controller;
    this.voice.update(dt);
    if (v.mode === 'idle') return;
    const speed = Math.max(v.speed, 2);

    // --- Obstacles ---
    for (const o of ctx.obstacles) {
      const dist = o.x - v.x;
      if (dist < -2) continue;
      const eta = dist / speed;
      if (o.state === 'dormant' && eta < o.windup + o.strikeLead && dist < 48) o.warn(ctx.obstacleCtx);
      if (o.state === 'warning' && eta <= o.strikeLead) o.strike(ctx.obstacleCtx);
    }

    // --- Pavement set-piece ---
    const pav = ctx.env.pavement;
    if (v.x > COURSE.pavementStart - 20) pav.beginRise();
    if (v.x > COURSE.hillCrest - 26) pav.beginSlide();
    if (v.mode === 'run' && v.x > COURSE.hillCrest - 1.5 && pav.slide > 0.45) v.startSlide();

    // --- Wind: gusts push at her back, hurrying her along ---
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTimer = 5 + Math.random() * 6;
      this.gustHold = 1.6;
      ctx.env.setGust(0.35 + Math.random() * 0.3);
    }
    if (this.gustHold > 0) {
      this.gustHold -= dt;
      if (this.gustHold <= 0) ctx.env.setGust(0);
    }

    // --- Commentary ---
    if (v.x > 6) this.voice.once('opening', PARK_LINES.opening, 4.8);
    if (v.x > 34) this.voice.once('running', PARK_LINES.running);
    if (v.x > 136) this.voice.once('trees', PARK_LINES.trees);
    if (pav.phase === 'rising') this.voice.once('rise', PARK_LINES.rise);
    if (v.mode === 'slide') this.voice.once('slide', PARK_LINES.slide, 3.2);
    if (v.x > 430) this.voice.once('date', PARK_LINES.date, 4.6);
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
  }
}
