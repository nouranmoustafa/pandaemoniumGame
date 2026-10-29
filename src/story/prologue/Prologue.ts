import * as THREE from 'three';
import { type CinematicDirector, type Shot, type ShotFrame } from '../../camera/CinematicDirector';
import { CAST, OUTFITS } from '../../characters/cast';
import type { CharacterId } from '../../characters/design';
import { GeneratedCharacter } from '../../characters/GeneratedCharacter';
import type { GestureName } from '../../characters/gestures';
import { Performer } from '../../characters/Performer';
import { ShadowTwin } from '../../characters/ShadowTwin';
import type { EventBus } from '../../core/Events';
import { clamp, damp, lerp, smoothstep } from '../../core/math';
import { APP_BEATS, DatingApp } from '../../ui/DatingApp';
import type { Visitor } from '../../visitor/Visitor';
import type { Environment } from '../../world/Environment';
import { ENTRANCE } from '../../world/ParkEntrance';

export type PrologueBeat = 'PROLOGUE_ESTABLISHING' | 'PROLOGUE_FRIENDS' | 'PROLOGUE_PHONE' | 'PROLOGUE_GOODBYE' | 'PROLOGUE_PARK_ENTRY';

export const BEATS: Array<{ id: PrologueBeat; at: number }> = [
  { id: 'PROLOGUE_ESTABLISHING', at: 0 },
  { id: 'PROLOGUE_FRIENDS', at: 7 },
  { id: 'PROLOGUE_PHONE', at: 15 },
  { id: 'PROLOGUE_GOODBYE', at: 25 },
  { id: 'PROLOGUE_PARK_ENTRY', at: 31 },
];
/** When the player takes control. */
export const HANDOFF_AT = 42.4;
/** When the app starts on her phone. */
const APP_AT = 17.0;

interface Friend {
  id: CharacterId;
  char: GeneratedCharacter;
  perf: Performer;
  home: THREE.Vector3;
  heading: number;
}

interface Cue {
  at: number;
  run: () => void;
}

const V_HOME = new THREE.Vector3(-27.85, 0, 0.35);
const HOMES: Record<Exclude<CharacterId, 'visitor'>, THREE.Vector3> = {
  odette: new THREE.Vector3(-29.7, 0, -0.55),
  juno: new THREE.Vector3(-30.15, 0, 1.15),
  wren: new THREE.Vector3(-28.95, 0, 1.95),
};
const CIRCLE = new THREE.Vector3(-29.1, 0, 0.6);

function headingTo(from: THREE.Vector3, to: THREE.Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Chapter One's prologue: four friends outside the gardens at dusk, a match
 * on a dating app, a goodbye, and a walk into the park that gets colder with
 * every step — handing the Visitor to the player without a cut.
 *
 * Everything runs off one clock. Cues fire once each, in order, from
 * update(); nothing is scheduled with timers, so pausing freezes the scene
 * and skipping simply jumps the clock and settles the end state.
 */
export class Prologue {
  readonly friends: Friend[] = [];
  readonly app = new DatingApp();
  readonly twin: ShadowTwin;
  time = 0;
  active = false;
  complete = false;
  beat: PrologueBeat | null = null;
  onBeat: (b: PrologueBeat) => void = () => {};
  onHandoff: () => void = () => {};
  private cues: Cue[] = [];
  private cueIndex = 0;
  private titleTime = 0;
  // The Visitor's cinematic motion.
  private vSpeed = 0;
  private vTargetSpeed = 0;
  private vHeading = 0;
  private walking = false;
  private chatterT = 0;
  private tmp = new THREE.Vector3();
  private eyes = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private bus: EventBus,
    private env: Environment,
    private visitor: Visitor,
    private director: CinematicDirector,
  ) {
    for (const id of ['odette', 'juno', 'wren'] as const) {
      const char = new GeneratedCharacter(CAST[id], OUTFITS[id]);
      const home = HOMES[id];
      const f: Friend = { id, char, perf: new Performer(char), home, heading: headingTo(home, CIRCLE) };
      scene.add(char.object);
      this.friends.push(f);
    }
    this.twin = new ShadowTwin(this.friend('wren').char);
    scene.add(this.twin.object);
    visitor.character.setPhoneScreen(this.app.material);
    this.director.setShots(this.shots());
    this.cues = this.buildCues().sort((a, b) => a.at - b.at);
  }

  friend(id: CharacterId): Friend {
    return this.friends.find((f) => f.id === id)!;
  }

  private eyesOf(c: GeneratedCharacter, out = new THREE.Vector3()): THREE.Vector3 {
    return c.getEyesWorld(out);
  }

  /** Everyone back on their marks: the ordinary evening, before anything. */
  reset(): void {
    this.time = 0;
    this.titleTime = 0;
    this.active = false;
    this.complete = false;
    this.beat = null;
    this.cueIndex = 0;
    this.walking = false;
    this.vSpeed = this.vTargetSpeed = 0;
    this.vHeading = headingTo(V_HOME, CIRCLE);
    this.app.reset();
    for (const f of this.friends) {
      f.perf.reset();
      f.char.object.visible = true;
      f.char.object.position.copy(f.home);
      f.char.object.rotation.set(0, f.heading, 0);
      f.perf.express({ smile: 0.25 });
    }
    this.twin.lag = 0;
    this.twin.setActive(true);
    this.visitor.place(V_HOME.x, V_HOME.z, this.vHeading, this.env.pavement);
    this.visitor.performer.reset();
    this.visitor.performer.express({ smile: 0.3 });
  }

  start(): void {
    this.reset();
    this.active = true;
    this.setBeat('PROLOGUE_ESTABLISHING');
  }

  /** Jump to the end state: she is at the handoff mark, facing the park. */
  skip(): void {
    this.cueIndex = this.cues.length;
    this.time = HANDOFF_AT;
    this.active = false;
    this.complete = true;
    this.app.reset();
    this.env.entrance.reset();
    this.env.rippleGrass(0, 0);
    for (const f of this.friends) {
      f.perf.reset();
      f.perf.express({ smile: 0.2 });
    }
    this.twin.lag = 0;
    this.visitor.performer.reset();
    this.visitor.place(ENTRANCE.handoffX, 0, Math.PI / 2, this.env.pavement);
  }

  /** The chase owns her now; the friends stay behind, out of sight. */
  release(): void {
    this.active = false;
    this.complete = true;
    this.twin.setActive(false);
  }

  private setBeat(b: PrologueBeat): void {
    if (this.beat === b) return;
    this.beat = b;
    this.bus.emit('prologue:beat', { beat: b });
    this.onBeat(b);
  }

  // ------------------------------------------------------------------ update

  /** Title screen backdrop: the four of them chatting, the camera drifting. */
  updateTitle(dt: number): ShotFrame {
    this.titleTime += dt;
    this.ambientChatter(dt, true);
    this.updateVisitor(dt);
    this.updateFriends(dt);
    const t = this.titleTime;
    const f: ShotFrame = this.titleFrame(t, { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 34 });
    return f;
  }

  titleFrame(t: number, out: ShotFrame): ShotFrame {
    out.pos.set(-37.8 + Math.sin(t * 0.07) * 1.2, 2.5 + Math.sin(t * 0.11) * 0.15, 7.8 + Math.sin(t * 0.05) * 0.6);
    out.look.set(-27.2, 1.4, -0.9);
    out.fov = 34;
    return out;
  }

  update(dt: number): ShotFrame {
    // Stage 6 pacing: every beat is kept, with less waiting between them.
    this.time += dt * (this.time < 31 ? 1.7 : 1.2);
    const t = this.time;
    for (let i = BEATS.length - 1; i >= 0; i--) {
      if (t >= BEATS[i].at) {
        this.setBeat(BEATS[i].id);
        break;
      }
    }
    while (this.cueIndex < this.cues.length && this.cues[this.cueIndex].at <= t) this.cues[this.cueIndex++].run();
    if (t >= 29.8) this.ambientChatter(dt, false);
    if (t >= APP_AT && t < APP_AT + APP_BEATS.end + 1) this.app.update(t - APP_AT);
    this.updateVisitor(dt);
    this.updateFriends(dt);
    const frame = this.director.update(t, dt);
    if (t >= HANDOFF_AT && !this.complete) {
      this.complete = true;
      this.onHandoff();
    }
    return frame;
  }

  /** Background life: small talk, glances, gestures among the friends. */
  private ambientChatter(dt: number, includeVisitor: boolean): void {
    this.chatterT -= dt;
    if (this.chatterT > 0) return;
    this.chatterT = 1.6 + Math.random() * 2.2;
    const cast: Performer[] = this.friends.map((f) => f.perf);
    if (includeVisitor) cast.push(this.visitor.performer);
    const speaker = cast[Math.floor(Math.random() * cast.length)];
    const moves: GestureName[] = ['talk', 'talk', 'story', 'tilt', 'nod'];
    const g = moves[Math.floor(Math.random() * moves.length)];
    speaker.play(g, Math.random() < 0.5 ? 1 : -1);
    const sp = this.eyesOf(speaker.character, new THREE.Vector3());
    for (const p of cast) {
      if (p === speaker) continue;
      if (p === this.friend('odette').perf && !includeVisitor && this.time > 28) continue; // she is watching the Visitor go
      p.lookAt(sp, 0.9);
    }
    speaker.lookAt(this.eyesOf(cast[(cast.indexOf(speaker) + 1) % cast.length].character, new THREE.Vector3()), 0.8);
    if (Math.random() < 0.25) cast[Math.floor(Math.random() * cast.length)].play('laugh', 1);
  }

  private updateFriends(dt: number): void {
    for (const f of this.friends) {
      f.char.object.rotation.y = f.heading;
      f.perf.update(dt, { speed: 0 });
      f.char.updateSecondary(dt, { velocity: this.tmp.set(0, 0, 0), accel: this.tmp, wind: 0.12, slide: 0 });
    }
    this.twin.update(dt);
  }

  private updateVisitor(dt: number): void {
    const v = this.visitor;
    const c = v.controller;
    // Speed toward the script's target; heading toward the path once she walks.
    this.vSpeed = damp(this.vSpeed, this.vTargetSpeed, 2.4, dt);
    let want = this.vHeading;
    if (this.walking) {
      const aim = this.tmp.set(c.x + 3.5, 0, 0);
      want = Math.atan2(aim.x - c.x, aim.z - c.z);
    }
    const diff = wrapAngle(want - this.vHeading);
    this.vHeading += clamp(diff, -2.4 * dt, 2.4 * dt);
    const x = c.x + Math.sin(this.vHeading) * this.vSpeed * dt;
    const z = c.z + Math.cos(this.vHeading) * this.vSpeed * dt;
    v.place(x, z, this.vHeading, this.env.pavement);
    v.updateCinematic(dt, this.vSpeed);
    // Keep the phone's screen turned to her eyes (or our lens) while she reads.
    const reading = this.director.current === 'phone' || this.director.current === 'phone-reply';
    const aim = v.eyesWorld(this.eyes);
    if (reading) aim.lerp(this.director.out.pos, 0.75);
    v.aimPhone(aim, v.performer.phone);
  }

  // -------------------------------------------------------------- the script

  private buildCues(): Cue[] {
    const V = this.visitor.performer;
    const O = this.friend('odette').perf;
    const J = this.friend('juno').perf;
    const W = this.friend('wren').perf;
    const vEyes = () => this.visitor.eyesWorld(new THREE.Vector3());
    const eyes = (p: Performer) => this.eyesOf(p.character, new THREE.Vector3());
    const sound = (id: 'buzz' | 'notify' | 'swing' | 'branch' | 'flicker' | 'grass' | 'send' | 'laugh') => this.bus.emit('prologue:sound', { id });
    return [
      // --- A normal evening ---
      { at: 0.3, run: () => (V.express({ smile: 0.35 }), V.lookAt(eyes(J), 0.9), O.lookAt(vEyes(), 1)) },
      { at: 0.8, run: () => (J.play('story', 1), J.express({ smile: 0.55 }), J.lookAt(vEyes(), 0.9), W.lookAt(eyes(J), 0.85)) },
      { at: 3.6, run: () => (V.play('talk', 1), V.lookAt(eyes(W), 0.9), W.play('nod', 1)) },
      { at: 5.8, run: () => (W.play('talk', -1), W.lookAt(vEyes(), 0.9), V.lookAt(eyes(W), 0.9), J.lookAt(eyes(W), 0.9)) },
      { at: 7.6, run: () => (J.play('story', 1), J.lookAt(vEyes(), 1), V.lookAt(eyes(J), 0.9)) },
      // Laughter. Odette smiles, but only just; she watches the Visitor instead.
      { at: 9.0, run: () => (V.play('laugh', 1), J.play('laugh', -1), W.play('laugh', 1), V.express({ laugh: 0.9 }, 9), J.express({ laugh: 1 }, 9), W.express({ laugh: 0.7 }, 9), O.express({ smile: 0.3 }, 3), O.lookAt(vEyes(), 1)) },
      { at: 9.05, run: () => sound('laugh') },
      { at: 9.3, run: () => (O.stare = true) },
      // Everyone stops laughing — except Juno's smile, which stays exactly where it was.
      { at: 10.4, run: () => (V.express({ smile: 0.3 }, 5), W.express({ smile: 0.15 }, 5), J.express({ laugh: 1 }, 30)) },
      { at: 11.1, run: () => (V.play('tilt', 1), V.lookAt(eyes(O), 0.9)) },
      // Odette finds the lens, and holds it a beat too long.
      { at: 11.0, run: () => (O.lookAt(this.director.out.pos.clone(), 1), (O.stare = true)) },
      { at: 12.75, run: () => O.lookAt(vEyes(), 1) },
      { at: 12.5, run: () => (J.express({}, 30), J.faceRate = 30) },
      { at: 12.6, run: () => (J.express({ smile: 0.15 }, 5), W.play('talk', 1), V.lookAt(eyes(W), 0.9)) },
      // Wren glances toward the gardens; her shadow takes a moment longer.
      // In the wide shot, under the low moon: Wren touches her hair and glances at the gardens.
      // Her long shadow does the same — a little over half a second later.
      { at: 3.9, run: () => (this.twin.lag = 0.6) },
      { at: 4.1, run: () => (W.play('hairTuck', -1), W.lookAt(new THREE.Vector3(-18, 1.7, -2), 1)) },
      { at: 5.9, run: () => W.lookAt(vEyes(), 0.9) },
      { at: 6.8, run: () => (this.twin.lag = 0) },
      // Odette looks at the Visitor's pocket — before the phone makes a sound.
      { at: 14.35, run: () => (O.stare = false, O.lookAt(this.visitor.character.getBoneWorld('hips', new THREE.Vector3()).add(new THREE.Vector3(0.1, 0.0, 0.2)), 1)) },
      // --- The phone ---
      { at: 15.0, run: () => (sound('buzz'), V.express({ surprise: 0.35, smile: 0.2 }, 8), V.lookAt(this.visitor.character.getBoneWorld('hips', new THREE.Vector3()), 0.7)) },
      { at: 15.4, run: () => V.setPhone(1) },
      { at: 15.8, run: () => (sound('buzz'), J.lookAt(vEyes(), 0.9), W.lookAt(vEyes(), 0.8), O.lookAt(vEyes(), 1)) },
      { at: 16.7, run: () => (V.lookAt(null), V.express({ concern: 0.15, smile: 0.15 }, 4)) },
      { at: APP_AT + APP_BEATS.notify, run: () => sound('notify') },
      { at: APP_AT + APP_BEATS.match, run: () => V.express({ surprise: 0.45, smile: 0.35 }, 5) },
      { at: APP_AT + APP_BEATS.message, run: () => (V.express({ smile: 0.45, surprise: 0.15 }, 4), J.play('tilt', -1)) },
      // Reaction: pleased, curious — the smile she tries not to show her friends.
      { at: 21.4, run: () => (V.phoneLift = 0.4) },
      { at: 21.6, run: () => (V.express({ smile: 0.85 }, 3.5), V.play('hairTuck', 1), V.lookAt(eyes(J), 0.55)) },
      { at: 23.0, run: () => (V.phoneLift = 1) },
      { at: 22.8, run: () => V.lookAt(eyes(O), 0.7) },
      { at: 23.3, run: () => (V.lookAt(null), (V.typing = 1)) },
      { at: APP_AT + APP_BEATS.sent, run: () => (sound('send'), (V.typing = 0)) },
      // --- Goodbye ---
      { at: 25.0, run: () => (V.setPhone(0), V.lookAt(eyes(J), 0.9), V.express({ smile: 0.6 }, 4)) },
      { at: 25.9, run: () => (V.play('thumbBack', -1), V.lookAt(eyes(O), 0.9)) },
      { at: 26.3, run: () => (O.play('nod', 1), O.express({ smile: 0.25 }, 3), W.lookAt(new THREE.Vector3(-46, 1.4, 6), 0.8)) },
      { at: 26.5, run: () => (J.play('waveStop', -1), J.express({ smile: 0.6 }, 5)) },
      { at: 27.0, run: () => (V.play('wave', 1), (this.walking = true)) },
      { at: 27.4, run: () => (this.vTargetSpeed = 1.35, V.lookAt(null), V.express({ smile: 0.35 }, 2)) },
      { at: 28.4, run: () => (O.lookAt(vEyes(), 1), (O.stare = true)) },
      { at: 29.0, run: () => (this.vTargetSpeed = 1.5) },
      // --- Into the park ---
      { at: 31.5, run: () => V.express({ smile: 0.15 }, 1) },
      { at: 33.0, run: () => (this.vTargetSpeed = 1.65, (V.nervous = 0.15)) },
      { at: 34.4, run: () => (this.env.lamps.stutter(-10, 1.3), sound('flicker')) },
      { at: 34.6, run: () => (V.lookAt(new THREE.Vector3(-9.8, 4.6, -4.6), 0.8), V.express({ concern: 0.3 }, 2)) },
      { at: 35.6, run: () => V.lookAt(null) },
      { at: 36.0, run: () => (this.env.entrance.pushSwing(1.3), sound('swing'), (V.nervous = 0.3)) },
      { at: 36.3, run: () => V.lookAt(new THREE.Vector3(-6.5, 1.0, -13), 0.85) },
      { at: 37.8, run: () => (V.lookAt(null), V.express({ concern: 0.55 }, 2), (this.vTargetSpeed = 1.75)) },
      { at: 38.8, run: () => (this.env.entrance.twitchBranch(), sound('branch')) },
      { at: 39.0, run: () => (V.lookAt(new THREE.Vector3(-2.5, 2.7, -6.6), 0.9), (V.nervous = 0.5)) },
      { at: 39.9, run: () => (V.lookAt(null), (this.vTargetSpeed = 1.2)) },
      // The grass moves against the wind. She stops.
      { at: 40.0, run: () => sound('grass') },
      { at: 40.6, run: () => (this.vTargetSpeed = 0, V.play('hesitate', 1), V.express({ fear: 0.35, concern: 0.55 }, 6)) },
      { at: 41.2, run: () => V.lookAt(new THREE.Vector3(ENTRANCE.gateX, 1.6, 0), 1) },
      { at: 42.0, run: () => (V.lookAt(null), V.express({ concern: 0.5, determined: 0.25 }, 4), (V.nervous = 0)) },
    ];
  }

  /** Called each frame by the chapter: the grass ripple travels toward her. */
  grassRipple(): { x: number; amp: number } {
    const t = this.time - 40.0;
    if (t < 0 || t > 2.2 || !this.active) return { x: 0, amp: 0 };
    const vx = this.visitor.controller.x;
    return { x: lerp(vx + 22, vx + 1, smoothstep(0, 1.6, t)), amp: Math.sin(Math.min(1, t / 2.2) * Math.PI) * 1.4 };
  }

  // ----------------------------------------------------------------- camera

  private shots(): Shot[] {
    const v = this.visitor;
    const vEyes = (out: THREE.Vector3) => v.eyesWorld(out);
    const vPos = () => v.position;
    const f = (o: number, eh = 0) => {
      const h = v.heading;
      return new THREE.Vector3(Math.sin(h) * o, eh, Math.cos(h) * o);
    };
    const left = (o: number) => {
      const h = v.heading;
      return new THREE.Vector3(Math.cos(h) * o, 0, -Math.sin(h) * o);
    };
    const E = new THREE.Vector3();
    const ease = (t: number, a: number, b: number) => smoothstep(a, b, t);
    const odette = this.friend('odette').char;
    const juno = this.friend('juno').char;
    const wren = this.friend('wren').char;
    const C = new THREE.Vector3();
    const A = new THREE.Vector3();
    const B = new THREE.Vector3();
    return [
      {
        name: 'establishing',
        start: 0,
        blend: 2.2,
        frame: (t, o) => {
          const k = ease(t, 0, 7.5);
          o.pos.set(lerp(-45, -36.2, k), lerp(8.6, 3.3, k), lerp(14.5, 7.0, k));
          o.look.set(lerp(-26.5, -28.4, k), lerp(1.9, 1.3, k), lerp(-1.2, 0.4, k));
          o.fov = lerp(40, 35, k);
        },
      },
      {
        // Over the friends' shoulders, onto her.
        name: 'friends',
        start: 6.6,
        blend: 2.4,
        frame: (t, o) => {
          const k = ease(t, 6.6, 10.5);
          vEyes(E);
          o.pos.set(lerp(-31.9, -31.2, k), 1.78, lerp(0.15, 0.3, k));
          o.look.copy(E).add(new THREE.Vector3(0, -0.06, 0));
          o.fov = lerp(30, 27, k);
        },
      },
      {
        // The reverse: over her right shoulder, onto the three of them.
        name: 'friends-reverse',
        start: 10.2,
        blend: 1.8,
        frame: (t, o) => {
          vEyes(E);
          o.pos.copy(E).add(f(-1.45)).add(left(-0.85)).add(new THREE.Vector3(0, 0.14 + (t - 10.2) * 0.01, 0));
          odette.getEyesWorld(A);
          juno.getEyesWorld(B);
          wren.getEyesWorld(C);
          o.look.addVectors(A, B).add(C).multiplyScalar(1 / 3).add(new THREE.Vector3(0, -0.35, 0));
          o.fov = 38;
        },
      },
      {
        // The buzz: we move in on her.
        name: 'phone-push',
        start: 14.7,
        blend: 1.6,
        frame: (t, o) => {
          const k = ease(t, 14.7, 16.6);
          vEyes(E);
          o.pos.copy(E).add(f(lerp(1.9, 1.35, k))).add(left(0.35)).add(new THREE.Vector3(0, -0.02, 0));
          o.look.copy(E).add(new THREE.Vector3(0, lerp(-0.12, -0.3, k), 0));
          o.fov = 30;
        },
      },
      {
        // Over her shoulder onto the screen.
        name: 'phone',
        start: 16.6,
        blend: 1.4,
        frame: (_t, o) => {
          vEyes(E);
          v.phoneScreenWorld(A);
          o.pos.copy(E).add(f(-0.3)).add(left(-0.4)).add(new THREE.Vector3(0, 0.12, 0));
          o.look.copy(A);
          o.fov = 27;
        },
      },
      {
        // Round her right side (never through her) on the way to her face.
        name: 'phone-side',
        start: 21.0,
        blend: 0.7,
        frame: (_t, o) => {
          vEyes(E);
          o.pos.copy(E).add(left(-0.85)).add(f(0.35)).add(new THREE.Vector3(0, -0.07, 0));
          o.look.copy(E).add(new THREE.Vector3(0, -0.04, 0));
          o.fov = 28;
        },
      },
      {
        // Her face as she reads it.
        name: 'reaction',
        start: 21.6,
        blend: 0.9,
        frame: (t, o) => {
          vEyes(E);
          o.pos.copy(E).add(f(0.85)).add(left(0.42)).add(new THREE.Vector3(0, -0.08, 0));
          o.look.copy(E).add(new THREE.Vector3(0, -0.04 - (t - 21.5) * 0.004, 0));
          o.fov = 26;
        },
      },
      {
        name: 'reply-side',
        start: 23.1,
        blend: 0.6,
        frame: (_t, o) => {
          vEyes(E);
          o.pos.copy(E).add(left(-0.8)).add(f(0.1)).add(new THREE.Vector3(0, 0.02, 0));
          o.look.copy(E).add(new THREE.Vector3(0, -0.15, 0));
          o.fov = 28;
        },
      },
      {
        name: 'phone-reply',
        start: 23.6,
        blend: 0.8,
        frame: (_t, o) => {
          vEyes(E);
          v.phoneScreenWorld(A);
          o.pos.copy(E).add(f(-0.3)).add(left(-0.4)).add(new THREE.Vector3(0, 0.12, 0));
          o.look.copy(A);
          o.fov = 27;
        },
      },
      {
        // From the gate side: her friends' faces as she tells them she's going.
        name: 'goodbye',
        start: 24.9,
        blend: 1.7,
        frame: (t, o) => {
          const k = ease(t, 24.9, 27.6);
          o.pos.set(lerp(-24.0, -24.6, k), 1.65, lerp(3.4, 3.9, k));
          o.look.set(-29.2, 1.25, 0.4);
          o.fov = 33;
        },
      },
      {
        // From inside the gates, looking back: she walks toward us; they grow small behind her.
        name: 'leaving',
        start: 27.6,
        blend: 2.3,
        frame: (t, o) => {
          const k = ease(t, 27.6, 31.4);
          vEyes(E);
          o.pos.set(lerp(-17.6, -15.8, k), 1.55, -1.3);
          o.look.copy(E).multiplyScalar(0.75).addScaledVector(CIRCLE, 0.25).setY(1.35);
          o.fov = 34;
        },
      },
      {
        // She passes us; we swing round to her side.
        name: 'follow-side',
        start: 31.0,
        blend: 2.6,
        frame: (_t, o) => {
          const p = vPos();
          o.pos.set(p.x + 1.6, p.y + 1.6, p.z - 3.4);
          o.look.set(p.x + 0.6, p.y + 1.3, p.z);
          o.fov = 36;
        },
      },
      {
        name: 'follow-behind',
        start: 34.4,
        blend: 3.2,
        frame: (_t, o) => {
          const p = vPos();
          o.pos.set(p.x - 3.4, p.y + 1.9, p.z - 1.2);
          o.look.set(p.x + 4.0, p.y + 1.25, p.z + 0.2);
          o.fov = 38;
        },
      },
      {
        // Settling toward the chase framing, so the handoff is only the last few metres.
        name: 'settle',
        start: 39.6,
        blend: 2.7,
        frame: (_t, o) => {
          const p = vPos();
          o.pos.set(p.x - 5.4, p.y + 3.1, p.z + 4.6);
          o.look.set(p.x + 6.6, p.y + 1.0, p.z - 0.6);
          o.fov = 42;
        },
      },
    ];
  }
}
