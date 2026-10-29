import { ahead, CHASE } from '../../config';
import type { DemonAbilitySystem } from '../../demon/abilities/DemonAbilitySystem';
import type { ObstacleContext } from '../../obstacles/Obstacle';
import type { ObstacleManager } from '../../obstacles/ObstacleManager';

/**
 * The park's scripted beats, identical in both modes: the course's own
 * hazards wake as she nears them during the chase (away from the house).
 */
export class CourseDirector {
  constructor(
    private course: ObstacleManager,
    private abilities: DemonAbilitySystem,
  ) {}

  update(ctx: ObstacleContext): void {
    const v = ctx.visitor.controller;
    if (v.mode === 'idle') return;
    if (v.dir !== CHASE.dir) return;
    const speed = Math.max(v.speed, 2);

    for (const o of this.course.obstacles) {
      const dist = ahead(v.x, o.x);
      if (dist < -2) continue;
      const eta = dist / speed;
      if (o.state === 'dormant' && eta < o.windup + o.strikeLead && dist < 48) o.warn(ctx);
      this.abilities.driveProximity(o, ctx);
    }
  }
}
