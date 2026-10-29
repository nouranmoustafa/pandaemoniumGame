import * as THREE from 'three';
import { clamp, damp, noise1, smoothstep } from '../core/math';
import { Vine } from '../world/Vine';
import type { GeneratedCharacter } from './GeneratedCharacter';
import { faceUV } from './geo/head';
import type { BoneName } from './rig/CharacterRig';

/**
 * How far each part of her has gone wrong (0 = herself). The script moves
 * these on its own clock; nothing here animates on its own except the
 * deliberate ticks and the breath.
 */
export interface CorruptionParams {
  /** Head lifted away from the shoulders on a lengthening neck. */
  neck: number;
  /** The smile past the face's limits (morph overdrive). */
  smile: number;
  /** The jaw opening further than a jaw opens. */
  jaw: number;
  /** Eyes sinking into black. */
  eyes: number;
  /** Fingers lengthening. */
  fingers: number;
  /** Arms lengthening and thinning to bone. */
  arms: number;
  /** Legs lengthening: she rises, taller than she was. */
  legs: number;
  /** Upper body twisted away from the hips (radians-ish, signed). */
  twist: number;
  /** Head tilt (radians, signed). */
  tilt: number;
  /** Head turned past where a neck can turn it (radians, signed). */
  headTurn: number;
  /** Puppet: left shoulder rotated up and over, out of its socket. */
  shoulderBreak: number;
  /** Puppet: right elbow bending the wrong way. */
  elbowBreak: number;
  /** Spine arched backward. */
  arch: number;
  /** Folded forward at the hips. */
  fold: number;
  /** 0..1 — the head holds its forward facing whatever the body does. */
  faceLock: number;
  /** A second pair of eyes opening above the first. */
  secondEyes: number;
  /** The face lengthening downward. */
  longFace: number;
  /** A second face at the back of the head. */
  secondFace: number;
  /** Shadow-like limbs out of her back. */
  limbs: number;
  /** Skin draining of colour. */
  pallor: number;
  /** Deliberate small ticks and a slow, wrong sway. */
  menace: number;
  /** Shadow-only features (seen only in what she casts on the path). */
  shadowForm: number;
  /** Lift above the ground (the third friend stops walking and simply moves). */
  float: number;
}

const ZERO: CorruptionParams = {
  neck: 0,
  smile: 0,
  jaw: 0,
  eyes: 0,
  fingers: 0,
  arms: 0,
  legs: 0,
  twist: 0,
  tilt: 0,
  headTurn: 0,
  shoulderBreak: 0,
  elbowBreak: 0,
  arch: 0,
  fold: 0,
  faceLock: 0,
  secondEyes: 0,
  longFace: 0,
  secondFace: 0,
  limbs: 0,
  pallor: 0,
  menace: 0,
  shadowForm: 0,
  float: 0,
};

const SIDES = ['L', 'R'] as const;
const FINGER_ROOTS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;

/** A shadow-only material: casts, never draws. */
function shadowOnly(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
}

/**
 * The second face: pale, eyeless pits, a mouth that runs too far round.
 * Painted in the head's own UV layout so it sits on the same skull mesh.
 */
function secondFaceTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const px = (x: number, y: number): [number, number] => {
    const z = Math.sqrt(Math.max(0.02, 1 - x * x - y * y));
    const [u, v] = faceUV(x, y, z);
    return [u * S, (1 - v) * S];
  };
  g.fillStyle = '#b7b2ab';
  g.fillRect(0, 0, S, S);
  // Mottling and faint veins.
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(80,70,90,${Math.random() * 0.06})`;
    g.beginPath();
    g.arc(Math.random() * S, Math.random() * S, 4 + Math.random() * 18, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(70,60,95,0.25)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 18; i++) {
    let [x, y] = px((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2);
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (Math.random() - 0.5) * 30;
      y += (Math.random() - 0.3) * 26;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // Eye pits: deep and too far apart, one lower than the other.
  const pit = (x: number, y: number, rx: number, ry: number) => {
    const [cx, cy] = px(x, y);
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rx);
    gr.addColorStop(0, 'rgba(0,0,0,1)');
    gr.addColorStop(0.6, 'rgba(8,4,8,0.95)');
    gr.addColorStop(1, 'rgba(40,30,40,0)');
    g.fillStyle = gr;
    g.save();
    g.translate(cx, cy);
    g.scale(1, ry / rx);
    g.translate(-cx, -cy);
    g.beginPath();
    g.arc(cx, cy, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  pit(-0.42, 0.06, 34, 46);
  pit(0.4, -0.04, 30, 52);
  // Nose: two slits.
  for (const x of [-0.05, 0.05]) {
    const [cx, cy] = px(x, -0.2);
    g.fillStyle = 'rgba(10,5,8,0.85)';
    g.fillRect(cx - 2, cy - 6, 4, 12);
  }
  // The mouth: a thin black seam from ear to ear, dropping at one end.
  g.strokeStyle = 'rgba(6,2,4,0.95)';
  g.lineWidth = 7;
  g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const f = i / 40;
    const x = -0.85 + f * 1.7;
    const y = -0.42 - Math.sin(f * Math.PI) * 0.06 - smoothstep(0.6, 1, f) * 0.18;
    const [cx, cy] = px(x, y);
    if (i === 0) g.moveTo(cx, cy);
    else g.lineTo(cx, cy);
  }
  g.stroke();
  // Teeth: small pale ticks along it.
  g.strokeStyle = 'rgba(220,214,200,0.7)';
  g.lineWidth = 2;
  for (let i = 4; i < 37; i += 2) {
    const f = i / 40;
    const x = -0.85 + f * 1.7;
    const y = -0.42 - Math.sin(f * Math.PI) * 0.06 - smoothstep(0.6, 1, f) * 0.18;
    const [cx, cy] = px(x, y);
    g.beginPath();
    g.moveTo(cx, cy - 5);
    g.lineTo(cx, cy + 5);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Stage 5: what the friends really are, worked into their own bodies.
 *
 * Every change is made on the character's own skeleton and head after the
 * performer has posed her for the frame — bones lengthened (positions) and
 * thinned (scales), joints turned past their limits, the head's morph
 * targets driven beyond 1, the eyes darkened — so her hair, clothes and
 * face stay hers while they stretch. The few added parts (a second pair of
 * eyes, a second face, shadow limbs, shadow-only horns and arms) grow out
 * of bones she already has.
 *
 * reset() puts every bone, scale and material back exactly, so a replay
 * starts from the ordinary woman again.
 */
export class Corruption {
  readonly p: CorruptionParams = { ...ZERO };
  private basePos = new Map<BoneName, THREE.Vector3>();
  private touched: BoneName[] = ['head', 'neck', 'hips', 'spine', 'chest', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'thighL', 'thighR', 'kneeL', 'kneeR', 'ankleL', 'ankleR'];
  private fingerBones: BoneName[] = [];
  private eyeMat: THREE.MeshPhysicalMaterial;
  private eyeColor: THREE.Color;
  private skinMat: THREE.MeshPhysicalMaterial | null;
  private skinColor = new THREE.Color();
  private headMat: THREE.MeshPhysicalMaterial;
  private headColor = new THREE.Color();
  private headBase = new THREE.Vector3();
  private eyeGroupBase: THREE.Vector3[];
  private extraEyes: THREE.Mesh[] = [];
  private face2: THREE.Mesh | null = null;
  private shadowParts: THREE.Mesh[] = [];
  readonly limbs: Vine[] = [];
  private limbLocal: THREE.Vector3[][] = [];
  private time = 0;
  private tick = { t: 3, yaw: 0, roll: 0, target: { yaw: 0, roll: 0 } };
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  private R: number;

  constructor(
    readonly char: GeneratedCharacter,
    readonly kind: 'smile' | 'puppet' | 'twoFace',
    worldParent: THREE.Object3D,
  ) {
    const rig = char.rig;
    for (const n of this.touched) this.basePos.set(n, rig.bone(n).position.clone());
    for (const s of SIDES) for (const f of FINGER_ROOTS) this.fingerBones.push(`${f}1${s}` as BoneName);
    this.R = rig.m.headR;
    this.eyeMat = char.head.eyes[0].material as THREE.MeshPhysicalMaterial;
    this.eyeColor = this.eyeMat.color.clone();
    this.skinMat = (char.materials.get('skin') as THREE.MeshPhysicalMaterial | undefined) ?? null;
    if (this.skinMat) this.skinColor.copy(this.skinMat.color);
    this.headMat = char.head.head.material as THREE.MeshPhysicalMaterial;
    this.headColor.copy(this.headMat.color);
    this.headBase.copy(char.head.head.position);
    this.eyeGroupBase = char.head.eyeGroup.map((g) => g.position.clone());
    const R = this.R;
    const head = char.head.head;

    if (kind === 'puppet') {
      // The drawing on the glass showed her with four eyes.
      const wet = new THREE.MeshPhysicalMaterial({ color: 0x020102, roughness: 0.08, clearcoat: 1 });
      for (const g of char.head.eyeGroup) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(R * 0.11, 14, 10), wet);
        eye.position.copy(g.position).add(new THREE.Vector3(g.position.x * 0.18, R * 0.4, -R * 0.06));
        eye.scale.set(1.25, 0.7, 0.5);
        eye.visible = false;
        head.add(eye);
        this.extraEyes.push(eye);
      }
      // Shadow-only: three more arms.
      for (let k = 0; k < 3; k++) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.035, 0.95, 5).translate(0, -0.47, 0), shadowOnly());
        arm.castShadow = true;
        arm.visible = false;
        arm.position.set((k - 1) * 0.08, 0.12, -0.05);
        arm.rotation.set(0.4, 0, (k - 1) * 0.9 + (k === 1 ? 2.6 : 0));
        rig.bone('chest').add(arm);
        this.shadowParts.push(arm);
      }
    }
    if (kind === 'smile') {
      // Shadow-only: a skull that runs up into two horns.
      for (const side of [1, -1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(R * 0.28, R * 2.6, 6).translate(0, R * 1.3, 0), shadowOnly());
        horn.castShadow = true;
        horn.visible = false;
        horn.position.set(side * R * 0.45, R * 1.9, 0);
        horn.rotation.set(-0.35, 0, -side * 0.42);
        rig.bone('head').add(horn);
        this.shadowParts.push(horn);
      }
    }
    if (kind === 'twoFace') {
      const mat = new THREE.MeshPhysicalMaterial({ map: secondFaceTexture(), roughness: 0.5, sheen: 0.2, sheenColor: new THREE.Color(0x9a90a0) });
      const face2 = new THREE.Mesh(head.geometry, mat);
      face2.morphTargetInfluences = head.morphTargetInfluences!.map(() => 0);
      face2.morphTargetDictionary = head.morphTargetDictionary;
      face2.rotation.y = Math.PI;
      face2.visible = false;
      face2.castShadow = true;
      rig.bone('head').add(face2);
      this.face2 = face2;
      // Shadow limbs: long, jointed, out of the shoulder blades — two a side, unequal.
      const black = new THREE.MeshStandardMaterial({ color: 0x1a1622, roughness: 0.28, metalness: 0.2, emissive: 0x08060c });
      const H = rig.p.height;
      const specs: Array<[number, number, number, number]> = [
        // side, rise, reach, droop
        [1, 0.55, 0.95, 0.3],
        [1, 0.15, 1.2, 0.95],
        [-1, 0.75, 0.8, 0.15],
        [-1, 0.25, 1.35, 1.1],
      ];
      for (const [side, rise, reach, droop] of specs) {
        const vine = new Vine(black, 0.03, 36, 6, 0);
        worldParent.add(vine.mesh);
        this.limbs.push(vine);
        // Chest-bone local: out of the back, up, out, then down like a long finger.
        this.limbLocal.push([
          new THREE.Vector3(side * 0.06 * H, 0.05 * H, -0.07 * H),
          new THREE.Vector3(side * 0.18 * H, (0.1 + rise * 0.15) * H, -0.16 * H),
          new THREE.Vector3(side * (0.18 + reach * 0.25) * H, (0.14 + rise * 0.25) * H, -0.14 * H),
          new THREE.Vector3(side * (0.22 + reach * 0.38) * H, (0.05 + rise * 0.2 - droop * 0.3) * H, 0.02 * H),
          new THREE.Vector3(side * (0.24 + reach * 0.42) * H, (-0.08 - droop * 0.38) * H, 0.1 * H),
        ]);
      }
    }
  }

  get active(): boolean {
    return Object.values(this.p).some((v) => v !== 0);
  }

  /** Everything back as it was: bones, scales, materials, added parts hidden. */
  reset(): void {
    Object.assign(this.p, ZERO);
    const rig = this.char.rig;
    for (const [n, pos] of this.basePos) {
      const b = rig.bone(n);
      b.position.copy(pos);
      b.scale.set(1, 1, 1);
    }
    for (const n of this.fingerBones) rig.bone(n).scale.set(1, 1, 1);
    this.eyeMat.color.copy(this.eyeColor);
    if (this.skinMat) this.skinMat.color.copy(this.skinColor);
    this.headMat.color.copy(this.headColor);
    this.char.head.head.position.copy(this.headBase);
    this.char.head.head.scale.set(1, 1, 1);
    this.char.head.eyeGroup.forEach((g, i) => g.position.copy(this.eyeGroupBase[i]));
    for (const e of this.extraEyes) e.visible = false;
    if (this.face2) this.face2.visible = false;
    for (const s of this.shadowParts) s.visible = false;
    for (const l of this.limbs) {
      l.extent = 0;
      l.update();
    }
    this.tick = { t: 3, yaw: 0, roll: 0, target: { yaw: 0, roll: 0 } };
    this.time = 0;
  }

  /** Apply after the performer has posed her for the frame. */
  apply(dt: number): void {
    this.time += dt;
    const p = this.p;
    const rig = this.char.rig;
    const H = rig.p.height;
    const R = this.R;
    const bone = (n: BoneName) => rig.bone(n);
    const base = (n: BoneName) => this.basePos.get(n)!;

    // --- Lengths: the neck, the arms, the legs ---
    bone('neck').position.copy(base('neck')).add(this.v.set(0, p.neck * 0.05 * H, 0));
    bone('head').position.copy(base('head')).add(this.v.set(0, p.neck * 0.2 * H, p.neck * 0.02 * H));
    // A bone's scale carries down the limb: the upper arm's length stretches the forearm
    // too, and the hand takes it back so only the fingers (on their own) grow.
    const armLen = 1 + p.arms * 0.6;
    const armThin = 1 - p.arms * 0.42;
    for (const s of SIDES) {
      bone(`shoulder${s}`).scale.set(armThin, armLen, armThin);
      bone(`wrist${s}`).scale.set(1, 1 / armLen, 1);
    }
    const fingerLen = 1 + p.fingers * 1.9;
    for (const n of this.fingerBones) bone(n).scale.set(1 - p.fingers * 0.3, fingerLen, 1 - p.fingers * 0.3);
    const legLen = 1 + p.legs * 0.3;
    for (const s of SIDES) {
      bone(`thigh${s}`).scale.set(1 - p.legs * 0.18, legLen, 1 - p.legs * 0.18);
      bone(`ankle${s}`).scale.set(1, 1 / legLen, 1);
    }
    rig.root.position.y += (rig.m.thigh + rig.m.shin) * (legLen - 1) + p.float * 0.35;

    // --- Deliberate ticks: a sharp small turn, then held; never a spasm ---
    this.tick.t -= dt;
    if (p.menace > 0 && this.tick.t <= 0) {
      this.tick.t = 1.6 + ((Math.sin(this.time * 12.9898) * 43758.5453) % 1 + 1) % 1 * 2.2;
      this.tick.target.yaw = (Math.sin(this.time * 7.3) > 0 ? 1 : -1) * 0.12;
      this.tick.target.roll = Math.sin(this.time * 3.1) * 0.22;
    }
    this.tick.yaw = damp(this.tick.yaw, this.tick.target.yaw * p.menace, 22, dt);
    this.tick.roll = damp(this.tick.roll, this.tick.target.roll * p.menace, 18, dt);
    const sway = Math.sin(this.time * 0.9) * 0.05 * p.menace;

    // --- Postures past their limits ---
    const add = (n: BoneName, x: number, y: number, z: number) => {
      const b = bone(n);
      b.rotation.x += x;
      b.rotation.y += y;
      b.rotation.z += z;
    };
    add('hips', p.fold * 1.25, 0, sway);
    add('spine', -p.arch * 0.75, p.twist * 0.3, p.twist * 0.25);
    add('chest', -p.arch * 0.55 + p.fold * 0.2, p.twist * 0.8, 0);
    add('neck', -p.arch * 0.2, 0, p.tilt * 0.3);
    add('shoulderL', -p.shoulderBreak * 2.75, p.shoulderBreak * 0.6, p.shoulderBreak * 0.55);
    add('elbowL', -p.shoulderBreak * 0.4, 0, 0);
    add('shoulderR', p.elbowBreak * 0.5, 0, -p.elbowBreak * 0.25);
    add('elbowR', p.elbowBreak * 2.3, 0, 0);
    add('wristR', p.elbowBreak * 0.8, 0, 0);
    add('head', 0, p.headTurn + this.tick.yaw, p.tilt * 0.7 + this.tick.roll);

    // The face holds still while everything under it moves.
    if (p.faceLock > 0) {
      this.char.object.updateMatrixWorld(true);
      const head = bone('head');
      const parent = head.parent as THREE.Object3D;
      parent.getWorldQuaternion(this.q).invert();
      this.char.object.getWorldQuaternion(this.q2);
      this.e.set(0, p.headTurn + this.tick.yaw, p.tilt * 0.7 + this.tick.roll);
      const want = this.q2.multiply(new THREE.Quaternion().setFromEuler(this.e));
      const local = this.q.multiply(want);
      head.quaternion.slerp(local, clamp(p.faceLock, 0, 1));
    }

    // --- The face ---
    const head = this.char.head;
    const mi = head.head.morphTargetInfluences!;
    const mm = head.morph;
    mi[mm.smile] = Math.max(mi[mm.smile], p.smile * 2.3);
    mi[mm.jawOpen] = Math.max(mi[mm.jawOpen], p.jaw * 2.1);
    mi[mm.wide] = Math.max(mi[mm.wide], p.eyes * 1.4);
    mi[mm.browUp] = mi[mm.browUp] + p.smile * 0.5;
    this.eyeMat.color.copy(this.eyeColor).multiplyScalar(1 - p.eyes * 0.97);
    head.eyeGroup.forEach((g, i) => g.position.copy(this.eyeGroupBase[i]).add(this.v.set(0, 0, -p.eyes * 0.06 * R)));
    const longF = 1 + p.longFace * 0.4;
    head.head.scale.set(1 - p.longFace * 0.08, longF, 1);
    // Stretch downward from the crown, so the hair still fits the top of the skull.
    head.head.position.copy(this.headBase).add(this.v.set(0, -(longF - 1) * (rig.m.headCenter.y + R) * 0.9, 0));
    const pale = smoothstep(0, 1, p.pallor);
    this.headMat.color.copy(this.headColor).lerp(new THREE.Color(0.72, 0.74, 0.78), pale * 0.6);
    if (this.skinMat) this.skinMat.color.copy(this.skinColor).lerp(new THREE.Color(0.6, 0.6, 0.64), pale * 0.6);
    for (const e of this.extraEyes) {
      e.visible = p.secondEyes > 0.01;
      e.scale.set(1.25 * p.secondEyes, 0.7 * p.secondEyes, 0.5);
    }
    if (this.face2) {
      const k = p.secondFace;
      this.face2.visible = k > 0.01;
      // It pushes out through the back of her hair.
      this.face2.position.set(0, 0, -R * (0.42 - k * 0.34));
      this.face2.scale.setScalar(0.62 + k * 0.4);
      const m2 = this.face2.morphTargetInfluences!;
      m2[mm.smile] = 0.4 + k * 0.6;
      m2[mm.jawOpen] = k * 1.4 + Math.max(0, Math.sin(this.time * 1.7)) * 0.2 * k;
      m2[mm.wide] = 1;
    }
    for (const s of this.shadowParts) {
      s.visible = p.shadowForm > 0.01;
      s.scale.setScalar(Math.max(0.01, p.shadowForm));
    }

    // --- Shadow limbs, from her shoulder blades ---
    if (this.limbs.length) {
      this.char.object.updateMatrixWorld(true);
      this.m4.copy(bone('chest').matrixWorld);
      this.limbs.forEach((l, i) => {
        const pts = this.limbLocal[i].map((v, j) => {
          const w = v.clone();
          // Each joint breathes a little, out of step with the others.
          w.y += noise1(this.time * 0.6 + i * 3 + j, 50 + i) * 0.03 * H * j;
          return w.applyMatrix4(this.m4);
        });
        l.setPath(pts);
        l.extent = smoothstep(i * 0.12, 0.64 + i * 0.12, p.limbs);
        l.update(this.time);
      });
    }
  }
}
