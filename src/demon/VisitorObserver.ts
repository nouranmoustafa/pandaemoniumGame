import { ahead, LANES, type LaneIndex, RUN } from '../config';
import type { EventBus } from '../core/Events';
import type { Obstacle } from '../obstacles/Obstacle';
import type { VisitorController } from '../visitor/VisitorController';

/**
 * Everything the Demon notices about her: how hard she taps, where she likes
 * to run, how she dodges, when she fails. Shared by the AI, the sarcasm
 * engine and the psychological tricks.
 */
export class VisitorObserver {
  /** Exponentially-decayed seconds spent in each lane (recent habits). */
  readonly laneTime = [0, 0, 0];
  dodges = 0;
  dodgeStreak = 0;
  bestStreak = 0;
  hitsTotal = 0;
  /** Lane changes that led straight into a catch. */
  intoDanger = 0;
  braced = 0;
  blown = 0;
  /** Seconds she has been dawdling (near jog speed, not tapping). */
  slowTime = 0;
  /** Seconds of sustained hard sprinting. */
  hardSprintTime = 0;
  /** Seconds since she last changed lane. */
  sinceLaneChange = 0;
  time = 0;

  private taps: number[] = [];
  private switches: number[] = [];
  private hits: number[] = [];
  private intoDangerTimes: number[] = [];

  constructor(
    bus: EventBus,
    private visitor: () => VisitorController,
    private obstacles: () => readonly Obstacle[],
  ) {
    bus.on('visitor:sprintTap', () => this.taps.push(this.time));
    bus.on('visitor:lane', () => {
      this.switches.push(this.time);
      this.sinceLaneChange = 0;
    });
    bus.on('visitor:caught', () => {
      // She steered straight into it: a lane change moments before being caught.
      if (this.sinceLaneChange < 1.6 && this.switches.length) {
        this.intoDanger++;
        this.intoDangerTimes.push(this.time);
      }
      this.hits.push(this.time);
      this.hitsTotal++;
      this.dodgeStreak = 0;
    });
    bus.on('visitor:dodge', () => {
      this.dodges++;
      this.dodgeStreak++;
      this.bestStreak = Math.max(this.bestStreak, this.dodgeStreak);
    });
    bus.on('visitor:braced', () => this.braced++);
    bus.on('visitor:blown', () => this.blown++);
  }

  reset(): void {
    this.laneTime.fill(0);
    this.dodges = this.dodgeStreak = this.bestStreak = this.hitsTotal = 0;
    this.intoDanger = this.braced = this.blown = 0;
    this.slowTime = this.hardSprintTime = this.sinceLaneChange = 0;
    this.time = 0;
    this.taps.length = this.switches.length = this.hits.length = this.intoDangerTimes.length = 0;
  }

  update(dt: number): void {
    const v = this.visitor();
    if (v.mode === 'idle') return;
    this.time += dt;
    this.sinceLaneChange += dt;
    const decay = Math.exp(-dt / 10);
    for (let i = 0; i < 3; i++) this.laneTime[i] *= decay;
    this.laneTime[v.lane] += dt;

    const rate = this.tapRate;
    if (v.mode === 'run' && rate < 0.5 && v.speed < RUN.jogSpeed + 0.8) this.slowTime += dt;
    else this.slowTime = Math.max(0, this.slowTime - dt * 2);
    if (v.mode === 'run' && rate >= 3.2 && v.speed > 10) this.hardSprintTime += dt;
    else this.hardSprintTime = Math.max(0, this.hardSprintTime - dt * 1.5);

    const cut = this.time - 30;
    while (this.taps.length && this.taps[0] < this.time - 3) this.taps.shift();
    while (this.switches.length && this.switches[0] < cut) this.switches.shift();
    while (this.hits.length && this.hits[0] < cut) this.hits.shift();
    while (this.intoDangerTimes.length && this.intoDangerTimes[0] < cut) this.intoDangerTimes.shift();
  }

  /** Space presses per second over the last two seconds. */
  get tapRate(): number {
    return this.taps.filter((t) => t > this.time - 2).length / 2;
  }

  recentHits(seconds: number): number {
    return this.hits.filter((t) => t > this.time - seconds).length;
  }

  recentSwitches(seconds: number): number {
    return this.switches.filter((t) => t > this.time - seconds).length;
  }

  recentIntoDanger(seconds: number): number {
    return this.intoDangerTimes.filter((t) => t > this.time - seconds).length;
  }

  /** 0..1: how much she sits in one lane rather than weaving. */
  get laneStability(): number {
    return Math.min(1, this.sinceLaneChange / 6);
  }

  favouriteLane(exclude?: number): LaneIndex {
    let best = -1;
    let bestT = -1;
    for (let i = 0; i < 3; i++) {
      if (i === exclude) continue;
      if (this.laneTime[i] > bestT) {
        bestT = this.laneTime[i];
        best = i;
      }
    }
    return best as LaneIndex;
  }

  /**
   * Where will she be when she reaches x? If something already waits in her
   * lane before then, she'll dodge — toward the open neighbour she favours.
   */
  predictLane(x: number): LaneIndex {
    const v = this.visitor();
    const lane = v.lane;
    const threatIn = (l: number) =>
      this.obstacles().some((o) => o.threatening && o.blocksLanes && o.lanes.includes(l as LaneIndex) && ahead(v.x, o.x) > 2 && ahead(o.x, x) > -4);
    if (!threatIn(lane)) return lane;
    const options = [lane - 1, lane + 1].filter((l) => l >= 0 && l <= 2 && !threatIn(l));
    if (!options.length) return lane;
    if (options.length === 1) return options[0] as LaneIndex;
    // Habit, with a tiebreak toward the middle of the path.
    const [a, b] = options;
    const ta = this.laneTime[a] + (a === 1 ? 0.5 : 0);
    const tb = this.laneTime[b] + (b === 1 ? 0.5 : 0);
    return (ta >= tb ? a : b) as LaneIndex;
  }

  laneZ(l: LaneIndex): number {
    return LANES[l];
  }
}
