import * as THREE from 'three';
import { JOINTS, type JointName, type Pose } from '../../visitor/Pose';

/**
 * Body proportions. Everything in metres before the character's world
 * scale. Each character's identity (height, limbs, shoulders, head) lives
 * here, separately from her clothes, so outfits can change without
 * touching who she is.
 */
export interface Proportions {
  height: number;
  /** Shoulder half-width as a fraction of height. */
  shoulder: number;
  hip: number;
  /** Leg length multiplier (hip joint → ankle). */
  leg: number;
  arm: number;
  neck: number;
  head: number;
  /** Bust / chest depth factor. */
  bust: number;
  waist: number;
  /** Rest posture: forward tilt of the upper body. */
  slouch: number;
}

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
export type FingerName = (typeof FINGERS)[number];
export type Side = 'L' | 'R';

/** Bones beyond the shared Pose joints. */
export type ExtraBone =
  | 'root'
  | `${FingerName}${1 | 2}${Side}`
  | 'coatBack'
  | 'coatL'
  | 'coatR'
  | `hair${number}`
  | `scarf${number}`;

export type BoneName = JointName | ExtraBone;

export interface ChainSpec {
  /** Prefix: bones are named prefix0, prefix1… */
  prefix: 'hair' | 'scarf';
  parent: BoneName;
  /** First bone's offset from its parent (model space). */
  origin: [number, number, number];
  /** Offset between successive bones. */
  step: [number, number, number];
  count: number;
  /** Index offset, so several chains can share a prefix. */
  start?: number;
}

/** A segment a vertex can be skinned to. */
export interface BoneSegment {
  index: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
}

/** Hand pose controls: 0 = open/straight, 1 = fully curled. */
export interface HandShape {
  curl: number;
  spread: number;
  thumb: number;
  /** Index finger straightens independently of the others (pointing, phone taps). */
  point: number;
}

export const RELAXED_HAND: HandShape = { curl: 0.32, spread: 0.12, thumb: 0.25, point: 0 };

/**
 * A real skeletal rig: THREE.Bone hierarchy with bind pose, finger bones,
 * coat panel bones and spring chains (hair, scarf). Bone rest rotations are
 * zero, so the engine's Pose (Euler offsets per joint) maps onto it 1:1.
 */
export class CharacterRig {
  readonly bones = new Map<BoneName, THREE.Bone>();
  readonly list: THREE.Bone[] = [];
  readonly root: THREE.Bone;
  readonly skeleton: THREE.Skeleton;
  /** Bind-pose model-space positions. */
  readonly bindPos = new Map<BoneName, THREE.Vector3>();
  /** Tip of each terminal bone (for skinning segments). */
  private tips = new Map<BoneName, THREE.Vector3>();
  readonly chains = new Map<string, BoneName[]>();
  readonly p: Proportions;
  /** Key measurements other builders need. */
  readonly m: {
    hipJointY: number;
    ankleY: number;
    thigh: number;
    shin: number;
    upperArm: number;
    foreArm: number;
    palm: number;
    shoulderX: number;
    hipX: number;
    headR: number;
    headCenter: THREE.Vector3;
    neckBaseY: number;
    chestY: number;
    spineY: number;
    hipsY: number;
  };

  constructor(p: Proportions, chains: ChainSpec[] = []) {
    this.p = p;
    const H = p.height;
    const legLen = H * 0.47 * p.leg;
    const thigh = legLen * 0.51;
    const shin = legLen * 0.49;
    const ankleY = H * 0.042;
    const hipJointY = ankleY + legLen;
    const hipsY = hipJointY + H * 0.028;
    const spineY = hipsY + H * 0.036;
    const chestY = spineY + H * 0.118;
    const neckBaseY = chestY + H * 0.128;
    const neckLen = H * 0.04 * p.neck;
    const upperArm = H * 0.17 * p.arm;
    const foreArm = H * 0.148 * p.arm;
    const palm = H * 0.056;
    const shoulderX = H * p.shoulder;
    const hipX = H * 0.052 * p.hip;
    const headR = H * 0.064 * p.head;

    const add = (name: BoneName, parent: BoneName | null, x: number, y: number, z: number) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, z);
      if (parent) this.bones.get(parent)!.add(b);
      this.bones.set(name, b);
      this.list.push(b);
      return b;
    };

    this.root = add('root', null, 0, 0, 0);
    add('hips', 'root', 0, hipsY, 0);
    add('spine', 'hips', 0, spineY - hipsY, 0);
    add('chest', 'spine', 0, chestY - spineY, -0.004 * H);
    add('neck', 'chest', 0, neckBaseY - chestY, -0.01 * H);
    add('head', 'neck', 0, neckLen, 0.008 * H);
    for (const [s, sx] of [
      ['L', 1],
      ['R', -1],
    ] as const) {
      add(`shoulder${s}`, 'chest', sx * shoulderX, (neckBaseY - chestY) * 0.78, -0.012 * H);
      add(`elbow${s}`, `shoulder${s}`, 0, -upperArm, -0.004 * H);
      add(`wrist${s}`, `elbow${s}`, 0, -foreArm, 0.004 * H);
      add(`thigh${s}`, 'hips', sx * hipX, hipJointY - hipsY, 0);
      add(`knee${s}`, `thigh${s}`, 0, -thigh, 0.004 * H);
      add(`ankle${s}`, `knee${s}`, 0, -shin, -0.006 * H);
      // Fingers: the hand hangs palm-inward, so fingers fan front (+Z, index) to back (pinky).
      const fz = [0.012, 0.009, 0.003, -0.003, -0.0085].map((z) => z * H);
      const fl = [0.021, 0.026, 0.028, 0.026, 0.021].map((l) => l * H);
      FINGERS.forEach((f, i) => {
        const base: [number, number, number] =
          f === 'thumb' ? [-sx * 0.004 * H, -palm * 0.28, 0.014 * H] : [-sx * 0.0015 * H, -palm, fz[i]];
        add(`${f}1${s}` as BoneName, `wrist${s}`, ...base);
        add(`${f}2${s}` as BoneName, `${f}1${s}` as BoneName, 0, -fl[i], f === 'thumb' ? 0.004 * H : 0);
        this.tips.set(`${f}2${s}` as BoneName, new THREE.Vector3(0, -fl[i] * 0.95, 0));
      });
    }
    // Coat / skirt panels hang from the hips.
    add('coatBack', 'hips', 0, -0.01 * H, -0.06 * H);
    add('coatL', 'hips', 0.06 * H, -0.01 * H, 0.03 * H);
    add('coatR', 'hips', -0.06 * H, -0.01 * H, 0.03 * H);

    for (const c of chains) {
      const names: BoneName[] = [];
      let parent: BoneName = c.parent;
      for (let i = 0; i < c.count; i++) {
        const name = `${c.prefix}${(c.start ?? 0) + i}` as BoneName;
        const o = i === 0 ? c.origin : c.step;
        add(name, parent, o[0], o[1], o[2]);
        names.push(name);
        parent = name;
      }
      this.tips.set(parent, new THREE.Vector3(...c.step));
      this.chains.set(`${c.prefix}${c.start ?? 0}`, names);
    }

    // Terminal tips.
    this.tips.set('head', new THREE.Vector3(0, headR * 2.2, 0));
    this.tips.set('ankleL', new THREE.Vector3(0, -ankleY * 0.5, 0.11 * H * 0.5));
    this.tips.set('ankleR', new THREE.Vector3(0, -ankleY * 0.5, 0.11 * H * 0.5));
    this.tips.set('coatBack', new THREE.Vector3(0, -0.3 * H, -0.03 * H));
    this.tips.set('coatL', new THREE.Vector3(0, -0.3 * H, 0.02 * H));
    this.tips.set('coatR', new THREE.Vector3(0, -0.3 * H, 0.02 * H));

    // Rest posture.
    this.root.updateMatrixWorld(true);
    for (const [name, b] of this.bones) this.bindPos.set(name, new THREE.Vector3().setFromMatrixPosition(b.matrixWorld));
    this.skeleton = new THREE.Skeleton(this.list);

    this.m = {
      hipJointY,
      ankleY,
      thigh,
      shin,
      upperArm,
      foreArm,
      palm,
      shoulderX,
      hipX,
      headR,
      headCenter: new THREE.Vector3(0, headR * 1.02, headR * 0.12),
      neckBaseY,
      chestY,
      spineY,
      hipsY,
    };
  }

  bone(name: BoneName): THREE.Bone {
    const b = this.bones.get(name);
    if (!b) throw new Error(`No bone ${name}`);
    return b;
  }

  index(name: BoneName): number {
    return this.list.indexOf(this.bone(name));
  }

  /** Model-space segment from a bone to its child (or tip). */
  segment(name: BoneName, child?: BoneName): BoneSegment {
    const a = this.bindPos.get(name)!;
    let b: THREE.Vector3;
    if (child) b = this.bindPos.get(child)!;
    else if (this.tips.has(name)) b = a.clone().add(this.tips.get(name)!);
    else {
      const kid = this.bone(name).children.find((c) => (c as THREE.Bone).isBone) as THREE.Bone | undefined;
      b = kid ? this.bindPos.get(kid.name as BoneName)! : a.clone();
    }
    return { index: this.index(name), a: a.clone(), b: b.clone() };
  }

  /** Apply an engine Pose (Euler offsets per joint) plus root motion. */
  applyPose(pose: Pose): void {
    for (let i = 0; i < JOINTS.length; i++) {
      const b = this.bones.get(JOINTS[i])!;
      b.rotation.set(pose.rot[i * 3], pose.rot[i * 3 + 1], pose.rot[i * 3 + 2]);
    }
    // Posture: a hint of slouch lives in the spine, not the animation.
    if (this.p.slouch) {
      this.bones.get('chest')!.rotation.x += this.p.slouch;
      this.bones.get('neck')!.rotation.x -= this.p.slouch * 0.6;
    }
    this.root.position.set(pose.root[0], pose.root[1], pose.root[2]);
    this.root.rotation.set(pose.rootRot[0], pose.rootRot[1], pose.rootRot[2]);
  }

  /** Finger curls. Left and right mirror around the hand's palm-in rest. */
  applyHand(side: Side, h: HandShape): void {
    const sx = side === 'L' ? -1 : 1;
    FINGERS.forEach((f, i) => {
      const b1 = this.bones.get(`${f}1${side}` as BoneName)!;
      const b2 = this.bones.get(`${f}2${side}` as BoneName)!;
      if (f === 'thumb') {
        // Thumb folds across the palm.
        b1.rotation.set(-0.25 - h.thumb * 0.5, 0, sx * (0.25 + h.thumb * 0.6));
        b2.rotation.set(-h.thumb * 0.4, 0, sx * h.thumb * 0.5);
        return;
      }
      const c = f === 'index' ? h.curl * (1 - h.point) : h.curl * (1 + (i - 1) * 0.06);
      const spread = (i - 2.2) * h.spread * 0.18;
      b1.rotation.set(spread, 0, sx * c * 1.25);
      b2.rotation.set(0, 0, sx * c * 1.35);
    });
  }
}
