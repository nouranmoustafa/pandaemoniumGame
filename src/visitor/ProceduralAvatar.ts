import * as THREE from 'three';
import { clamp, spring } from '../core/math';
import type { SecondaryMotion, VisitorAvatar } from './Avatar';
import { JOINTS, type JointName, Pose } from './Pose';

/**
 * The Visitor, built from primitives into a jointed hierarchy.
 *
 * This is an honest stand-in for a rigged character: rigid limbs on a
 * skeleton, with spring-driven secondary motion for the ponytail, scarf and
 * coat panels. It is NOT skinned and NOT a cloth simulation. When a rigged
 * GLTF arrives, write a GltfAvatar that implements VisitorAvatar.
 */

type Spring1 = { v: number; vel: number };
const sp = (): Spring1 => ({ v: 0, vel: 0 });

/** Capsule whose top sphere is centred on the pivot and which extends down -Y by `length`. */
function limb(radius: number, length: number, mat: THREE.Material): THREE.Mesh {
  const g = new THREE.CapsuleGeometry(radius, length, 6, 12);
  g.translate(0, -length / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

function lathePanel(points: Array<[number, number]>, phiStart: number, phiLength: number, mat: THREE.Material): THREE.Mesh {
  const g = new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    18,
    phiStart,
    phiLength,
  );
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

export class ProceduralAvatar implements VisitorAvatar {
  readonly object = new THREE.Group();
  private model = new THREE.Group();
  private joints = {} as Record<JointName, THREE.Group>;
  private lastPose = new Pose();

  private ponytail: THREE.Group[] = [];
  private ponySprings: Spring1[] = [];
  private ponySide: Spring1[] = [];
  private scarfTail: THREE.Group[] = [];
  private scarfSprings: Spring1[] = [];
  private coatBack = new THREE.Group();
  private coatL = new THREE.Group();
  private coatR = new THREE.Group();
  private coatSprings = { back: sp(), l: sp(), r: sp(), side: sp() };
  private phoneScreen: THREE.MeshStandardMaterial;

  constructor() {
    this.object.add(this.model);
    this.object.scale.setScalar(1.14);

    const skin = new THREE.MeshStandardMaterial({ color: 0xe8d4cb, roughness: 0.55 });
    const coat = new THREE.MeshPhysicalMaterial({
      color: 0x6e1422,
      roughness: 0.72,
      sheen: 0.8,
      sheenColor: new THREE.Color(0xff6a7a),
      sheenRoughness: 0.5,
      side: THREE.DoubleSide,
    });
    const lining = new THREE.MeshStandardMaterial({ color: 0x23060c, roughness: 0.8, side: THREE.DoubleSide });
    const tights = new THREE.MeshStandardMaterial({ color: 0x17121b, roughness: 0.6 });
    const boots = new THREE.MeshStandardMaterial({ color: 0x1e140f, roughness: 0.32, metalness: 0.1 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x0e0a0d, roughness: 0.42 });
    const scarf = new THREE.MeshStandardMaterial({ color: 0xd9cdb4, roughness: 0.9 });
    const eyes = new THREE.MeshStandardMaterial({ color: 0x050306, roughness: 0.15 });
    const lips = new THREE.MeshStandardMaterial({ color: 0x7a1020, roughness: 0.4 });

    const J = (name: JointName, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const g = new THREE.Group();
      g.name = name;
      g.position.set(x, y, z);
      parent.add(g);
      this.joints[name] = g;
      return g;
    };

    // Skeleton.
    const hips = J('hips', this.model, 0, 0.92, 0);
    const spine = J('spine', hips, 0, 0.06, 0);
    const chest = J('chest', spine, 0, 0.2, 0);
    const neck = J('neck', chest, 0, 0.21, -0.01);
    const head = J('head', neck, 0, 0.08, 0.01);
    const shL = J('shoulderL', chest, 0.165, 0.15, -0.01);
    const elL = J('elbowL', shL, 0, -0.27, 0);
    const wrL = J('wristL', elL, 0, -0.24, 0);
    const shR = J('shoulderR', chest, -0.165, 0.15, -0.01);
    const elR = J('elbowR', shR, 0, -0.27, 0);
    const wrR = J('wristR', elR, 0, -0.24, 0);
    const thL = J('thighL', hips, 0.085, -0.03, 0);
    const knL = J('kneeL', thL, 0, -0.42, 0);
    const anL = J('ankleL', knL, 0, -0.41, 0);
    const thR = J('thighR', hips, -0.085, -0.03, 0);
    const knR = J('kneeR', thR, 0, -0.42, 0);
    const anR = J('ankleR', knR, 0, -0.41, 0);

    // Pelvis.
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), tights);
    pelvis.scale.set(1.05, 0.75, 0.8);
    pelvis.castShadow = true;
    hips.add(pelvis);

    // Torso: fitted coat bodice.
    const bodice = lathePanel(
      [
        [0.0, -0.06],
        [0.125, -0.06],
        [0.13, 0.04],
        [0.142, 0.16],
        [0.162, 0.3],
        [0.158, 0.37],
        [0.115, 0.43],
        [0.05, 0.455],
        [0.0, 0.455],
      ],
      0,
      Math.PI * 2,
      coat,
    );
    bodice.scale.z = 0.7;
    spine.add(bodice);
    // Coat buttons + belt.
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.014, 6, 24), lining);
    belt.rotation.x = Math.PI / 2;
    belt.scale.y = 0.7;
    belt.position.y = 0.02;
    spine.add(belt);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 4), lining);
      b.position.set(0, 0.1 + i * 0.09, 0.1 + i * 0.006);
      spine.add(b);
    }

    // Coat skirt: three hanging panels so the legs can move through the open front.
    const skirtPts: Array<[number, number]> = [
      [0.13, 0.0],
      [0.155, -0.1],
      [0.2, -0.26],
      [0.25, -0.42],
      [0.27, -0.47],
    ];
    for (const [pivot, start, len] of [
      [this.coatBack, Math.PI - 1.25, 2.5],
      [this.coatL, 0.35, 1.6],
      [this.coatR, -0.35 - 1.6, 1.6],
    ] as const) {
      pivot.position.y = 0.03;
      hips.add(pivot);
      pivot.add(lathePanel(skirtPts, start, len, coat));
      const inner = lathePanel(
        skirtPts.map(([r, y]) => [r - 0.008, y] as [number, number]),
        start,
        len,
        lining,
      );
      pivot.add(inner);
    }
    this.coatBack.scale.z = 0.85;

    // Legs.
    thL.add(limb(0.07, 0.4, tights));
    thR.add(limb(0.07, 0.4, tights));
    knL.add(limb(0.052, 0.2, tights));
    knR.add(limb(0.052, 0.2, tights));
    for (const kn of [knL, knR]) {
      const boot = limb(0.06, 0.22, boots);
      boot.position.y = -0.18;
      kn.add(boot);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.012, 6, 16), boots);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = -0.18;
      kn.add(cuff);
    }
    for (const an of [anL, anR]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.23, 2, 1, 3), boots);
      // Round the toe a little.
      const p = foot.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i);
        if (z > 0.05) p.setX(i, p.getX(i) * 0.75);
        if (z > 0.05 && p.getY(i) > 0) p.setY(i, p.getY(i) * 0.5);
      }
      foot.geometry.computeVertexNormals();
      foot.position.set(0, -0.025, 0.055);
      foot.castShadow = true;
      an.add(foot);
      const heel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), boots);
      heel.position.set(0, -0.065, -0.035);
      an.add(heel);
    }

    // Arms.
    for (const [sh, el, wr, side] of [
      [shL, elL, wrL, 1],
      [shR, elR, wrR, -1],
    ] as const) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.066, 12, 8), coat);
      puff.scale.set(1, 0.9, 0.95);
      puff.castShadow = true;
      sh.add(puff);
      sh.add(limb(0.053, 0.26, coat));
      el.add(limb(0.045, 0.22, coat));
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.013, 6, 14), scarf);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = -0.21;
      el.add(cuff);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), skin);
      hand.scale.set(0.75, 1.25, 0.5);
      hand.position.set(0, -0.045, 0.004);
      hand.castShadow = true;
      wr.add(hand);
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.03, 3, 6), skin);
      thumb.position.set(side * -0.02, -0.03, 0.025);
      thumb.rotation.x = 0.6;
      wr.add(thumb);
    }

    // Phone in her right hand — the dating app, still open.
    const phone = new THREE.Group();
    phone.position.set(-0.005, -0.075, 0.03);
    phone.rotation.set(-0.3, 0, 0);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.135, 0.01), new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 0.3 }));
    phone.add(body);
    this.phoneScreen = new THREE.MeshStandardMaterial({ color: 0x220812, emissive: 0xff4f86, emissiveIntensity: 2.2 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.058, 0.12), this.phoneScreen);
    screen.position.z = 0.0056;
    phone.add(screen);
    wrR.add(phone);

    // Neck, scarf.
    const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.045, 0.1, 10), skin);
    neckMesh.position.y = 0.03;
    neck.add(neckMesh);
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.036, 8, 20), scarf);
    wrap.rotation.x = Math.PI / 2;
    wrap.position.y = 0.0;
    wrap.scale.set(1, 0.9, 1.2);
    wrap.castShadow = true;
    neck.add(wrap);
    let parent: THREE.Object3D = neck;
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.position.set(i === 0 ? 0.05 : 0, i === 0 ? -0.01 : -0.11, i === 0 ? -0.06 : 0);
      parent.add(g);
      const piece = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.12, 0.022), scarf);
      piece.position.y = -0.055;
      piece.castShadow = true;
      g.add(piece);
      this.scarfTail.push(g);
      this.scarfSprings.push(sp());
      parent = g;
    }

    // Head.
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.108, 24, 18), skin);
    skull.scale.set(0.88, 1.04, 0.94);
    skull.position.y = 0.1;
    skull.castShadow = true;
    head.add(skull);
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), skin);
    jaw.scale.set(0.95, 0.85, 1);
    jaw.position.set(0, 0.045, 0.03);
    head.add(jaw);
    for (const s of [1, -1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.017, 10, 8), eyes);
      eye.scale.set(1.1, 0.75, 0.5);
      eye.position.set(s * 0.037, 0.108, 0.093);
      head.add(eye);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.01), hair);
      brow.position.set(s * 0.037, 0.13, 0.096);
      brow.rotation.z = s * -0.18;
      head.add(brow);
    }
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), lips);
    mouth.scale.set(1.3, 0.45, 0.5);
    mouth.position.set(0, 0.045, 0.098);
    head.add(mouth);

    // Hair: crown cap + bob around the back and sides, leaving the face open.
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.36), hair);
    crown.scale.set(0.92, 1.02, 1);
    crown.position.set(0, 0.105, -0.004);
    crown.rotation.x = -0.12;
    crown.castShadow = true;
    head.add(crown);
    const bob = new THREE.Mesh(
      new THREE.SphereGeometry(0.124, 24, 16, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.74),
      hair,
    );
    bob.material = hair.clone();
    (bob.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    bob.scale.set(0.95, 1.05, 1.02);
    bob.position.set(0, 0.098, -0.008);
    bob.castShadow = true;
    head.add(bob);
    // Low ponytail that streams behind her.
    parent = head;
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      g.position.set(0, i === 0 ? 0.03 : -0.085, i === 0 ? -0.105 : 0);
      parent.add(g);
      const r = 0.042 - i * 0.007;
      const strand = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), hair);
      strand.scale.set(1, 1.6, 0.85);
      strand.position.y = -0.045;
      strand.castShadow = true;
      g.add(strand);
      this.ponytail.push(g);
      this.ponySprings.push(sp());
      this.ponySide.push(sp());
      parent = g;
    }

    this.object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).receiveShadow = true;
    });
  }

  applyPose(pose: Pose): void {
    for (let i = 0; i < JOINTS.length; i++) {
      const j = this.joints[JOINTS[i]];
      j.rotation.set(pose.rot[i * 3], pose.rot[i * 3 + 1], pose.rot[i * 3 + 2]);
    }
    this.model.position.set(pose.root[0], pose.root[1], pose.root[2]);
    this.model.rotation.set(pose.rootRot[0], pose.rootRot[1], pose.rootRot[2]);
    this.lastPose.copy(pose);
  }

  updateSecondary(dt: number, m: SecondaryMotion): void {
    dt = Math.min(dt, 1 / 30);
    const speed = m.velocity.x;
    const lateralAccel = -m.accel.z; // world -Z is her local +X
    const vertAccel = m.accel.y;
    const forwardAccel = m.accel.x;

    // Ponytail: trails behind with speed, bounces with each stride.
    for (let i = 0; i < this.ponytail.length; i++) {
      const s = this.ponySprings[i];
      const k = 0.35 + i * 0.25;
      const target = clamp(0.12 + speed * 0.075 * k + m.wind * 0.6 + m.slide * 0.5 - vertAccel * 0.004 + forwardAccel * 0.01, -0.3, 1.5);
      [s.v, s.vel] = spring(s.v, s.vel, target / (i + 1), 120 - i * 18, 7 - i, dt);
      this.ponytail[i].rotation.x = s.v;
      const ss = this.ponySide[i];
      [ss.v, ss.vel] = spring(ss.v, ss.vel, clamp(-lateralAccel * 0.012, -0.6, 0.6), 90, 6, dt);
      this.ponytail[i].rotation.z = ss.v;
    }

    // Scarf tail flutters.
    for (let i = 0; i < this.scarfTail.length; i++) {
      const s = this.scarfSprings[i];
      const flutter = Math.sin(performance.now() * 0.012 + i * 1.7) * 0.06 * Math.min(1, speed / 8);
      const target = clamp(0.3 + speed * 0.07 + m.slide * 0.6 + flutter * (i + 1), 0, 1.7) / (i === 0 ? 1 : 2.4);
      [s.v, s.vel] = spring(s.v, s.vel, target, 110, 6, dt);
      this.scarfTail[i].rotation.x = s.v;
      this.scarfTail[i].rotation.z = i === 0 ? 0.25 : 0;
    }

    // Coat panels: the back flares with speed, sides are kicked by the thighs.
    const p = this.lastPose.rot;
    const thighL = p[11 * 3];
    const thighR = p[14 * 3];
    const cs = this.coatSprings;
    const bounce = -vertAccel * 0.0035;
    [cs.back.v, cs.back.vel] = spring(cs.back.v, cs.back.vel, clamp(0.04 + speed * 0.04 + m.wind * 0.3 + bounce + m.slide * 0.5, -0.1, 0.95), 85, 6, dt);
    [cs.l.v, cs.l.vel] = spring(cs.l.v, cs.l.vel, Math.min(0.15, thighL * 0.55) + speed * 0.012 + bounce, 140, 9, dt);
    [cs.r.v, cs.r.vel] = spring(cs.r.v, cs.r.vel, Math.min(0.15, thighR * 0.55) + speed * 0.012 + bounce, 140, 9, dt);
    [cs.side.v, cs.side.vel] = spring(cs.side.v, cs.side.vel, clamp(lateralAccel * 0.006, -0.3, 0.3), 70, 5, dt);
    this.coatBack.rotation.set(cs.back.v, 0, cs.side.v);
    this.coatL.rotation.set(cs.l.v, 0, 0.06 + Math.max(0, cs.side.v) + m.slide * 0.5);
    this.coatR.rotation.set(cs.r.v, 0, -0.06 + Math.min(0, cs.side.v) - m.slide * 0.5);
  }

  getAnkleWorld(side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3 {
    return this.joints[side === 'L' ? 'ankleL' : 'ankleR'].getWorldPosition(out);
  }

  setPhoneGlow(v: number): void {
    this.phoneScreen.emissiveIntensity = 2.2 * v;
  }
}
