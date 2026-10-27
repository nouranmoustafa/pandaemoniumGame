import type { EventBus } from '../core/Events';
import type { Obstacle, ObstacleContext } from '../obstacles/Obstacle';
import type { Visitor } from '../visitor/Visitor';
import type { Environment } from '../world/Environment';

export interface DemonContext {
  visitor: Visitor;
  env: Environment;
  obstacles: readonly Obstacle[];
  obstacleCtx: ObstacleContext;
  bus: EventBus;
}

/**
 * The Demon is whoever controls the house and the park.
 *
 * Stage 1 ships the AI version. In local 1v1 a HumanDemonDirector will
 * implement this same interface, reading the Demon player's input to choose
 * which obstacle to warn/strike and when — obstacles already expose warn()
 * and strike() so nothing else has to change.
 */
export interface DemonDirector {
  reset(): void;
  update(dt: number, ctx: DemonContext): void;
}
