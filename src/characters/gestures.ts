import { clamp, noise1, smoothstep } from '../core/math';
import type { Pose } from '../visitor/Pose';

/**
 * Authored gestures, layered over idle or walk by the Performer. Each is a
 * function of local time with anticipation, a held beat and follow-through,
 * blended in by weight w. Gestures write targets (blendJoint) or add
 * offsets; the Performer smooths the result, so nothing pops.
 */
export interface GestureDef {
  duration: number;
  /** Fade in / out seconds. */
  ease?: [number, number];
  apply(p: Pose, t: number, w: number, side: 1 | -1): void;
}

/** Side helpers: 1 = her left, -1 = her right. */
const S = (side: 1 | -1) => (side === 1 ? 'L' : 'R');

export const GESTURES = {
  /** Conversational hand beats: forearm up, open palm, small emphatic beats. */
  talk: {
    duration: 2.6,
    ease: [0.5, 0.7],
    apply(p, t, w, side) {
      const s = S(side);
      const beat = Math.sin(t * 4.2) * 0.08 * smoothstep(0.3, 0.7, t) + noise1(t * 1.4, 3) * 0.08;
      p.blendJoint(`shoulder${s}`, -0.45 + beat * 0.3, side * 0.25, side * 0.18, w);
      p.blendJoint(`elbow${s}`, -1.45 - beat, side * 0.5, 0, w);
      p.blendJoint(`wrist${s}`, 0.15 + beat * 0.6, side * -0.7, side * 0.2, w);
      p.blendHand(s, 0.2, 0.4, 0.1, 0, w);
      p.add('head', beat * 0.15 * w, 0, side * 0.05 * w);
    },
  },
  /** Both hands, a little bigger — Juno telling a story. */
  story: {
    duration: 3.2,
    ease: [0.55, 0.75],
    apply(p, t, w) {
      for (const side of [1, -1] as const) {
        const s = S(side);
        const beat = Math.sin(t * 3.6 + (side > 0 ? 0 : 1.3)) * 0.1 + noise1(t * 1.2, side + 4) * 0.12;
        p.blendJoint(`shoulder${s}`, -0.55 + beat * 0.4, side * 0.3, side * 0.25, w);
        p.blendJoint(`elbow${s}`, -1.35 - beat, side * 0.45, 0, w);
        p.blendJoint(`wrist${s}`, 0.1, side * -0.8, side * 0.3, w);
        p.blendHand(s, 0.15, 0.55, 0.05, 0, w);
      }
      p.add('spine', Math.sin(t * 3) * 0.03 * w, 0, 0);
      p.add('head', Math.sin(t * 5) * 0.05 * w, Math.sin(t * 1.4) * 0.12 * w, 0);
    },
  },
  /** Laughter: a breath in, shoulders bouncing, head back, then settling. */
  laugh: {
    duration: 2.2,
    ease: [0.12, 0.6],
    apply(p, t, w, side) {
      const bounce = Math.abs(Math.sin(t * 9)) * (1 - smoothstep(0.5, 2.0, t)) * 0.8;
      p.add('spine', (-0.06 + bounce * 0.05) * w, 0, 0);
      p.add('chest', (-0.04 + bounce * 0.06) * w, 0, 0);
      p.add('neck', -0.1 * w, 0, 0);
      p.add('head', (-0.18 + bounce * 0.1) * w, 0, side * 0.08 * w);
      p.root[1] += bounce * 0.008 * w;
      // One hand comes up toward the chest.
      const s = S(side);
      p.blendJoint(`shoulder${s}`, -0.55, -side * 0.2, -side * 0.12, w * 0.8);
      p.blendJoint(`elbow${s}`, -1.9, 0, 0, w * 0.8);
      p.blendHand(s, 0.35, 0.3, 0.2, 0, w);
    },
  },
  nod: {
    duration: 0.9,
    ease: [0.1, 0.25],
    apply(p, t, w) {
      p.add('head', Math.sin(t * 9) * 0.12 * w * (1 - t / 0.9), 0, 0);
    },
  },
  /** A head tilt that lingers. */
  tilt: {
    duration: 2.4,
    ease: [0.5, 0.6],
    apply(p, _t, w, side) {
      p.add('head', 0.04 * w, side * 0.1 * w, side * 0.16 * w);
      p.add('neck', 0, 0, side * 0.05 * w);
    },
  },
  /** A wave goodbye: arm rises, hand swings from the wrist. */
  wave: {
    duration: 2.6,
    ease: [0.35, 0.45],
    apply(p, t, w, side) {
      const s = S(side);
      const swing = Math.sin(t * 9) * smoothstep(0.25, 0.5, t);
      p.blendJoint(`shoulder${s}`, -1.25, side * 0.15, side * 0.45, w);
      p.blendJoint(`elbow${s}`, -1.55, 0, 0, w);
      p.blendJoint(`wrist${s}`, 0, side * -1.2, side * swing * 0.45, w);
      p.blendHand(s, 0.05, 0.45, 0, 0, w);
    },
  },
  /**
   * The wave that stops. Identical to the wave, until it isn't: the hand
   * freezes mid-swing and holds, a little too long, before dropping.
   */
  waveStop: {
    duration: 3.1,
    ease: [0.35, 0.18],
    apply(p, t, w, side) {
      const s = S(side);
      const live = t < 1.3;
      const swing = live ? Math.sin(t * 9) * smoothstep(0.25, 0.5, t) : Math.sin(1.3 * 9);
      p.blendJoint(`shoulder${s}`, -1.25, side * 0.15, side * 0.45, w);
      p.blendJoint(`elbow${s}`, -1.55, 0, 0, w);
      p.blendJoint(`wrist${s}`, 0, side * -1.2, side * swing * 0.45, w);
      p.blendHand(s, 0.05, 0.45, 0, 0, w);
    },
  },
  /** "I'll go" — a thumb over the shoulder toward the park, a small shrug. */
  thumbBack: {
    duration: 1.9,
    ease: [0.25, 0.45],
    apply(p, t, w, side) {
      const s = S(side);
      const jab = Math.sin(clamp((t - 0.35) / 0.4, 0, 1) * Math.PI) * 0.15;
      p.blendJoint(`shoulder${s}`, -0.2 + jab, side * 0.3, side * 0.35, w);
      p.blendJoint(`elbow${s}`, -1.6, side * 0.9, 0, w);
      p.blendJoint(`wrist${s}`, 0, side * 0.4, 0, w);
      p.blendHand(s, 1, 0, 0, 0, w);
      const shrug = Math.sin(clamp((t - 0.2) / 0.8, 0, 1) * Math.PI);
      p.add('chest', -0.03 * shrug * w, 0, 0);
      p.add('head', 0, 0, side * 0.08 * shrug * w);
    },
  },
  /** Tucking hair behind an ear — the Visitor, pleased and a little nervous. */
  hairTuck: {
    duration: 1.6,
    ease: [0.3, 0.45],
    apply(p, t, w, side) {
      const s = S(side);
      const reach = smoothstep(0.1, 0.6, t) * (1 - smoothstep(1.0, 1.5, t));
      p.blendJoint(`shoulder${s}`, -1.0, side * 0.2, side * 0.25, w * reach);
      p.blendJoint(`elbow${s}`, -2.35, side * 0.3, 0, w * reach);
      p.blendJoint(`wrist${s}`, 0.3, 0, side * 0.4, w * reach);
      p.blendHand(s, 0.3, 0.2, 0.2, 0.4, w * reach);
      p.add('head', 0.06 * w * reach, -side * 0.12 * w * reach, -side * 0.1 * w * reach);
    },
  },
  /** Arms folded — Odette waiting. */
  arms: {
    duration: 6,
    ease: [0.6, 0.7],
    apply(p, _t, w) {
      p.blendJoint('shoulderL', -0.62, -0.25, -0.35, w);
      p.blendJoint('elbowL', -1.95, 0.5, 0, w);
      p.blendJoint('wristL', 0, 0.2, 0, w);
      p.blendJoint('shoulderR', -0.5, 0.25, 0.32, w);
      p.blendJoint('elbowR', -2.05, -0.5, 0, w);
      p.blendHand('L', 0.4, 0.05, 0.2, 0, w).blendHand('R', 0.4, 0.05, 0.2, 0, w);
    },
  },
  /** Flinch: shoulders in, hands to the chest, a half-step back. */
  flinch: {
    duration: 1.4,
    ease: [0.06, 0.7],
    apply(p, t, w) {
      const k = 1 - smoothstep(0.3, 1.3, t) * 0.5;
      for (const side of [1, -1] as const) {
        const s = S(side);
        p.blendJoint(`shoulder${s}`, -0.7, -side * 0.3, -side * 0.2, w * k);
        p.blendJoint(`elbow${s}`, -2.1, 0, 0, w * k);
        p.blendHand(s, 0.7, 0.1, 0.5, 0, w);
      }
      p.add('spine', 0.08 * w * k, 0, 0);
      p.add('neck', 0.1 * w * k, 0, 0);
      p.root[2] -= 0.05 * w * k;
    },
  },
  /** She stops, weight back, uncertain. */
  hesitate: {
    duration: 1.8,
    ease: [0.25, 0.6],
    apply(p, t, w, side) {
      p.add('spine', -0.05 * w, 0, 0);
      p.root[2] -= 0.03 * w;
      const s = S(side);
      p.blendJoint(`shoulder${s}`, -0.4, -side * 0.15, -side * 0.1, w * 0.7);
      p.blendJoint(`elbow${s}`, -1.2, 0, 0, w * 0.7);
      p.blendHand(s, 0.55, 0.1, 0.4, 0, w);
      p.add('head', Math.sin(t * 1.5) * 0.03 * w, 0, 0);
    },
  },
  /**
   * Stage 4: dragged by the wrist. The held arm is drawn forward and up,
   * the other swings back for balance, and she leans away from the pull.
   * Meant to be played with a long `extend` and stopped.
   */
  pulled: {
    duration: 1.0,
    ease: [0.18, 0.6],
    apply(p, t, w, side) {
      const s = S(side);
      const o = S(-side as 1 | -1);
      const tug = noise1(t * 3.1, 9) * 0.12 + Math.max(0, Math.sin(t * 2.3)) * 0.08;
      p.blendJoint(`shoulder${s}`, -1.25 - tug, side * 0.1, side * 0.12, w);
      p.blendJoint(`elbow${s}`, -0.2, 0, 0, w);
      p.blendJoint(`wrist${s}`, 0.25, 0, 0, w);
      p.blendHand(s, 0.55, 0.05, 0.3, 0, w);
      p.blendJoint(`shoulder${o}`, 0.35, 0, -side * 0.35, w);
      p.blendJoint(`elbow${o}`, -0.7, 0, 0, w);
      p.blendHand(o, 0.75, 0.1, 0.5, 0, w);
      p.add('spine', (-0.1 + tug * 0.3) * w, side * 0.12 * w, 0);
      p.add('head', 0.12 * w, side * 0.1 * w, 0);
    },
  },
  /** A sudden heave back against whatever has her (a tap of SPACE). */
  resist: {
    duration: 0.75,
    ease: [0.05, 0.45],
    apply(p, t, w) {
      const k = Math.sin(clamp(t / 0.5, 0, 1) * Math.PI);
      p.add('spine', -0.2 * k * w, 0, 0);
      p.add('chest', -0.1 * k * w, 0, 0);
      p.add('neck', 0.12 * k * w, 0, 0);
      p.root[2] -= 0.08 * k * w;
      for (const side of [1, -1] as const) p.blendHand(S(side), 1, 0, 0.6, 0, w * k);
    },
  },
  /** Trying a door that will not open: reach, grip, two hard rattles. */
  tryDoor: {
    duration: 2.4,
    ease: [0.35, 0.5],
    apply(p, t, w, side) {
      const s = S(side);
      const rattle = t > 0.8 && t < 2.0 ? Math.sin(t * 26) * 0.07 : 0;
      p.blendJoint(`shoulder${s}`, -0.95 + rattle, side * 0.1, side * 0.05, w);
      p.blendJoint(`elbow${s}`, -0.5, 0, 0, w);
      p.blendJoint(`wrist${s}`, 0.1, side * -0.9, 0, w);
      p.blendHand(s, 0.85, 0.05, 0.6, 0, w);
      p.add('spine', (0.08 + rattle * 0.4) * w, 0, 0);
      p.add('head', 0.1 * w, 0, 0);
    },
  },
  /**
   * Held up by the ribbons while the gown takes her: arms lifted out from
   * her sides, palms turned forward, head tipped back a little.
   */
  raised: {
    duration: 1.6,
    ease: [0.9, 0.9],
    apply(p, t, w) {
      const sway = Math.sin(t * 1.3) * 0.05;
      for (const side of [1, -1] as const) {
        const s = S(side);
        p.blendJoint(`shoulder${s}`, -0.3 + sway * side, 0, side * (0.8 + sway), w);
        p.blendJoint(`elbow${s}`, -0.35, 0, 0, w);
        p.blendJoint(`wrist${s}`, 0, side * -0.6, side * 0.2, w);
        p.blendHand(s, 0.12, 0.4, 0.1, 0, w);
      }
      p.add('neck', -0.08 * w, 0, 0);
      p.add('head', -0.1 * w, 0, 0);
    },
  },

  // ------------------------------------------------------------ Stage 5

  /** Both palms flat against the window glass, leaning in toward it. */
  palmsGlass: {
    duration: 1.2,
    ease: [0.6, 0.6],
    apply(p, t, w) {
      const breath = Math.sin(t * 1.7) * 0.03;
      for (const side of [1, -1] as const) {
        const s = S(side);
        p.blendJoint(`shoulder${s}`, -1.42 + breath, side * 0.1, -side * 0.12, w);
        p.blendJoint(`elbow${s}`, -0.62, 0, 0, w);
        p.blendJoint(`wrist${s}`, -0.2, side * -1.25, side * 0.55, w);
        p.blendHand(s, 0.04, 0.5, 0.05, 0, w);
      }
      p.add('spine', 0.07 * w, 0, 0);
      p.add('chest', 0.04 * w, 0, 0);
      p.add('head', -0.04 * w, 0, 0);
    },
  },
  /** One knock-knock with the knuckles of the right hand, then a small wave at the glass. */
  knock: {
    duration: 1.6,
    ease: [0.25, 0.45],
    apply(p, t, w, side) {
      const s = S(side);
      const knock = t < 0.9 ? Math.max(0, Math.sin(t * 15)) * 0.14 : 0;
      const swing = t > 0.9 ? Math.sin(t * 10) * 0.35 : 0;
      p.blendJoint(`shoulder${s}`, -1.35 + knock, side * 0.1, -side * 0.05, w);
      p.blendJoint(`elbow${s}`, -1.05 + knock, 0, 0, w);
      p.blendJoint(`wrist${s}`, 0.1, side * -0.9, side * swing, w);
      p.blendHand(s, t < 0.9 ? 0.85 : 0.1, 0.3, 0.5, 0, w);
      p.add('spine', 0.05 * w, 0, 0);
    },
  },
  /**
   * Wiping the glass with her sleeve: the right forearm pressed flat to it,
   * one round sweep and back. The script stamps the cleared fog where the
   * hand actually is, so the clean patch follows the arm.
   */
  wipe: {
    duration: 1.05,
    ease: [0.14, 0.3],
    apply(p, t, w, side) {
      const s = S(side);
      const a = smoothstep(0.08, 0.95, t) * Math.PI * 2;
      const sweep = Math.sin(a) * 0.55;
      const lift = Math.cos(a) * 0.22;
      p.blendJoint(`shoulder${s}`, -1.42 - lift, side * 0.25, -side * (0.25 - sweep), w);
      p.blendJoint(`elbow${s}`, -0.95 - lift * 0.4, side * 0.4, 0, w);
      p.blendJoint(`wrist${s}`, 0, side * -0.4, 0, w);
      p.blendHand(s, 0.55, 0.05, 0.4, 0, w);
      p.add('chest', 0.03 * w, side * sweep * 0.25 * w, 0);
      p.add('spine', 0.06 * w, 0, 0);
    },
  },
  /** Recoiling from the glass: hands drawn in to the chest, weight back. */
  recoil: {
    duration: 1.8,
    ease: [0.12, 0.8],
    apply(p, t, w) {
      const k = 1 - smoothstep(0.7, 1.8, t) * 0.4;
      for (const side of [1, -1] as const) {
        const s = S(side);
        p.blendJoint(`shoulder${s}`, -0.75, -side * 0.25, -side * 0.25, w * k);
        p.blendJoint(`elbow${s}`, -2.2, 0, 0, w * k);
        p.blendJoint(`wrist${s}`, 0.3, 0, 0, w * k);
        p.blendHand(s, 0.6, 0.1, 0.4, 0, w);
      }
      p.add('spine', -0.1 * w * k, 0, 0);
      p.add('head', -0.06 * w * k, 0, 0);
      p.root[2] -= 0.22 * smoothstep(0, 0.35, t) * w;
    },
  },
  /** Reaching for the window latch with her right hand. */
  latch: {
    duration: 1.4,
    ease: [0.3, 0.4],
    apply(p, t, w, side) {
      const s = S(side);
      const push = smoothstep(0.6, 1.1, t);
      p.blendJoint(`shoulder${s}`, -1.25 - push * 0.15, side * 0.1, side * 0.1, w);
      p.blendJoint(`elbow${s}`, -0.7 + push * 0.4, 0, 0, w);
      p.blendJoint(`wrist${s}`, 0.2, side * -0.6, 0, w);
      p.blendHand(s, 0.8 - push * 0.6, 0.2, 0.5, 0, w);
      p.add('spine', 0.1 * w, 0, 0);
    },
  },
  /**
   * On the sill: crouched in the open window, one knee up, the left hand
   * on the frame, the right reaching out into the night.
   */
  sill: {
    duration: 1.0,
    ease: [0.5, 0.5],
    apply(p, t, w) {
      const sway = Math.sin(t * 2.1) * 0.03;
      p.blendJoint('thighL', -1.65, 0, 0.1, w);
      p.blendJoint('kneeL', 2.15, 0, 0, w);
      p.blendJoint('ankleL', -0.45, 0, 0, w);
      p.blendJoint('thighR', -0.95, 0, -0.12, w);
      p.blendJoint('kneeR', 2.3, 0, 0, w);
      p.blendJoint('ankleR', 0.35, 0, 0, w);
      p.blendJoint('hips', 0.25, 0, 0, w);
      p.blendJoint('spine', 0.3 + sway, 0, 0, w);
      p.blendJoint('chest', 0.15, 0, 0, w);
      p.blendJoint('shoulderL', -2.1, 0, 0.55, w);
      p.blendJoint('elbowL', -0.5, 0, 0, w);
      p.blendHand('L', 0.8, 0.05, 0.6, 0, w);
      p.blendJoint('shoulderR', -1.3 + sway, 0, -0.2, w);
      p.blendJoint('elbowR', -0.3, 0, 0, w);
      p.blendHand('R', 0.3, 0.3, 0.2, 0, w);
      p.blendJoint('neck', -0.25, 0, 0, w);
      p.root[1] -= 0.5 * w;
      p.root[2] -= 0.05 * w;
    },
  },
  /**
   * Pulling free: leaning out of the window toward the grass with both
   * arms reaching, the gown caught behind her. `STRUGGLE` carries the lean
   * and each heave (a tap of SPACE) from the script.
   */
  pullFree: {
    duration: 1.0,
    ease: [0.4, 0.3],
    apply(p, t, w) {
      const L = STRUGGLE.lean;
      const h = STRUGGLE.heave;
      const strain = noise1(t * 5, 31) * 0.06;
      p.blendJoint('thighL', -1.2 + L * 0.4, 0, 0.1, w);
      p.blendJoint('kneeL', 1.7 - L * 0.5, 0, 0, w);
      p.blendJoint('thighR', -0.5 + L * 0.3, 0, -0.1, w);
      p.blendJoint('kneeR', 1.9 - L * 0.4, 0, 0, w);
      p.blendJoint('hips', 0.35 + L * 0.35 + h * 0.2, 0, 0, w);
      p.blendJoint('spine', 0.35 + L * 0.2 + h * 0.15 + strain, 0, 0, w);
      p.blendJoint('chest', 0.1 + h * 0.1, 0, 0, w);
      for (const side of [1, -1] as const) {
        const s = S(side);
        p.blendJoint(`shoulder${s}`, -1.75 - h * 0.3 + strain * side, 0, side * 0.35, w);
        p.blendJoint(`elbow${s}`, -0.25, 0, 0, w);
        p.blendHand(s, 0.25 + h * 0.4, 0.35, 0.3, 0, w);
      }
      p.blendJoint('neck', -0.35 - h * 0.1, 0, 0, w);
      p.blendJoint('head', -0.2, 0, 0, w);
      p.root[1] -= (0.42 - L * 0.12) * w;
      p.root[2] += (0.05 + L * 0.18 + h * 0.12) * w;
    },
  },
  /** Fallen on the grass: on her knees and hands, head down. Released slowly, she rises. */
  fallen: {
    duration: 1.0,
    ease: [0.12, 1.4],
    apply(p, t, w) {
      const breath = Math.sin(t * 3.2) * 0.04;
      p.blendJoint('thighL', -1.4, 0, 0.12, w);
      p.blendJoint('kneeL', 2.5, 0, 0, w);
      p.blendJoint('ankleL', 0.7, 0, 0, w);
      p.blendJoint('thighR', -1.1, 0, -0.18, w);
      p.blendJoint('kneeR', 2.55, 0, 0, w);
      p.blendJoint('ankleR', 0.7, 0, 0, w);
      p.blendJoint('hips', 0.4, 0, 0, w);
      p.blendJoint('spine', 0.55 + breath, 0, 0, w);
      p.blendJoint('chest', 0.25 + breath, 0, 0, w);
      for (const side of [1, -1] as const) {
        const s = S(side);
        p.blendJoint(`shoulder${s}`, -0.95, 0, side * 0.12, w);
        p.blendJoint(`elbow${s}`, -0.2, 0, 0, w);
        p.blendJoint(`wrist${s}`, -0.9, 0, 0, w);
        p.blendHand(s, 0.2, 0.5, 0.2, 0, w);
      }
      p.blendJoint('neck', 0.3, 0, 0, w);
      p.blendJoint('head', 0.15, 0, 0, w);
      p.root[1] -= 0.62 * w;
      p.root[2] -= 0.1 * w;
    },
  },
  /** A friend calling her over: the arm forward, the hand curling twice toward herself. */
  beckon: {
    duration: 2.4,
    ease: [0.4, 0.5],
    apply(p, t, w, side) {
      const s = S(side);
      const curl = Math.max(0, Math.sin(t * 5)) * smoothstep(0.4, 0.7, t);
      p.blendJoint(`shoulder${s}`, -1.05, side * 0.1, side * 0.15, w);
      p.blendJoint(`elbow${s}`, -0.6 - curl * 0.3, 0, 0, w);
      p.blendJoint(`wrist${s}`, -0.3, side * -1.3, 0, w);
      p.blendHand(s, curl, 0.2, 0.1, 0, w);
    },
  },
  /** Backing away: hands up in front of her, the body turned half away. */
  shield: {
    duration: 1.2,
    ease: [0.35, 0.6],
    apply(p, t, w) {
      const tremble = noise1(t * 14, 41) * 0.05;
      for (const side of [1, -1] as const) {
        const s = S(side);
        p.blendJoint(`shoulder${s}`, -1.0 + tremble, -side * 0.2, side * 0.05, w);
        p.blendJoint(`elbow${s}`, -1.55, 0, 0, w);
        p.blendJoint(`wrist${s}`, -0.5, side * -1.1, 0, w);
        p.blendHand(s, 0.25, 0.5, 0.2, 0, w);
      }
      p.add('spine', -0.12 * w, 0, 0);
      p.add('chest', -0.06 * w, 0.12 * w, 0);
      p.add('head', 0.05 * w, 0, 0);
    },
  },
  /** Both hands come up to her mouth. */
  handsMouth: {
    duration: 1.5,
    ease: [0.25, 0.6],
    apply(p, _t, w) {
      for (const side of [1, -1] as const) {
        const s = S(side);
        p.blendJoint(`shoulder${s}`, -1.05, -side * 0.45, -side * 0.35, w);
        p.blendJoint(`elbow${s}`, -2.45, 0, 0, w);
        p.blendJoint(`wrist${s}`, 0.2, 0, 0, w);
        p.blendHand(s, 0.35, 0.25, 0.3, 0, w);
      }
      p.add('neck', 0.08 * w, 0, 0);
      p.add('spine', 0.04 * w, 0, 0);
    },
  },
} satisfies Record<string, GestureDef>;

/** Script-driven values for the window struggle (see `pullFree`). */
export const STRUGGLE = { lean: 0, heave: 0 };

export type GestureName = keyof typeof GESTURES;

/**
 * Holding the phone up to read it. A continuous layer (not a timed
 * gesture): the Performer ramps its weight. `type` makes the thumb tap.
 */
export function phoneHold(p: Pose, w: number, t: number, type: number): void {
  if (w <= 0) return;
  p.blendJoint('shoulderR', -0.82, 0.12, -0.1, w);
  p.blendJoint('elbowR', -2.05, 0.5, 0, w);
  p.blendJoint('wristR', -0.15, -0.55, 0.1, w);
  const tap = type * Math.max(0, Math.sin(t * 14));
  // Thumb along the phone's edge (not across the screen); it dips to tap when typing.
  p.blendHand('R', 0.9, 0.02, 0.05 + tap * 0.2, 0, w);
  p.add('neck', 0.18 * w, 0, 0);
  p.add('head', 0.3 * w, -0.08 * w, 0);
  // The free hand drifts up to steady the phone when typing.
  p.blendJoint('shoulderL', -0.45, -0.15, -0.15, w * type);
  p.blendJoint('elbowL', -1.7, -0.4, 0, w * type);
  p.blendHand('L', 0.35, 0.1, 0.3, 0, w * type);
}

/** Reaching into the coat pocket (to take the phone out or put it away). */
export function pocketReach(p: Pose, w: number): void {
  if (w <= 0) return;
  p.blendJoint('shoulderR', 0.12, -0.1, -0.22, w);
  p.blendJoint('elbowR', -0.45, 0, 0, w);
  p.blendJoint('wristR', 0, 0, 0, w);
  p.blendHand('R', 0.5, 0.05, 0.3, 0, w);
  p.add('chest', 0, 0.05 * w, -0.04 * w);
  p.add('head', 0.1 * w, -0.1 * w, 0);
}
