/**
 * Typed event bus that decouples gameplay from presentation (sound, UI, the
 * Demon's commentary). New chapters add events here.
 */
export interface GameEvents {
  'visitor:caught': { by: 'grass' | 'branch'; x: number };
  'visitor:step': { speed: number; foot: 'L' | 'R' };
  'visitor:lane': { lane: number };
  'visitor:sprintTap': { effort: number };
  'visitor:slideStart': Record<string, never>;
  'obstacle:warn': { kind: 'grass' | 'branch'; x: number };
  'obstacle:strike': { kind: 'grass' | 'branch'; x: number };
  'pavement:rise': Record<string, never>;
  'pavement:slide': Record<string, never>;
  'demon:line': { text: string; duration?: number };
  'chapter:complete': { caught: number; time: number };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private map = new Map<keyof GameEvents, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.map.get(type);
    if (!set) {
      set = new Set();
      this.map.set(type, set);
    }
    set.add(fn as Handler<unknown>);
    return () => set!.delete(fn as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    this.map.get(type)?.forEach((fn) => fn(payload));
  }
}
