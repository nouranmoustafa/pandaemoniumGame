import type { EventBus } from '../core/Events';
import { mulberry32 } from '../core/math';

/**
 * The house's voice: dry, patient, faintly offended. Lines are data so that
 * later chapters (and a human Demon's taunt button) can reuse the same system.
 */
export const PARK_LINES = {
  opening: "He said he'd be waiting by the fountain. There is no fountain.",
  running: "Go on, then. Run. It's very good for the heart.",
  trees: 'The trees have opinions about you. Mostly unkind.',
  rise: 'Walking is so tiring. Allow me.',
  slide: "There. Isn't that easier?",
  date: "Your date isn't coming, by the way. Something much worse is.",
  arrive: 'Come in. Wipe your feet.',
  caughtGrass: [
    'The grass only wants to hold you. Some of us are affectionate.',
    "Clingy, isn't it? It runs in the family.",
    "You'd think you'd never been held before.",
  ],
  caughtBranch: [
    'The trees were planted for shade. They took it personally.',
    "That one's been waiting all autumn to do that.",
    'Mind your head. I do.',
  ],
  untouched: "Not a scratch. How disappointing. How *impressive*.",
} as const;

export class DemonVoice {
  private said = new Set<string>();
  private cooldown = 0;
  private rand = mulberry32(666);

  constructor(private bus: EventBus) {}

  reset(): void {
    this.said.clear();
    this.cooldown = 0;
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  /** Say a scripted line once per run. */
  once(key: string, text: string, duration = 4.2): void {
    if (this.said.has(key)) return;
    this.said.add(key);
    this.cooldown = duration + 1.5;
    this.bus.emit('demon:line', { text, duration });
  }

  /** A reactive quip, rate-limited so it never becomes a nag. */
  quip(pool: readonly string[], chance = 0.7): void {
    if (this.cooldown > 0 || this.rand() > chance) return;
    const unused = pool.filter((l) => !this.said.has(l));
    if (!unused.length) return;
    const text = unused[Math.floor(this.rand() * unused.length)];
    this.said.add(text);
    this.cooldown = 7;
    this.bus.emit('demon:line', { text, duration: 3.6 });
  }
}
