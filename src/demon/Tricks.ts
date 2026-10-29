import * as THREE from 'three';
import { ahead, CHASE } from '../config';
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

/** Positions along the chase (it runs toward −X): `F` metres on from x. */
const F = (x: number, metres: number) => x + metres * CHASE.dir;
const BENCH_SPOTS = [F(CHASE.start, 30), F(CHASE.start, 96), F(SHORTCUT.start, 5)];
const BENCH_PLAQUES = ['FOR THOSE WHO WAITED', 'FOR THOSE WHO WAITED. STILL.', 'YOU AGAIN.'];
const SIGN_X = F(CHASE.start, 70);

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
    this.lure = new Signpost(F(SHORTCUT.start, 1), -5.0, 'EXIT', true);
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
    this.arch.position.set(F(SHORTCUT.start, -2), 0, -6.6);
  }

  get peaceful(): boolean {
    return this.shortcut === 'active';
  }

  reset(): void {
    this.sign.reset(SIGN_X, false);
    this.lure.reset(F(SHORTCUT.start, 1), true);
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
    const d = ahead(vx, this.sign.x);
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
    if (ahead(b.x, vx) > 11 && b.encounter < BENCH_SPOTS.length - 1) {
      b.encounter++;
      b.moveTo(BENCH_SPOTS[b.encounter]);
      b.engrave(BENCH_PLAQUES[b.encounter]);
      this.bus.emit('trick:bench', { encounter: b.encounter + 1 });
    }

    // --- The conferring lamps ---
    this.lightsTimer -= dt * (mind.phase === 'amused' ? 1 : 0.6);
    if (this.lightsTimer <= 0 && v.mode === 'run') {
      const ok = this.env.lamps.confer(Math.min(F(vx, 22), F(vx, 55)), Math.max(F(vx, 22), F(vx, 55)));
      if (ok) this.bus.emit('trick:lights', {});
      // On success, a long pause; otherwise try again shortly further on.
      this.lightsTimer = ok ? 22 + Math.random() * 10 : 3;
    }

    // --- The false shortcut ---
    if (this.shortcut === 'waiting' && ahead(SHORTCUT.start, vx) > -6) {
      this.shortcut = 'active';
      this.bus.emit('trick:shortcut', { active: true });
    }
    if (this.shortcut === 'active') {
      // Everything goes quiet; a following breeze; she speeds up without trying.
      v.tailwind = damp(v.tailwind, 2.6, 1.5, dt);
      this.env.setPeace(1);
      // Familiar landmarks begin to repeat: the same lying sign, the same two lamps.
      if (!this.signRepeated && ahead(this.sign.x, vx) > 15 && ahead(SHORTCUT.start, vx) > 6) {
        this.signRepeated = true;
        this.sign.reset(F(SHORTCUT.start, 30), true);
        this.signTurnedThisPass = true;
        this.env.lamps.confer(Math.min(F(SHORTCUT.start, 26), F(SHORTCUT.end, 20)), Math.max(F(SHORTCUT.start, 26), F(SHORTCUT.end, 20)));
      }
      if (ahead(SHORTCUT.end, vx) > -4) {
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
    const run = ahead(CHASE.start, vx);
    const safeStretch = run > 36 && run < 196 && (ahead(vx, SHORTCUT.start) > 46 || ahead(SHORTCUT.end, vx) > 0);
    if (
      v.mode === 'run' &&
      obs.hardSprintTime > 2 &&
      this.inclineCooldown <= 0 &&
      this.inclinesUsed < 2 &&
      safeStretch &&
      !pav.inclineActive
    ) {
      // 11 m ahead of her, 34 m long (the pavement takes it from its low-X end).
      const x0 = Math.min(F(vx, 11), F(vx, 45));
      pav.raiseIncline(x0, 34, 2.6);
      this.inclineEnd = F(vx, 45);
      this.inclinesUsed++;
      this.inclineCooldown = 40;
      this.bus.emit('pavement:sarcasm', { x: x0 });
      sarcasm.say('effort', v, F(vx, 23));
    }
    if (this.inclineEnd > 0 && ahead(this.inclineEnd, vx) > 0) {
      pav.lowerInclines();
      this.inclineEnd = -1;
    }
  }
}
