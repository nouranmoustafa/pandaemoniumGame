import * as THREE from 'three';
import { ahead, LANES, type LaneIndex, POWERS } from '../config';
import { clamp, mulberry32, smoothstep } from '../core/math';
import { leafTexture } from '../world/Textures';
import { Obstacle, type ObstacleContext } from './Obstacle';

const STREAKS = 34;
const LEAVES = 40;
const ZONE = 16;

let streakGeo: THREE.BufferGeometry | null = null;
let leafGeo: THREE.BufferGeometry | null = null;
let leafMat: THREE.MeshStandardMaterial | null = null;

/**
 * A supernatural gust. It gathers visibly in a stretch of path ahead (streaks
 * and leaves spiralling), then shoves her toward the targeted lane and drags
 * at her speed while she is inside it. She can brace by steering; if she
 * doesn't, it moves her a lane — sometimes straight into something else.
 */
export class WindGust extends Obstacle {
  readonly kind = 'wind' as const;
  readonly windup = POWERS.wind.windup;
  readonly strikeLead = 0;

  private streaks: THREE.InstancedMesh;
  private streakMat: THREE.MeshBasicMaterial;
  private leaves: THREE.InstancedMesh;
  private streakData: Array<{ x: number; z: number; y: number; speed: number; len: number }> = [];
  private leafData: Array<{ a: number; r: number; y: number; spin: number; phase: number }> = [];
  private dir: -1 | 0 | 1 = 0;
  private strength = 0;
  private time = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private rand: () => number;

  constructor(x: number, readonly targetLane: LaneIndex, seed: number) {
    super(x, [targetLane], new THREE.Group());
    this.dynamic = true;
    this.selfTimed = true;
    this.blocksLanes = false;
    this.halfLength = ZONE / 2;
    this.rand = mulberry32(seed);

    streakGeo ??= new THREE.PlaneGeometry(1, 0.035);
    if (!leafGeo) {
      leafGeo = new THREE.PlaneGeometry(0.2, 0.2);
      leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, color: 0x6a3a26 });
      leafMat.userData.shared = true;
    }
    this.streakMat = new THREE.MeshBasicMaterial({
      color: 0xbfc8ee,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.streaks = new THREE.InstancedMesh(streakGeo, this.streakMat, STREAKS);
    this.streaks.frustumCulled = false;
    this.leaves = new THREE.InstancedMesh(leafGeo, leafMat!, LEAVES);
    this.leaves.frustumCulled = false;
    this.group.add(this.streaks, this.leaves);
    for (let i = 0; i < STREAKS; i++) {
      this.streakData.push({
        x: x + (this.rand() - 0.5) * ZONE,
        z: (this.rand() - 0.5) * 9,
        y: 0.3 + this.rand() * 2.4,
        speed: 9 + this.rand() * 8,
        len: 1.2 + this.rand() * 2.2,
      });
    }
    for (let i = 0; i < LEAVES; i++) {
      this.leafData.push({ a: this.rand() * Math.PI * 2, r: 0.5 + this.rand() * 3, y: this.rand() * 3, spin: 2 + this.rand() * 4, phase: this.rand() * 10 });
    }
  }

  /** Wind never closes lanes, so it only "threatens" until it has blown out. */
  override get threatening(): boolean {
    return this.state === 'warning' || this.state === 'holding' || this.state === 'striking';
  }

  override get dangerous(): boolean {
    return false;
  }

  /** Current gust strength 0..1, for the environment (grass, trees, leaves). */
  get gustStrength(): number {
    return this.strength;
  }

  update(dt: number, ctx: ObstacleContext): void {
    this.time += dt;
    this.stateTime += dt;
    const v = ctx.visitor.controller;
    const inZone = v.x > this.x - ZONE / 2 && v.x < this.x + ZONE / 2;

    switch (this.state) {
      case 'warning':
        // Gathers; fully formed by the end of its windup, then waits for her.
        this.strength = 0.35 * smoothstep(0, this.windup, this.stateTime);
        if (inZone && this.stateTime > 0.4) this.strike(ctx);
        // If she somehow passes it entirely, it disperses.
        if (ahead(this.x, v.x) > ZONE / 2) this.setState('retracting');
        break;
      case 'striking':
        this.strength = Math.min(1, 0.35 + this.stateTime * 3);
        if (this.stateTime > 0.25) this.setState('holding');
        break;
      case 'holding':
        this.strength = 1;
        if (!inZone || this.stateTime > 3) this.setState('retracting');
        break;
      case 'retracting':
        this.strength = Math.max(0, this.strength - dt * 0.9);
        if (this.stateTime > 1.2) {
          this.setState('spent');
          ctx.bus.emit('obstacle:end', { kind: 'wind', x: this.x });
        }
        break;
      default:
        this.strength = 0;
    }

    // Direction: toward the targeted lane from wherever she is now.
    const dz = LANES[this.targetLane] - v.z;
    this.dir = Math.abs(dz) < 0.6 ? 0 : dz > 0 ? 1 : -1;

    // --- Force on the Visitor ---
    if ((this.state === 'striking' || this.state === 'holding') && inZone) {
      const s = this.strength;
      v.applyWind(this.dir * 34 * s, 0.6 * s, this.dir);
    }

    // --- Visuals ---
    const visible = this.state !== 'spent' && this.state !== 'dormant';
    this.group.visible = visible && Math.abs(this.x - v.x) < 90;
    if (!this.group.visible) return;
    const s = this.strength;
    this.streakMat.opacity = 0.05 + 0.3 * s;
    // Streaks travel with the wind: sideways toward the target, and backward (headwind).
    const angle = Math.atan2(this.dir * 0.8, -1);
    const vx = Math.cos(angle);
    const vz = Math.sin(angle);
    for (let i = 0; i < STREAKS; i++) {
      const d = this.streakData[i];
      d.x += vx * d.speed * dt * (0.4 + s);
      d.z += vz * d.speed * dt * (0.4 + s);
      if (d.x < this.x - ZONE / 2) d.x += ZONE;
      if (d.x > this.x + ZONE / 2) d.x -= ZONE;
      if (d.z > 5) d.z -= 10;
      if (d.z < -5) d.z += 10;
      const ground = ctx.pavement.heightAt(d.x, d.z);
      this.v.set(d.x, ground + d.y + Math.sin(this.time * 3 + i) * 0.15, d.z);
      this.e.set(0, -angle, Math.sin(this.time * 2 + i) * 0.1);
      this.q.setFromEuler(this.e);
      this.s.set(d.len * (0.5 + s), 1 + s, 1);
      this.streaks.setMatrixAt(i, this.m4.compose(this.v, this.q, this.s));
    }
    this.streaks.instanceMatrix.needsUpdate = true;

    // Leaves: a loose spiral that tightens and races sideways as it strikes.
    const cx = this.x;
    for (let i = 0; i < LEAVES; i++) {
      const d = this.leafData[i];
      d.a += dt * (1.5 + s * 5);
      const r = d.r * (1 - s * 0.3);
      const drift = (s * 3 * this.dir + Math.sin(this.time + d.phase)) * 0.6;
      const lx = cx + Math.cos(d.a) * r * 1.6 - s * 2;
      const lz = clamp(Math.sin(d.a) * r * 0.8 + drift, -5, 5);
      const ground = ctx.pavement.heightAt(lx, lz);
      this.v.set(lx, ground + 0.15 + d.y * (0.3 + s * 0.7) + Math.sin(this.time * 2 + d.phase) * 0.3, lz);
      this.e.set(this.time * d.spin, this.time * d.spin * 0.7, d.phase);
      this.q.setFromEuler(this.e);
      this.s.setScalar(visible ? 1 : 0);
      this.leaves.setMatrixAt(i, this.m4.compose(this.v, this.q, this.s));
    }
    this.leaves.instanceMatrix.needsUpdate = true;
  }
}
