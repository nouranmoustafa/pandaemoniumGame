import * as THREE from 'three';
import { noise1 } from '../core/math';

export interface ShotFrame {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

/** A directed shot: evaluated every frame, so it can track moving characters. */
export interface Shot {
  name: string;
  start: number;
  /** Seconds to ease in from the previous shot (0 = a cut, which we avoid). */
  blend: number;
  frame(t: number, out: ShotFrame): void;
}

const smoother = (u: number) => u * u * u * (u * (u * 6 - 15) + 10);

/**
 * Authored camera choreography. Shots are laid out on the prologue's clock;
 * the active shot eases in from the one before it while both keep moving,
 * then a light spring removes any residual kink. A whisper of hand-held
 * drift keeps static frames alive.
 */
export class CinematicDirector {
  private shots: Shot[] = [];
  private a: ShotFrame = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40 };
  private b: ShotFrame = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40 };
  readonly out: ShotFrame = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40 };
  private primed = false;
  /** Set to blend the very first shot in from wherever the camera already is. */
  private from: ShotFrame | null = null;
  current = '';

  setShots(shots: Shot[]): void {
    this.shots = [...shots].sort((x, y) => x.start - y.start);
    this.primed = false;
  }

  /** Start from the camera's present framing (e.g. the title shot). */
  startFrom(pos: THREE.Vector3, look: THREE.Vector3, fov: number): void {
    this.from = { pos: pos.clone(), look: look.clone(), fov };
    this.out.pos.copy(pos);
    this.out.look.copy(look);
    this.out.fov = fov;
    this.primed = true;
  }

  update(t: number, dt: number): ShotFrame {
    let i = -1;
    for (let k = 0; k < this.shots.length; k++) if (this.shots[k].start <= t) i = k;
    if (i < 0) i = 0;
    const shot = this.shots[i];
    this.current = shot.name;
    shot.frame(t, this.a);
    const u = shot.blend > 0 ? Math.min(1, (t - shot.start) / shot.blend) : 1;
    if (u < 1) {
      if (i > 0) this.shots[i - 1].frame(t, this.b);
      else if (this.from) Object.assign(this.b, { pos: this.b.pos.copy(this.from.pos), look: this.b.look.copy(this.from.look), fov: this.from.fov });
      else this.b = { pos: this.a.pos.clone(), look: this.a.look.clone(), fov: this.a.fov };
      const k = smoother(u);
      this.a.pos.lerpVectors(this.b.pos, this.a.pos, k);
      this.a.look.lerpVectors(this.b.look, this.a.look, k);
      this.a.fov = this.b.fov + (this.a.fov - this.b.fov) * k;
    }
    // Hand-held whisper.
    this.a.pos.x += noise1(t * 0.35, 21) * 0.025;
    this.a.pos.y += noise1(t * 0.3, 22) * 0.02;
    this.a.look.x += noise1(t * 0.25, 23) * 0.02;
    if (!this.primed) {
      this.out.pos.copy(this.a.pos);
      this.out.look.copy(this.a.look);
      this.out.fov = this.a.fov;
      this.primed = true;
    }
    const s = 1 - Math.exp(-9 * dt);
    this.out.pos.lerp(this.a.pos, s);
    this.out.look.lerp(this.a.look, s);
    this.out.fov += (this.a.fov - this.out.fov) * s;
    return this.out;
  }
}
