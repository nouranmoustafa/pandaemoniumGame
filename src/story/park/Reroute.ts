import * as THREE from 'three';
import type { ChaseCamera } from '../../camera/ChaseCamera';
import { CHASE } from '../../config';
import type { EventBus } from '../../core/Events';
import type { Input } from '../../core/Input';
import { damp, smoothstep } from '../../core/math';
import type { Visitor } from '../../visitor/Visitor';
import type { Environment } from '../../world/Environment';

/** The wide half-ring: where it stands (she enters it at RING_X), its radius and banking. */
const RING_X = CHASE.end + 8;
const R = 7;
const IN = 4.6;
const OUT = 9.4;
/** Height of the banked ring at angle a (0..π) and radius r. */
const ringH = (a: number, r: number) => Math.sin(a) * (1.4 + (r - IN) * 0.45);
/** Metres before the ring at which it starts to heave up out of the ground. */
const RISE_AT = 20;

type Phase = 'off' | 'approach' | 'turn' | 'done';

/**
 * The Demon has won the chase: the road takes her back. Ahead of her the path
 * heaves up out of the grass and curls into a wide, banked half-circle of its
 * own cobbles; she can't stop, and it carries her round until she faces the
 * way she came. There she blacks out (see ParkChapter); she wakes at the door.
 */
export class Reroute {
  phase: Phase = 'off';
  /** Called once she is round, facing the house's end of the park again. */
  onTurned: () => void = () => {};
  private ring: THREE.Mesh;
  private up = 0;
  private target = 0;
  private a = 0;
  private speed = 0;
  private y = 0;
  private z0 = 0;
  private tmp = new THREE.Vector3();
  private look = new THREE.Vector3();
  private ground = { heightAt: () => this.y, slopeAt: () => 0, rollAngle: () => 0 };

  constructor(
    scene: THREE.Scene,
    private env: Environment,
    private visitor: Visitor,
    private camera: ChaseCamera,
    private bus: EventBus,
  ) {
    const nA = 64;
    const nR = 10;
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= nA; i++)
      for (let j = 0; j <= nR; j++) {
        const a = (i / nA) * Math.PI;
        const r = IN + ((OUT - IN) * j) / nR;
        pos.push(RING_X - r * Math.sin(a), ringH(a, r), -r * Math.cos(a));
        uv.push((a * R) / 1.5, (r - IN) / 1.5);
        col.push(0.8, 0.8, 0.8);
        if (i < nA && j < nR) {
          const k = i * (nR + 1) + j;
          idx.push(k, k + 1, k + nR + 1, k + 1, k + nR + 2, k + nR + 1);
        }
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = (env.pavement.mesh.material as THREE.MeshStandardMaterial).clone();
    mat.side = THREE.DoubleSide;
    this.ring = new THREE.Mesh(geo, mat);
    this.ring.receiveShadow = this.ring.castShadow = true;
    this.ring.visible = false;
    scene.add(this.ring);
  }

  get active(): boolean {
    return this.phase !== 'off';
  }

  reset(): void {
    this.phase = 'off';
    this.up = this.target = 0;
    this.ring.visible = false;
    this.ring.position.y = -3.2;
  }

  /** The chase is over and the house has won: she can't stop now. */
  begin(): void {
    const c = this.visitor.controller;
    this.phase = 'approach';
    c.controllable = false;
    this.speed = Math.max(c.speed, 8);
  }

  /** The camera's subject; while she is on the ring the lens looks on round the curve. */
  subject() {
    const v = this.visitor;
    const c = v.controller;
    let look: THREE.Vector3 | undefined;
    if (this.phase === 'turn') {
      const a = Math.min(Math.PI, this.a + 0.8);
      look = this.look.set(RING_X - R * Math.sin(a), ringH(a, R) + this.ring.position.y + 0.9, -R * Math.cos(a));
      if (this.a + 0.8 > Math.PI) look.x += (this.a + 0.8 - Math.PI) * 10;
    }
    return { position: v.position, speed: this.phase === 'turn' ? this.speed : c.speed, slide: 0, eyes: v.eyesWorld(this.tmp), heading: v.heading, look };
  }

  update(dt: number, input: Input): void {
    const v = this.visitor;
    const c = v.controller;
    if (this.phase === 'approach') {
      // Running on, no longer steering: drawn to the middle of the path as the ring comes up.
      c.effort = 1;
      c.lane = 1;
      v.update(dt, input, this.env.pavement);
      if (this.target === 0 && c.x - RING_X < RISE_AT) {
        this.target = 1;
        this.ring.visible = true;
        this.bus.emit('pavement:rise', {});
        this.env.flareHouse();
      }
      if (c.x <= RING_X) {
        this.phase = 'turn';
        this.a = 0;
        this.z0 = c.z + R;
        this.speed = Math.min(11, Math.max(8, c.speed));
      }
    } else if (this.phase === 'turn') {
      this.speed = damp(this.speed, 8.5, 1.2, dt);
      this.a = Math.min(Math.PI, this.a + (this.speed / R) * dt);
      const a = this.a;
      this.y = ringH(a, R) + this.ring.position.y;
      const heading = Math.atan2(-Math.cos(a), Math.sin(a));
      const zIn = this.z0 * (1 - smoothstep(0, 0.9, a));
      v.place(RING_X - R * Math.sin(a), -R * Math.cos(a) + zIn, heading, this.ground);
      v.updateCinematic(dt, this.speed * 1.4);
      if (a >= Math.PI) {
        // Round: facing the house's end of the park again. She holds there until the chapter cuts away.
        this.phase = 'done';
        this.camera.shake(0.45);
        this.bus.emit('pavement:sarcasm', { x: c.x });
        this.onTurned();
      }
    }
    this.up = damp(this.up, this.target, 2.4, dt);
    this.ring.position.y = (this.up - 1) * 3.2;
    if (this.target === 0 && this.up < 0.01) this.ring.visible = false;
  }
}
