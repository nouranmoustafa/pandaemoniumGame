import * as THREE from 'three';
import type { CinematicDirector, Shot, ShotFrame } from '../../camera/CinematicDirector';
import type { ChaseCamera } from '../../camera/ChaseCamera';
import { COURSE } from '../../config';
import type { EventBus } from '../../core/Events';
import { clamp, damp, smoothstep } from '../../core/math';
import { APP_BEATS, type DatingApp } from '../../ui/DatingApp';
import type { Visitor } from '../../visitor/Visitor';
import type { Environment } from '../../world/Environment';
import { HOUSE_FRONT } from '../../world/House';

/**
 * Where the house first stands: just up the path from the gate, so she walks
 * straight to it. Once she flees and the park turns her round, it sinks and
 * goes back to the end of the course, to rise again at the end of the slide.
 */
export const FIRST_HOUSE_X = 31;
const STOP_X = FIRST_HOUSE_X + HOUSE_FRONT - 11;
/** Where the ground rises into a banked U and turns her round (her escape back toward the gate). */
const ARC_X = -6;
const ARC_R = 2.6;
const ARC_IN = 1.0;
const ARC_OUT = 4.2;
/** Height of the banked ramp at angle a (0..π) and radius r. */
const arcH = (a: number, r: number) => Math.sin(a) * (1.2 + (r - ARC_IN) * 0.6);

type Phase = 'off' | 'walk' | 'phone' | 'flee' | 'turn' | 'loop';

/**
 * Between the prologue and the chase: she walks up the path to the old
 * garden house and stops in front of it. Her date writes again, in the same
 * app: come inside. The park goes wrong around her; she turns and runs back
 * the way she came — in her own eyes now (first person) — and the path
 * itself turns her round. Then the chase: away again, for the park's exit.
 */
export class Approach {
  phase: Phase = 'off';
  time = 0;
  /** Called when the escape is turned round and the chase proper should begin. */
  onChase: () => void = () => {};
  private walkSpeed = 0;
  private heading = Math.PI / 2;
  private targetHeading = Math.PI / 2;
  private cues: Array<{ at: number; run: () => void }> = [];
  private cueIndex = 0;
  private tmp = new THREE.Vector3();

  constructor(
    private env: Environment,
    private visitor: Visitor,
    private app: DatingApp,
    private director: CinematicDirector,
    private camera: ChaseCamera,
    private bus: EventBus,
    private say: { prompt: (html: string | null) => void; hint: (v: boolean) => void; phone: (c: HTMLCanvasElement | null) => void },
    scene: THREE.Scene,
  ) {
    // The ramp: a banked half-ring of the path's own cobbles, under the ground until it rises.
    const nA = 40;
    const nR = 8;
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= nA; i++)
      for (let j = 0; j <= nR; j++) {
        const a = (i / nA) * Math.PI;
        const r = ARC_IN + ((ARC_OUT - ARC_IN) * j) / nR;
        pos.push(ARC_X - r * Math.sin(a), arcH(a, r), -r * Math.cos(a));
        uv.push((a * ARC_R) / 1.5, (r - ARC_IN) / 1.5);
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
    const pm = env.pavement.mesh.material as THREE.MeshStandardMaterial;
    const mat = pm.clone();
    mat.side = THREE.DoubleSide;
    this.ramp = new THREE.Mesh(geo, mat);
    this.ramp.receiveShadow = this.ramp.castShadow = true;
    this.ramp.visible = false;
    scene.add(this.ramp);
  }

  private ramp: THREE.Mesh;
  private rampUp = 0;
  private rampTarget = 0;
  private arcA = 0;
  private arcSpeed = 0;
  private arcY = 0;
  private arcZ0 = 0;
  private lookTmp = new THREE.Vector3();
  private arcGround = { heightAt: () => this.arcY, slopeAt: () => 0, rollAngle: () => 0 };

  get active(): boolean {
    return this.phase !== 'off';
  }

  /** The house stands at the top of the path (title, prologue). */
  placeFirstHouse(): void {
    const H = this.env.house;
    H.group.position.set(FIRST_HOUSE_X, H.group.position.y, COURSE.houseZ);
    H.rise = 1;
    H.snapRise();
    H.riseRate = 0.32;
  }

  /** Back where it belongs, sunk until the slide. */
  placeFinalHouse(): void {
    const H = this.env.house;
    H.rise = 0;
    H.snapRise();
    H.group.position.set(COURSE.houseX, H.group.position.y, COURSE.houseZ);
    H.riseRate = 0.32;
  }

  reset(): void {
    this.phase = 'off';
    this.time = 0;
    this.fleeT = -1;
    this.rampUp = this.rampTarget = 0;
    this.ramp.visible = false;
    this.say.phone(null);
    this.cues = [];
    this.cueIndex = 0;
  }

  /** The prologue's last shot: she walks on, up the path, to the house. */
  begin(): void {
    this.phase = 'walk';
    this.time = 0;
    this.walkSpeed = 1.3;
    this.heading = this.targetHeading = Math.PI / 2;
    const v = this.visitor;
    const P = v.performer;
    const H = this.env.house;
    const sound = (id: 'buzz' | 'notify' | 'flicker' | 'grass' | 'swing' | 'branch') => this.bus.emit('prologue:sound', { id });
    const houseLook = new THREE.Vector3(FIRST_HOUSE_X - 6, 6, COURSE.houseZ);
    const E = new THREE.Vector3();
    this.cues = [
      { at: 0.2, run: () => (P.lookAt(houseLook, 0.7), P.express({ concern: 0.35, smile: 0.1 }, 2)) },
    ];
    this.cueIndex = 0;
    this.director.setShots(this.walkShots(1e6));
    this.director.startFrom(this.camera.camera.position.clone(), this.camera.camera.getWorldDirection(E).multiplyScalar(10).add(this.camera.camera.position), this.camera.camera.fov);
    // Phone cues are queued when she arrives (see update).
    this.arrivalCues = [
      { at: 0.1, run: () => (sound('buzz'), P.setPhone(1), P.express({ concern: 0.3, surprise: 0.2 }, 3)) },
      // Her phone, held up to us: the same app. The invitation arrives at ~1.8 s and stays readable ~3.6 s.
      { at: 0.6, run: () => this.say.phone(this.app.screen) },
      { at: 0.9, run: () => sound('notify') },
      { at: 5.4, run: () => this.say.phone(null) },
      // Eerie: the lamps stutter, the windows flare, the door eases open, the wind turns.
      { at: 5.5, run: () => (this.env.lamps.stutter(STOP_X - 4, 1.6), sound('flicker'), this.env.flareHouse(), (H.doorOpen = 0.25), this.env.setGust(0.9)) },
      { at: 5.8, run: () => (P.setPhone(0), P.lookAt(houseLook, 1), P.express({ fear: 0.6, surprise: 0.4 }, 4), (P.nervous = 0.6), sound('grass')) },
      { at: 6.3, run: () => (P.play('hesitate', 1), this.env.rippleGrass(STOP_X + 2, 1)) },
      // She will not go in. She turns her back on it.
      { at: 6.8, run: () => ((this.targetHeading = -Math.PI / 2), P.lookAt(null), P.express({ fear: 0.75, determined: 0.5 }, 4)) },
      { at: 7.5, run: () => this.beginFlee() },
    ];
  }

  private arrivalCues: Array<{ at: number; run: () => void }> = [];
  private arriveAt = -1;

  /** Skip / retry: straight to the chase (the house is already back at the end). */
  cancel(): void {
    this.phase = 'off';
  }

  private beginFlee(): void {
    this.phase = 'flee';
    const c = this.visitor.controller;
    c.dir = -1;
    c.start();
    c.speed = 4.5;
    this.visitor.heading = this.heading;
    this.visitor.setFirstPerson(true);
    this.camera.fpv = true;
    this.camera.dir = -1;
    this.camera.beginHandoff(this.subject(), 0.9);
    this.say.hint(true);
    this.env.setGust(0);

  }

  subject() {
    const v = this.visitor;
    const c = v.controller;
    let look: THREE.Vector3 | undefined;
    if (this.phase === 'turn') {
      const a = Math.min(Math.PI, this.arcA + 1.0);
      look = this.lookTmp.set(ARC_X - ARC_R * Math.sin(a), arcH(a, ARC_R) + this.ramp.position.y + 0.9, -ARC_R * Math.cos(a));
      if (this.arcA + 1.0 > Math.PI) look.x += (this.arcA + 1.0 - Math.PI) * 8;
    }
    return { position: v.position, speed: c.speed, slide: c.slideBlend, eyes: v.eyesWorld(this.tmp), heading: v.heading, look };
  }

  /** Returns a cinematic frame while she walks and reads; null once the player has her. */
  update(dt: number, input: import('../../core/Input').Input): ShotFrame | null {
    this.time += dt;
    const t = this.time;
    while (this.cueIndex < this.cues.length && this.cues[this.cueIndex].at <= t) this.cues[this.cueIndex++].run();
    const v = this.visitor;
    const c = v.controller;
    if (this.phase === 'walk' || this.phase === 'phone') {
      if (this.phase === 'walk' && c.x >= STOP_X - 0.6) {
        this.phase = 'phone';
        this.arriveAt = t;
        this.cues = this.arrivalCues.map((q) => ({ at: q.at + t, run: q.run }));
        this.cueIndex = 0;
        this.director.setShots(this.walkShots(t));
      }
      this.walkSpeed = damp(this.walkSpeed, this.phase === 'walk' ? 2.6 : 0, this.phase === 'walk' ? 2.2 : 3.5, dt);
      this.heading += clamp(this.targetHeading - this.heading, -2.6 * dt, 2.6 * dt);
      const z = damp(c.z, 0, 1.2, dt);
      v.place(c.x + Math.sin(this.heading) * this.walkSpeed * dt * (this.phase === 'walk' ? 1 : 0), z, this.heading, this.env.pavement);
      v.updateCinematic(dt, this.walkSpeed);
      if (this.phase === 'phone') {
        // The app: her date writes again — the invitation.
        const a = t - this.arriveAt;
        this.app.update(APP_BEATS.sent + 0.8 + clamp(a - 0.4, 0, 6) * (APP_BEATS.inviteMsg - APP_BEATS.sent) / 1.4);
        if (P(v).phone > 0.3) v.aimPhone(v.eyesWorld(this.tmp), 1);
      }
      return this.director.update(t, dt);
    }
    if (this.phase === 'turn') {
      this.updateTurn(dt);
      this.updateRamp(dt);
      return null;
    }
    // The escape: hers to run, back toward the gate — until the path turns her round.
    v.update(dt, input, this.env.pavement);
    if (this.phase === 'loop') {
      const since = this.time - this.loopAt;
      // The ramp settles back; the house stands ahead of her — then sinks, and the park opens again.
      if (since > 1.0) this.rampTarget = 0;
      if (since > 1.4 && this.env.house.rise === 1) {
        this.env.house.riseRate = 0.8;
        this.env.house.rise = 0;
      }
      if (since > 3.2) {
        this.say.hint(false);
        this.env.setGust(0);
        this.placeFinalHouse();
        this.phase = 'off';
        this.ramp.visible = false;
        this.rampTarget = this.rampUp = 0;
        this.onChase();
      }
      this.updateRamp(dt);
      return null;
    }
    if (this.phase === 'flee') {
      // Headwind and a wave through the grass, all of it toward the house.
      const k = smoothstep(0, 2.5, t - this.fleeStart());
      c.applyWind(0, 0.55 * k, 0);
      this.env.setGust(0.8 * k);
      this.env.rippleGrass(c.x - 6, k);
      // Ahead of her the path heaves up and curls: a banked half-ring of cobbles.
      if (this.rampTarget === 0 && t - this.fleeStart() > 0.8) {
        this.rampTarget = 1;
        this.ramp.visible = true;
        this.bus.emit('pavement:rise', {});
        c.lane = 0;
      }
      if (c.x <= ARC_X) {
        // Onto the ramp: she keeps running, and the curve carries her round.
        this.phase = 'turn';
        this.arcA = 0;
        this.arcZ0 = c.z + ARC_R;
        this.arcSpeed = Math.min(3.6, Math.max(3.0, c.speed));
        c.controllable = false;
      }
    }
    this.updateRamp(dt);
    return null;
  }

  private updateRamp(dt: number): void {
    this.rampUp = damp(this.rampUp, this.rampTarget, 2.2, dt);
    this.ramp.position.y = (this.rampUp - 1) * 2.6;
    if (this.rampTarget === 0 && this.rampUp < 0.01) this.ramp.visible = false;
  }

  /** Round the U: position, height and facing all follow the curve; the camera turns with her. */
  private updateTurn(dt: number): void {
    const v = this.visitor;
    const c = v.controller;
    this.arcSpeed = damp(this.arcSpeed, 2.7, 1.5, dt);
    this.arcA = Math.min(Math.PI, this.arcA + (this.arcSpeed / ARC_R) * dt);
    const a = this.arcA;
    this.arcY = arcH(a, ARC_R) + this.ramp.position.y;
    const heading = Math.atan2(-Math.cos(a), Math.sin(a));
    // Ease in from wherever she was across the path when the curve took her.
    const zIn = this.arcZ0 * (1 - smoothstep(0, 0.7, a));
    v.place(ARC_X - ARC_R * Math.sin(a), -ARC_R * Math.cos(a) + zIn, heading, this.arcGround);
    v.updateCinematic(dt, this.arcSpeed * 1.6);
    if (a >= Math.PI) {
      // Round: facing the house again, running on toward it.
      this.phase = 'loop';
      this.loopAt = this.time;
      c.dir = 1;
      c.mode = 'run';
      c.lane = 2;
      c.speed = 4.5;
      c.controllable = true;
      v.heading = Math.PI / 2;
      this.camera.dir = 1;
      this.camera.shake(0.3);
      this.bus.emit('pavement:sarcasm', { x: c.x });
    }
  }

  private loopAt = 0;
  private fleeT = -1;

  private fleeStart(): number {
    if (this.fleeT < 0) this.fleeT = this.time;
    return this.fleeT;
  }

  private walkShots(a0: number): Shot[] {
    const v = this.visitor;
    const E = new THREE.Vector3();
    return [
      {
        // Behind her and to the side: the path, and the house at the top of it.
        name: 'to-house',
        start: 0,
        blend: 2.0,
        frame: (_t, o) => {
          const p = v.position;
          o.pos.set(p.x - 4.2, p.y + 1.9, p.z + 3.0);
          o.look.set(p.x + 10, p.y + 3.4, COURSE.houseZ * 0.4);
          o.fov = 44;
        },
      },
      {
        // Over her shoulder: the phone, the house beyond it.
        name: 'invite',
        start: a0 + 0.3,
        blend: 1.6,
        frame: (_t, o) => {
          v.eyesWorld(E);
          v.phoneScreenWorld(this.tmp);
          o.pos.copy(E).add(new THREE.Vector3(-0.55, 0.12, 0.42));
          o.look.copy(this.tmp);
          o.fov = 36;
        },
      },
      {
        // Her face, the house behind her, as she turns.
        name: 'turn',
        start: a0 + 8.4,
        blend: 1.2,
        frame: (_t, o) => {
          v.eyesWorld(E);
          o.pos.copy(E).add(new THREE.Vector3(-2.2, -0.2, 0.6));
          o.look.copy(E).add(new THREE.Vector3(1.5, 0.6, -0.3));
          o.fov = 40;
        },
      },
    ];
  }
}

function P(v: Visitor) {
  return v.performer;
}
