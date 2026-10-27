export type GameStateId = 'title' | 'playing' | 'paused' | 'ending' | 'ended';

export interface StateHandlers {
  enter?: (from: GameStateId | null) => void;
  exit?: (to: GameStateId) => void;
}

/** Minimal explicit state machine for top-level game flow. */
export class StateMachine {
  private current: GameStateId | null = null;
  private handlers = new Map<GameStateId, StateHandlers>();
  private changeListeners: Array<(s: GameStateId) => void> = [];

  register(id: GameStateId, h: StateHandlers): this {
    this.handlers.set(id, h);
    return this;
  }

  get state(): GameStateId | null {
    return this.current;
  }

  is(id: GameStateId): boolean {
    return this.current === id;
  }

  go(id: GameStateId): void {
    const prev = this.current;
    if (prev === id) return;
    if (prev) this.handlers.get(prev)?.exit?.(id);
    this.current = id;
    this.handlers.get(id)?.enter?.(prev);
    for (const l of this.changeListeners) l(id);
  }

  onChange(fn: (s: GameStateId) => void): void {
    this.changeListeners.push(fn);
  }
}
