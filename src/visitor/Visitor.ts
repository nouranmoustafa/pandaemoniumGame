import * as THREE from 'three';
import { CAST, OUTFITS } from '../characters/cast';
import type { ExpressionMix } from '../characters/Expression';
import { GeneratedCharacter } from '../characters/GeneratedCharacter';
import type { GestureName } from '../characters/gestures';
import type { GltfAvatar } from '../characters/gltf/GltfAvatar';
import { Performer } from '../characters/Performer';
import type { EventBus } from '../core/Events';
import type { Input } from '../core/Input';
import { RUN } from '../config';
import { clamp, damp, smoothstep } from '../core/math';
import type { VisitorAnimator } from './VisitorAnimator';
import { type Ground, VisitorController } from './VisitorController';

/** Facing for the chase: the model faces +Z; the run direction is +X. */
export const CHASE_HEADING = Math.PI / 2;

/**
 * The Visitor: gameplay controller + animator + skinned character.
 *
 * Two drivers share one body. In the chase, VisitorController owns her
 * position and the animator follows its speed. In cinematics, the prologue
 * places her and sets her walking speed directly. The animator (and its gait
 * phase) is the same object in both, so a walk flows straight into the run.
 *
 * Bodies: by default she is the generated skinned character. If a rigged GLB
 * is attached (attachGlb), it becomes the visible body for the whole run —
 * prologue and chase — driven by the same controller state through its
 * AnimationMixer. The generated character keeps running hidden as the
 * performance driver (gesture timing, gaze, face), so the cameras and the
 * script work unchanged with either body.
 */
export class Visitor {
  readonly controller: VisitorController;
  readonly character: GeneratedCharacter;
  readonly performer: Performer;
  readonly position = new THREE.Vector3();
  /** World yaw of the model. */
  heading = CHASE_HEADING;
  /** Set by the chapter: the Demon's anxiety, read as her rising dread. */
  dread = 0;
  private prevPos = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private prevVel = new THREE.Vector3();
  private accel = new THREE.Vector3();
  private relief = 0;
  private lookAhead = new THREE.Vector3();
  /** The GLB body, when one is attached. */
  glb: GltfAvatar | null = null;
  /** The phone prop in the GLB's hand (the generated body carries its own). */
  private glbPhone: THREE.Object3D | null = null;
  private tmp = new THREE.Vector3();

  constructor(private bus: EventBus) {
    this.controller = new VisitorController(bus);
    this.character = new GeneratedCharacter(CAST.visitor, OUTFITS.visitor);
    this.performer = new Performer(this.character);
    this.animator.onStep((foot) => this.bus.emit('visitor:step', { speed: Math.max(this.controller.speed, this.cineSpeed), foot }));
    bus.on('visitor:dodge', () => (this.relief = 1));
    bus.on('visitor:caught', () => this.performer.play('flinch'));
    bus.on('visitor:lane', () => this.glb?.play('dodge', 0.06, 0.2));
    this.performer.onGesture = (g) => this.glbGesture(g);
  }

  /** Make a rigged GLB her visible body. The generated one carries on, hidden, as the driver. */
  attachGlb(avatar: GltfAvatar): void {
    this.glb?.dispose();
    this.glb = avatar;
    const parent = this.character.object.parent;
    parent?.add(avatar.object);
    this.character.object.visible = false;
    // Her phone: the same prop (and the same dating-app screen), carried by the GLB's hand.
    this.glbPhone?.removeFromParent();
    this.glbPhone = this.character.phone.clone(true);
    this.glbPhone.scale.setScalar(this.character.design.scale);
    parent?.add(this.glbPhone);
    this.syncTransform();
  }

  /** Back to the generated body (missing asset, or a toggle). */
  detachGlb(): void {
    this.glb?.dispose();
    this.glb = null;
    this.glbPhone?.removeFromParent();
    this.glbPhone = null;
    this.character.object.visible = true;
  }

  /** The script's gestures, as the GLB's own clips (when it has them). */
  private glbGesture(g: GestureName): void {
    if (!this.glb) return;
    const map: Partial<Record<GestureName, string>> = {
      talk: 'talk',
      story: 'talk',
      laugh: 'laugh',
      wave: 'wave',
      waveStop: 'wave',
      thumbBack: 'wave',
      hesitate: 'hesitate',
      nod: 'talk',
    };
    const clip = map[g];
    if (clip) this.glb.play(clip);
  }

  /** World position of her eyes, whichever body she's in (for cameras and look-ats). */
  eyesWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.glb ? this.glb.getEyesWorld(out) : this.character.getEyesWorld(out);
  }

  /** World position of the phone screen she's reading. */
  phoneScreenWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.glbPhone ? this.glbPhone.getWorldPosition(out) : this.character.phoneScreen.getWorldPosition(out);
  }

  /** Keep the GLB's phone in its right hand, screen turned toward `aim`. */
  private placeGlbPhone(aim: THREE.Vector3 | null): void {
    const phone = this.glbPhone;
    if (!phone || !this.glb) return;
    phone.visible = this.character.phone.visible;
    if (!phone.visible) return;
    const hand = this.glb.getHandWorld('R', this.tmp) ?? this.eyesWorld(this.tmp).add(new THREE.Vector3(0, -0.4, 0));
    phone.position.copy(hand).add(new THREE.Vector3(0, 0.07, 0));
    const target = aim ?? this.eyesWorld(new THREE.Vector3());
    const x = target.clone().sub(phone.position).normalize();
    const z = new THREE.Vector3().crossVectors(x, new THREE.Vector3(0, 1, 0)).normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    phone.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }

  /** Called by the prologue each frame with where the phone's screen should face. */
  aimPhone(target: THREE.Vector3, w: number): void {
    this.character.aimPhone(target, w);
    this.placeGlbPhone(target);
  }

  get animator(): VisitorAnimator {
    return this.performer.animator;
  }

  get object(): THREE.Object3D {
    return this.character.object;
  }

  /** Speed while cinematics drive her (the controller is idle then). */
  private cineSpeed = 0;

  reset(x = 0, ground?: Ground): void {
    this.controller.reset(x);
    if (ground) this.controller.y = ground.heightAt(x, this.controller.z);
    this.performer.reset();
    this.heading = CHASE_HEADING;
    this.cineSpeed = 0;
    this.relief = 0;
    this.syncTransform();
    this.prevPos.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.prevVel.set(0, 0, 0);
    this.accel.set(0, 0, 0);
  }

  /** Place her (cinematics). Keeps velocity estimates continuous. */
  place(x: number, z: number, heading: number, ground: Ground): void {
    const c = this.controller;
    c.x = x;
    c.z = z;
    c.y = ground.heightAt(x, z);
    this.heading = heading;
    this.syncTransform();
  }

  private trackMotion(dt: number): void {
    if (dt > 0) {
      this.velocity.subVectors(this.position, this.prevPos).divideScalar(dt);
      this.accel.subVectors(this.velocity, this.prevVel).divideScalar(dt);
      // Clamp spikes (respawn, frame hitches).
      this.accel.clampLength(0, 80);
    }
    this.prevPos.copy(this.position);
    this.prevVel.copy(this.velocity);
  }

  /** Cinematic drive: the prologue has already placed her this frame. */
  updateCinematic(dt: number, speed: number): void {
    this.cineSpeed = speed;
    this.trackMotion(dt);
    this.performer.update(dt, { speed });
    this.character.updateSecondary(dt, { velocity: this.velocity, accel: this.accel, wind: 0.08, slide: 0 });
    if (this.glb) {
      this.glb.drive(dt, { speed, stumbleTime: -1, stumbleDuration: 1, slide: 0, laneVel: 0, windLean: 0, slope: 0, arriving: false });
      this.glb.setFace(this.performer.face, this.performer.blink);
    }
  }

  update(dt: number, input: Input, ground: Ground): void {
    const c = this.controller;
    c.update(dt, input, ground);
    this.cineSpeed = 0;
    // Turn to face the run once the chase owns her.
    this.heading = damp(this.heading, CHASE_HEADING, 6, dt);
    this.syncTransform();
    this.trackMotion(dt);

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
      windLean: c.windLean,
      headwind: c.headwind,
      slip: c.slip,
      idleStyle: 'open',
    });
    const p = this.performer.pose.copy(pose);
    // Running hands: loose fists.
    const runK = smoothstep(2.5, 5, c.speed) * (1 - c.slideBlend);
    p.blendHand('L', 0.7, 0.05, 0.6, 0, runK).blendHand('R', 0.7, 0.05, 0.6, 0, runK);
    // Eyes on the path ahead (the animator's glances back carry the head; the eyes follow it).
    this.lookAhead.set(this.position.x + 9, this.position.y + 1.6, this.position.z * 0.5);
    this.performer.lookAt(c.mode === 'idle' ? null : this.lookAhead, 0.6);
    this.performer.layer(dt, p);
    this.character.applyPose(p);
    this.performer.express(this.chaseExpression(dt), c.stumbling ? 18 : 5);
    this.performer.updateFace(dt);
    this.character.updateSecondary(dt, {
      velocity: this.velocity,
      accel: this.accel,
      wind: Math.min(1, Math.abs(c.windLean) + c.headwind),
      slide: c.slideBlend,
    });
    this.placeGlbPhone(null);
    if (this.glb) {
      this.glb.drive(dt, {
        speed: c.speed,
        stumbleTime: c.stumbleTime,
        stumbleDuration: RUN.stumbleDuration,
        slide: c.slideBlend,
        laneVel: c.laneVel,
        windLean: c.windLean,
        slope: c.slope * (1 - c.slideBlend),
        arriving: c.mode === 'arrive',
      });
      this.glb.setFace(this.performer.face, this.performer.blink);
    }
  }

  /** What her face does while she runs. */
  private chaseExpression(dt: number): ExpressionMix {
    const c = this.controller;
    this.relief = Math.max(0, this.relief - dt * 0.8);
    if (c.mode === 'idle') return {};
    if (c.mode === 'arrive') return { fear: 0.45, surprise: 0.35 };
    const st = c.stumbleTime;
    const hit = st >= 0 ? 1 - smoothstep(0.6, 2.0, st) : 0;
    const effort = smoothstep(0.3, 0.9, c.effort);
    const dread = clamp(this.dread, 0, 1);
    return {
      fear: Math.max(hit, c.slideBlend * 0.5, dread * 0.35),
      surprise: c.slideBlend * 0.4,
      determined: effort * 0.7 * (1 - hit),
      concern: (0.45 + dread * 0.3) * (1 - hit) * (1 - this.relief),
      distress: dread * 0.3 * (1 - hit),
      smile: this.relief * 0.2,
    };
  }

  private syncTransform(): void {
    const c = this.controller;
    this.position.set(c.x, c.y, c.z);
    this.character.object.position.copy(this.position);
    this.character.object.rotation.set(0, this.heading, 0);
    if (this.glb) {
      this.glb.object.position.copy(this.position);
      this.glb.object.rotation.set(0, this.heading, 0);
    }
  }

  getAnkle(side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3 {
    return this.glb ? this.glb.getAnkleWorld(side, out) : this.character.getAnkleWorld(side, out);
  }
}
