/**
 * Engine-agnostic skeletal pose: Euler rotations per joint plus a root offset.
 * The procedural animator produces these; any avatar (the current procedural
 * one, or a future rigged GLTF) consumes them.
 *
 * Model convention: character faces +Z, her left is +X, up is +Y.
 * Positive X rotation swings a limb backward / pitches the torso forward.
 */
export const JOINTS = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'shoulderL',
  'elbowL',
  'wristL',
  'shoulderR',
  'elbowR',
  'wristR',
  'thighL',
  'kneeL',
  'ankleL',
  'thighR',
  'kneeR',
  'ankleR',
] as const;

export type JointName = (typeof JOINTS)[number];

/** Loosely curled, at rest. */
const RELAXED_HANDS = [0.32, 0.12, 0.25, 0, 0.32, 0.12, 0.25, 0];

export class Pose {
  /** Packed [x, y, z] per joint, in JOINTS order. */
  readonly rot = new Float32Array(JOINTS.length * 3);
  /** Root translation offset (model space). */
  readonly root = new Float32Array(3);
  /** Root rotation offset (pitch, yaw, roll). */
  readonly rootRot = new Float32Array(3);
  /** Hands: [curl, spread, thumb, point] for L then R (0 = open, 1 = closed). */
  readonly hand = new Float32Array(RELAXED_HANDS);

  setHand(side: 'L' | 'R', curl: number, spread = 0.12, thumb = 0.25, point = 0): this {
    const o = side === 'L' ? 0 : 4;
    this.hand[o] = curl;
    this.hand[o + 1] = spread;
    this.hand[o + 2] = thumb;
    this.hand[o + 3] = point;
    return this;
  }

  /** Blend one hand toward a shape by weight w. */
  blendHand(side: 'L' | 'R', curl: number, spread: number, thumb: number, point: number, w: number): this {
    if (w <= 0) return this;
    const o = side === 'L' ? 0 : 4;
    const t = [curl, spread, thumb, point];
    for (let i = 0; i < 4; i++) this.hand[o + i] += (t[i] - this.hand[o + i]) * Math.min(1, w);
    return this;
  }

  set(j: JointName, x: number, y = 0, z = 0): this {
    const i = JOINT_INDEX[j] * 3;
    this.rot[i] = x;
    this.rot[i + 1] = y;
    this.rot[i + 2] = z;
    return this;
  }

  add(j: JointName, x: number, y = 0, z = 0): this {
    const i = JOINT_INDEX[j] * 3;
    this.rot[i] += x;
    this.rot[i + 1] += y;
    this.rot[i + 2] += z;
    return this;
  }

  /** Blend a single joint toward a rotation by weight w. */
  blendJoint(j: JointName, x: number, y: number, z: number, w: number): this {
    if (w <= 0) return this;
    const i = JOINT_INDEX[j] * 3;
    this.rot[i] += (x - this.rot[i]) * w;
    this.rot[i + 1] += (y - this.rot[i + 1]) * w;
    this.rot[i + 2] += (z - this.rot[i + 2]) * w;
    return this;
  }

  clear(): this {
    this.rot.fill(0);
    this.root.fill(0);
    this.rootRot.fill(0);
    this.hand.set(RELAXED_HANDS);
    return this;
  }

  copy(p: Pose): this {
    this.rot.set(p.rot);
    this.root.set(p.root);
    this.rootRot.set(p.rootRot);
    this.hand.set(p.hand);
    return this;
  }

  /** this = lerp(this, other, w) */
  blend(other: Pose, w: number): this {
    if (w <= 0) return this;
    if (w >= 1) return this.copy(other);
    for (let i = 0; i < this.rot.length; i++) this.rot[i] += (other.rot[i] - this.rot[i]) * w;
    for (let i = 0; i < 3; i++) {
      this.root[i] += (other.root[i] - this.root[i]) * w;
      this.rootRot[i] += (other.rootRot[i] - this.rootRot[i]) * w;
    }
    for (let i = 0; i < 8; i++) this.hand[i] += (other.hand[i] - this.hand[i]) * w;
    return this;
  }

  /** Exponential smoothing toward a target pose (removes pops between states). */
  dampToward(target: Pose, rate: number, dt: number): this {
    return this.blend(target, 1 - Math.exp(-rate * dt));
  }
}

export const JOINT_INDEX = Object.fromEntries(JOINTS.map((j, i) => [j, i])) as Record<JointName, number>;
