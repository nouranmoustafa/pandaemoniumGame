import * as THREE from 'three';
import type { EventBus } from '../core/Events';
import type { Input } from '../core/Input';
import type { VisitorAvatar } from './Avatar';
import { ProceduralAvatar } from './ProceduralAvatar';
import { VisitorAnimator } from './VisitorAnimator';
import { type Ground, VisitorController } from './VisitorController';

/**
 * The Visitor: gameplay controller + animator + visual avatar.
 */
export class Visitor {
  readonly controller: VisitorController;
  readonly animator = new VisitorAnimator();
  readonly avatar: VisitorAvatar;
  readonly position = new THREE.Vector3();
  private prevPos = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private prevVel = new THREE.Vector3();
  private accel = new THREE.Vector3();
  private phoneGlow = 1;

  constructor(private bus: EventBus) {
    this.controller = new VisitorController(bus);
    this.avatar = new ProceduralAvatar();
    this.animator.onStep((foot) => this.bus.emit('visitor:step', { speed: this.controller.speed, foot }));
  }

  get object(): THREE.Object3D {
    return this.avatar.object;
  }

  reset(x = 0, ground?: Ground): void {
    this.controller.reset(x);
    if (ground) this.controller.y = ground.heightAt(x, this.controller.z);
    this.animator.reset();
    this.syncTransform();
    this.prevPos.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.prevVel.set(0, 0, 0);
    this.accel.set(0, 0, 0);
  }

  update(dt: number, input: Input, ground: Ground): void {
    const c = this.controller;
    c.update(dt, input, ground);
    this.syncTransform();

    if (dt > 0) {
      this.velocity.subVectors(this.position, this.prevPos).divideScalar(dt);
      this.accel.subVectors(this.velocity, this.prevVel).divideScalar(dt);
      // Clamp spikes (respawn, frame hitches).
      this.accel.clampLength(0, 80);
    }
    this.prevPos.copy(this.position);
    this.prevVel.copy(this.velocity);

    const pose = this.animator.update(dt, {
      speed: c.speed,
      effort: c.effort,
      lateralVel: c.laneVel,
      stumbleTime: c.stumbleTime,
      stumbleSide: c.stumbleSide,
      slide: c.slideBlend,
      slope: c.slope,
      roll: c.roll,
      arriving: c.mode === 'arrive',
    });
    this.avatar.applyPose(pose);
    this.avatar.updateSecondary(dt, { velocity: this.velocity, accel: this.accel, wind: 0, slide: c.slideBlend });

    // Phone glow pulses like a notification while she runs.
    const target = c.mode === 'idle' ? 1 : 0.55 + 0.45 * Math.max(0, Math.sin(performance.now() * 0.004));
    this.phoneGlow += (target - this.phoneGlow) * Math.min(1, dt * 6);
    this.avatar.setPhoneGlow(this.phoneGlow);
  }

  private syncTransform(): void {
    const c = this.controller;
    this.position.set(c.x, c.y, c.z);
    this.avatar.object.position.copy(this.position);
    // Model faces +Z; the run direction is +X.
    this.avatar.object.rotation.set(0, Math.PI / 2, 0);
  }

  getAnkle(side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3 {
    return this.avatar.getAnkleWorld(side, out);
  }
}
