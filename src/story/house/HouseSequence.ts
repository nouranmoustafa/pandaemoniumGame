import * as THREE from 'three';
import { CinematicDirector, type Shot, type ShotFrame } from '../../camera/CinematicDirector';
import { WeddingDress } from '../../characters/WeddingDress';
import { COURSE } from '../../config';
import type { EventBus, HouseSound } from '../../core/Events';
import type { Input } from '../../core/Input';
import { clamp, damp, lerp, smoothstep } from '../../core/math';
import type { Visitor } from '../../visitor/Visitor';
import type { Ground } from '../../visitor/VisitorController';
import type { Environment } from '../../world/Environment';
import { HOUSE_FLOOR, HOUSE_FRONT } from '../../world/House';
import { HouseInterior, ROOM } from '../../world/HouseInterior';
import { Ribbon } from '../../world/Ribbon';
import { Vine, vineMaterial } from '../../world/Vine';

export type HouseBeat = 'HOUSE_THRESHOLD' | 'HOUSE_INTERIOR' | 'WEDDING_DRESS';
type Phase = 'off' | 'threshold' | 'interior' | 'dress' | 'done';

/** The front door, in world space: the wall's X, the path side of it. */
const DOOR = new THREE.Vector3(COURSE.houseX + HOUSE_FRONT, HOUSE_FLOOR, COURSE.houseZ);
/** Interior clock: when the ribbons come for her again, and when they start to pull. */
const AISLE_REACH = 8.8;
const AISLE_PULL = 10.2;
/** Dress clock: the gown's reveal and the veil. */
const REVEAL = [1.2, 7.2] as const;
const VEIL = [5.6, 8.0] as const;
/** Stage 5 follows straight on (laughter outside), so the house no longer fades to its end card here. */
const DRESS_END = 13.4;
/**
 * Stage 6 pacing: the house's cue clock runs faster than real time (the same beats, less
 * waiting); her walking speeds are raised to match, so she still reaches each mark.
 */
const CLOCK = { threshold: 1.35, interior: 1.45, dress: 1.4 } as const;

export interface HouseServices {
  bus: EventBus;
  input: Input;
  say: (text: string, duration?: number) => void;
  fade: (opacity: number, seconds: number) => void;
  shake: (amount: number) => void;
  prompt: (html: string | null) => void;
}

interface Cue {
  at: number;
  run: () => void;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Stage 4: the house takes her in.
 *
 * THRESHOLD — the door swings open and white silk ribbons reach out of the
 * light, take her by the wrists and waist, and draw her up the path. She can
 * pull back (tap SPACE); the house only tightens its grip and keeps count.
 *
 * INTERIOR — the door slams behind her. The hall is laid out as a wedding
 * with no guests: rows of empty chairs, a crimson aisle, candles that light
 * themselves, a dead-rose arch, a tall mirror under a sheet. The ribbons
 * come again and walk her down the aisle.
 *
 * WEDDING_DRESS — under the arch, the ribbons spiral round her and the gown
 * takes her: her coat whitens and dissolves as the gown grows over her along
 * the same field, and the veil settles from above. Her face is made to
 * smile. The sheet slips from the mirror; the mirror is not ready yet.
 *
 * Like the prologue it runs on its own clocks with cues that fire once, so
 * pausing freezes it and a skip simply ends it.
 *
 * Stage 5: when it ends (onComplete) the finale takes her from the mirror
 * to the window, in the same room, without a cut.
 */
export class HouseSequence {
  readonly interior = new HouseInterior();
  readonly director = new CinematicDirector();
  readonly dress: WeddingDress;
  phase: Phase = 'off';
  /** Clock of the current phase (the dress keeps the interior's clock running). */
  time = 0;
  /** How many times she pulled back. */
  resists = 0;
  onBeat: (b: HouseBeat) => void = () => {};
  onComplete: () => void = () => {};
  private ribbons: Ribbon[] = [];
  /** Vines that grow across the inside of the front door when she tries it. */
  private doorVines: Vine[] = [];
  private doorSeal = 0;
  /** The capture at the door: vines out of the ground for her wrists and waist. */
  private captureVines: Vine[] = [];
  /** Per ribbon: when it starts to reach for her on the current clock (-1 = not yet). */
  private reachAt = [-1, -1, -1];
  private spiral = 0;
  private dressStart = 0;
  private cues: Cue[] = [];
  private cueIndex = 0;
  private transition = -1;
  /** She came to on the ground (a Demon win): dragged, not walked, to the door. */
  private waking = false;
  private speed = 0;
  private targetSpeed = 0;
  private heading = Math.PI / 2;
  private targetHeading: number | null = null;
  private aim: THREE.Vector3 | null = null;
  private pulling = false;
  private complete = false;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private pts: THREE.Vector3[] = Array.from({ length: 32 }, () => new THREE.Vector3());

  /** Up the path to the porch, then the porch itself. */
  private porch: Ground;
  private floor: Ground = { heightAt: () => 0, slopeAt: () => 0, rollAngle: () => 0 };

  constructor(
    scene: THREE.Scene,
    private env: Environment,
    private visitor: Visitor,
    private s: HouseServices,
  ) {
    scene.add(this.interior.group);
    for (let k = 0; k < 3; k++) {
      const r = new Ribbon(k === 2 ? 0.1 : 0.075, k * 2.1);
      scene.add(r.mesh);
      this.ribbons.push(r);
    }
    this.dress = new WeddingDress(visitor.character, scene);
    const vm = vineMaterial();
    for (let k = 0; k < 3; k++) {
      const v = new Vine(vm, k === 2 ? 0.06 : 0.045, 48, 7, 7);
      scene.add(v.mesh);
      this.captureVines.push(v);
    }
    for (let k = 0; k < 5; k++) {
      const v = new Vine(vm, 0.045 + (k % 2) * 0.015, 32, 7, 6);
      const y = 0.4 + k * 0.62;
      const p = (x: number, yy: number, z: number) => this.interior.toWorld(x, yy, z);
      v.setPath([p(0.16, y - 0.3, -1.35), p(0.24, y + 0.2, -0.5), p(0.2, y - 0.15, 0.4), p(0.16, y + 0.25, 1.35)]);
      scene.add(v.mesh);
      this.doorVines.push(v);
    }
    const pave = env.pavement;
    this.porch = {
      heightAt: (x, z) => lerp(pave.heightAt(x, z), HOUSE_FLOOR, smoothstep(DOOR.x - 5.0, DOOR.x - 4.0, x)),
      slopeAt: () => 0,
      rollAngle: () => 0,
    };
  }

  /**
   * Compile the interior, the gown and the ribbons now, under the indoor
   * lighting they will be drawn with, so the house never stalls on entry.
   */
  prewarm(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    // A real frame of each, not just compile(): that also builds the shadow
    // passes' depth programs and uploads the buffers and painted textures.
    // The ribbons are first seen outdoors, at the door, in the moon's shadow.
    const rib = this.ribbons[0];
    rib.setPath([camera.position.clone().add(new THREE.Vector3(0, 0, -3)), camera.position.clone().add(new THREE.Vector3(1, 0, -3))]);
    rib.extent = 1;
    rib.update(0);
    renderer.render(scene, camera);
    // Indoors: the room, the gown half-revealed and the veil, from the aisle.
    this.env.setIndoors(true);
    this.interior.visible = true;
    this.dress.reveal = 0.5;
    this.dress.veil.begin(0);
    const body = this.visitor.character.object;
    const home = body.position.clone();
    this.interior.toWorld(ROOM.altarX, 0, 0, body.position);
    rib.setPath([this.interior.toWorld(ROOM.altarX - 1, 1, 0), this.interior.toWorld(ROOM.altarX - 1, 2, 0)]);
    rib.update(0);
    const cam = camera.clone();
    cam.position.copy(this.interior.toWorld(ROOM.altarX - 3.5, 1.6, 1.2));
    cam.lookAt(this.interior.toWorld(ROOM.altarX, 1.1, 0));
    cam.updateMatrixWorld();
    renderer.render(scene, cam);
    body.position.copy(home);
    rib.extent = 0;
    rib.mesh.visible = false;
    this.dress.reset();
    this.interior.visible = false;
    this.env.setIndoors(false);
  }

  get active(): boolean {
    return this.phase !== 'off' && this.phase !== 'done';
  }

  /** Inside (including the held final tableau behind the end card). */
  get indoors(): boolean {
    return this.interior.visible;
  }

  // ------------------------------------------------------------------ flow

  /** The door opens. She has stopped in front of the house (the chase's arrival). */
  start(cameraFrom: ShotFrame): void {
    this.reset();
    this.env.house.group.position.set(COURSE.houseX, this.env.house.group.position.y, COURSE.houseZ);
    this.env.house.rise = 1;
    this.env.house.snapRise();
    this.phase = 'threshold';
    this.visitor.useGeneratedBody(true);
    const c = this.visitor.controller;
    this.heading = this.visitor.heading;
    this.speed = Math.min(c.speed, 1.5);
    this.targetSpeed = 0;
    this.aim = null;
    this.director.setShots(this.thresholdShots());
    this.director.startFrom(cameraFrom.pos, cameraFrom.look, cameraFrom.fov);
    this.setCues(this.thresholdCues());
    this.onBeat('HOUSE_THRESHOLD');
  }

  /** Everything back as it was: her own clothes, the park visible, the door shut. */
  reset(): void {
    this.phase = 'off';
    this.time = 0;
    this.resists = 0;
    this.transition = -1;
    this.waking = false;
    this.complete = false;
    this.pulling = false;
    this.spiral = 0;
    this.reachAt = [-1, -1, -1];
    for (const r of this.ribbons) {
      r.extent = 0;
      r.mesh.visible = false;
    }
    this.dress.reset();
    this.doorSeal = 0;
    for (const v of this.doorVines) {
      v.extent = 0;
      v.update();
    }
    this.interior.reset();
    this.interior.visible = false;
    this.env.setIndoors(false);
    this.env.house.doorOpen = 0;
    this.visitor.useGeneratedBody(false);
    this.s.prompt(null);
  }

  /**
   * Skip: jump to the final tableau — gowned under the arch, the sheet off
   * the mirror — and end. The caller fades around this.
   */
  finish(notify = true): void {
    if (this.phase === 'off' || this.complete) return;
    if (!this.interior.visible) this.enterInterior();
    this.s.fade(1, 0);
    const I = this.interior;
    const at = I.toWorld(ROOM.altarX, 0, 0);
    this.heading = Math.PI / 2;
    this.targetHeading = Math.PI / 2;
    this.speed = this.targetSpeed = 0;
    this.aim = null;
    this.pulling = false;
    this.visitor.place(at.x, at.z, this.heading, this.floor);
    this.perf.reset();
    this.perf.express({ smile: 0.5, fear: 0.6, surprise: 0.3 }, 20);
    this.perf.lookAt(I.toWorld(ROOM.mirrorX, 1.8, 0), 0.9);
    this.dress.wearNow();
    I.lightPairs(ROOM.candleXs.length);
    I.lightChandelier();
    I.doorShut = I.sheetSlip = I.mirrorWake = 1;
    for (const r of this.ribbons) r.extent = 0;
    this.reachAt = [-1, -1, -1];
    this.dressStart = this.time - DRESS_END;
    this.director.setShots(this.dressShots(this.dressStart));
    this.cues = [];
    this.cueIndex = 0;
    this.phase = 'done';
    this.complete = true;
    this.s.prompt(null);
    if (notify) this.onComplete();
  }

  /** Debug / test: straight to the gowned tableau under the arch, without handing on. */
  jumpToTableau(): void {
    this.reset();
    this.phase = 'dress';
    this.visitor.useGeneratedBody(true);
    this.finish(false);
  }

  private setCues(cues: Cue[]): void {
    this.cues = cues.sort((a, b) => a.at - b.at);
    this.cueIndex = 0;
  }

  private sound(id: HouseSound): void {
    this.s.bus.emit('house:sound', { id });
  }

  private get perf() {
    return this.visitor.performer;
  }

  private bone(name: 'wristL' | 'wristR' | 'hips', out: THREE.Vector3): THREE.Vector3 {
    return this.visitor.character.getBoneWorld(name, out);
  }

  // --------------------------------------------------------------- update

  update(dt: number): ShotFrame {
    // The house never speaks: it answers with doors, candles, ribbons and the mirror.
    this.time += dt * (this.phase === 'threshold' || this.phase === 'interior' || this.phase === 'dress' ? CLOCK[this.phase] : 1);
    const t = this.time;
    while (this.cueIndex < this.cues.length && this.cues[this.cueIndex].at <= t) this.cues[this.cueIndex++].run();
    if (this.phase === 'threshold') this.updateThreshold(dt);
    else if (this.phase === 'interior') this.updateInterior(dt);
    else if (this.phase === 'dress') this.updateDress(dt);
    else if (this.phase === 'done' && this.interior.visible) this.drive(dt, this.floor);
    this.updateRibbons();
    this.interior.update(dt);
    this.dress.update(dt);
    return this.director.update(t, dt);
  }

  /** Tap SPACE: she heaves back. The ribbons go slack for a moment, then take up the slack. */
  private resist(): void {
    if (!this.pulling || !this.s.input.consume('sprint')) return;
    this.resists++;
    this.speed = 0;
    this.perf.play('resist');
    this.s.shake(0.12);
    this.sound('snap');
  }

  /** Walk (or be walked) toward `aim` at the current speed; turn toward the target heading. */
  private drive(dt: number, ground: Ground): void {
    const v = this.visitor;
    const c = v.controller;
    this.speed = damp(this.speed, this.targetSpeed, this.pulling ? 1.6 : 2.6, dt);
    let move = this.heading;
    if (this.aim) {
      const d = Math.hypot(this.aim.x - c.x, this.aim.z - c.z);
      if (d < 0.12 && !this.pulling) this.targetSpeed = 0;
      move = Math.atan2(this.aim.x - c.x, this.aim.z - c.z);
    }
    const want = this.targetHeading ?? (this.speed > 0.2 ? move : this.heading);
    const diff = wrapAngle(want - this.heading);
    this.heading += clamp(diff, -2.6 * dt, 2.6 * dt);
    const x = c.x + Math.sin(move) * this.speed * dt;
    const z = c.z + Math.cos(move) * this.speed * dt;
    v.place(x, z, this.heading, ground);
    // Dragged along the ground, her legs don't walk.
    v.updateCinematic(dt, this.waking ? 0 : this.speed);
  }

  private updateThreshold(dt: number): void {
    const t = this.time;
    this.env.house.doorOpen = damp(this.env.house.doorOpen, t > 0.2 ? 1 : 0, 1.8, dt);
    this.resist();
    this.drive(dt, this.porch);
    // She crosses the threshold into the light; the door takes her.
    const c = this.visitor.controller;
    const dist = Math.hypot(DOOR.x - 0.3 - c.x, DOOR.z - c.z);
    if (this.transition < 0 && dist < 0.8) {
      this.transition = 0;
      this.pulling = false;
      this.s.prompt(null);
      this.s.fade(1, 0.4);
    }
    if (this.transition >= 0) {
      this.transition += dt;
      if (this.transition > 0.55) this.enterInterior();
    }
  }

  private enterInterior(): void {
    this.phase = 'interior';
    this.time = 0;
    this.transition = -1;
    this.env.setIndoors(true);
    this.env.house.doorOpen = 0;
    this.interior.visible = true;
    this.interior.reset();
    for (const r of this.ribbons) r.extent = 0;
    this.reachAt = [-1, -1, -1];
    const start = this.interior.toWorld(1.7, 0, 0.1);
    this.heading = Math.PI / 2;
    this.targetHeading = null;
    this.visitor.place(start.x, start.z, this.heading, this.floor);
    this.speed = 1.3;
    this.targetSpeed = 0;
    this.aim = null;
    this.perf.stop('pulled');
    this.perf.stop('fallen');
    this.waking = false;
    this.director.setShots(this.interiorShots());
    this.setCues(this.interiorCues());
    this.s.fade(0, 1.3);
    this.onBeat('HOUSE_INTERIOR');
  }

  private updateInterior(dt: number): void {
    this.interior.doorShut = smoothstep(0.12, 0.38, this.time);
    // As she tries the handle, the door grows shut.
    this.doorSeal = smoothstep(3.3, 5.2, this.time);
    this.doorVines.forEach((v, k) => {
      v.extent = smoothstep(k * 0.12, 0.5 + k * 0.12, this.doorSeal);
      v.update(this.time);
    });
    this.resist();
    this.drive(dt, this.floor);
    if (this.pulling && this.visitor.controller.x >= this.interior.toWorld(ROOM.altarX, 0, 0).x) this.beginDress();
  }

  private beginDress(): void {
    this.phase = 'dress';
    this.pulling = false;
    this.s.prompt(null);
    this.dressStart = this.time;
    this.targetSpeed = 0;
    this.aim = null;
    this.targetHeading = Math.PI / 2;
    this.perf.stop('pulled');
    const d0 = this.dressStart;
    this.director.setShots([...this.interiorShots(), ...this.dressShots(d0)]);
    this.director.startFrom(this.director.out.pos, this.director.out.look, this.director.out.fov);
    this.setCues(this.dressCues(d0));
    this.onBeat('WEDDING_DRESS');
  }

  private updateDress(dt: number): void {
    const d = this.time - this.dressStart;
    this.drive(dt, this.floor);
    this.dress.reveal = smoothstep(REVEAL[0], REVEAL[1], d);
    this.dress.veilDrop = smoothstep(VEIL[0], VEIL[1], d);
    // The ribbons let go of her wrists, then wind round her from above, then withdraw.
    this.spiral = smoothstep(0.6, 2.0, d) * (1 - smoothstep(6.4, 8.2, d));
    this.interior.sheetSlip = smoothstep(9.8, 11.2, d);
    this.interior.mirrorWake = smoothstep(10.4, 12.4, d);
    if (d >= DRESS_END && !this.complete) {
      this.phase = 'done';
      this.complete = true;
      this.onComplete();
    }
  }

  // -------------------------------------------------------------- ribbons

  /**
   * Each ribbon either reaches from its root to a hold on her (wrists,
   * waist), drawn out along the path as it reaches, or — during the gown —
   * spirals down around her from the dark above.
   */
  private updateRibbons(): void {
    const t = this.time;
    const holds = ['wristR', 'wristL', 'hips'] as const;
    for (let k = 0; k < 3; k++) {
      const r = this.ribbons[k];
      if (this.phase === 'dress') {
        const d = t - this.dressStart;
        // First the wrists are let go (the reaching ribbons withdraw), then the spiral.
        if (d < 0.6) {
          this.layHold(k, holds[k], this.rootFor(k), 1);
          r.extent = 1 - smoothstep(0, 0.6, d);
        } else {
          this.laySpiral(k, d);
          r.extent = this.spiral;
        }
      } else if (this.reachAt[k] >= 0 && this.phase !== 'off' && this.phase !== 'done') {
        const u = clamp((t - this.reachAt[k]) / 1.15, 0, 1);
        const taut = smoothstep(0.9, 1, u) * (this.pulling ? 1 : 0.6);
        this.layHold(k, holds[k], this.rootFor(k), taut);
        r.extent = 1 - (1 - u) * (1 - u) * (1 - u);
      } else r.extent = 0;
      // At the door it is vines that take her; ribbons only inside.
      const vine = this.captureVines[k];
      vine.extent = this.phase === 'threshold' ? r.extent : 0;
      if (this.phase === 'threshold') r.extent = 0;
      vine.update(t);
      r.update(t);
    }
  }

  private rootFor(k: number): THREE.Vector3 {
    // Out of the ground between her and the porch.
    if (this.phase === 'threshold') return this.tmp2.set(DOOR.x - 1.4 - k * 0.5, 0.02, DOOR.z + [0.9, -0.9, 0.1][k]);
    return this.interior.toWorld(ROOM.archX - 0.1, [2.45, 2.6, 2.2][k], [0.45, -0.45, 0][k], this.tmp2);
  }

  /** Root → (snaking, then pulled straight) → one loop round the hold. */
  private layHold(k: number, hold: 'wristL' | 'wristR' | 'hips', root: THREE.Vector3, taut: number): void {
    const t = this.time;
    const end = this.bone(hold, this.tmp);
    if (hold === 'hips') end.y += 0.12;
    const pts = this.pts;
    const n = 7;
    const dx = end.x - root.x;
    const dz = end.z - root.z;
    const len = Math.hypot(dx, dz) || 1;
    const px = -dz / len;
    const pz = dx / len;
    const slack = 1 - taut;
    for (let j = 0; j < n; j++) {
      const f = j / (n - 1);
      const env = Math.sin(f * Math.PI);
      const snake = Math.sin(f * 7 - t * 5 + k * 1.7) * 0.28 * slack * env + Math.sin(t * 1.3 + k) * 0.04 * env;
      pts[j].set(lerp(root.x, end.x, f) + px * snake, lerp(root.y, end.y, f) - 0.35 * slack * env + Math.cos(f * 5 - t * 4 + k) * 0.12 * slack * env, lerp(root.z, end.z, f) + pz * snake);
    }
    // A turn round the wrist (or waist).
    const R = hold === 'hips' ? 0.2 : 0.045;
    for (let j = 0; j < 4; j++) {
      const a = (j / 4) * Math.PI * 2 + 0.6;
      pts[n + j].set(end.x + px * Math.cos(a) * R, end.y + Math.sin(a) * R * (hold === 'hips' ? 0.25 : 1), end.z + pz * Math.cos(a) * R + (hold === 'hips' ? Math.sin(a) * R : 0));
    }
    const target = this.phase === 'threshold' ? this.captureVines[k] : this.ribbons[k];
    target.setPath(pts.slice(0, n + 4));
  }

  /** Down from the dark above her, winding round her body to the floor. */
  private laySpiral(k: number, d: number): void {
    const base = this.visitor.position;
    const pts = this.pts;
    const n = 30;
    for (let j = 0; j < n; j++) {
      const f = j / (n - 1);
      const a = k * 2.094 + f * Math.PI * 3.2 + d * 1.1;
      const y = lerp(4.6, 0.12, f);
      // Wide where it comes down, close round her through the body, flaring with the skirt.
      const r = lerp(1.0, 0.36, smoothstep(0, 0.35, f)) + smoothstep(0.65, 1, f) * 0.28;
      pts[j].set(base.x + Math.cos(a) * r, base.y + y, base.z + Math.sin(a) * r);
    }
    this.ribbons[k].setPath(pts.slice(0, n));
  }

  // ---------------------------------------------------------------- script

  /**
   * The Demon won: the road turned her round and she blacked out. She comes to on the
   * ground before the porch, and the vines are already coming for her out of the grass;
   * they drag her, on her back, to the open door. (The interior follows as usual.)
   */
  startWake(): void {
    this.start({ pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40 });
    this.waking = true;
    const at = new THREE.Vector3(DOOR.x - 11, 0, DOOR.z + 0.3);
    this.heading = this.targetHeading = -Math.PI / 2;
    this.speed = this.targetSpeed = 0;
    this.visitor.place(at.x, at.z, this.heading, this.porch);
    this.perf.reset();
    this.perf.play('fallen', 1, 600);
    this.perf.express({ distress: 0.4, concern: 0.3 }, 3);
    this.setCues(this.wakeCues());
    const shots = this.wakeShots();
    const f0: ShotFrame = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 36 };
    shots[0].frame(0, f0);
    this.director.setShots(shots);
    this.director.startFrom(f0.pos, f0.look, f0.fov);
    this.s.fade(0, 2.4);
  }

  private wakeCues(): Cue[] {
    const V = this.perf;
    const doorAt = new THREE.Vector3(DOOR.x, DOOR.y + 1.8, DOOR.z);
    return [
      { at: 0.4, run: () => this.sound('creak') },
      // She comes to; the house is right behind her, its door open.
      { at: 1.3, run: () => (V.express({ fear: 0.45, surprise: 0.4, distress: 0.4 }, 4), V.lookAt(doorAt, 0.8)) },
      { at: 2.0, run: () => ((this.reachAt[0] = 2.0), this.sound('silk'), this.env.rippleGrass(DOOR.x - 6, 1)) },
      { at: 2.4, run: () => ((this.reachAt[1] = 2.4), this.sound('silk')) },
      { at: 2.8, run: () => ((this.reachAt[2] = 2.8), V.play('flinch'), V.express({ fear: 0.8, distress: 0.6 }, 6), (V.nervous = 0.7), this.s.shake(0.2)) },
      {
        at: 3.6,
        run: () => {
          this.pulling = true;
          this.aim = new THREE.Vector3(DOOR.x - 0.2, 0, DOOR.z);
          this.targetSpeed = 2.0;
          this.s.shake(0.25);
          this.s.prompt('TAP SPACE — <span>PULL BACK</span>');
        },
      },
      { at: 5.2, run: () => (V.lookAt(this.tmp.set(this.visitor.position.x - 20, 1.2, this.visitor.position.z).clone(), 1), (this.targetSpeed = 2.4)) },
    ];
  }

  private wakeShots(): Shot[] {
    const v = this.visitor;
    const E = new THREE.Vector3();
    return [
      {
        // Low on the ground, by her face, the porch beyond her.
        name: 'wake',
        start: 0,
        blend: 0,
        frame: (_t, o) => {
          // Above her face, looking down at her as she comes to.
          v.eyesWorld(E);
          o.pos.set(E.x - 1.6, E.y + 1.5, E.z + 1.5);
          o.look.set(E.x + 0.3, E.y, E.z);
          o.fov = 40;
        },
      },
      {
        // Wide, from the side: the grass rising for her, the open door.
        name: 'seized',
        start: 1.9,
        blend: 1.2,
        frame: (_t, o) => {
          const p = v.position;
          o.pos.set(p.x + 0.2, p.y + 3.2, p.z + 8.6);
          o.look.set(p.x + 2.2, p.y + 0.3, p.z);
          o.fov = 40;
        },
      },
      {
        // Tracking alongside as she is dragged to the threshold.
        name: 'drag',
        start: 3.8,
        blend: 1.6,
        frame: (_t, o) => {
          const p = v.position;
          o.pos.set(p.x + 0.6, p.y + 2.8, p.z + 7.8);
          o.look.set(p.x + 2.4, p.y + 0.4, p.z);
          o.fov = 40;
        },
      },
    ];
  }

  private thresholdCues(): Cue[] {
    const V = this.perf;
    const doorAt = new THREE.Vector3(DOOR.x, DOOR.y + 1.8, DOOR.z);
    return [
      { at: 0.15, run: () => (this.sound('creak'), V.lookAt(doorAt, 0.9), V.express({ concern: 0.6, fear: 0.2 }, 3)) },
      { at: 1.5, run: () => ((this.reachAt[0] = 1.5), this.sound('silk')) },
      { at: 2.1, run: () => (V.express({ fear: 0.5, surprise: 0.5 }, 6), (V.nervous = 0.6)) },
      { at: 2.65, run: () => (V.play('flinch'), V.lookAt(this.bone('wristR', new THREE.Vector3()), 1), this.s.shake(0.15)) },
      { at: 2.7, run: () => ((this.reachAt[1] = 2.7), this.sound('silk')) },
      { at: 3.5, run: () => ((this.reachAt[2] = 3.5), this.sound('silk')) },
      {
        at: 3.6,
        run: () => {
          this.pulling = true;
          this.aim = new THREE.Vector3(DOOR.x - 0.2, 0, DOOR.z);
          this.targetSpeed = 3.1;
          V.play('pulled', -1, 600);
          V.lookAt(doorAt, 0.7);
          V.express({ fear: 0.55, distress: 0.5, determined: 0.3 }, 4);
          this.s.prompt('TAP SPACE — <span>PULL BACK</span>');
        },
      },
      // A last look back at the park.
      { at: 6.2, run: () => V.lookAt(this.tmp.set(this.visitor.position.x - 20, 1.6, this.visitor.position.z + 6).clone(), 1) },
      { at: 7.4, run: () => (V.lookAt(doorAt, 0.8), (this.targetSpeed = 3.6)) },
    ];
  }

  private interiorCues(): Cue[] {
    const V = this.perf;
    const I = this.interior;
    const door = I.toWorld(0, 1.5, 0.2);
    return [
      { at: 0.0, run: () => (V.express({ fear: 0.6, surprise: 0.4 }, 6), (V.nervous = 0.5)) },
      { at: 0.3, run: () => (this.sound('slam'), this.s.shake(0.5), V.play('flinch')) },
      { at: 1.2, run: () => ((this.targetHeading = -Math.PI / 2), V.lookAt(door, 1)) },
      { at: 2.0, run: () => ((this.aim = I.toWorld(0.62, 0, 0.25)), (this.targetSpeed = 1.35), (this.targetHeading = null)) },
      { at: 3.0, run: () => ((this.targetHeading = -Math.PI / 2), V.play('tryDoor', -1)) },
      { at: 3.4, run: () => this.s.shake(0.12) },
      { at: 3.8, run: () => this.sound('rattle') },
      { at: 5.4, run: () => ((this.targetHeading = Math.PI / 2), V.express({ fear: 0.4, concern: 0.6 }, 3)) },
      ...ROOM.candleXs.map((x, i) => ({
        at: 5.6 + i * 0.5,
        run: () => {
          I.lightPairs(i + 1);
          this.sound('candle');
          V.lookAt(I.toWorld(x, 1.3, 0), 0.7);
        },
      })),
      { at: 8.6, run: () => (this.sound('organ'), V.lookAt(I.toWorld(ROOM.archX, 1.8, 0), 0.8), V.express({ fear: 0.5, distress: 0.4 }, 3)) },
      ...[0, 1, 2].map((k) => ({ at: AISLE_REACH + k * 0.5, run: () => ((this.reachAt[k] = AISLE_REACH + k * 0.5), this.sound('silk')) })),
      {
        at: AISLE_PULL,
        run: () => {
          this.pulling = true;
          this.aim = I.toWorld(ROOM.altarX + 1, 0, 0);
          this.targetHeading = null;
          this.targetSpeed = 1.55;
          V.play('pulled', -1, 600);
          V.express({ fear: 0.45, distress: 0.55 }, 3);
          this.s.prompt('TAP SPACE — <span>PULL BACK</span>');
        },
      },
      { at: AISLE_PULL + 5.5, run: () => this.sound('creak') },
    ];
  }

  private dressCues(d0: number): Cue[] {
    const V = this.perf;
    const I = this.interior;
    const mirror = I.toWorld(ROOM.mirrorX, 1.8, 0);
    return [
      { at: d0 + 0.0, run: () => (this.sound('silk'), V.express({ fear: 0.6, surprise: 0.3 }, 4), V.lookAt(null)) },
      { at: d0 + 0.6, run: () => (V.play('raised', 1, 600), this.sound('silk')) },
      { at: d0 + REVEAL[0], run: () => ((I.flare = 1), V.express({ fear: 0.7, distress: 0.5, surprise: 0.3 }, 3)) },
      { at: d0 + 3.6, run: () => (I.lightChandelier(), this.sound('bell'), this.sound('silk')) },
      { at: d0 + 5.0, run: () => V.lookAt(this.tmp.copy(this.visitor.position).add(new THREE.Vector3(0.3, 3.5, 0)).clone(), 0.6) },
      { at: d0 + 6.2, run: () => (V.lookAt(null), (I.flare = 0.8)) },
      { at: d0 + 7.6, run: () => (V.stop('raised'), (V.nervous = 0.2)) },
      // The smile is not hers.
      { at: d0 + 7.9, run: () => (V.express({ smile: 0.6, fear: 0.5, surprise: 0.2 }, 1.6), (V.stare = true)) },
      { at: d0 + 9.4, run: () => ((V.stare = false), V.lookAt(mirror, 0.9)) },
      { at: d0 + 9.8, run: () => this.sound('sheet') },
      { at: d0 + 11.0, run: () => (this.sound('bell'), V.express({ fear: 0.7, surprise: 0.5 }, 5)) },
    ];
  }

  // ---------------------------------------------------------------- camera

  private thresholdShots(): Shot[] {
    const v = this.visitor;
    const E = new THREE.Vector3();
    const W = new THREE.Vector3();
    return [
      {
        name: 'door',
        start: 0,
        blend: 1.6,
        frame: (_t, o) => {
          const p = v.position;
          o.pos.set(p.x - 4.8, p.y + 1.7, p.z + 3.2);
          o.look.set(DOOR.x, DOOR.y + 2.0, DOOR.z);
          o.fov = 40;
        },
      },
      {
        // From her side: the ribbons come out of the light toward her.
        name: 'ribbons',
        start: 1.3,
        blend: 1.4,
        frame: (_t, o) => {
          const p = v.position;
          o.pos.set(p.x + 0.8, p.y + 1.35, p.z + 4.6);
          o.look.copy(p).lerp(DOOR, 0.42).add(new THREE.Vector3(0, 1.25, 0));
          o.fov = 44;
        },
      },
      {
        name: 'grip',
        start: 2.6,
        blend: 0.8,
        frame: (_t, o) => {
          v.eyesWorld(E);
          this.bone('wristR', W);
          o.pos.copy(E).add(new THREE.Vector3(1.5, -0.3, 1.3));
          o.look.copy(E).lerp(W, 0.5);
          o.fov = 34;
        },
      },
      {
        // Ahead of her, looking back at her face as she's drawn toward us — then
        // round behind her as the doorway fills the frame.
        name: 'dragged',
        start: 4.4,
        blend: 1.8,
        frame: (_t, o) => {
          const p = v.position;
          v.eyesWorld(E);
          const dx = DOOR.x - p.x;
          const dz = DOOR.z - p.z;
          const dist = Math.hypot(dx, dz) || 1;
          const fx = dx / dist;
          const fz = dz / dist;
          const k = smoothstep(6.5, 2.6, dist);
          const ahead = Math.min(3.3, dist - 1.2);
          o.pos.set(lerp(p.x + fx * ahead - fz * 1.9, p.x - fx * 2.6 - fz * 0.9, k), p.y + lerp(1.5, 1.9, k), lerp(p.z + fz * ahead + fx * 1.9, p.z - fz * 2.6 + fx * 0.9, k));
          o.look.copy(E).lerp(this.tmp.set(DOOR.x + 0.8, DOOR.y + 1.6, DOOR.z), k);
          o.fov = 38;
        },
      },
    ];
  }

  private interiorShots(): Shot[] {
    const v = this.visitor;
    const I = this.interior;
    const E = new THREE.Vector3();
    return [
      {
        name: 'inside',
        start: 0,
        blend: 0,
        frame: (_t, o) => {
          o.pos.copy(I.toWorld(4.4, 1.5, 1.2));
          o.look.copy(v.eyesWorld(E)).add(new THREE.Vector3(0, -0.15, 0));
          o.fov = 40;
        },
      },
      {
        name: 'to-door',
        start: 1.4,
        blend: 1.4,
        frame: (_t, o) => {
          o.pos.copy(I.toWorld(3.1, 1.75, -0.9));
          o.look.copy(I.toWorld(0, 1.4, 0.2));
          o.fov = 40;
        },
      },
      {
        // High in the corner: the empty chairs, the aisle lighting itself.
        name: 'aisle-wide',
        start: 5.2,
        blend: 2.2,
        frame: (t, o) => {
          const k = smoothstep(5.2, 9, t);
          o.pos.copy(I.toWorld(lerp(0.6, 1.2, k), 3.7, 3.6));
          o.look.copy(I.toWorld(lerp(7, 10, k), 0.9, -0.6));
          o.fov = 50;
        },
      },
      {
        name: 'candle-face',
        start: 7.6,
        blend: 1.6,
        frame: (_t, o) => {
          v.eyesWorld(E);
          o.pos.copy(E).add(new THREE.Vector3(0.95, -0.02, 0.45));
          o.look.copy(E);
          o.fov = 30;
        },
      },
      {
        // Ahead of her up the aisle, backing away as she's walked toward us.
        name: 'aisle-ahead',
        start: AISLE_PULL - 0.2,
        blend: 2.0,
        frame: (_t, o) => {
          const p = v.position;
          v.eyesWorld(E);
          o.pos.set(Math.min(p.x + 3.2, I.toWorld(ROOM.archX - 0.6, 0, 0).x), p.y + 1.45, p.z + 0.45);
          o.look.copy(E).add(new THREE.Vector3(0, -0.12, 0));
          o.fov = 36;
        },
      },
      {
        name: 'aisle-side',
        start: AISLE_PULL + 4.5,
        blend: 2.6,
        frame: (_t, o) => {
          const p = v.position;
          o.pos.set(p.x + 0.5, p.y + 1.35, p.z + 2.35);
          o.look.set(p.x + 1.0, p.y + 1.15, p.z);
          o.fov = 40;
        },
      },
    ];
  }

  private dressShots(d0: number): Shot[] {
    const v = this.visitor;
    const I = this.interior;
    const E = new THREE.Vector3();
    const orbit = (a: number, r: number, y: number, o: ShotFrame) => {
      const p = v.position;
      o.pos.set(p.x + Math.cos(a) * r, p.y + y, p.z + Math.sin(a) * r);
      o.look.set(p.x, p.y + 1.1, p.z);
    };
    return [
      {
        name: 'dress-wide',
        start: d0,
        blend: 2.2,
        frame: (t, o) => {
          orbit(0.55 + (t - d0) * 0.05, 3.0, 1.45, o);
          o.fov = 40;
        },
      },
      {
        name: 'dress-orbit',
        start: d0 + 3.0,
        blend: 2.5,
        frame: (t, o) => {
          orbit(0.75 + (t - d0 - 3) * 0.17, 2.4, 1.25, o);
          o.fov = 40;
        },
      },
      {
        name: 'dress-face',
        start: d0 + 7.4,
        blend: 1.8,
        frame: (_t, o) => {
          v.eyesWorld(E);
          o.pos.copy(E).add(new THREE.Vector3(0.9, -0.03, 0.32));
          o.look.copy(E).add(new THREE.Vector3(0, -0.02, 0));
          o.fov = 28;
        },
      },
      {
        // Behind her: the gown, the veil, and the sheet coming off the mirror.
        name: 'mirror',
        start: d0 + 9.2,
        blend: 2.0,
        frame: (_t, o) => {
          const p = v.position;
          o.pos.set(p.x - 3.4, p.y + 1.85, p.z + 1.5);
          o.look.copy(I.toWorld(ROOM.mirrorX - 1.2, 1.55, 0));
          o.fov = 40;
        },
      },
    ];
  }
}
