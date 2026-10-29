import { COURSE } from '../../config';
import type { DemonAbilitySystem } from '../../demon/abilities/DemonAbilitySystem';
import type { ObstacleContext } from '../../obstacles/Obstacle';
import type { ObstacleManager } from '../../obstacles/ObstacleManager';
import type { Environment } from '../../world/Environment';

/**
 * The park's scripted beats, identical in both modes: the course's own
 * hazards wake as she nears them, and the pavement set-piece (hill → slide)
 * plays at fixed points. The final slide is always a directed event — no
 * Demon, AI or human, can trigger it early.
 */
export class CourseDirector {
  constructor(
    private course: ObstacleManager,
    private abilities: DemonAbilitySystem,
    private env: Environment,
  ) {}

  update(ctx: ObstacleContext): void {
    const v = ctx.visitor.controller;
    if (v.mode === 'idle') return;
    const speed = Math.max(v.speed, 2);

    for (const o of this.course.obstacles) {
      const dist = o.x - v.x;
      if (dist < -2) continue;
      const eta = dist / speed;
      if (o.state === 'dormant' && eta < o.windup + o.strikeLead && dist < 48) o.warn(ctx);
      this.abilities.driveProximity(o, ctx);
    }

    const pav = this.env.pavement;
    if (v.x > COURSE.pavementStart - 20) pav.beginRise();
    if (v.x > COURSE.hillCrest - 26) {
      pav.beginSlide();
      // Where the exit was, the house comes up out of the ground: the path has led her round.
      this.env.house.rise = 1;
    }
    if (v.mode === 'run' && v.x > COURSE.hillCrest - 1.5 && pav.slide > 0.45) v.startSlide();
  }
}
