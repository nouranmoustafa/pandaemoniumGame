import { RUN } from '../config';
import { clamp, invLerp, lerp, noise1, smoothstep } from '../core/math';
import { type JointName, Pose } from './Pose';

export interface AnimInput {
  speed: number;
  /** 0..1 — how hard she is pushing (Space taps). */
  effort: number;
  /** World Z velocity (lane change). */
  lateralVel: number;
  /** Seconds since caught, or -1. */
  stumbleTime: number;
  /** Which leg the roots/branch caught. */
  stumbleSide: 'L' | 'R';
  /** 0..1 — sliding weight. */
  slide: number;
  /** Forward slope dh/dx. */
  slope: number;
  /** Surface roll in radians. */
  roll: number;
  /** Ending: being drawn toward the house. */
  arriving: boolean;
  /** Sideways wind force, roughly -1..1 (positive pushes toward world +Z, her right). */
  windLean?: number;
  /** Headwind strength 0..1. */
  headwind?: number;
  /** Loss of footing on wet stone 0..1. */
  slip?: number;
}

const TAU = Math.PI * 2;

/**
 * Procedural animation: idle, jog → sprint locomotion (one continuous cycle
 * whose cadence and amplitude scale with real speed), stumble/recovery,
 * sliding, and additive leans. Layers are blended, then the final pose is
 * smoothed so state changes never pop.
 */
export class VisitorAnimator {
  readonly pose = new Pose();
  private target = new Pose();
  private idle = new Pose();
  private run = new Pose();
  private stumble = new Pose();
  private slidePose = new Pose();

  /** Gait phase in radians. */
  phase = 0;
  private time = 0;
  private lastPhase = 0;
  private stepCallback: ((foot: 'L' | 'R') => void) | null = null;

  onStep(cb: (foot: 'L' | 'R') => void): void {
    this.stepCallback = cb;
  }

  reset(): void {
    this.phase = 0;
    this.lastPhase = 0;
    this.pose.clear();
  }

  update(dt: number, a: AnimInput): Pose {
    this.time += dt;
    const t = this.time;

    // Gait intensity tracks actual speed, not input — animation stays in sync.
    const I = clamp(invLerp(RUN.jogSpeed * 0.6, RUN.sprintSpeed, a.speed), 0, 1);
    const moving = smoothstep(0.25, 2.2, a.speed) * (1 - a.slide);
    const cycleLength = lerp(2.2, 6.4, smoothstep(0, RUN.sprintSpeed, a.speed));
    if (a.slide < 0.95) this.phase += (a.speed / cycleLength) * TAU * dt;
    this.detectSteps(moving);

    this.buildIdle(t);
    this.buildRun(this.phase, I, t, a);
    this.target.copy(this.idle).blend(this.run, moving);

    if (a.slide > 0) {
      this.buildSlide(t, a);
      this.target.blend(this.slidePose, a.slide);
    }

    if (a.stumbleTime >= 0) {
      const w = this.stumbleWeight(a.stumbleTime);
      if (w > 0) {
        this.buildStumble(a.stumbleTime, a.stumbleSide, a.slide);
        this.target.blend(this.stumble, w);
      }
    }

    // Additive layers — leans that apply on top of every state.
    const lean = clamp(a.lateralVel * 0.055, -0.38, 0.38);
    const rr = this.target.rootRot;
    rr[2] += lean * (1 + a.slide * 0.6); // roll into the dodge
    rr[1] += -clamp(a.lateralVel * 0.045, -0.35, 0.35) * (1 - a.slide * 0.5); // look where she is going
    this.target.add('head', 0, clamp(a.lateralVel * 0.05, -0.3, 0.3), -lean * 0.6);
    this.target.add('spine', 0, 0, -lean * 0.4);
    // Arms flare out on a hard lateral change for balance.
    const flare = Math.abs(lean) * 1.4;
    this.target.add('shoulderL', 0, 0, flare);
    this.target.add('shoulderR', 0, 0, -flare);

    // Slope: lean into hills, brace on descents.
    const slopeLean = clamp(a.slope, -0.5, 0.5);
    rr[0] += -Math.atan(a.slope) * a.slide;
    this.target.add('spine', slopeLean * 0.9 * (1 - a.slide), 0, 0);
    // Tilting pavement: running, she balances against it; sliding, she rides it.
    rr[2] += lerp(a.roll * 0.45, -a.roll * 1.1, a.slide);

    // Wind: lean INTO the push, hunch forward, raise an arm against the gust.
    const wl = clamp(a.windLean ?? 0, -1.2, 1.2);
    const hw = clamp(a.headwind ?? 0, 0, 1);
    const gust = Math.min(1, Math.abs(wl) + hw);
    if (gust > 0.01) {
      rr[2] += -wl * 0.26;
      this.target.add('spine', hw * 0.28, 0, wl * 0.12);
      this.target.add('head', hw * 0.15, -wl * 0.25, 0);
      const flutter = Math.sin(t * 17) * 0.05 * gust;
      // The arm on the windward side comes up to shield her face.
      const shieldL = wl < 0 ? Math.min(1, -wl + hw * 0.6) : hw * 0.4;
      const shieldR = wl > 0 ? Math.min(1, wl + hw * 0.6) : hw * 0.4;
      this.target.blendJoint('shoulderL', -1.45 + flutter, 0.35, 0.25, shieldL * 0.8);
      this.target.blendJoint('elbowL', -1.9, 0, 0, shieldL * 0.8);
      this.target.blendJoint('shoulderR', -1.45 - flutter, -0.35, -0.25, shieldR * 0.8);
      this.target.blendJoint('elbowR', -1.9, 0, 0, shieldR * 0.8);
    }

    // Slipping on a puddle: arms fly out, hips wobble.
    const slip = clamp(a.slip ?? 0, 0, 1);
    if (slip > 0.01) {
      const wob = Math.sin(t * 13) * slip;
      rr[2] += wob * 0.09;
      rr[0] += Math.sin(t * 9 + 1) * 0.05 * slip;
      this.target.add('shoulderL', -0.3 * slip, 0, 0.9 * slip + wob * 0.2);
      this.target.add('shoulderR', -0.3 * slip, 0, -0.9 * slip + wob * 0.2);
      this.target.add('spine', -0.1 * slip, 0, -wob * 0.12);
    }

    if (a.arriving) {
      // Drawn in: arms limp, head lifts toward the house.
      this.target.add('head', -0.35, 0, 0);
    }

    // Smooth the final pose. High rate keeps the gait crisp while removing pops.
    this.pose.dampToward(this.target, a.stumbleTime >= 0 && a.stumbleTime < 0.15 ? 40 : 22, dt);
    return this.pose;
  }

  /** Fast in, held, then eased out — the recovery. */
  private stumbleWeight(st: number): number {
    const dur = RUN.stumbleDuration;
    if (st > dur) return 0;
    const inT = smoothstep(0, 0.08, st);
    const outT = 1 - smoothstep(dur * 0.4, dur, st);
    return inT * outT;
  }

  private detectSteps(moving: number): void {
    if (moving < 0.3 || !this.stepCallback) {
      this.lastPhase = this.phase;
      return;
    }
    // Foot strikes at phase π/2 (left) and 3π/2 (right).
    const prev = this.lastPhase % TAU;
    const cur = this.phase % TAU;
    const crossed = (edge: number) => (prev < edge && cur >= edge) || (prev > cur && (prev < edge || cur >= edge));
    if (crossed(Math.PI / 2)) this.stepCallback('L');
    if (crossed((3 * Math.PI) / 2)) this.stepCallback('R');
    this.lastPhase = this.phase;
  }

  private buildIdle(t: number): void {
    const p = this.idle.clear();
    const breath = Math.sin(t * 1.7);
    const sway = Math.sin(t * 0.55);
    // Nervous glance away from her phone, now and then.
    const glance = smoothstep(0.55, 0.85, noise1(t * 0.3, 2)) ;
    p.set('hips', 0, sway * 0.04, sway * 0.03);
    p.set('spine', 0.04 + breath * 0.012, -sway * 0.02, -sway * 0.02);
    p.set('chest', 0.02 + breath * 0.02, 0, 0);
    p.set('neck', 0.12 * (1 - glance), 0, 0);
    p.set('head', 0.28 * (1 - glance) - 0.1 * glance, glance * 0.9 * Math.sign(noise1(t * 0.05, 5) || 1), 0);
    // Left arm hangs, right holds the phone up.
    p.set('shoulderL', 0.05 + breath * 0.02, 0, 0.1);
    p.set('elbowL', -0.2, 0, 0);
    p.set('wristL', 0, 0, 0);
    p.set('shoulderR', -0.42 + glance * 0.2, 0.15, -0.1);
    p.set('elbowR', -1.45 + glance * 0.5, 0.25, 0);
    p.set('wristR', -0.2, 0, 0);
    // Weight on one leg.
    p.set('thighL', -0.02, 0.05, 0.03);
    p.set('kneeL', 0.05, 0, 0);
    p.set('ankleL', -0.03, 0, 0);
    p.set('thighR', 0.08, -0.12, -0.02);
    p.set('kneeR', 0.18, 0, 0);
    p.set('ankleR', -0.1, 0, 0);
    p.root[1] = -0.01 + breath * 0.004;
    p.root[0] = sway * 0.015;
  }

  private buildRun(ph: number, I: number, t: number, a: AnimInput): void {
    const p = this.run.clear();
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    const sR = Math.sin(ph + Math.PI);
    const cR = Math.cos(ph + Math.PI);
    const amp = lerp(0.52, 1.0, I);
    const fear = a.effort; // harder effort → more frantic upper body

    // Legs.
    const kneeAmp = lerp(1.0, 1.85, I);
    p.set('thighL', -s * amp - 0.12 - 0.18 * I, s * 0.05, 0.02);
    p.set('kneeL', 0.22 + kneeAmp * Math.pow(Math.max(0, c), 1.3) + 0.25 * Math.max(0, -s) * I, 0, 0);
    p.set('ankleL', 0.55 * Math.max(0, -s) * (0.4 + I) - 0.25 * Math.max(0, c), 0, 0);
    p.set('thighR', -sR * amp - 0.12 - 0.18 * I, sR * 0.05, -0.02);
    p.set('kneeR', 0.22 + kneeAmp * Math.pow(Math.max(0, cR), 1.3) + 0.25 * Math.max(0, -sR) * I, 0, 0);
    p.set('ankleR', 0.55 * Math.max(0, -sR) * (0.4 + I) - 0.25 * Math.max(0, cR), 0, 0);

    // Pelvis twist and drop, torso counter-rotation.
    p.set('hips', 0, s * 0.16 * amp, c * 0.045);
    p.set('spine', 0.1 + 0.26 * I + fear * 0.05, -s * 0.07, -c * 0.03);
    p.set('chest', 0.03 * I, -s * 0.16 * amp, 0);
    p.set('neck', -0.08 - 0.12 * I, s * 0.04, 0);
    // Glances back over her shoulder at higher effort.
    const lookBack = smoothstep(0.7, 0.95, noise1(t * 0.4, 7)) * (0.4 + fear * 0.6);
    p.set('head', -0.05 - 0.15 * I, lookBack * 1.1, 0);

    // Arms pump opposite the legs; right hand still clutches the phone.
    const armAmp = lerp(0.55, 1.15, I) * (1 + fear * 0.15);
    p.set('shoulderL', s * armAmp - 0.1, 0, 0.12 + I * 0.08);
    p.set('elbowL', -(lerp(1.15, 1.65, I) + 0.25 * Math.max(0, -s)), 0, 0);
    p.set('wristL', 0.1, 0, 0);
    p.set('shoulderR', sR * armAmp - 0.1, 0, -0.12 - I * 0.08);
    p.set('elbowR', -(lerp(1.15, 1.65, I) + 0.25 * Math.max(0, -sR)), 0, 0);
    p.set('wristR', 0.1, 0, 0);

    // Vertical bob: lowest just after each foot strike, airborne mid-swing.
    const bob = lerp(0.03, 0.085, I);
    p.root[1] = -0.04 - 0.07 * I + bob * Math.cos(2 * ph - 0.6) * -1;
    p.root[2] = 0;
    p.rootRot[0] = 0.03 * I;
  }

  private buildStumble(st: number, side: 'L' | 'R', slide: number): void {
    const p = this.stumble.clear();
    const caught = side;
    const free = side === 'L' ? 'R' : 'L';
    const flail = Math.sin(st * 22) * 0.18 * (1 - smoothstep(0, 0.6, st));
    // Pitched forward, the caught leg dragged back, arms thrown out to catch herself.
    p.set('spine', 0.72 - slide * 0.6, 0, flail * 0.3);
    p.set('chest', 0.22, 0, 0);
    p.set('neck', -0.35, 0, 0);
    p.set('head', -0.35, flail, 0);
    p.set('shoulderL', -1.55 + flail, 0, 0.55);
    p.set('elbowL', -0.35, 0, 0);
    p.set('shoulderR', -1.35 - flail, 0, -0.55);
    p.set('elbowR', -0.5, 0, 0);
    p.set(`thigh${caught}` as JointName, 0.75, 0, 0);
    p.set(`knee${caught}` as JointName, 1.25, 0, 0);
    p.set(`ankle${caught}` as JointName, 0.5, 0, 0);
    p.set(`thigh${free}` as JointName, -0.8, 0, 0);
    p.set(`knee${free}` as JointName, 0.65, 0, 0);
    p.set(`ankle${free}` as JointName, -0.2, 0, 0);
    p.set('hips', 0, side === 'L' ? 0.2 : -0.2, 0);
    p.root[1] = -0.16;
    p.rootRot[0] = 0.12;
  }

  private buildSlide(t: number, a: AnimInput): void {
    const p = this.slidePose.clear();
    const wobble = Math.sin(t * 9) * 0.04 + Math.sin(t * 3.3) * 0.05;
    const speedK = clamp(a.speed / 20, 0, 1);
    // Seated, legs out front, leaning back, arms out for balance.
    p.set('hips', 0, wobble * 0.5, 0);
    p.set('spine', -0.38 - speedK * 0.15, 0, wobble);
    p.set('chest', -0.08, 0, 0);
    p.set('neck', 0.25, 0, 0);
    p.set('head', 0.15, Math.sin(t * 1.3) * 0.15, 0);
    p.set('thighL', -1.42, 0.08, 0.1);
    p.set('kneeL', 0.32 + wobble, 0, 0);
    p.set('ankleL', -0.35, 0, 0);
    p.set('thighR', -1.38, -0.08, -0.1);
    p.set('kneeR', 0.4 - wobble, 0, 0);
    p.set('ankleR', -0.3, 0, 0);
    p.set('shoulderL', -0.35 + wobble * 2, 0, 1.05 + wobble);
    p.set('elbowL', -0.45, 0, 0);
    p.set('wristL', 0, 0, 0.3);
    p.set('shoulderR', -0.25 - wobble * 2, 0, -1.0 - wobble);
    p.set('elbowR', -0.6, 0, 0);
    p.set('wristR', 0, 0, -0.3);
    p.root[1] = -0.74;
    p.root[2] = -0.12;
  }
}
