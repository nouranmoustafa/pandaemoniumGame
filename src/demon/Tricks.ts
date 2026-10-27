import * as THREE from 'three';
import type { EventBus } from '../core/Events';
import { damp } from '../core/math';
import { SHORTCUT } from '../story/park/course';
import type { VisitorController } from '../visitor/VisitorController';
import type { Environment } from '../world/Environment';
import { Bench } from '../world/props/Bench';
import { Signpost } from '../world/props/Signpost';
import type { DemonMind } from './DemonMind';
import type { Sarcasm } from './Sarcasm';
import type { VisitorObserver } from './VisitorObserver';

const BENCH_SPOTS = [30, 96, SHORTCUT.start + 5];
const BENCH_PLAQUES = ['FOR THOSE WHO WAITED', 'FOR THOSE WHO WAITED. STILL.', 'YOU AGAIN.'];
const SIGN_X = 70;

type ShortcutState = 'waiting' | 'active' | 'done';

/**
 * The Demon's quieter work — the psychological tricks. These run in both
 * modes (they belong to the park, not to the Demon player's hand):
 *
 *  - the lying signpost        - the recurring bench
 *  - the conferring lamps      - the false shortcut
 *  - the sarcastic pavement (an incline raised under a hard sprint)
 *
 * The watching lamp heads themselves live in Streetlights.
 */
export class Tricks {
  readonly group = new THREE.Group();
  readonly sign: Signpost;
  readonly lure: Signpost;
  readonly bench: Bench;
  shortcut: ShortcutState = 'waiting';
  private signRepeated = false;
  private signTurnedThisPass = false;
  private lightsTimer = 14;
  private inclineCooldown = 0;
  private inclinesUsed = 0;
  private inclineEnd = -1;
  private arch = new THREE.Group();

  constructor(
    private bus: EventBus,
    private env: Environment,
  ) {
    this.sign = new Signpost(SIGN_X, -5.0, 'EXIT');
    this.lure = new Signpost(SHORTCUT.start + 1, -5.0, 'EXIT', true);
    this.bench = new Bench(BENCH_SPOTS[0], -5.5);
    this.bench.engrave(BENCH_PLAQUES[0]);
    this.buildArch();
    this.group.add(this.sign.group, this.lure.group, this.bench.group, this.arch);
  }

  /** The false shortcut's gateway: two stone pillars and an iron arch, slightly askew. */
  private buildArch(): void {
    const stone = new THREE.MeshStandardMaterial({ color: 0x3a3640, roughness: 0.95 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x0b0a0e, roughness: 0.45, metalness: 0.6 });
    for (const dx of [-1.7, 1.7]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.55, 3.2, 0.55), stone);
      p.position.set(dx, 1.6, 0);
      p.rotation.z = dx * 0.012;
      p.castShadow = true;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), stone);
      cap.position.set(dx, 3.4, 0);
      this.arch.add(p, cap);
    }
    const arc = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.05, 6, 24, Math.PI), iron);
    arc.position.y = 3.1;
    this.arch.add(arc);
    this.arch.position.set(SHORTCUT.start - 2, 0, -6.6);
  }

  get peaceful(): boolean {
    return this.shortcut === 'active';
  }

  reset(): void {
    this.sign.reset(SIGN_X, false);
    this.lure.reset(SHORTCUT.start + 1, true);
    this.bench.moveTo(BENCH_SPOTS[0]);
    this.bench.encounter = 0;
    this.bench.engrave(BENCH_PLAQUES[0]);
    this.shortcut = 'waiting';
    this.signRepeated = false;
    this.signTurnedThisPass = false;
    this.lightsTimer = 14;
    this.inclineCooldown = 0;
    this.inclinesUsed = 0;
    this.inclineEnd = -1;
  }

  update(dt: number, v: VisitorController, obs: VisitorObserver, mind: DemonMind, sarcasm: Sarcasm): void {
    const pav = this.env.pavement;
    this.sign.update(dt, pav);
    this.lure.update(dt, pav);
    this.bench.update(dt, pav);
    if (v.mode === 'idle') return;
    const vx = v.x;

    // --- The lying signpost ---
    const d = this.sign.x - vx;
    if (d > 9 && d < 34 && !this.signTurnedThisPass) {
      this.sign.turnTo(true);
      this.signTurnedThisPass = true;
      this.bus.emit('trick:sign', { x: this.sign.x, toHouse: true });
    } else if (d <= 6.5 && d > -2.5) {
      this.sign.snapBack(dt); // she's close enough to read it: innocent again
    } else if (d <= -2.5 && d > -8 && this.sign.heading < 0.5) {
      this.sign.turnTo(true); // ...and it watches her go
    }

    // --- The recurring bench ---
    const b = this.bench;
    if (vx > b.x + 11 && b.encounter < BENCH_SPOTS.length - 1) {
      b.encounter++;
      b.moveTo(BENCH_SPOTS[b.encounter]);
      b.engrave(BENCH_PLAQUES[b.encounter]);
      this.bus.emit('trick:bench', { encounter: b.encounter + 1 });
    }

    // --- The conferring lamps ---
    this.lightsTimer -= dt * (mind.phase === 'amused' ? 1 : 0.6);
    if (this.lightsTimer <= 0 && v.mode === 'run') {
      const ok = this.env.lamps.confer(vx + 22, vx + 55);
      if (ok) this.bus.emit('trick:lights', {});
      // On success, a long pause; otherwise try again shortly further on.
      this.lightsTimer = ok ? 22 + Math.random() * 10 : 3;
    }

    // --- The false shortcut ---
    if (this.shortcut === 'waiting' && vx > SHORTCUT.start - 6) {
      this.shortcut = 'active';
      this.bus.emit('trick:shortcut', { active: true });
    }
    if (this.shortcut === 'active') {
      // Everything goes quiet; a following breeze; she speeds up without trying.
      v.tailwind = damp(v.tailwind, 2.6, 1.5, dt);
      this.env.setPeace(1);
      // Familiar landmarks begin to repeat: the same lying sign, the same two lamps.
      if (!this.signRepeated && vx > this.sign.x + 15 && vx > SHORTCUT.start + 6) {
        this.signRepeated = true;
        this.sign.reset(SHORTCUT.start + 30, true);
        this.signTurnedThisPass = true;
        this.env.lamps.confer(SHORTCUT.start + 26, SHORTCUT.end + 20);
      }
      if (vx > SHORTCUT.end - 4) {
        this.shortcut = 'done';
        this.env.setPeace(0);
        this.env.flareHouse();
        this.bus.emit('trick:shortcut', { active: false });
      }
    } else {
      v.tailwind = damp(v.tailwind, 0, 2, dt);
    }

    // --- The sarcastic pavement ---
    this.inclineCooldown = Math.max(0, this.inclineCooldown - dt);
    const safeStretch = vx > 36 && vx < 196 && (vx + 46 < SHORTCUT.start || vx > SHORTCUT.end);
    if (
      v.mode === 'run' &&
      obs.hardSprintTime > 2 &&
      this.inclineCooldown <= 0 &&
      this.inclinesUsed < 2 &&
      safeStretch &&
      !pav.inclineActive
    ) {
      const x0 = vx + 11;
      pav.raiseIncline(x0, 34, 2.6);
      this.inclineEnd = x0 + 34;
      this.inclinesUsed++;
      this.inclineCooldown = 40;
      this.bus.emit('pavement:sarcasm', { x: x0 });
      sarcasm.say('effort', v, x0 + 12);
    }
    if (this.inclineEnd > 0 && vx > this.inclineEnd) {
      pav.lowerInclines();
      this.inclineEnd = -1;
    }
  }
}
