/** Top-level flow. Pausing is a flow state; the story position is tracked separately. */
export type GameStateId = 'title' | 'prologue' | 'playing' | 'house' | 'paused' | 'ended';

/**
 * Where the story is. Tracked alongside the flow so systems can react to
 * story beats on entry/exit (UI prompts, the Demon panel, camera, audio)
 * without polling scattered flags.
 */
export type StoryState =
  | 'TITLE_SCREEN'
  | 'MODE_SELECTION'
  | 'PROLOGUE_ESTABLISHING'
  | 'PROLOGUE_FRIENDS'
  | 'PROLOGUE_PHONE'
  | 'PROLOGUE_GOODBYE'
  | 'PROLOGUE_PARK_ENTRY'
  | 'CHASE_GAMEPLAY'
  | 'CHASE_ESCALATION'
  | 'PAVEMENT_SLIDE'
  | 'HOUSE_THRESHOLD'
  | 'HOUSE_INTERIOR'
  | 'WEDDING_DRESS'
  | 'STAGE_4_END';

export interface StateHandlers<Id extends string> {
  enter?: (from: Id | null) => void;
  exit?: (to: Id) => void;
}

/** Minimal explicit state machine: one enter and one exit per transition, never re-entered. */
export class StateMachine<Id extends string = GameStateId> {
  private current: Id | null = null;
  private handlers = new Map<Id, StateHandlers<Id>>();
  private changeListeners: Array<(s: Id, from: Id | null) => void> = [];

  register(id: Id, h: StateHandlers<Id>): this {
    this.handlers.set(id, h);
    return this;
  }

  get state(): Id | null {
    return this.current;
  }

  is(id: Id): boolean {
    return this.current === id;
  }

  go(id: Id): void {
    const prev = this.current;
    if (prev === id) return;
    if (prev) this.handlers.get(prev)?.exit?.(id);
    this.current = id;
    this.handlers.get(id)?.enter?.(prev);
    for (const l of this.changeListeners) l(id, prev);
  }

  onChange(fn: (s: Id, from: Id | null) => void): void {
    this.changeListeners.push(fn);
  }
}
