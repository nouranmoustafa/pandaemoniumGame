import * as THREE from 'three';
import { clamp, spring } from '../core/math';
import type { SecondaryMotion, VisitorAvatar } from '../visitor/Avatar';
import type { Pose } from '../visitor/Pose';
import type { CharacterDesign, Garment, Outfit } from './design';
import { type FaceState, NEUTRAL } from './Expression';
import { BodyBuilder } from './geo/body';
import { buildHair, hairChains } from './geo/hair';
import { buildHead, type HeadParts } from './geo/head';
import { normalizeAttributes } from './geo/loft';
import { type BoneName, CharacterRig, type ChainSpec, type HandShape, RELAXED_HAND } from './rig/CharacterRig';
import { eyeTexture, fabric, FacePainter, hairTexture } from './textures';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Spring1 = { v: number; vel: number };
const sp = (): Spring1 => ({ v: 0, vel: 0 });

function clothMaterial(g: Garment, repeat = 5): THREE.MeshPhysicalMaterial {
  const t = fabric(g.fabric);
  const map = t.map.clone();
  const bump = t.bump.clone();
  for (const x of [map, bump]) {
    x.repeat.set(repeat, repeat * 0.8);
    x.needsUpdate = true;
  }
  const leather = g.fabric === 'leather';
  return new THREE.MeshPhysicalMaterial({
    color: g.color,
    map,
    bumpMap: bump,
    bumpScale: leather ? 0.6 : 1.2,
    roughness: g.roughness ?? (leather ? 0.38 : 0.85),
    clearcoat: leather ? 0.35 : 0,
    clearcoatRoughness: 0.4,
    sheen: g.sheen ?? (g.fabric === 'velvet' ? 1 : g.fabric === 'wool' || g.fabric === 'knit' ? 0.5 : 0),
    sheenColor: new THREE.Color(g.sheenColor ?? g.color).lerp(new THREE.Color(0xffffff), 0.35),
    sheenRoughness: 0.55,
  });
}

/**
 * An original, fully code-generated character: a real THREE.Skeleton with
 * SkinnedMesh body and clothing layers, a morph-targeted head with a
 * painted, expression-driven face, articulated fingers, and spring-driven
 * hair, scarf and coat bones.
 *
 * Identity (design) and clothing (outfit) are separate: setOutfit() rebuilds
 * only the garment layers on the same skeleton.
 */
export class GeneratedCharacter implements VisitorAvatar {
  readonly object = new THREE.Group();
  readonly model = new THREE.Group();
  readonly rig: CharacterRig;
  readonly head: HeadParts;
  readonly face: FacePainter;
  readonly phone: THREE.Group;
  phoneScreen!: THREE.Mesh;
  readonly faceState: FaceState = { ...NEUTRAL };
  /** Garment meshes of the current outfit (the body's skin, hands and neck included). */
  clothing: THREE.SkinnedMesh[] = [];
  /** Material per slot of the current outfit. */
  readonly materials = new Map<string, THREE.Material>();
  private skinMat: THREE.MeshPhysicalMaterial;
  private hairMat: THREE.MeshPhysicalMaterial;
  private headMat: THREE.MeshPhysicalMaterial;
  private chainSprings = new Map<BoneName, { x: Spring1; z: Spring1 }>();
  private coat = { back: sp(), l: sp(), r: sp(), side: sp() };
  private lastPose: Pose | null = null;
  private gaze = { yaw: 0, pitch: 0 };
  private time = Math.random() * 10;
  private invQ = new THREE.Quaternion();
  private localV = new THREE.Vector3();
  private localA = new THREE.Vector3();
  hands: { L: HandShape; R: HandShape } = { L: { ...RELAXED_HAND }, R: { ...RELAXED_HAND } };
  outfit: Outfit;

  constructor(
    readonly design: CharacterDesign,
    outfit: Outfit,
  ) {
    this.outfit = outfit;
    const p = design.proportions;
    const R = p.height * 0.064 * p.head;
    const center = new THREE.Vector3(0, R * 1.02, R * 0.12);
    const chains: ChainSpec[] = [...hairChains(design.hair.kind, R, center)];
    if (outfit.scarf) {
      chains.push({ prefix: 'scarf', parent: 'chest', origin: [0.035 * p.height, 0.095 * p.height, 0.06 * p.height], step: [0.004, -0.085, 0.006], count: 4 });
    }
    this.rig = new CharacterRig(p, chains);
    this.object.add(this.model);
    this.model.add(this.rig.root);

    this.skinMat = new THREE.MeshPhysicalMaterial({
      color: design.skin,
      roughness: 0.58,
      sheen: 0.25,
      sheenColor: new THREE.Color(0xff8a70),
      sheenRoughness: 0.7,
    });
    this.face = new FacePainter(design.makeup);
    this.headMat = new THREE.MeshPhysicalMaterial({
      map: this.face.texture,
      roughness: 0.56,
      sheen: 0.25,
      sheenColor: new THREE.Color(0xff8a70),
      sheenRoughness: 0.7,
    });
    const eyeMat = new THREE.MeshPhysicalMaterial({ map: eyeTexture(design.eye.iris, design.eye.dark), roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });
    const lidMat = new THREE.MeshPhysicalMaterial({ color: design.skin, vertexColors: true, roughness: 0.55, sheen: 0.3, sheenColor: new THREE.Color(0xff8a70) });
    this.head = buildHead(R, center, design.face, this.headMat, eyeMat, lidMat);
    this.rig.bone('head').add(this.head.head);

    // Hair.
    const ht = hairTexture(design.id.length * 13);
    ht.repeat.set(3, 1);
    this.hairMat = new THREE.MeshPhysicalMaterial({
      color: design.hair.color,
      map: ht,
      roughness: 0.64,
      sheen: 0.35,
      sheenColor: new THREE.Color(design.hair.sheen),
      sheenRoughness: 0.35,
      side: THREE.DoubleSide,
    });
    const hair = buildHair(design.hair.kind, this.rig, R, center).map(normalizeAttributes);
    this.addSkinned(mergeGeometries(hair, false)!, this.hairMat, 'hair');

    // Phone prop: rests in the right palm, screen toward the thumb side.
    this.phone = this.buildPhone();
    this.rig.bone('wristR').add(this.phone);
    this.phone.visible = false;

    this.buildClothing(outfit);
    for (const [, names] of this.rig.chains) for (const n of names) this.chainSprings.set(n, { x: sp(), z: sp() });
    this.object.scale.setScalar(design.scale);
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
      }
    });
    this.head.lidsUpper.concat(this.head.lidsLower).forEach((l) => (l.castShadow = false));
  }

  private buildPhone(): THREE.Group {
    const H = this.design.proportions.height;
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.006 * H * 1.4, 0.088 * H, 0.043 * H),
      new THREE.MeshPhysicalMaterial({ color: 0x0d0c10, roughness: 0.25, metalness: 0.6, clearcoat: 1 }),
    );
    g.add(body);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.04 * H, 0.084 * H),
      new THREE.MeshBasicMaterial({ color: 0x111111, toneMapped: false }),
    );
    // Screen faces +X (the thumb side of a palm-in right hand).
    screen.rotation.y = Math.PI / 2;
    screen.position.x = 0.0045 * H;
    g.add(screen);
    this.phoneScreen = screen;
    const r = this.rig;
    const wr = r.bindPos.get('wristR')!;
    const mid = r.bindPos.get('middle1R')!;
    // Held by its lower edge, out past the fingertips, so the hand never covers the screen.
    g.position.set(mid.x - wr.x + 0.022 * H, (mid.y - wr.y) * 1.4, mid.z - wr.z + 0.004 * H);
    return g;
  }

  /** Bind extra skinned geometry (built in bind pose) to this character's skeleton. */
  addSkinned(geo: THREE.BufferGeometry, mat: THREE.Material, slot: string): THREE.SkinnedMesh {
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.name = slot;
    this.model.add(mesh);
    mesh.bind(this.rig.skeleton, new THREE.Matrix4());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  private buildClothing(outfit: Outfit): void {
    // Geometry is built from the rig's bind positions and bound with an
    // identity bind matrix, so this works whatever pose she is in.
    const parts = new BodyBuilder(this.rig, outfit).build();
    const bySlot = new Map<string, THREE.BufferGeometry[]>();
    for (const part of parts) {
      const list = bySlot.get(part.slot) ?? [];
      list.push(normalizeAttributes(part.geo));
      bySlot.set(part.slot, list);
    }
    const mats = this.materialsFor(outfit);
    for (const [slot, geos] of bySlot) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mat = mats.get(slot) ?? this.skinMat;
      this.clothing.push(this.addSkinned(merged, mat, slot));
    }
  }

  private materialsFor(o: Outfit): Map<string, THREE.Material> {
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
    const m = this.materials;
    m.set('skin', this.skinMat);
    m.set('nails', new THREE.MeshPhysicalMaterial({ color: 0x3a1418, roughness: 0.2, clearcoat: 1 }));
    m.set('top', clothMaterial(o.top));
    m.set('collar', clothMaterial(o.top.collarGarment ?? o.top));
    if (o.under) m.set('under', clothMaterial(o.under, 7));
    if (o.skirt) m.set('skirt', clothMaterial(o.skirt));
    m.set('legs', clothMaterial(o.legs, 4));
    m.set('shoes', clothMaterial(o.shoes, 3));
    m.set('sole', new THREE.MeshStandardMaterial({ color: 0x0b0908, roughness: 0.7 }));
    m.set('belt', new THREE.MeshPhysicalMaterial({ color: o.top.belt ?? 0x120c0c, roughness: 0.4, clearcoat: 0.4 }));
    m.set('buttons', new THREE.MeshStandardMaterial({ color: o.top.buttons ?? 0x2a2622, roughness: 0.3, metalness: 0.8 }));
    if (o.scarf) m.set('scarf', clothMaterial(o.scarf, 6));
    const lining = new THREE.MeshStandardMaterial({ color: new THREE.Color(o.top.color).multiplyScalar(0.35), roughness: 0.9, side: THREE.DoubleSide });
    m.set('lining', lining);
    return m;
  }

  /** Change clothes, keeping face, hair, body and rig. */
  setOutfit(outfit: Outfit): void {
    for (const c of this.clothing) {
      c.geometry.dispose();
      c.removeFromParent();
    }
    this.clothing = [];
    this.outfit = outfit;
    this.buildClothing(outfit);
  }

  applyPose(pose: Pose): void {
    this.rig.applyPose(pose);
    const h = pose.hand;
    this.hands.L.curl = h[0];
    this.hands.L.spread = h[1];
    this.hands.L.thumb = h[2];
    this.hands.L.point = h[3];
    this.hands.R.curl = h[4];
    this.hands.R.spread = h[5];
    this.hands.R.thumb = h[6];
    this.hands.R.point = h[7];
    this.rig.applyHand('L', this.hands.L);
    this.rig.applyHand('R', this.hands.R);
    this.lastPose = pose;
  }

  /** Current eye direction (yaw, pitch) relative to the head. */
  get gazeAngles(): Readonly<{ yaw: number; pitch: number }> {
    return this.gaze;
  }

  setGaze(yaw: number, pitch: number): void {
    this.gaze.yaw = clamp(yaw, -0.55, 0.55);
    this.gaze.pitch = clamp(pitch, -0.4, 0.35);
  }

  /** Expression, lids, blink. Call once per frame after the performer decides. */
  updateFace(dt: number, f: FaceState, blink: number): void {
    Object.assign(this.faceState, f);
    this.face.update(dt, f);
    const mi = this.head.head.morphTargetInfluences!;
    const mm = this.head.morph;
    mi[mm.smile] = clamp(f.smile, 0, 1.2);
    mi[mm.frown] = clamp(f.frown, 0, 1);
    mi[mm.jawOpen] = clamp(f.open, 0, 1);
    mi[mm.browUp] = clamp(f.browInnerUp * 0.7 + f.browOuterUp * 0.3 - f.browDown * 0.5, -0.6, 1.2);
    mi[mm.browKnit] = clamp(f.browKnit + f.browDown * 0.4, 0, 1);
    mi[mm.wide] = clamp(f.wide, 0, 1);
    // Lids: the upper lid's edge elevation (radians above the eye's equator).
    const pitchFollow = this.gaze.pitch * 0.45;
    const upOpen = 0.22 + f.lidUp * 0.42 - f.squint * 0.12 + pitchFollow;
    const up = upOpen + (-0.32 - upOpen) * blink;
    const low = -0.52 + f.squint * 0.3 + pitchFollow * 0.4 + (Math.min(-0.3, up - 0.02) - (-0.52 + f.squint * 0.3)) * blink * 0.25;
    for (let i = 0; i < 2; i++) {
      this.head.lidsUpper[i].rotation.x = -up;
      this.head.lidsLower[i].rotation.x = -low;
      this.head.eyes[i].rotation.set(-this.gaze.pitch, this.gaze.yaw, 0);
    }
  }

  setPhoneScreen(mat: THREE.Material): void {
    this.phoneScreen.material = mat;
  }

  setPhoneGlow(v: number): void {
    const m = this.phoneScreen.material as THREE.MeshBasicMaterial;
    if (m.color) m.color.setScalar(0.25 + 0.75 * v);
  }

  /** Spring-driven hair, scarf and coat panels. */
  updateSecondary(dt: number, m: SecondaryMotion): void {
    dt = Math.min(dt, 1 / 30);
    this.time += dt;
    this.object.getWorldQuaternion(this.invQ).invert();
    const v = this.localV.copy(m.velocity).applyQuaternion(this.invQ);
    const a = this.localA.copy(m.accel).applyQuaternion(this.invQ);
    const fwd = v.z;
    const lateralA = a.x;
    const vertA = a.y;
    const fwdA = a.z;

    for (const [prefix, names] of this.rig.chains) {
      const scarf = prefix.startsWith('scarf');
      names.forEach((n, i) => {
        const s = this.chainSprings.get(n)!;
        const k = 0.4 + i * 0.25;
        const flutter = Math.sin(this.time * 9 + i * 1.7) * 0.05 * Math.min(1, Math.abs(fwd) / 6) + Math.sin(this.time * 1.3 + i) * 0.015 * (0.4 + m.wind);
        let tx = clamp(0.05 + fwd * 0.06 * k + m.wind * 0.45 + m.slide * 0.5 - vertA * 0.004 + fwdA * 0.012, -0.4, 1.4) / (i + 1);
        if (scarf) tx = clamp(tx * 0.35, -0.2, 0.3);
        [s.x.v, s.x.vel] = spring(s.x.v, s.x.vel, tx + flutter, 110 - i * 16, 7 - i * 0.8, dt);
        [s.z.v, s.z.vel] = spring(s.z.v, s.z.vel, clamp(-lateralA * 0.012 + (scarf ? flutter * 2 : 0), -0.6, 0.6), 85, 6, dt);
        const b = this.rig.bone(n);
        b.rotation.x = s.x.v;
        b.rotation.z = s.z.v;
      });
    }

    const pose = this.lastPose;
    const thighL = pose ? pose.rot[11 * 3] : 0;
    const thighR = pose ? pose.rot[14 * 3] : 0;
    const cs = this.coat;
    const bounce = -vertA * 0.0035;
    [cs.back.v, cs.back.vel] = spring(cs.back.v, cs.back.vel, clamp(0.02 + fwd * 0.04 + m.wind * 0.3 + bounce + m.slide * 0.5, -0.1, 0.95), 85, 6, dt);
    [cs.l.v, cs.l.vel] = spring(cs.l.v, cs.l.vel, Math.min(0.15, thighL * 0.4) + fwd * 0.012 + bounce, 140, 9, dt);
    [cs.r.v, cs.r.vel] = spring(cs.r.v, cs.r.vel, Math.min(0.15, thighR * 0.4) + fwd * 0.012 + bounce, 140, 9, dt);
    [cs.side.v, cs.side.vel] = spring(cs.side.v, cs.side.vel, clamp(lateralA * 0.006, -0.3, 0.3), 70, 5, dt);
    this.rig.bone('coatBack').rotation.set(cs.back.v, 0, cs.side.v);
    this.rig.bone('coatL').rotation.set(cs.l.v, 0, 0.02 + Math.max(0, cs.side.v) + m.slide * 0.5);
    this.rig.bone('coatR').rotation.set(cs.r.v, 0, -0.02 + Math.min(0, cs.side.v) - m.slide * 0.5);
  }

  /** VisitorAvatar: roots grab her ankles. */
  getAnkleWorld(side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3 {
    return this.rig.bone(side === 'L' ? 'ankleL' : 'ankleR').getWorldPosition(out);
  }

  /**
   * Prop constraint: turn the phone in her hand so its screen faces `target`
   * (her eyes, or a camera), blended by w. Call after the pose is applied.
   */
  aimPhone(target: THREE.Vector3, w: number): void {
    if (w <= 0 || !this.phone.visible) {
      this.phone.quaternion.identity();
      return;
    }
    const wrist = this.rig.bone('wristR');
    this.object.updateMatrixWorld(true);
    const pos = this.phone.getWorldPosition(new THREE.Vector3());
    // Screen normal is the phone's local +X; build a world rotation with X → target, Y → up.
    const x = target.clone().sub(pos).normalize();
    const z = new THREE.Vector3().crossVectors(x, new THREE.Vector3(0, 1, 0)).normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    // Tilt the top of the phone back a little, as it's naturally held.
    y.applyAxisAngle(z, -0.25);
    x.crossVectors(y, z).normalize();
    const world = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    const parent = wrist.getWorldQuaternion(new THREE.Quaternion()).invert();
    const local = parent.multiply(world);
    this.phone.quaternion.identity().slerp(local, Math.min(1, w));
  }

  getBoneWorld(name: BoneName, out: THREE.Vector3): THREE.Vector3 {
    return this.rig.bone(name).getWorldPosition(out);
  }

  /** World position of the eyes' midpoint (for cameras and look-at). */
  getEyesWorld(out: THREE.Vector3): THREE.Vector3 {
    const a = this.head.eyeGroup[0].getWorldPosition(new THREE.Vector3());
    const b = this.head.eyeGroup[1].getWorldPosition(new THREE.Vector3());
    return out.addVectors(a, b).multiplyScalar(0.5);
  }

  setCastShadow(v: boolean): void {
    this.object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = v;
    });
    this.head.lidsUpper.concat(this.head.lidsLower).forEach((l) => (l.castShadow = false));
  }
}
