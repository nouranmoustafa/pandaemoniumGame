import type * as THREE from 'three';
import type { Pose } from './Pose';

export interface SecondaryMotion {
  /** World-space velocity of the root. */
  velocity: THREE.Vector3;
  /** World-space acceleration of the root. */
  accel: THREE.Vector3;
  /** Extra wind / drag (0..1). */
  wind: number;
  /** 0..1 — sliding pose weight, which changes how cloth and hair hang. */
  slide: number;
}

/**
 * Anything that can visually represent the Visitor. Stage 1 ships with a
 * procedural, hand-built avatar; a rigged GLTF character can implement the
 * same interface by mapping Pose joints onto its bones (or by driving its own
 * AnimationMixer from the same state) without any gameplay code changing.
 */
export interface VisitorAvatar {
  readonly object: THREE.Object3D;
  applyPose(pose: Pose): void;
  updateSecondary(dt: number, motion: SecondaryMotion): void;
  /** World position of an ankle — roots grab here. */
  getAnkleWorld(side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3;
  /** Phone screen glow 0..1 (the dating app). */
  setPhoneGlow(v: number): void;
}
