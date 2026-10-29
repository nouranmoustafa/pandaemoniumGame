import * as THREE from 'three';
import { ahead, CHASE, LANES, type LaneIndex } from '../config';
import { clamp, easeInCubic, easeOutCubic, easeInOutSine, mulberry32, noise1, smoothstep } from '../core/math';
import { Tendril, bezier, taperedTube } from '../world/geometry';
import { glowTexture } from '../world/Textures';
import { Obstacle, type ObstacleContext } from './Obstacle';

export type BranchStyle = 'sweep' | 'drop';

const LIMB_SEGS = 14;
let eyeTex: THREE.Texture | null = null;
let dangerTex: THREE.Texture | null = null;

/**
 * A crooked tree beside the path that is very much alive. It leans back,
 * lifts a limb, opens its knot-hole eyes and holds the limb trembling over the
 * lanes it means to hit — then swings it across ("sweep") or slams it down
 * ("drop").
 */
export class TreeAttack extends Obstacle {
  readonly kind = 'branch' as const;
  readonly windup = 1.5;
  readonly strikeLead = 0.5;

  private trunkPivot = new THREE.Group();
  private limb: Tendril;
  private claws: Tendril[] = [];
  private eyes: THREE.Sprite[] = [];
  private danger: THREE.Mesh[] = [];
  private dangerPivots: THREE.Group[] = [];
  private base: THREE.Vector3;
  private limbMat: THREE.MeshStandardMaterial;
  private topLocal = new THREE.Vector3();
  private baseLive = new THREE.Vector3();
  private trunkMat: THREE.MeshStandardMaterial;
  private bend = { value: 0 };
  private time = 0;
  private seed: number;
  private tip = new THREE.Vector3();
  private ctrl = new THREE.Vector3();
  private restTip = new THREE.Vector3();
  private restCtrl = new THREE.Vector3();
  private warnTip = new THREE.Vector3();
  private warnCtrl = new THREE.Vector3();
  private hitTip = new THREE.Vector3();
  private hitCtrl = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private side = new THREE.Vector3();

  constructor(
    x: number,
    lanes: LaneIndex[],
    readonly style: BranchStyle,
    plannedSurface: number,
    bark: THREE.Material,
    seed: number,
  ) {
    super(x, lanes, new THREE.Group());
    this.seed = seed;
    const rand = mulberry32(seed);
    eyeTex ??= glowTexture('rgba(255,70,50,1)');
    dangerTex ??= glowTexture('rgba(200,30,40,0.9)');

    const trunkZ = -7.3;
    const limbY = style === 'sweep' ? plannedSurface + 2.8 : plannedSurface + 7.4;
    this.base = new THREE.Vector3(x - 0.6, limbY, style === 'sweep' ? -6.3 : -5.6);
    // The living limb gets its own material so its veins can glow as it wakes.
    this.limbMat = (bark as THREE.MeshStandardMaterial).clone();
    this.limbMat.color.setHex(0x86748a);
    this.limbMat.emissive.setHex(0x000000);
    // The trunk deforms: displacement grows with the square of height, so it bends like wood.
    this.trunkMat = (bark as THREE.MeshStandardMaterial).clone();
    const bendHeight = { value: Math.max(1, limbY) };
    const bend = this.bend;
    this.trunkMat.onBeforeCompile = (shader) => {
      shader.uniforms.uBend = bend;
      shader.uniforms.uBendH = bendHeight;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uBend; uniform float uBendH;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float bh = clamp(position.y / uBendH, 0.0, 1.6);
           transformed.z += uBend * bh * bh * uBendH;`,
        );
    };
    this.trunkMat.customProgramCacheKey = () => 'tree-bend';

    // Trunk: a hunched, twisting column that leans over the path.
    this.trunkPivot.position.set(x, 0, trunkZ);
    this.group.add(this.trunkPivot);
    const top = this.base.clone().sub(this.trunkPivot.position);
    this.topLocal.copy(top);
    const trunkPts = [
      new THREE.Vector3(0, -0.3, 0),
      new THREE.Vector3(0.3, top.y * 0.35, -0.35),
      new THREE.Vector3(-0.2, top.y * 0.7, top.z * 0.5),
      top.clone(),
      top.clone().add(new THREE.Vector3(-0.6, 2.4, 0.4)),
      top.clone().add(new THREE.Vector3(-0.2, 4.2, -0.6)),
    ];
    const trunk = new THREE.Mesh(taperedTube(new THREE.CatmullRomCurve3(trunkPts), 24, 9, 0.62, 0.06), this.trunkMat);
    trunk.castShadow = trunk.receiveShadow = true;
    this.trunkPivot.add(trunk);
    // Gnarled static limbs for silhouette.
    for (let i = 0; i < 4; i++) {
      const from = trunkPts[3 + (i % 2)].clone();
      const pts = [from, from.clone().add(new THREE.Vector3((rand() - 0.5) * 3, 1.5 + rand() * 2, -1 - rand() * 2))];
      pts.push(pts[1].clone().add(new THREE.Vector3((rand() - 0.5) * 2, 0.5 + rand(), -rand())));
      const m = new THREE.Mesh(taperedTube(new THREE.CatmullRomCurve3(pts), 10, 6, 0.18, 0.01), this.trunkMat);
      m.castShadow = true;
      this.trunkPivot.add(m);
    }
    // Buttress roots.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rand();
      const pts = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(a) * 0.7, 0.3, Math.sin(a) * 0.7), new THREE.Vector3(Math.cos(a) * 1.6, -0.1, Math.sin(a) * 1.6)];
      this.trunkPivot.add(new THREE.Mesh(taperedTube(new THREE.CatmullRomCurve3(pts), 6, 5, 0.3, 0.04), bark));
    }

    // Knot-hole eyes, facing the path and the camera.
    for (const dx of [-0.24, 0.24]) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: eyeTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.05 }),
      );
      s.position.set(dx, top.y * 0.55, top.z * 0.35 + 0.62);
      s.scale.set(0.5, 0.28, 1);
      this.trunkPivot.add(s);
      this.eyes.push(s);
      const hole = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: 0x000000 }));
      hole.scale.set(1.3, 0.6, 0.4);
      hole.position.copy(s.position).add(new THREE.Vector3(0, 0, -0.06));
      this.trunkPivot.add(hole);
    }

    // The living limb and its claw-like twigs.
    this.limb = new Tendril(LIMB_SEGS, this.limbMat, 0.44, 0.09);
    this.group.add(this.limb.group);
    for (let i = 0; i < 3; i++) {
      const c = new Tendril(5, this.limbMat, 0.085, 0.012);
      this.claws.push(c);
      this.group.add(c.group);
    }

    // Lane danger strips — the red warning under the lanes it will hit.
    for (const l of lanes) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0, LANES[l]);
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(4.2, 2.5),
        new THREE.MeshBasicMaterial({ map: dangerTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      m.rotation.x = -Math.PI / 2;
      pivot.add(m);
      this.group.add(pivot);
      this.danger.push(m);
      this.dangerPivots.push(pivot);
    }

    // Pose anchors.
    this.restTip.set(this.base.x - 1.4, this.base.y + 3.4, this.base.z - 1.6);
    this.restCtrl.set(this.base.x + 0.4, this.base.y + 2.2, this.base.z + 0.2);
  }

  override reset(): void {
    super.reset();
    this.bend.value = 0;
  }

  private get farLaneZ(): number {
    return Math.max(...this.lanes.map((l) => LANES[l]));
  }

  update(dt: number, ctx: ObstacleContext): void {
    this.time += dt;
    this.stateTime += dt;
    const v = ctx.visitor;
    const dist = ahead(v.controller.x, this.x);
    const near = dist > -45 && dist < 110;
    this.group.visible = near;
    if (!near) return;
    const pav = ctx.pavement;
    const t = this.time;

    // Target poses depend on the live pavement height.
    const endZ = this.style === 'sweep' ? this.farLaneZ + 1.15 : LANES[this.lanes[0]];
    const surf = pav.heightAt(this.x, endZ);
    const warnZ = this.style === 'sweep' ? (this.base.z + endZ) / 2 : endZ;
    // Offsets along X lean toward the side she comes from.
    const D = CHASE.dir;
    this.warnTip.set(this.x - 1.0 * D, Math.max(surf + 5.2, this.base.y + 1.8), warnZ);
    this.warnCtrl.set(this.base.x + 0.2, this.base.y + 2.6, this.base.z + (warnZ - this.base.z) * 0.35);
    if (this.style === 'sweep') {
      this.hitTip.set(this.x + 0.5 * D, surf + 0.95, endZ);
      this.hitCtrl.set(this.x - 0.3 * D, Math.max(surf + 1.6, this.base.y + 0.3), (this.base.z + endZ) / 2 - 0.5);
    } else {
      this.hitTip.set(this.x + 0.2 * D, surf + 0.12, endZ);
      this.hitCtrl.set(this.x - 0.8 * D, this.base.y + 0.6, (this.base.z + endZ) / 2);
    }

    let lean = 0;
    let eye = 0.05;
    let danger = 0;
    let tremble = 0;
    switch (this.state) {
      case 'dormant': {
        const breathe = Math.sin(t * 0.8 + this.seed) * 0.15;
        this.tip.copy(this.restTip).add(this.tmp.set(breathe, breathe * 0.5, 0));
        this.ctrl.copy(this.restCtrl);
        lean = Math.sin(t * 0.6 + this.seed) * 0.01;
        break;
      }
      case 'warning': {
        const k = clamp(this.stateTime / this.windup, 0, 1);
        const lift = easeInOutSine(clamp(k * 1.6, 0, 1));
        this.tip.lerpVectors(this.restTip, this.warnTip, lift);
        this.ctrl.lerpVectors(this.restCtrl, this.warnCtrl, lift);
        tremble = smoothstep(0.3, 1, k);
        lean = -0.07 * lift; // rear back before the blow
        eye = 0.2 + 0.8 * smoothstep(0.1, 0.6, k);
        danger = smoothstep(0.15, 0.7, k) * 0.75;
        break;
      }
      case 'striking': {
        const k = clamp(this.stateTime / 0.26, 0, 1);
        const e = easeInCubic(k);
        this.tip.lerpVectors(this.warnTip, this.hitTip, e);
        this.ctrl.lerpVectors(this.warnCtrl, this.hitCtrl, easeOutCubic(k));
        lean = -0.07 + 0.13 * e;
        eye = 1;
        danger = 1;
        if (k >= 1) this.setState('holding');
        break;
      }
      case 'holding': {
        this.tip.copy(this.hitTip).add(this.tmp.set(0, Math.sin(t * 30) * 0.03 * Math.exp(-this.stateTime * 4), 0));
        this.ctrl.copy(this.hitCtrl);
        lean = 0.06;
        eye = 1;
        danger = 0.8 * (1 - smoothstep(0.6, 1.2, this.stateTime));
        if (this.stateTime > 1.3 || ahead(this.x, v.controller.x) > 4) this.setState('retracting');
        break;
      }
      case 'retracting': {
        const k = easeInOutSine(clamp(this.stateTime / 1.2, 0, 1));
        this.tip.lerpVectors(this.hitTip, this.restTip, k);
        this.ctrl.lerpVectors(this.hitCtrl, this.restCtrl, k);
        lean = 0.06 * (1 - k);
        eye = 1 - k * 0.9;
        if (k >= 1) this.setState('spent');
        break;
      }
      case 'spent':
        this.tip.copy(this.restTip);
        this.ctrl.copy(this.restCtrl);
        eye = 0.08;
        break;
    }

    if (tremble > 0) {
      const n = (o: number) => noise1(t * 14 + o, this.seed) * 0.28 * tremble;
      this.tip.x += n(0);
      this.tip.y += n(3);
      this.tip.z += n(7);
    }

    // --- Collision: the limb is across her path. ---
    const armed = (this.state === 'striking' && this.stateTime > 0.15) || (this.state === 'holding' && this.stateTime < 0.9);
    if (armed && !this.landed && this.overlapsVisitor(v, this.style === 'sweep' ? 0.85 : 0.75, 1.05)) {
      if (v.controller.catch('branch', Math.random() < 0.5 ? 'L' : 'R')) this.landed = true;
    }

    // --- Pose trunk, limb and claws ---
    // The trunk bends (quadratically with height) rather than tipping like a post.
    this.bend.value = lean;
    // Veins smoulder while it winds up and burn at the strike.
    const veins = Math.max(danger, eye > 0.1 ? eye * 0.6 : 0);
    this.limbMat.emissive.setRGB(0.07 * veins, 0.008 * veins, 0.012 * veins);
    // The limb grows out of the trunk, so it follows the trunk's lean.
    this.baseLive.copy(this.topLocal).add(this.trunkPivot.position);
    this.baseLive.z += lean * this.topLocal.y;
    for (const s of this.eyes) {
      const flick = 0.85 + 0.15 * Math.sin(t * 17 + this.seed);
      (s.material as THREE.SpriteMaterial).opacity = eye * flick;
    }
    const pts = this.limb.points;
    for (let i = 0; i <= LIMB_SEGS; i++) {
      const k = i / LIMB_SEGS;
      bezier(this.baseLive, this.ctrl, this.tip, k, pts[i]);
      const w = Math.sin(t * 2.2 + k * 6 + this.seed) * 0.08 * k;
      pts[i].x += w;
      pts[i].y += Math.cos(t * 1.7 + k * 5) * 0.06 * k;
    }
    this.limb.sync();

    // Claws fan out from the tip along the limb direction.
    this.dir.subVectors(pts[LIMB_SEGS], pts[LIMB_SEGS - 2]).normalize();
    this.side.crossVectors(this.dir, this.tmp.set(0, 1, 0));
    if (this.side.lengthSq() < 1e-4) this.side.set(1, 0, 0);
    this.side.normalize();
    const curl = this.state === 'striking' || this.state === 'holding' ? 0.6 : 0.25 + tremble * 0.5;
    for (let c = 0; c < this.claws.length; c++) {
      const claw = this.claws[c];
      const fan = (c - 1) * 0.7;
      const cp = claw.points;
      const start = pts[LIMB_SEGS - 1];
      for (let i = 0; i < cp.length; i++) {
        const k = i / (cp.length - 1);
        this.tmp2
          .copy(this.dir)
          .multiplyScalar(k * 1.3)
          .addScaledVector(this.side, fan * k * 0.8)
          .add(this.tmp.set(0, -curl * k * k * 0.6 + Math.sin(t * 8 + c + k * 3) * 0.04 * tremble, 0));
        cp[i].copy(start).add(this.tmp2);
      }
      claw.sync();
    }

    // Danger strips follow the surface.
    for (let i = 0; i < this.danger.length; i++) {
      const pivot = this.dangerPivots[i];
      const z = pivot.position.z;
      pivot.position.y = pav.heightAt(this.x, z) + 0.06;
      pivot.rotation.z = Math.atan(pav.slopeAt(this.x, z));
      (this.danger[i].material as THREE.MeshBasicMaterial).opacity = danger * (0.7 + 0.3 * Math.sin(t * 12));
    }
  }
}
