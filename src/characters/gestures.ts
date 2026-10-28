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
} satisfies Record<string, GestureDef>;

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
  p.blendHand('R', 0.62, 0.05, 0.0 + tap * 0.25, 0, w);
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
