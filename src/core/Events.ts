/**
 * Typed event bus that decouples gameplay from presentation (sound, UI, the
 * Demon's commentary). New chapters add events here.
 */
export type HazardKind = 'grass' | 'branch' | 'wind' | 'water' | 'fire';
export type CatchCause = 'grass' | 'branch' | 'water' | 'fire';
export type PowerKind = 'grass' | 'wind' | 'water' | 'fire';
export type DemonPhase = 'amused' | 'irritated' | 'desperate';
export type Caster = 'ai' | 'human' | 'course';
/** Stage 4's sound cues (the house sequence stays decoupled from the audio engine). */
export type HouseSound = 'creak' | 'slam' | 'rattle' | 'candle' | 'organ' | 'silk' | 'bell' | 'sheet' | 'snap';

export interface GameEvents {
  'visitor:caught': { by: CatchCause; x: number };
  'visitor:dodge': { kind: HazardKind; x: number; streak: number };
  'visitor:step': { speed: number; foot: 'L' | 'R' };
  'visitor:lane': { lane: number; from: number };
  'visitor:sprintTap': { effort: number };
  'visitor:slideStart': Record<string, never>;
  /** Wind shoved her into another lane. */
  'visitor:blown': { lane: number };
  /** She pushed back against the wind before it could move her. */
  'visitor:braced': Record<string, never>;
  'obstacle:warn': { kind: HazardKind; x: number };
  'obstacle:strike': { kind: HazardKind; x: number };
  'obstacle:end': { kind: HazardKind; x: number };
  'pavement:rise': Record<string, never>;
  'pavement:slide': Record<string, never>;
  'pavement:sarcasm': { x: number };
  'demon:cast': { kind: PowerKind; x: number; lane: number; caster: Caster };
  'demon:phase': { phase: DemonPhase };
  'demon:line': { text: string; duration?: number };
  'demon:remark': { id: string; text: string };
  'trick:sign': { x: number; toHouse: boolean };
  'trick:bench': { encounter: number };
  'trick:lights': Record<string, never>;
  'trick:shortcut': { active: boolean };
  'chapter:complete': { caught: number; time: number; winner?: 'demon' | 'visitor'; resisted?: number };
  /** Prologue story beats and its sound cues (audio stays decoupled from the script). */
  'prologue:beat': { beat: string };
  'prologue:sound': { id: 'buzz' | 'notify' | 'swing' | 'branch' | 'flicker' | 'grass' | 'send' | 'laugh' };
  'house:sound': { id: HouseSound };
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
