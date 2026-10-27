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
 * Anything that can visually represent the Visitor. Stage 3 ships a
 * generated, skinned character (characters/GeneratedCharacter); a supplied
 * rigged GLB implements the same contract (characters/gltf/GltfAvatar).
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
