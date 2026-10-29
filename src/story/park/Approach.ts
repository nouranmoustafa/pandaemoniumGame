import * as THREE from 'three';
import type { CinematicDirector, Shot, ShotFrame } from '../../camera/CinematicDirector';
import type { ChaseCamera } from '../../camera/ChaseCamera';
import { CHASE, COURSE } from '../../config';
import type { EventBus } from '../../core/Events';
import { clamp, damp } from '../../core/math';
import { APP_BEATS, type DatingApp } from '../../ui/DatingApp';
import type { Visitor } from '../../visitor/Visitor';
import type { Environment } from '../../world/Environment';

/** Where she stops to read the invitation: the house stands at the end of the road, far off. */
const STOP_X = CHASE.start;
/** Where the cut finds her, walking on toward it. */
const WALK_FROM = STOP_X - 20;
/** Black between the park gate and deep in the park. */
const CUT = 0.45;

type Phase = 'off' | 'cut' | 'walk' | 'phone';

/**
 * Between the prologue and the chase. A cut: she has walked deep into the
 * park, and the old garden house stands at the end of the road. Her date
 * writes again, in the same app: come inside. The park goes wrong around her;
 * she turns her back on the house and runs — in her own eyes now (first
 * person) — and the chase begins: away from the house, toward her friends.
 */
export class Approach {
  phase: Phase = 'off';
  time = 0;
  /** Called when she turns and runs: the chase proper begins. */
  onChase: () => void = () => {};
  private walkSpeed = 0;
  private heading = Math.PI / 2;
  private targetHeading = Math.PI / 2;
  private cues: Array<{ at: number; run: () => void }> = [];
  private cueIndex = 0;
  private tmp = new THREE.Vector3();
  private arrivalCues: Array<{ at: number; run: () => void }> = [];
  private arriveAt = -1;

  constructor(
    private env: Environment,
    private visitor: Visitor,
    private app: DatingApp,
    private director: CinematicDirector,
    private camera: ChaseCamera,
    private bus: EventBus,
    private say: {
      prompt: (html: string | null) => void;
      hint: (v: boolean) => void;
      phone: (c: HTMLCanvasElement | null) => void;
      fade: (opacity: number, seconds: number) => void;
    },
  ) {}

  get active(): boolean {
    return this.phase !== 'off';
  }

  /** The house stands where it always stands: at the end of the road. */
  placeFirstHouse(): void {
    const H = this.env.house;
    H.group.position.set(COURSE.houseX, H.group.position.y, COURSE.houseZ);
    H.rise = 1;
    H.snapRise();
    H.riseRate = 0.32;
  }

  /** Sunk where it stands, until the slide brings her back to it. */
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
    this.say.phone(null);
    this.cues = [];
    this.cueIndex = 0;
  }

  /** From the prologue's last shot: to black, and deep into the park. */
  begin(): void {
    this.phase = 'cut';
    this.time = 0;
    this.say.fade(1, CUT * 0.8);
    const cam = this.camera.camera;
    const hold: Shot = {
      name: 'hold',
      start: 0,
      blend: 0,
      frame: (_t, o) => {
        o.pos.copy(cam.position);
        o.look.copy(cam.getWorldDirection(this.tmp).multiplyScalar(10).add(cam.position));
        o.fov = cam.fov;
      },
    };
    const f: ShotFrame = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: cam.fov };
    hold.frame(0, f);
    this.director.setShots([{ ...hold, frame: (_t, o) => (o.pos.copy(f.pos), o.look.copy(f.look), (o.fov = f.fov)) }]);
    this.director.startFrom(f.pos, f.look, f.fov);
    this.cues = [{ at: CUT, run: () => this.beginWalk() }];
    this.cueIndex = 0;
  }

  private beginWalk(): void {
    this.phase = 'walk';
    this.walkSpeed = 2.2;
    this.heading = this.targetHeading = Math.PI / 2;
    const v = this.visitor;
    const P = v.performer;
    const H = this.env.house;
    this.placeFirstHouse();
    v.place(WALK_FROM, 0, this.heading, this.env.pavement);
    const sound = (id: 'buzz' | 'notify' | 'flicker' | 'grass' | 'swing' | 'branch') => this.bus.emit('prologue:sound', { id });
    const houseLook = new THREE.Vector3(COURSE.houseX - 6, 6, COURSE.houseZ);
    this.cues = [{ at: CUT + 0.2, run: () => (P.lookAt(houseLook, 0.7), P.express({ concern: 0.35, smile: 0.1 }, 2)) }];
    this.cueIndex = 0;
    const shots = this.walkShots(1e6);
    const f0: ShotFrame = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 44 };
    shots[0].frame(0, f0);
    this.director.setShots(shots);
    this.director.startFrom(f0.pos, f0.look, f0.fov);
    this.say.fade(0, 0.9);
    // Phone cues are queued when she stops (see update).
    this.arrivalCues = [
      { at: 0.1, run: () => (sound('buzz'), P.setPhone(1), P.express({ concern: 0.3, surprise: 0.2 }, 3)) },
      // Her phone, held up to us: the same app. The invitation arrives at ~1.8 s and stays readable ~3.6 s.
      { at: 0.6, run: () => this.say.phone(this.app.screen) },
      { at: 0.9, run: () => sound('notify') },
      { at: 5.4, run: () => this.say.phone(null) },
      // Eerie: the lamps stutter, the windows flare, the door eases open, the wind turns.
      { at: 5.5, run: () => (this.env.lamps.stutter(STOP_X + 4, 1.6), sound('flicker'), this.env.flareHouse(), (H.doorOpen = 0.25), this.env.setGust(0.9)) },
      { at: 5.8, run: () => (P.setPhone(0), P.lookAt(houseLook, 1), P.express({ fear: 0.6, surprise: 0.4 }, 4), (P.nervous = 0.6), sound('grass')) },
      { at: 6.3, run: () => (P.play('hesitate', 1), this.env.rippleGrass(STOP_X + 2, 1)) },
      // She will not go in. She turns her back on it.
      { at: 6.8, run: () => ((this.targetHeading = -Math.PI / 2), P.lookAt(null), P.express({ fear: 0.75, determined: 0.5 }, 4)) },
      { at: 7.5, run: () => this.beginFlee() },
    ];
  }

  /** Skip / retry: straight to the chase. */
  cancel(): void {
    this.phase = 'off';
  }

  /** She runs: the chase is hers (and the Demon's) from here. */
  private beginFlee(): void {
    this.phase = 'off';
    this.say.hint(true);
    this.env.setGust(0);
    this.env.house.doorOpen = 0;
    this.onChase();
  }

  subject() {
    const v = this.visitor;
    const c = v.controller;
    return { position: v.position, speed: c.speed, slide: c.slideBlend, eyes: v.eyesWorld(this.tmp), heading: v.heading };
  }

  /** Returns the directed shot while she walks and reads. */
  update(dt: number, _input: import('../../core/Input').Input): ShotFrame | null {
    this.time += dt;
    const t = this.time;
    while (this.cueIndex < this.cues.length && this.cues[this.cueIndex].at <= t) this.cues[this.cueIndex++].run();
    if (this.phase === 'off') return null;
    const v = this.visitor;
    const c = v.controller;
    if (this.phase === 'walk' && c.x >= STOP_X - 0.6) {
      this.phase = 'phone';
      this.arriveAt = t;
      this.cues = this.arrivalCues.map((q) => ({ at: q.at + t, run: q.run }));
      this.cueIndex = 0;
      this.director.setShots(this.walkShots(t));
    }
    if (this.phase === 'walk' || this.phase === 'phone') {
      this.walkSpeed = damp(this.walkSpeed, this.phase === 'walk' ? 2.6 : 0, this.phase === 'walk' ? 2.2 : 3.5, dt);
      this.heading += clamp(this.targetHeading - this.heading, -2.6 * dt, 2.6 * dt);
      const z = damp(c.z, 0, 1.2, dt);
      v.place(c.x + Math.sin(this.heading) * this.walkSpeed * dt * (this.phase === 'walk' ? 1 : 0), z, this.heading, this.env.pavement);
      v.updateCinematic(dt, this.walkSpeed);
      if (this.phase === 'phone') {
        // The app: her date writes again — the invitation.
        const a = t - this.arriveAt;
        this.app.update(APP_BEATS.sent + 0.8 + clamp(a - 0.4, 0, 6) * (APP_BEATS.inviteMsg - APP_BEATS.sent) / 1.4);
        if (v.performer.phone > 0.3) v.aimPhone(v.eyesWorld(this.tmp), 1);
      }
    }
    return this.director.update(t, dt);
  }

  private walkShots(a0: number): Shot[] {
    const v = this.visitor;
    const E = new THREE.Vector3();
    return [
      {
        // Behind her and to the side: the road, and the house at the end of it.
        name: 'to-house',
        start: 0,
        blend: 2.0,
        frame: (_t, o) => {
          const p = v.position;
          o.pos.set(p.x - 4.6, p.y + 1.8, p.z + 3.0);
          o.look.set(p.x + 18, p.y + 4.2, COURSE.houseZ * 0.4);
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
        // Her face, the house far behind her, as she turns.
        name: 'turn',
        start: a0 + 5.6,
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
