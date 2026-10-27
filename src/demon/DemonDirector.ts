import type { EventBus } from '../core/Events';
import type { ObstacleContext } from '../obstacles/Obstacle';
import type { Visitor } from '../visitor/Visitor';
import type { Environment } from '../world/Environment';
import type { DemonAbilitySystem } from './abilities/DemonAbilitySystem';
import type { DemonMind } from './DemonMind';
import type { VisitorObserver } from './VisitorObserver';

export interface DemonContext {
  visitor: Visitor;
  env: Environment;
  obstacleCtx: ObstacleContext;
  bus: EventBus;
  abilities: DemonAbilitySystem;
  mind: DemonMind;
  observer: VisitorObserver;
  /** True while the false shortcut is pretending to be safe. */
  peaceful: boolean;
}

/**
 * The Demon is whoever controls the park's powers.
 * - AIDemonDirector: single player, reactive rule-based AI.
 * - HumanDemonDirector: local 1v1, a second player with the mouse.
 * Both act only through DemonAbilitySystem, so the rules are identical.
 */
export interface DemonDirector {
  readonly kind: 'ai' | 'human';
  reset(): void;
  update(dt: number, ctx: DemonContext): void;
}
