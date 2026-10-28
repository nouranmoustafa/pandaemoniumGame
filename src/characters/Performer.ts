import * as THREE from 'three';
import { clamp, damp, smoothstep } from '../core/math';
import { type AnimInput, type IdleStyle, VisitorAnimator } from '../visitor/VisitorAnimator';
import { Pose } from '../visitor/Pose';
import { type ExpressionMix, type FaceState, NEUTRAL, dampFace, mixExpression } from './Expression';
import type { GeneratedCharacter } from './GeneratedCharacter';
import { GESTURES, type GestureName, phoneHold, pocketReach } from './gestures';

interface ActiveGesture {
  name: GestureName;
  t: number;
  side: 1 | -1;
  weight: number;
  /** Seconds to hold beyond the gesture's own duration (or shorten if negative). */
  extend: number;
}

/**
 * Drives one character's performance on top of locomotion: authored
 * gestures, a look-at with the eyes leading the head, expressions with
 * smoothing, blinks, and the phone. The same Performer drives the Visitor
 * in cinematics and in the chase, and each of the three friends.
 */
export class Performer {
  readonly animator = new VisitorAnimator();
  readonly pose = new Pose();
  private layered = new Pose();
  private primed = false;
  private fidgetT = 1 + Math.random() * 2;
  private saccade = new THREE.Vector2();
  /** Small unprompted life: glances and tilts whenever nothing is scripted. */
  autoFidget = true;
  private gestures: ActiveGesture[] = [];
  private faceState: FaceState = { ...NEUTRAL };
  private faceTarget: FaceState = { ...NEUTRAL };
  private mix: ExpressionMix = {};
  /** How fast the face moves toward its target. */
  faceRate = 4.5;
  private lookTarget: THREE.Vector3 | null = null;
  private lookWeight = 0;
  private headYaw = 0;
  private headPitch = 0;
  private eyeYaw = 0;
  private eyePitch = 0;
  private blinkT = -1;
  private nextBlink = 2 + Math.random() * 3;
  /** Suppress blinking (a stare that lasts too long). */
  stare = false;
  phone = 0;
  private phoneTarget = 0;
  private pocket = 0;
  private pocketTarget = 0;
  typing = 0;
  /** 1 = phone held up to read; lower values let it sink toward the chest (so it doesn't hide her face). */
  phoneLift = 1;
  private lift = 1;
  idleStyle: IdleStyle;
  nervous = 0;
  time = Math.random() * 20;
  private tmp = new THREE.Vector3();
  private headWorld = new THREE.Vector3();

  constructor(readonly character: GeneratedCharacter) {
    this.idleStyle = character.design.idle;
  }

  /** Called whenever a gesture starts (a GLB body plays its own clip for it). */
  onGesture: (name: GestureName) => void = () => {};
  /** This frame's face and blink, after smoothing. */
  blink = 0;
  get face(): Readonly<FaceState> {
    return this.faceState;
  }

  play(name: GestureName, side: 1 | -1 = 1, extend = 0): void {
    this.onGesture(name);
    this.gestures = this.gestures.filter((g) => g.name !== name);
    this.gestures.push({ name, t: 0, side, weight: 0, extend });
  }

  /** Release a held gesture early (fades out). */
  stop(name: GestureName): void {
    for (const g of this.gestures) if (g.name === name) g.extend = Math.min(g.extend, g.t - GESTURES[name].duration);
  }

  isPlaying(name: GestureName): boolean {
    return this.gestures.some((g) => g.name === name);
  }

  express(mix: ExpressionMix, rate = 4.5): void {
    this.mix = mix;
    this.faceRate = rate;
  }

  /** Look at a world point (null releases to straight ahead). weight 0..1. */
  lookAt(target: THREE.Vector3 | null, weight = 1): void {
    if (target) {
      this.lookTarget = (this.lookTarget ?? new THREE.Vector3()).copy(target);
    } else this.lookTarget = null;
    this.lookWeight = weight;
  }

  /** Phone: 0 = in the pocket, 1 = held up and read. */
  setPhone(v: 0 | 1): void {
    if (v === this.phoneTarget) return;
    this.phoneTarget = v;
    this.pocketTarget = 1;
  }

  reset(): void {
    this.gestures = [];
    this.mix = {};
    Object.assign(this.faceState, NEUTRAL);
    this.lookTarget = null;
    this.phone = this.phoneTarget = 0;
    this.pocket = this.pocketTarget = 0;
    this.typing = 0;
    this.phoneLift = this.lift = 1;
    this.stare = false;
    this.nervous = 0;
    this.headYaw = this.headPitch = this.eyeYaw = this.eyePitch = 0;
    this.primed = false;
    this.character.phone.visible = false;
    this.animator.reset();
  }

  /**
   * Build this frame's pose from locomotion input, layer the performance,
   * and push everything to the character.
   */
  update(dt: number, input: Partial<AnimInput> & { speed: number }): Pose {
    this.time += dt;
    const base = this.animator.update(dt, {
      effort: 0,
      lateralVel: 0,
      stumbleTime: -1,
      stumbleSide: 'L',
      slide: 0,
      slope: 0,
      roll: 0,
      arriving: false,
      idleStyle: this.idleStyle,
      nervous: this.nervous,
      ...input,
    });
    const p = this.layered.copy(base);
    this.fidget(dt);
    this.layer(dt, p);
    // A final, softer follow: gestures gain weight and follow-through, and nothing starts or
    // stops on a single frame. (The chase skips this — there, responsiveness comes first.)
    if (!this.primed) {
      this.pose.copy(p);
      this.primed = true;
    } else this.pose.dampToward(p, 11, dt);
    this.character.applyPose(this.pose);
    this.updateFace(dt);
    return this.pose;
  }

  /** Apply gestures, phone and gaze on top of an already-built pose (used by the chase too). */
  layer(dt: number, p: Pose): void {
    // --- Gestures ---
    for (const g of this.gestures) {
      const def = GESTURES[g.name];
      g.t += dt;
      const [ein, eout] = def.ease ?? [0.3, 0.4];
      const end = def.duration + g.extend;
      const w = smoothstep(0, ein, g.t) * (1 - smoothstep(end - eout, end, g.t));
      g.weight = w;
      // Gestures that end on a hold keep their final pose for the extension.
      def.apply(p, Math.min(g.t, def.duration), w, g.side);
    }
    this.gestures = this.gestures.filter((g) => g.t < GESTURES[g.name].duration + g.extend);

    // --- Phone: out of the pocket, up to read, and back ---
    if (this.pocketTarget > 0) {
      this.pocket = Math.min(1, this.pocket + dt * 2.4);
      if (this.pocket >= 1) {
        this.character.phone.visible = this.phoneTarget === 1;
        this.pocketTarget = 0;
      }
    } else this.pocket = Math.max(0, this.pocket - dt * 2.2);
    const reaching = Math.sin(this.pocket * Math.PI * 0.5);
    // Taking it out: only once the hand has been to the pocket. Putting it away: lower first.
    const goal = this.phoneTarget === 1 && this.pocketTarget === 0 ? 1 : 0;
    this.phone = damp(this.phone, goal, 4, dt);
    pocketReach(p, reaching * (1 - this.phone));
    this.lift = damp(this.lift, this.phoneLift, 3, dt);
    phoneHold(p, this.phone * this.lift, this.time, this.typing);

    // --- Gaze: eyes lead, head follows, chest helps on big turns ---
    let wantYaw = 0;
    let wantPitch = 0;
    if (this.lookTarget && this.lookWeight > 0) {
      const head = this.character.rig.bone('head');
      head.getWorldPosition(this.headWorld);
      const local = this.character.object.worldToLocal(this.tmp.copy(this.lookTarget));
      const hl = this.character.object.worldToLocal(this.headWorld.clone());
      local.sub(hl);
      wantYaw = Math.atan2(local.x, local.z) * this.lookWeight;
      wantPitch = Math.atan2(local.y, Math.hypot(local.x, local.z)) * this.lookWeight;
    }
    wantYaw = clamp(wantYaw, -1.9, 1.9);
    wantPitch = clamp(wantPitch, -0.6, 0.5);
    this.eyeYaw = damp(this.eyeYaw, wantYaw, 22, dt);
    this.eyePitch = damp(this.eyePitch, wantPitch, 22, dt);
    this.headYaw = damp(this.headYaw, wantYaw, 4.5, dt);
    this.headPitch = damp(this.headPitch, wantPitch, 4.5, dt);
    const hy = this.headYaw;
    const chestShare = smoothstep(0.6, 1.6, Math.abs(hy)) * 0.35;
    p.add('chest', 0, hy * chestShare, 0);
    p.add('neck', -this.headPitch * 0.3, hy * 0.35, 0);
    p.add('head', -this.headPitch * 0.55, hy * (0.65 - chestShare), 0);
    this.character.setGaze(this.eyeYaw - this.headYaw * 0.92 + this.saccade.x, this.eyePitch - this.headPitch * 0.85 + this.saccade.y);
  }

  /** Between scripted beats: tiny eye saccades and the occasional tilt or nod. */
  private fidget(dt: number): void {
    if (!this.autoFidget) return;
    this.fidgetT -= dt;
    if (this.fidgetT > 0) return;
    this.fidgetT = 1.2 + Math.random() * 2.4;
    this.saccade.set((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.06);
    if (this.gestures.length === 0 && this.phone < 0.1 && Math.random() < 0.35) this.play(Math.random() < 0.6 ? 'tilt' : 'nod', Math.random() < 0.5 ? 1 : -1);
  }

  updateFace(dt: number): void {
    mixExpression(this.mix, this.faceTarget);
    dampFace(this.faceState, this.faceTarget, this.faceRate, dt);
    // Blinks: every few seconds, sometimes doubled; never during a stare.
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      blink = Math.sin(Math.min(1, this.blinkT / 0.16) * Math.PI);
      if (this.blinkT > 0.16) this.blinkT = -1;
    } else if (!this.stare) {
      this.nextBlink -= dt;
      if (this.nextBlink <= 0) {
        this.blinkT = 0;
        this.nextBlink = Math.random() < 0.2 ? 0.25 : 2 + Math.random() * 3.5;
      }
    }
    this.blink = blink;
    this.character.updateFace(dt, this.faceState, blink);
  }
}
