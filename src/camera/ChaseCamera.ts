import * as THREE from 'three';
import { CAMERA, COURSE, RUN } from '../config';
import { clamp, damp, lerp, noise1, smoothstep } from '../core/math';

export type CameraMode = 'title' | 'chase' | 'arrive';

export interface CameraSubject {
  position: THREE.Vector3;
  speed: number;
  slide: number;
}

/**
 * Elevated 2.5D oblique chase camera. It sits behind and to the near side of
 * the Visitor so the three lanes read as stacked rows (far lane = higher on
 * screen) while the path recedes toward the house in the upper right.
 *
 * Lateral follow is deliberately weak so lane changes are clearly visible as
 * movement against a stable frame.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'title';
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private desiredPos = new THREE.Vector3();
  private desiredLook = new THREE.Vector3();
  private trauma = 0;
  private time = 0;
  private groundY = 0;
  private lag = 0;
  private titleT = 0;
  private arriveT = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, 0.1, 2500);
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  setMode(m: CameraMode): void {
    this.mode = m;
    if (m === 'arrive') this.arriveT = 0;
  }

  /** Place the camera exactly at its chase position (used on restart). */
  snap(s: CameraSubject): void {
    this.groundY = s.position.y;
    this.lag = 0;
    this.computeChase(s);
    this.pos.copy(this.desiredPos);
    this.look.copy(this.desiredLook);
    this.apply();
  }

  private computeChase(s: CameraSubject): void {
    const p = s.position;
    const o = CAMERA.offset;
    const slide = s.slide;
    // Pull back and up as she speeds up; much more when sliding.
    const speedK = smoothstep(RUN.jogSpeed, RUN.sprintSpeed + 6, s.speed);
    const back = o.x - speedK * 1.4 - slide * 1.3;
    const up = o.y + speedK * 0.4 + slide * 1.1;
    const side = o.z + speedK * 0.5 + slide * 0.7;
    const followZ = p.z * CAMERA.laneFollow;
    this.desiredPos.set(p.x + back - this.lag, this.groundY + up, followZ + side);
    this.desiredLook.set(p.x + CAMERA.lookAhead.x + slide * 2.5, this.groundY + CAMERA.lookAhead.y, followZ * 0.6 - 0.8);
  }

  update(dt: number, s: CameraSubject): void {
    this.time += dt;
    // Ground height is smoothed separately so the hill doesn't jolt the frame.
    this.groundY = damp(this.groundY, s.position.y, 2.6, dt);

    if (this.mode === 'title') {
      this.titleT += dt;
      const t = this.titleT;
      const p = s.position;
      // Slow, uneasy drift around her as she stands with her phone.
      this.desiredPos.set(p.x - 4.2 + Math.sin(t * 0.13) * 0.8, p.y + 1.9 + Math.sin(t * 0.21) * 0.2, p.z + 4.6);
      this.desiredLook.set(p.x + 5, p.y + 2.1, p.z - 8.5);
      this.pos.lerp(this.desiredPos, 1 - Math.exp(-1.5 * dt));
      this.look.lerp(this.desiredLook, 1 - Math.exp(-1.5 * dt));
    } else if (this.mode === 'chase') {
      // Speed-dependent lag: she pulls ahead in the frame when sprinting.
      const targetLag = clamp((s.speed - RUN.jogSpeed) * 0.12, -0.6, 1.4);
      this.lag = damp(this.lag, targetLag, 1.5, dt);
      this.computeChase(s);
      this.pos.x = damp(this.pos.x, this.desiredPos.x, 12, dt);
      this.pos.y = damp(this.pos.y, this.desiredPos.y, 4, dt);
      this.pos.z = damp(this.pos.z, this.desiredPos.z, 3, dt);
      this.look.x = damp(this.look.x, this.desiredLook.x, 10, dt);
      this.look.y = damp(this.look.y, this.desiredLook.y, 4, dt);
      this.look.z = damp(this.look.z, this.desiredLook.z, 3, dt);
    } else {
      // Arrival: rise and turn to frame the house as the door opens.
      this.arriveT += dt;
      const k = smoothstep(0, 4, this.arriveT);
      const p = s.position;
      // End low behind her, so she stands small against the house.
      this.desiredPos.set(lerp(p.x - 8, p.x - 5.5, k), lerp(this.groundY + 5, this.groundY + 1.7, k), lerp(p.z + 8, p.z + 3.2, k));
      this.desiredLook.set(COURSE.houseX - 9, lerp(3, 7.5, k), lerp(p.z, COURSE.houseZ * 0.5, k));
      this.pos.lerp(this.desiredPos, 1 - Math.exp(-1.2 * dt));
      this.look.lerp(this.desiredLook, 1 - Math.exp(-1.2 * dt));
    }

    const targetFov = CAMERA.fov + smoothstep(RUN.jogSpeed, 20, s.speed) * 7 + s.slide * 3;
    this.camera.fov = damp(this.camera.fov, targetFov, 2, dt);
    this.camera.updateProjectionMatrix();
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.apply();
  }

  private apply(): void {
    this.camera.position.copy(this.pos);
    const sh = this.trauma * this.trauma;
    if (sh > 0) {
      const t = this.time * 30;
      this.camera.position.x += noise1(t, 1) * sh * 0.5;
      this.camera.position.y += noise1(t, 2) * sh * 0.5;
      this.camera.position.z += noise1(t, 3) * sh * 0.3;
    }
    this.camera.lookAt(this.look);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
