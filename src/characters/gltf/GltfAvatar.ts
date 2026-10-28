import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { SecondaryMotion, VisitorAvatar } from '../../visitor/Avatar';
import type { JointName, Pose } from '../../visitor/Pose';
import type { FaceState } from '../Expression';
import type { AssetEntry } from './manifest';

/** Common humanoid bone names (Mixamo, Unreal/Quaternius, Blender Rigify-export, VRM) → our joints. */
const BONE_ALIASES: Record<JointName, string[]> = {
  hips: ['mixamorig:Hips', 'mixamorigHips', 'Hips', 'pelvis', 'Pelvis', 'hips', 'J_Bip_C_Hips'],
  spine: ['mixamorig:Spine', 'mixamorigSpine', 'Spine', 'spine_01', 'spine', 'Abdomen', 'J_Bip_C_Spine'],
  chest: ['mixamorig:Spine2', 'mixamorigSpine2', 'Chest', 'UpperChest', 'spine_03', 'chest', 'Torso', 'J_Bip_C_Chest', 'mixamorig:Spine1'],
  neck: ['mixamorig:Neck', 'mixamorigNeck', 'Neck', 'neck_01', 'neck', 'J_Bip_C_Neck'],
  head: ['mixamorig:Head', 'mixamorigHead', 'Head', 'head', 'J_Bip_C_Head'],
  shoulderL: ['mixamorig:LeftArm', 'mixamorigLeftArm', 'LeftUpperArm', 'upperarm_l', 'UpperArmL', 'J_Bip_L_UpperArm'],
  elbowL: ['mixamorig:LeftForeArm', 'mixamorigLeftForeArm', 'LeftLowerArm', 'lowerarm_l', 'LowerArmL', 'J_Bip_L_LowerArm'],
  wristL: ['mixamorig:LeftHand', 'mixamorigLeftHand', 'LeftHand', 'hand_l', 'Palm2L', 'J_Bip_L_Hand'],
  shoulderR: ['mixamorig:RightArm', 'mixamorigRightArm', 'RightUpperArm', 'upperarm_r', 'UpperArmR', 'J_Bip_R_UpperArm'],
  elbowR: ['mixamorig:RightForeArm', 'mixamorigRightForeArm', 'RightLowerArm', 'lowerarm_r', 'LowerArmR', 'J_Bip_R_LowerArm'],
  wristR: ['mixamorig:RightHand', 'mixamorigRightHand', 'RightHand', 'hand_r', 'Palm2R', 'J_Bip_R_Hand'],
  thighL: ['mixamorig:LeftUpLeg', 'mixamorigLeftUpLeg', 'LeftUpperLeg', 'thigh_l', 'UpperLegL', 'J_Bip_L_UpperLeg'],
  kneeL: ['mixamorig:LeftLeg', 'mixamorigLeftLeg', 'LeftLowerLeg', 'calf_l', 'LowerLegL', 'J_Bip_L_LowerLeg'],
  ankleL: ['mixamorig:LeftFoot', 'mixamorigLeftFoot', 'LeftFoot', 'foot_l', 'FootL', 'J_Bip_L_Foot'],
  thighR: ['mixamorig:RightUpLeg', 'mixamorigRightUpLeg', 'RightUpperLeg', 'thigh_r', 'UpperLegR', 'J_Bip_R_UpperLeg'],
  kneeR: ['mixamorig:RightLeg', 'mixamorigRightLeg', 'RightLowerLeg', 'calf_r', 'LowerLegR', 'J_Bip_R_LowerLeg'],
  ankleR: ['mixamorig:RightFoot', 'mixamorigRightFoot', 'RightFoot', 'foot_r', 'FootR', 'J_Bip_R_Foot'],
};

/** Semantic clips the game asks for → names commonly used in packs. A manifest entry can override any of them. */
export const CLIP_ALIASES: Record<string, string[]> = {
  idle: ['Idle', 'idle', 'Idle_Neutral', 'Standing Idle'],
  walk: ['Walking', 'Walk', 'walk', 'Walk_Forward'],
  run: ['Running', 'Run', 'run', 'Jog', 'Run_Forward'],
  sprint: ['Sprint', 'Sprinting', 'Fast Run'],
  dodge: ['Dodge', 'Dodge_Left', 'Strafe'],
  stumble: ['Stumble', 'Trip', 'HitReact', 'Hit'],
  recover: ['Recover', 'GetUp', 'Stand_Up'],
  slide: ['Slide', 'Sliding'],
  wave: ['Wave', 'Waving'],
  talk: ['Talk', 'Talking'],
  laugh: ['Laugh', 'Laughing'],
  phone: ['Phone', 'Texting', 'Phone_Read'],
  hesitate: ['Hesitate', 'Look_Around'],
  fear: ['Fear', 'Scared'],
};

/** Our expression channels → common morph target names (ARKit, VRM, simple packs). */
const MORPH_ALIASES: Record<string, string[]> = {
  smile: ['mouthSmile', 'mouthSmileLeft', 'mouthSmileRight', 'Smile', 'happy', 'Fcl_MTH_Joy', 'Happy'],
  frown: ['mouthFrownLeft', 'mouthFrownRight', 'mouthFrown', 'Sad', 'sad', 'Fcl_MTH_Sorrow'],
  open: ['jawOpen', 'aa', 'Fcl_MTH_A'],
  browUp: ['browInnerUp', 'Surprised', 'surprised', 'Fcl_BRW_Surprised'],
  browDown: ['browDownLeft', 'browDownRight', 'Angry', 'angry', 'Fcl_BRW_Angry'],
  wide: ['eyeWideLeft', 'eyeWideRight', 'Fcl_EYE_Surprised'],
  blink: ['eyeBlinkLeft', 'eyeBlinkRight', 'blink', 'Fcl_EYE_Close', 'Blink'],
};

export interface GltfReport {
  url: string;
  bonesFound: JointName[];
  bonesMissing: JointName[];
  clips: string[];
  semanticClips: Record<string, string | null>;
  morphs: string[];
  morphsDriven: string[];
  skinnedMeshes: number;
  sourceHeight: number;
  scale: number;
}

/** What the gameplay controller tells the body each frame. */
export interface BodyDrive {
  speed: number;
  /** Seconds since caught, or -1. */
  stumbleTime: number;
  stumbleDuration: number;
  slide: number;
  laneVel: number;
  windLean: number;
  slope: number;
  arriving: boolean;
}

interface OneShot {
  key: string;
  t: number;
  dur: number;
  fadeIn: number;
  fadeOut: number;
}

/**
 * A rigged GLB character driven by THREE.AnimationMixer, usable as the
 * Visitor in actual gameplay:
 *
 *  - locomotion clips (idle / walk / run / sprint) cross-faded by real
 *    speed, with playback rate matched so feet don't skate
 *  - slide, stumble → recover, dodge and gestures as weighted overlays
 *  - leans (dodge, wind, slope) added procedurally on the holder, so they
 *    work on any rig regardless of its bone axes
 *  - expressions mapped onto whatever morph targets the model has
 *  - normalised to the game's character height, standing on y = 0
 *  - outfit layers by mesh name, for later costume changes
 *
 * Every clip runs continuously; its weight is decided here each frame, so
 * nothing snaps and nothing depends on the mixer's own fade state.
 */
export class GltfAvatar implements VisitorAvatar {
  /** The holder the game positions; the model is normalised inside it. */
  readonly object = new THREE.Group();
  readonly mixer: THREE.AnimationMixer;
  readonly report: GltfReport;
  private model = new THREE.Group();
  private lean = new THREE.Group();
  private bones = new Map<JointName, THREE.Bone>();
  private actions = new Map<string, THREE.AnimationAction>();
  private loco: Array<[string, number]> = [];
  private morphMeshes: THREE.Mesh[] = [];
  private meshes: THREE.Mesh[] = [];
  private shots: OneShot[] = [];
  private refSpeed: Record<string, number>;
  private wasStumbling = false;
  private recoverQueued = false;
  private leanRoll = 0;
  private leanYaw = 0;
  private headTmp = new THREE.Vector3();

  private constructor(root: THREE.Object3D, clips: THREE.AnimationClip[], entry: AssetEntry, targetHeight: number) {
    this.object.add(this.lean);
    this.lean.add(this.model);
    this.model.add(root);
    this.mixer = new THREE.AnimationMixer(root);
    let skinned = 0;
    const morphs = new Set<string>();
    const named = new Map<string, THREE.Bone>();
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) named.set(o.name, o as THREE.Bone);
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = m.receiveShadow = true;
        m.frustumCulled = false;
        this.meshes.push(m);
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
    // Clips: manifest overrides first, then the common aliases.
    const semantic: Record<string, string | null> = {};
    for (const [key, aliases] of Object.entries(CLIP_ALIASES)) {
      const want = entry.clips?.[key];
      const clip = (want ? clips.find((c) => c.name === want) : undefined) ?? clips.find((c) => aliases.includes(c.name));
      semantic[key] = clip?.name ?? null;
      if (!clip) continue;
      // Several semantic keys may share a clip; they share its action too.
      const a = this.mixer.clipAction(clip);
      if (!a.isRunning()) {
        a.play();
        a.setEffectiveWeight(0);
      }
      this.actions.set(key, a);
    }
    this.refSpeed = { idle: 0, walk: 1.5, run: 5.2, sprint: 10, ...(entry.clipSpeeds ?? {}) };
    for (const k of ['idle', 'walk', 'run', 'sprint']) if (this.actions.has(k)) this.loco.push([k, this.refSpeed[k]]);
    this.actions.get('idle')?.setEffectiveWeight(1);

    // Normalise: bind-pose height → the game's character height, feet on the ground.
    this.mixer.update(0);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const m of this.meshes) box.expandByObject(m);
    const h = Math.max(0.01, box.max.y - box.min.y);
    const scale = targetHeight / h;
    this.model.scale.setScalar(scale);
    this.model.position.y = -box.min.y * scale;
    const driven = [...morphs].filter((m) => Object.values(MORPH_ALIASES).some((a) => a.includes(m)));
    this.report = {
      url: entry.url,
      bonesFound: found,
      bonesMissing: missing,
      clips: clips.map((c) => c.name),
      semanticClips: semantic,
      morphs: [...morphs],
      morphsDriven: driven,
      skinnedMeshes: skinned,
      sourceHeight: h,
      scale,
    };
  }

  static async load(entry: AssetEntry, targetHeight: number, base = ''): Promise<GltfAvatar> {
    const gltf = await new GLTFLoader().loadAsync(base + entry.url);
    return new GltfAvatar(gltf.scene, gltf.animations, entry, targetHeight);
  }

  has(clip: string): boolean {
    return this.actions.has(clip);
  }

  /** One-shot gesture or reaction by semantic name. Returns false if the model lacks it. */
  play(key: string, fadeIn = 0.2, fadeOut = 0.35): boolean {
    const a = this.actions.get(key);
    if (!a) return false;
    // A stumble owns the body; gestures wait.
    if (key !== 'stumble' && key !== 'recover' && this.shots.some((s) => s.key === 'stumble')) return false;
    this.shots = this.shots.filter((s) => s.key !== key);
    a.time = 0;
    this.shots.push({ key, t: 0, dur: a.getClip().duration, fadeIn, fadeOut });
    return true;
  }

  /** Per-frame drive from the gameplay controller (or the prologue's walk). */
  drive(dt: number, d: BodyDrive): void {
    // --- Reactions from controller state ---
    const stumbling = d.stumbleTime >= 0 && d.stumbleTime < d.stumbleDuration;
    if (stumbling && !this.wasStumbling) {
      this.play('stumble', 0.06, 0.3);
      this.recoverQueued = true;
    }
    if (this.recoverQueued && d.stumbleTime > d.stumbleDuration * 0.45) {
      this.recoverQueued = false;
      this.play('recover', 0.2, 0.4);
    }
    this.wasStumbling = stumbling;

    // Weights accumulate per action (keys can share one) and are applied once, below.
    const weight = new Map<THREE.AnimationAction, number>();
    for (const a of this.actions.values()) weight.set(a, 0);
    const add = (a: THREE.AnimationAction | undefined, w: number) => a && weight.set(a, Math.max(weight.get(a) ?? 0, w));

    // --- One-shot overlays (the strongest one wins the body) ---
    let overlay = 0;
    for (const s of this.shots) {
      s.t += dt;
      const w = Math.min(1, s.t / s.fadeIn) * Math.min(1, Math.max(0, (s.dur - s.t) / s.fadeOut));
      add(this.actions.get(s.key), w);
      overlay = Math.max(overlay, w);
    }
    this.shots = this.shots.filter((s) => s.t < s.dur);

    // --- Slide: a held pose clip over locomotion ---
    const slideA = this.actions.get('slide');
    const slide = slideA ? d.slide : 0;
    add(slideA, slide * (1 - overlay));

    // --- Locomotion ladder ---
    const base = (1 - overlay) * (1 - slide);
    if (this.loco.length) {
      const sp = d.arriving ? Math.min(d.speed, 1.5) : d.speed;
      let lo = this.loco[0];
      let hi = this.loco[this.loco.length - 1];
      for (let i = 0; i < this.loco.length - 1; i++) {
        if (sp >= this.loco[i][1] && sp <= this.loco[i + 1][1]) {
          lo = this.loco[i];
          hi = this.loco[i + 1];
        }
      }
      if (sp > hi[1]) lo = hi;
      const span = Math.max(0.001, hi[1] - lo[1]);
      const t = lo === hi ? 1 : Math.min(1, Math.max(0, (sp - lo[1]) / span));
      for (const [k, v] of this.loco) {
        const a = this.actions.get(k)!;
        const w = k === lo[0] && k === hi[0] ? 1 : k === lo[0] ? 1 - t : k === hi[0] ? t : 0;
        add(a, w * base);
        // Playback rate follows real speed so the stride matches the ground.
        if (v > 0) a.setEffectiveTimeScale(Math.min(2.4, Math.max(0.35, sp / v)));
      }
    }

    // --- Procedural leans on the holder (rig-agnostic) ---
    const dodge = Math.max(-0.35, Math.min(0.35, d.laneVel * 0.05));
    this.leanRoll += (dodge - d.windLean * 0.22 - this.leanRoll) * Math.min(1, dt * 10);
    this.leanYaw += (-dodge * 0.8 - this.leanYaw) * Math.min(1, dt * 8);
    this.lean.rotation.set(Math.atan(Math.max(-0.4, Math.min(0.4, d.slope))) * 0.5, this.leanYaw, this.leanRoll);
    for (const [a, w] of weight) a.setEffectiveWeight(w);
    this.mixer.update(dt);
  }

  // ------------------------------------------------------------ VisitorAvatar

  applyPose(_pose: Pose): void {
    // Clips own the skeleton; leans come from drive().
  }

  updateSecondary(_dt: number, _m: SecondaryMotion): void {
    // drive() advances the mixer.
  }

  setFace(f: FaceState, blink: number): void {
    const channels: Record<string, number> = {
      smile: f.smile,
      frown: f.frown,
      open: f.open,
      browUp: f.browInnerUp + f.browOuterUp * 0.5,
      browDown: f.browDown + f.browKnit * 0.4,
      wide: Math.max(0, f.lidUp),
      blink,
    };
    for (const m of this.morphMeshes) {
      const dict = m.morphTargetDictionary!;
      const inf = m.morphTargetInfluences!;
      inf.fill(0);
      for (const [ch, v] of Object.entries(channels)) {
        for (const alias of MORPH_ALIASES[ch]) {
          const i = dict[alias];
          if (i !== undefined) inf[i] = Math.max(inf[i], Math.min(1, Math.max(0, v)));
        }
      }
    }
  }

  getAnkleWorld(side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3 {
    const b = this.bones.get(side === 'L' ? 'ankleL' : 'ankleR');
    return b ? b.getWorldPosition(out) : this.object.getWorldPosition(out);
  }

  setPhoneGlow(_v: number): void {
    // The phone prop belongs to the Visitor, not the model.
  }

  /** Approximate eye position: a little above and in front of the head bone. */
  getEyesWorld(out: THREE.Vector3): THREE.Vector3 {
    const head = this.bones.get('head');
    if (!head) return this.object.getWorldPosition(out).add(new THREE.Vector3(0, 1.6, 0));
    head.getWorldPosition(out);
    const s = this.report.scale * (this.report.sourceHeight / 1.7);
    this.headTmp.set(0, 0.08 * s, 0.09 * s).applyQuaternion(this.object.getWorldQuaternion(new THREE.Quaternion()));
    return out.add(this.headTmp);
  }

  getHandWorld(side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3 | null {
    const b = this.bones.get(side === 'L' ? 'wristL' : 'wristR');
    return b ? b.getWorldPosition(out) : null;
  }

  /**
   * Outfit layers: show only meshes whose names match one of the given
   * prefixes (meshes matching none of `all` are always shown — the body).
   */
  setOutfitLayers(show: string[], all: string[]): void {
    for (const m of this.meshes) {
      const layer = all.find((p) => m.name.startsWith(p));
      m.visible = !layer || show.includes(layer);
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.object.removeFromParent();
  }
}
