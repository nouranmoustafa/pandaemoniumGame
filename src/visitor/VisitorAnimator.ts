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
  /** How she stands still: the Stage 2 phone pose, or a character idle. */
  idleStyle?: IdleStyle;
  /** 0..1 — hunched, quick, glancing walk. */
  nervous?: number;
}

export type IdleStyle = 'phone' | 'open' | 'composed' | 'animated' | 'reserved';

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
  private walk = new Pose();
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
    const moving = smoothstep(0.08, 0.6, a.speed) * (1 - a.slide);
    // Below a jog she walks; both gaits share one phase so the change is seamless.
    const runW = smoothstep(2.3, 3.8, a.speed);
    const runCycle = lerp(2.2, 7.4, smoothstep(0, RUN.sprintSpeed, a.speed));
    const cycleLength = lerp(this.walkCycleLength(a.speed), runCycle, runW);
    if (a.slide < 0.95) this.phase += (a.speed / cycleLength) * TAU * dt;
    this.detectSteps(moving);

    this.buildIdle(t, a.idleStyle ?? 'phone');
    this.buildRun(this.phase, I, t, a);
    if (runW < 1) {
      this.buildWalk(this.phase, a.speed, a.nervous ?? 0, t);
      this.run.blend(this.walk, 1 - runW);
    }
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

  private walkAmp(speed: number): number {
    return clamp(0.2 + speed * 0.13, 0.22, 0.5);
  }

  /** Metres per full gait cycle when walking, matched to the leg swing so feet plant. */
  private walkCycleLength(speed: number): number {
    // Stance sweeps the foot 2·L·sin(A) in 62% of the cycle (L ≈ 0.89 m at world scale).
    return (2 * 0.89 * Math.sin(this.walkAmp(speed))) / 0.62;
  }

  /**
   * Walking: a linear stance sweep (so the planted foot keeps pace with the
   * ground), a knee-lifted swing, heel-toe roll, pelvis turn and drop, and
   * counter-swinging arms. "Nervous" hunches, tightens and quickens it.
   */
  private buildWalk(ph: number, speed: number, nervous: number, t: number): void {
    const p = this.walk.clear();
    const A = this.walkAmp(speed);
    const stanceFrac = 0.62;
    const leg = (phase: number) => {
      const u = (((phase % TAU) + TAU) % TAU) / TAU;
      if (u < stanceFrac) {
        const s = u / stanceFrac;
        // Forward (−A) at heel strike, back (+A) at toe-off.
        const thigh = lerp(-A, A, s);
        const knee = 0.06 + (s < 0.35 ? 0.16 * Math.sin((s / 0.35) * Math.PI) : 0) + 0.35 * smoothstep(0.75, 1, s);
        const toeOff = smoothstep(0.7, 1, s) * 0.35;
        const heel = (1 - smoothstep(0, 0.15, s)) * -0.15;
        return { thigh, knee, ankle: -(thigh + knee) + toeOff + heel, stance: 1 - Math.abs(s - 0.5) * 2 };
      }
      const s = (u - stanceFrac) / (1 - stanceFrac);
      const thigh = lerp(A, -A * 1.05, 0.5 - 0.5 * Math.cos(s * Math.PI));
      const knee = 0.3 + (0.62 + nervous * 0.12) * Math.sin(Math.min(1, s * 1.25) * Math.PI);
      return { thigh, knee, ankle: -(thigh + knee) * 0.55 - 0.05, stance: 0 };
    };
    const L = leg(ph);
    const R = leg(ph + Math.PI);
    p.set('thighL', L.thigh, 0, 0.02);
    p.set('kneeL', L.knee, 0, 0);
    p.set('ankleL', L.ankle, 0, 0);
    p.set('thighR', R.thigh, 0, -0.02);
    p.set('kneeR', R.knee, 0, 0);
    p.set('ankleR', R.ankle, 0, 0);
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    // Pelvis turns with the forward leg and drops on the swing side.
    p.set('hips', 0, -s * 0.09, c * 0.035);
    p.set('spine', 0.03 + nervous * 0.12, s * 0.04, -c * 0.02);
    p.set('chest', nervous * 0.08, s * 0.07, 0);
    p.set('neck', -0.02 + nervous * 0.05, 0, 0);
    const glance = nervous * smoothstep(0.55, 0.9, noise1(t * 0.35, 11));
    p.set('head', -0.02 - nervous * 0.08, glance * 0.7 * Math.sign(noise1(t * 0.07, 3) || 1), 0);
    // Arms counter-swing; nervous arms stay close, hands curled.
    const armAmp = lerp(0.42, 0.18, nervous) * (A / 0.4);
    p.set('shoulderL', s * armAmp + 0.02, 0, lerp(0.08, 0.04, nervous));
    p.set('elbowL', -0.22 - Math.max(0, -s) * 0.25 - nervous * 0.5, 0, 0);
    p.set('shoulderR', -s * armAmp + 0.02, 0, -lerp(0.08, 0.04, nervous));
    p.set('elbowR', -0.22 - Math.max(0, s) * 0.25 - nervous * 0.5, 0, 0);
    p.setHand('L', 0.35 + nervous * 0.4);
    p.setHand('R', 0.35 + nervous * 0.4);
    // The body vaults over the stance leg.
    const stanceThigh = L.stance > R.stance ? L.thigh : R.thigh;
    p.root[1] = -0.78 * (1 - Math.cos(stanceThigh)) - 0.012 - nervous * 0.02;
  }

  /** Standing idles: breathing, weight shifts and each woman's own bearing. */
  private buildCharacterIdle(t: number, style: IdleStyle): void {
    const p = this.idle.clear();
    const breath = Math.sin(t * 1.6);
    const shift = smoothstep(-0.4, 0.4, noise1(t * 0.12, style.length)) * 2 - 1; // which hip carries her weight
    const settle = style === 'animated' ? 1.6 : style === 'composed' ? 0.5 : 1;
    p.set('hips', 0, shift * 0.05 * settle, shift * 0.045 * settle);
    p.set('spine', 0.02 + breath * 0.01, -shift * 0.02, -shift * 0.04 * settle);
    p.set('chest', 0.015 + breath * 0.018, 0, -shift * 0.015);
    p.set('neck', 0.04, 0, 0);
    p.set('head', 0.04, 0, shift * 0.03);
    // Standing leg straight, the other relaxed with its knee forward.
    const w = 0.5 + shift * 0.5; // 1 = weight on the left
    p.set('thighL', -0.02 - (1 - w) * 0.1, 0.04, 0.02 - shift * 0.03);
    p.set('kneeL', 0.03 + (1 - w) * 0.22, 0, 0);
    p.set('ankleL', -0.01 - (1 - w) * 0.12, 0, 0);
    p.set('thighR', -0.02 - w * 0.1, -0.04, -0.02 - shift * 0.03);
    p.set('kneeR', 0.03 + w * 0.22, 0, 0);
    p.set('ankleR', -0.01 - w * 0.12, 0, 0);
    p.root[0] = shift * 0.03 * settle;
    p.root[1] = -0.01 - 0.01 * Math.abs(shift) + breath * 0.003;
    p.set('shoulderL', 0.04 + breath * 0.01, 0, 0.09);
    p.set('elbowL', -0.18, 0, 0);
    p.set('shoulderR', 0.04 + breath * 0.01, 0, -0.09);
    p.set('elbowR', -0.18, 0, 0);
    switch (style) {
      case 'composed':
        // Tall and still, hands loosely clasped in front.
        p.add('spine', -0.03, 0, 0);
        p.set('shoulderL', -0.22, 0.1, -0.12).set('elbowL', -0.75, 0.6, 0).set('wristL', 0, 0.3, 0);
        p.set('shoulderR', -0.2, -0.1, 0.12).set('elbowR', -0.8, -0.6, 0).set('wristR', 0, -0.3, 0);
        p.setHand('L', 0.45, 0.05, 0.4).setHand('R', 0.55, 0.05, 0.5);
        break;
      case 'animated':
        // A hand on her hip; the other is free to talk with.
        p.set('shoulderL', -0.1, 0.2, 0.55).set('elbowL', -1.5, 0.7, 0).set('wristL', 0.2, 0, 0.3);
        p.setHand('L', 0.6, 0.05, 0.3);
        break;
      case 'reserved':
        // Arms close, one hand holding the opposite elbow.
        p.add('neck', 0.08, 0, 0).add('head', 0.06, 0, 0);
        p.set('shoulderR', -0.35, -0.25, 0.18).set('elbowR', -1.75, -0.4, 0);
        p.set('shoulderL', -0.05, 0, 0.05).set('elbowL', -0.6, 0.3, 0);
        p.setHand('R', 0.6).setHand('L', 0.4);
        break;
      default:
        p.setHand('L', 0.3).setHand('R', 0.3);
    }
  }

  private buildIdle(t: number, style: IdleStyle): void {
    if (style !== 'phone') return this.buildCharacterIdle(t, style);
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
