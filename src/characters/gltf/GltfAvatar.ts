import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { SecondaryMotion, VisitorAvatar } from '../../visitor/Avatar';
import type { JointName, Pose } from '../../visitor/Pose';
import type { FaceState } from '../Expression';

/** Common humanoid bone names (Mixamo, Unreal/Quaternius, Blender Rigify-export, VRM) → our joints. */
const BONE_ALIASES: Record<JointName, string[]> = {
  hips: ['mixamorig:Hips', 'Hips', 'pelvis', 'Pelvis', 'hips', 'J_Bip_C_Hips'],
  spine: ['mixamorig:Spine', 'Spine', 'spine_01', 'spine', 'Abdomen', 'J_Bip_C_Spine'],
  chest: ['mixamorig:Spine2', 'Chest', 'spine_03', 'chest', 'Torso', 'J_Bip_C_Chest', 'mixamorig:Spine1'],
  neck: ['mixamorig:Neck', 'Neck', 'neck_01', 'neck', 'J_Bip_C_Neck'],
  head: ['mixamorig:Head', 'Head', 'head', 'J_Bip_C_Head'],
  shoulderL: ['mixamorig:LeftArm', 'LeftUpperArm', 'upperarm_l', 'UpperArmL', 'J_Bip_L_UpperArm'],
  elbowL: ['mixamorig:LeftForeArm', 'LeftLowerArm', 'lowerarm_l', 'LowerArmL', 'J_Bip_L_LowerArm'],
  wristL: ['mixamorig:LeftHand', 'LeftHand', 'hand_l', 'Palm2L', 'J_Bip_L_Hand'],
  shoulderR: ['mixamorig:RightArm', 'RightUpperArm', 'upperarm_r', 'UpperArmR', 'J_Bip_R_UpperArm'],
  elbowR: ['mixamorig:RightForeArm', 'RightLowerArm', 'lowerarm_r', 'LowerArmR', 'J_Bip_R_LowerArm'],
  wristR: ['mixamorig:RightHand', 'RightHand', 'hand_r', 'Palm2R', 'J_Bip_R_Hand'],
  thighL: ['mixamorig:LeftUpLeg', 'LeftUpperLeg', 'thigh_l', 'UpperLegL', 'J_Bip_L_UpperLeg'],
  kneeL: ['mixamorig:LeftLeg', 'LeftLowerLeg', 'calf_l', 'LowerLegL', 'J_Bip_L_LowerLeg'],
  ankleL: ['mixamorig:LeftFoot', 'LeftFoot', 'foot_l', 'FootL', 'J_Bip_L_Foot'],
  thighR: ['mixamorig:RightUpLeg', 'RightUpperLeg', 'thigh_r', 'UpperLegR', 'J_Bip_R_UpperLeg'],
  kneeR: ['mixamorig:RightLeg', 'RightLowerLeg', 'calf_r', 'LowerLegR', 'J_Bip_R_LowerLeg'],
  ankleR: ['mixamorig:RightFoot', 'RightFoot', 'foot_r', 'FootR', 'J_Bip_R_Foot'],
};

/** Semantic clips the game asks for → names commonly used in packs. */
export const CLIP_ALIASES: Record<string, string[]> = {
  idle: ['Idle', 'idle', 'Idle_Neutral', 'Standing Idle'],
  walk: ['Walking', 'Walk', 'walk', 'Walk_Forward'],
  run: ['Running', 'Run', 'run', 'Jog', 'Run_Forward'],
  sprint: ['Sprint', 'Sprinting', 'Fast Run'],
  stumble: ['Stumble', 'Hit', 'HitReact', 'Death'],
  slide: ['Slide', 'Sliding', 'Sitting'],
  wave: ['Wave', 'Waving'],
  talk: ['Talk', 'Talking', 'Yes'],
  phone: ['Phone', 'Texting'],
  fear: ['Fear', 'Scared', 'No'],
};

/** Our expression channels → common morph target names (ARKit, VRM, simple packs). */
const MORPH_ALIASES: Record<string, string[]> = {
  smile: ['mouthSmile', 'mouthSmileLeft', 'Smile', 'happy', 'Fcl_MTH_Joy', 'Happy'],
  frown: ['mouthFrownLeft', 'mouthFrown', 'Sad', 'sad', 'Fcl_MTH_Sorrow'],
  open: ['jawOpen', 'Surprised', 'aa', 'Fcl_MTH_A'],
  browUp: ['browInnerUp', 'Surprised', 'surprised', 'Fcl_BRW_Surprised'],
  browDown: ['browDownLeft', 'Angry', 'angry', 'Fcl_BRW_Angry'],
  wide: ['eyeWideLeft', 'Surprised', 'Fcl_EYE_Surprised'],
  blink: ['eyeBlinkLeft', 'blink', 'Fcl_EYE_Close', 'Blink'],
};

export interface GltfReport {
  bonesFound: JointName[];
  bonesMissing: JointName[];
  clips: string[];
  semanticClips: Record<string, string | null>;
  morphs: string[];
  skinnedMeshes: number;
}

/**
 * A rigged GLB character driven by THREE.AnimationMixer: locomotion clips
 * cross-faded by speed, one-shot gestures, and expressions mapped onto
 * whatever morph targets the model has. Implements VisitorAvatar so a
 * supplied model can stand in for the generated Visitor.
 *
 * Authored clips are the primary animation. The engine Pose only adds small
 * procedural leans on top (after the mixer), because arbitrary rigs have
 * arbitrary bone axes and a full retarget is out of scope here.
 */
export class GltfAvatar implements VisitorAvatar {
  readonly object = new THREE.Group();
  readonly mixer: THREE.AnimationMixer;
  readonly report: GltfReport;
  private bones = new Map<JointName, THREE.Bone>();
  private actions = new Map<string, THREE.AnimationAction>();
  private loco: Array<[string, number]> = [];
  private morphMeshes: THREE.Mesh[] = [];
  private speed = 0;
  private current = '';

  private constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.object.add(root);
    this.mixer = new THREE.AnimationMixer(root);
    let skinned = 0;
    const morphs = new Set<string>();
    const named = new Map<string, THREE.Bone>();
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) named.set(o.name, o as THREE.Bone);
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = m.receiveShadow = true;
        if ((m as THREE.SkinnedMesh).isSkinnedMesh) skinned++;
        if (m.morphTargetDictionary) {
          this.morphMeshes.push(m);
          Object.keys(m.morphTargetDictionary).forEach((k) => morphs.add(k));
        }
      }
    });
    const found: JointName[] = [];
    const missing: JointName[] = [];
    for (const [joint, aliases] of Object.entries(BONE_ALIASES) as Array<[JointName, string[]]>) {
      const b = aliases.map((a) => named.get(a)).find(Boolean);
      if (b) {
        this.bones.set(joint, b);
        found.push(joint);
      } else missing.push(joint);
    }
    const semantic: Record<string, string | null> = {};
    for (const [key, aliases] of Object.entries(CLIP_ALIASES)) {
      const clip = clips.find((c) => aliases.includes(c.name));
      semantic[key] = clip?.name ?? null;
      if (clip) this.actions.set(key, this.mixer.clipAction(clip));
    }
    // Locomotion ladder: clip → the speed (m/s) it was authored for.
    for (const [k, v] of [
      ['idle', 0],
      ['walk', 1.5],
      ['run', 5.2],
      ['sprint', 11],
    ] as const) {
      if (this.actions.has(k)) this.loco.push([k, v]);
    }
    for (const [k] of this.loco) {
      const a = this.actions.get(k)!;
      a.play();
      a.setEffectiveWeight(k === 'idle' ? 1 : 0);
    }
    this.report = { bonesFound: found, bonesMissing: missing, clips: clips.map((c) => c.name), semanticClips: semantic, morphs: [...morphs], skinnedMeshes: skinned };
  }

  static async load(url: string): Promise<GltfAvatar> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new GltfAvatar(gltf.scene, gltf.animations);
  }

  /** Locomotion speed in m/s: weights blend between the two nearest clips, playback rate tracks speed so feet don't skate. */
  setSpeed(speed: number): void {
    this.speed = speed;
    if (this.loco.length === 0) return;
    let lo = this.loco[0];
    let hi = this.loco[this.loco.length - 1];
    for (let i = 0; i < this.loco.length - 1; i++) {
      if (speed >= this.loco[i][1] && speed <= this.loco[i + 1][1]) {
        lo = this.loco[i];
        hi = this.loco[i + 1];
      }
    }
    const span = Math.max(0.001, hi[1] - lo[1]);
    const t = Math.min(1, Math.max(0, (speed - lo[1]) / span));
    for (const [k, v] of this.loco) {
      const a = this.actions.get(k)!;
      const w = k === lo[0] ? 1 - t : k === hi[0] ? t : 0;
      a.setEffectiveWeight(w);
      if (v > 0) a.setEffectiveTimeScale(Math.max(0.3, speed / v));
    }
  }

  /** One-shot gesture by semantic name ('wave', 'talk', 'fear'…). Returns false if the model lacks it. */
  play(name: string): boolean {
    const a = this.actions.get(name);
    if (!a) return false;
    if (this.current) this.actions.get(this.current)?.fadeOut(0.25);
    a.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.25).play();
    a.clampWhenFinished = false;
    this.current = name;
    return true;
  }

  applyPose(pose: Pose): void {
    // Additive leans only (see class note): the clips own the skeleton.
    this.object.rotation.set(pose.rootRot[0] * 0.6, 0, pose.rootRot[2] * 0.6);
  }

  updateSecondary(dt: number, _m: SecondaryMotion): void {
    this.mixer.update(dt);
  }

  setFace(f: FaceState, blink: number): void {
    const channels: Record<string, number> = {
      smile: f.smile,
      frown: f.frown,
      open: f.open,
      browUp: f.browInnerUp,
      browDown: f.browDown,
      wide: f.lidUp > 0 ? f.lidUp : 0,
      blink,
    };
    for (const m of this.morphMeshes) {
      const dict = m.morphTargetDictionary!;
      const inf = m.morphTargetInfluences!;
      inf.fill(0);
      for (const [ch, v] of Object.entries(channels)) {
        for (const alias of MORPH_ALIASES[ch]) {
          const i = dict[alias];
          if (i !== undefined) inf[i] = Math.max(inf[i], Math.min(1, v));
        }
      }
    }
  }

  getAnkleWorld(side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3 {
    const b = this.bones.get(side === 'L' ? 'ankleL' : 'ankleR');
    return b ? b.getWorldPosition(out) : this.object.getWorldPosition(out);
  }

  /** The supplied model brings its own phone prop (if any); nothing to drive here. */
  setPhoneGlow(_v: number): void {}

  get locomotionSpeed(): number {
    return this.speed;
  }
}
