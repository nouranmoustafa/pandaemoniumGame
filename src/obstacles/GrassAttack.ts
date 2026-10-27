import * as THREE from 'three';
import { LANES, type LaneIndex } from '../config';
import { clamp, easeOutBack, easeOutCubic, mulberry32, smoothstep } from '../core/math';
import { Tendril, bezier, bladeGeometry } from '../world/geometry';
import { crackTexture } from '../world/Textures';
import { Obstacle, type ObstacleContext } from './Obstacle';

const BLADES = 70;
const ROOTS = 3;
const ROOT_SEGS = 9;

let sharedBlade: THREE.BufferGeometry | null = null;
let sharedCrack: THREE.Texture | null = null;
let sharedRootMat: THREE.MeshStandardMaterial | null = null;

interface BladeData {
  dx: number;
  dz: number;
  h: number;
  yaw: number;
  phase: number;
}

/**
 * Grass that wakes up. The blades thrash in anticipation, the cobbles crack
 * with a red glow, and then roots burst out and grab for her ankles.
 * If they catch her, they stay attached until she tears free.
 */
export class GrassAttack extends Obstacle {
  readonly kind = 'grass' as const;
  readonly windup = 1.3;
  readonly strikeLead = 0.42;

  private blades: THREE.InstancedMesh;
  private bladeData: BladeData[] = [];
  private bladeMat: THREE.MeshStandardMaterial;
  private roots: Tendril[] = [];
  private rootBase: THREE.Vector3[] = [];
  private rootPhase: number[] = [];
  private crack: THREE.Mesh;
  private crackPivot = new THREE.Group();
  private caught = false;
  private lunge = new THREE.Vector3();
  private time = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private tip = new THREE.Vector3();
  private ctrl = new THREE.Vector3();
  private ankle = new THREE.Vector3();

  constructor(x: number, lane: LaneIndex, seed: number) {
    super(x, [lane], new THREE.Group());
    const rand = mulberry32(seed);
    const z = LANES[lane];
    sharedBlade ??= bladeGeometry(0.075);
    sharedCrack ??= crackTexture(3);
    sharedRootMat ??= new THREE.MeshStandardMaterial({ color: 0x5a3a34, roughness: 0.45, metalness: 0.05, emissive: 0x3a060c });

    this.bladeMat = new THREE.MeshStandardMaterial({
      color: 0x4c6a4a,
      roughness: 0.85,
      side: THREE.DoubleSide,
      vertexColors: true,
      emissive: 0x000000,
    });
    this.blades = new THREE.InstancedMesh(sharedBlade, this.bladeMat, BLADES);
    this.blades.frustumCulled = false;
    this.blades.castShadow = true;
    for (let i = 0; i < BLADES; i++) {
      // Concentrated in the lane, a few spilling into the cracks around it.
      const r = Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      this.bladeData.push({
        dx: Math.cos(a) * r * 1.9,
        dz: Math.sin(a) * r * 1.15,
        h: 0.55 + rand() * 0.75,
        yaw: rand() * Math.PI * 2,
        phase: rand() * 10,
      });
    }
    this.group.add(this.blades);

    for (let i = 0; i < ROOTS; i++) {
      const t = new Tendril(ROOT_SEGS, sharedRootMat, 0.13, 0.022);
      t.visible = false;
      this.roots.push(t);
      this.group.add(t.group);
      this.rootBase.push(new THREE.Vector3(x + (i - 1) * 0.7 + (rand() - 0.5) * 0.3, 0, z + (rand() - 0.5) * 0.9));
      this.rootPhase.push(rand() * 10);
    }

    this.crack = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 2.6),
      new THREE.MeshBasicMaterial({ map: sharedCrack, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.crack.rotation.x = -Math.PI / 2;
    this.crackPivot.add(this.crack);
    this.crackPivot.position.set(x, 0, z);
    this.group.add(this.crackPivot);
  }

  override reset(): void {
    super.reset();
    this.caught = false;
    for (const r of this.roots) r.visible = false;
    (this.crack.material as THREE.MeshBasicMaterial).opacity = 0;
    this.bladeMat.emissive.setHex(0x000000);
  }

  update(dt: number, ctx: ObstacleContext): void {
    this.time += dt;
    this.stateTime += dt;
    const v = ctx.visitor;
    const dist = this.x - v.controller.x;
    const near = dist > -40 && dist < 90;
    this.group.visible = near;
    if (!near) return;
    const pav = ctx.pavement;
    const laneZ = LANES[this.lanes[0]];

    // --- State progression ---
    let agitation = 0;
    switch (this.state) {
      case 'dormant':
        agitation = 0;
        break;
      case 'warning':
        agitation = clamp(this.stateTime / this.windup, 0, 1);
        break;
      case 'striking':
        agitation = 1;
        if (this.stateTime > 0.24) this.setState('holding');
        break;
      case 'holding':
        agitation = 1;
        if (this.stateTime > (this.caught ? 0.6 : 0.7)) this.setState('retracting');
        break;
      case 'retracting':
        agitation = 1 - clamp(this.stateTime / 0.9, 0, 1);
        if (this.stateTime > 1.1) this.setState('spent');
        break;
      case 'spent':
        agitation = 0;
        break;
    }

    // --- Collision: roots are up during striking/holding ---
    const armed = (this.state === 'striking' && this.stateTime > 0.1) || (this.state === 'holding' && !this.caught && this.stateTime < 0.35);
    if (armed && !this.landed && this.overlapsVisitor(v, 1.35, 1.0)) {
      const side = Math.random() < 0.5 ? 'L' : 'R';
      if (v.controller.catch('grass', side)) {
        this.landed = true;
        this.caught = true;
        this.setState('holding');
      }
    }

    // --- Crack telegraph ---
    const crackOpacity =
      this.state === 'warning' ? smoothstep(0, 0.6, agitation) * 0.9 : this.state === 'striking' || this.state === 'holding' ? 1 : agitation * 0.6;
    (this.crack.material as THREE.MeshBasicMaterial).opacity = crackOpacity * (0.75 + 0.25 * Math.sin(this.time * 14));
    this.crackPivot.position.y = pav.heightAt(this.x, laneZ) + 0.04;
    this.crackPivot.rotation.z = Math.atan(pav.slopeAt(this.x, laneZ));
    this.bladeMat.emissive.setRGB(0.11 * agitation, 0.008 * agitation, 0.015 * agitation);

    // --- Blades ---
    const t = this.time;
    const strikeK = this.state === 'striking' ? easeOutCubic(clamp(this.stateTime / 0.2, 0, 1)) : this.state === 'holding' ? 1 : 0;
    const wilt = this.state === 'retracting' ? clamp(this.stateTime / 0.9, 0, 1) : this.state === 'spent' ? 1 : 0;
    for (let i = 0; i < BLADES; i++) {
      const b = this.bladeData[i];
      const bx = this.x + b.dx;
      const bz = laneZ + b.dz;
      this.p.set(bx, pav.heightAt(bx, bz), bz);
      const calm = Math.sin(t * 1.8 + b.phase) * 0.12;
      const thrash = Math.sin(t * (11 + (i % 5)) + b.phase) * 0.55 * agitation;
      // Lean toward the incoming Visitor (-X), whip hard on strike, then wilt.
      const leanX = calm + thrash - agitation * 0.35 - strikeK * 0.7 + wilt * 0.9 * Math.sign(b.dz || 1);
      const leanZ = Math.cos(t * 9 + b.phase) * 0.35 * agitation;
      this.e.set(leanZ, b.yaw * (1 - agitation * 0.8), leanX, 'YXZ');
      this.q.setFromEuler(this.e);
      const grow = 1 + agitation * 0.65 + strikeK * 0.25 - wilt * 0.35;
      this.s.set(1.4, b.h * grow, 1);
      this.m4.compose(this.p, this.q, this.s);
      this.blades.setMatrixAt(i, this.m4);
    }
    this.blades.instanceMatrix.needsUpdate = true;

    // --- Roots ---
    for (let r = 0; r < ROOTS; r++) {
      const root = this.roots[r];
      const base = this.rootBase[r];
      base.y = pav.heightAt(base.x, base.z);
      const ph = this.rootPhase[r];
      let reach = 0; // 0 = buried, 1 = fully out
      let tipTarget: THREE.Vector3 | null = null;

      if (this.state === 'warning') {
        // Tips poke out of the cracks and taste the air.
        reach = smoothstep(0.35, 1, agitation) * 0.32;
      } else if (this.state === 'striking' || this.state === 'holding') {
        reach = this.state === 'striking' ? easeOutBack(clamp(this.stateTime / 0.22, 0, 1)) : 1;
        if (this.caught) {
          v.getAnkle(r % 2 === 0 ? v.controller.stumbleSide : r === 1 ? 'R' : 'L', this.ankle);
          tipTarget = this.ankle;
        } else {
          // Lunge toward where she would have been.
          this.lunge.set(this.x - 1.2 + r * 0.3, base.y + 0.35, laneZ + (r - 1) * 0.35);
          tipTarget = this.lunge;
        }
      } else if (this.state === 'retracting') {
        reach = 1 - easeOutCubic(clamp(this.stateTime / 0.8, 0, 1));
        this.lunge.set(base.x - 0.4, base.y + 0.4, base.z);
        tipTarget = this.lunge;
      }

      root.visible = reach > 0.01;
      if (!root.visible) continue;

      if (tipTarget) {
        this.tip.lerpVectors(this.p.set(base.x, base.y - 0.3, base.z), tipTarget, clamp(reach, 0, 1.15));
      } else {
        this.tip.set(base.x + Math.sin(t * 5 + ph) * 0.15, base.y + reach * 1.1, base.z + Math.cos(t * 4 + ph) * 0.15);
      }
      // Arch upward out of the ground before bending toward the tip.
      this.ctrl.set(base.x, base.y + 0.6 + reach * 0.5, base.z);
      const pts = root.points;
      const startY = base.y - 0.35;
      for (let i = 0; i <= ROOT_SEGS; i++) {
        const k = i / ROOT_SEGS;
        this.p.set(base.x, startY, base.z);
        bezier(this.p, this.ctrl, this.tip, k, pts[i]);
        // Writhing.
        const w = Math.sin(t * 9 + k * 7 + ph) * 0.07 * k * (this.caught ? 0.4 : 1);
        pts[i].x += w;
        pts[i].z += Math.cos(t * 7 + k * 5 + ph) * 0.06 * k;
      }
      root.sync(this.caught && this.state === 'holding' ? 1.15 : 1);
    }
  }
}
