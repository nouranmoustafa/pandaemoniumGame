import * as THREE from 'three';
import { CinematicDirector, type Shot, type ShotFrame } from '../../camera/CinematicDirector';
import type { ChaseCamera } from '../../camera/ChaseCamera';
import { Corruption } from '../../characters/Corruption';
import type { CharacterId } from '../../characters/design';
import { STRUGGLE } from '../../characters/gestures';
import { COURSE, LANES, type LaneIndex } from '../../config';
import type { EventBus, FinaleSound } from '../../core/Events';
import type { Input } from '../../core/Input';
import { clamp, damp, lerp, smoothstep } from '../../core/math';
import type { StoryState } from '../../core/StateMachine';
import { APP_BEATS } from '../../ui/DatingApp';
import type { Visitor } from '../../visitor/Visitor';
import type { Ground } from '../../visitor/VisitorController';
import type { Environment } from '../../world/Environment';
import { ESCAPE_WINDOW, HOUSE_FLOOR, HOUSE_FRONT } from '../../world/House';
import { ROOM } from '../../world/HouseInterior';
import { LAWN_Y, WINDOW } from '../../world/HouseWindow';
import { Ribbon } from '../../world/Ribbon';
import type { HouseSequence } from '../house/HouseSequence';
import type { Prologue } from '../prologue/Prologue';
import { CalmPath } from './CalmPath';

type Phase = 'off' | 'window' | 'wipe' | 'return' | 'choice' | 'stay' | 'escape' | 'struggle' | 'fall' | 'landing' | 'run' | 'reveal' | 'black' | 'ending' | 'done';
type FriendId = Exclude<CharacterId, 'visitor'>;
export type FinaleJump = 'window' | 'choice' | 'run' | 'reveal';

/** Stage 6 pacing: cue clocks that run faster than real time (the same beats, less waiting). */
const CLOCK: Partial<Record<Phase, number>> = { window: 1.4, return: 1.3, stay: 1.3, escape: 1.25, landing: 2.0, reveal: 1.6 };
/** 1v1, the Visitor's ending: her date's last message, on black. */
const WARN_SHOW = 0.5;
const WARN_HIDE = 5.8;

export interface FinaleServices {
  bus: EventBus;
  input: Input;
  camera: ChaseCamera;
  fade: (opacity: number, seconds: number) => void;
  shake: (amount: number) => void;
  prompt: (html: string | null) => void;
  choice: (options: string[] | null, selected: number) => void;
  /** The last line, over the closing shot (null hides it). */
  caption: (text: string | null) => void;
  effort: (v: number, tapped: boolean, visible: boolean) => void;
  /** The dating app held up to the player (null hides it); `over` puts it above the black. */
  phone: (screen: HTMLCanvasElement | null, over?: boolean) => void;
}

interface Cue {
  at: number;
  run: () => void;
}

interface FriendState {
  id: FriendId;
  /** Where she stands, and which way she faces. */
  pos: THREE.Vector3;
  heading: number;
  speed: number;
  /** A held pose: the performer stops advancing (the body goes still). */
  frozen: boolean;
  /** Seconds until the next wave, while they are waving her over. */
  waveT: number;
  waving: boolean;
}

/** Interior (set-local) marks at the window. */
const STAND = new THREE.Vector3(WINDOW.x - 0.8, 0, -3.7);
/** The camera the fog drawings are drawn for: from here they sit exactly over the friends. */
const ALIGN_EYE = new THREE.Vector3(WINDOW.x + 0.1, 1.62, -1.75);
const ALIGN_LOOK = new THREE.Vector3(WINDOW.x + 0.1, 1.42, -11.5);
/** The friends on the lawn outside the hall window (set-local). */
const LAWN: Record<FriendId, THREE.Vector3> = {
  // Spaced so that, from ALIGN_EYE, each falls on clear glass (not a bar of the frame).
  odette: new THREE.Vector3(WINDOW.x - 2.05, LAWN_Y, -11.6),
  juno: new THREE.Vector3(WINDOW.x + 0.66, LAWN_Y, -11.0),
  wren: new THREE.Vector3(WINDOW.x + 2.5, LAWN_Y, -11.8),
};
/** Where the friends wait on the path for the final run (world X), and her stopping distance. */
export const FRIENDS_X = COURSE.houseX + HOUSE_FRONT - 11.5 - 70;
const PATH_Z: Record<FriendId, number> = { odette: -1.85, juno: 0.15, wren: 2.05 };
const STOP_AT = 9.5;
/** Where she lands below the escape window (world), and the run's first mark. */
const HOUSE_POS = new THREE.Vector3(COURSE.houseX, 0, COURSE.houseZ);
const LAND = new THREE.Vector3(COURSE.houseX + ESCAPE_WINDOW.x, 0, COURSE.houseZ + ESCAPE_WINDOW.z + 1.55);
const RUN_FROM = COURSE.houseX + HOUSE_FRONT - 11.5;
/** From the lawn round the porch to the gap in the front fence, then onto the path. */
const ROUTE = [new THREE.Vector3(COURSE.houseX + HOUSE_FRONT - 2.5, 0, 5.4), new THREE.Vector3(RUN_FROM + 2.2, 0, 0.9)];
/** Wipes it takes to clear the glass. */
const WIPES = 3;
/** Taps it takes to tear free. */
const PULLS = 6;

const CHOICES = ['LEAVE THROUGH THE WINDOW', 'STAY INSIDE'];

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Stage 5: the window, the false escape, the real demons.
 *
 * The house has been trying, in its own coercive way, to keep her from the
 * three women she trusts. It writes what they are on the window glass; she
 * reads it as one more cruelty and climbs out. It lets her go in silence.
 *
 * A — WINDOW: her friends on the lawn, the glass fogging, a finger drawing
 *     their true faces exactly over them; she wipes it away (SPACE), and it
 *     comes back, more urgent.
 * B — CHOICE: leave through the window, or stay. Staying shows her a little
 *     more (a figure too tall, a hand with too many joints on the glass),
 *     then lets her choose again.
 * C — ESCAPE: the window opens; the gown catches on the frame and the frame
 *     grows vines; she tears free (SPACE) and falls onto the lawn. The house
 *     reaches after her once, and stops. It says nothing.
 * D — FALSE FREEDOM: the chase's own controls, back along the park — calm
 *     now, the lamps warm, her friends waving at the end of the path. Then,
 *     slowly, they are not quite right.
 * E — REVEAL: each friend becomes what she is, in her own body. She
 *     understands, turns toward the house, and is taken. The house, alone.
 *
 * Like the prologue and the house it runs on phase clocks with cues that
 * fire once each, so pausing freezes it and skipping jumps it cleanly.
 */
export class FinaleSequence {
  readonly director = new CinematicDirector();
  readonly corruption = new Map<FriendId, Corruption>();
  readonly path: CalmPath;
  phase: Phase = 'off';
  /** Clock of the current phase. */
  time = 0;

  private get clockScale(): number {
    return CLOCK[this.phase] ?? 1;
  }
  /** 1v1: the Visitor won the chase and never went inside (see beginVictoryRun). */
  victory = false;
  /** Where her friends wait on the path (world X): near the house, or — after a won chase — far down the park. */
  friendsX = FRIENDS_X;
  wipes = 0;
  stays = 0;
  pulls = 0;
  /** 0..1 — the world goes quiet: wind, drone and music fall away. */
  hush = 0;
  /** 0..1 — the reassuring theme on the run home. */
  hope = 0;
  onBeat: (b: StoryState) => void = () => {};
  onComplete: () => void = () => {};
  private friends = new Map<FriendId, FriendState>();
  private cues: Cue[] = [];
  private cueIndex = 0;
  private beat: StoryState | null = null;
  // Her cinematic drive.
  private speed = 0;
  private targetSpeed = 0;
  private heading = 0;
  private targetHeading: number | null = null;
  private aim: THREE.Vector3 | null = null;
  private lift = 0;
  private outdoors = false;
  private choiceIndex = 0;
  private choiceReady = 0;
  private wiping = -1;
  private struggle = 0;
  private sinceTap = 0;
  private snag: Ribbon;
  private snagFree = false;
  private fallT = -1;
  private revealAt = -1;
  private unease = 0;
  private sync = false;
  private shadowK = 0;
  private lungeFrom = new THREE.Vector3();
  private lungeT = -1;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private eyes = new THREE.Vector3();

  private floor: Ground = { heightAt: () => this.lift, slopeAt: () => 0, rollAngle: () => 0 };
  /** Outdoors: the path, or the low mound the house stands on, whichever is higher. */
  readonly ground: Ground;

  constructor(
    scene: THREE.Scene,
    private env: Environment,
    private visitor: Visitor,
    private house: HouseSequence,
    private prologue: Prologue,
    private s: FinaleServices,
  ) {
    const kinds: Record<FriendId, 'smile' | 'puppet' | 'twoFace'> = { odette: 'smile', juno: 'puppet', wren: 'twoFace' };
    for (const f of prologue.friends) {
      const id = f.id as FriendId;
      this.corruption.set(id, new Corruption(f.char, kinds[id], scene));
      this.friends.set(id, { id, pos: new THREE.Vector3(), heading: 0, speed: 0, frozen: false, waveT: 0, waving: false });
    }
    this.snag = new Ribbon(0.2, 0.7);
    scene.add(this.snag.mesh);
    this.path = new CalmPath(env.barkMaterial);
    scene.add(this.path.group);
    const pave = env.pavement;
    this.ground = {
      heightAt: (x, z) => {
        const dx = (x - (COURSE.houseX + 10)) / 42;
        const dz = (z - COURSE.houseZ) / 40;
        const mound = -0.8 + 1.1 * Math.sqrt(Math.max(0, 1 - dx * dx - dz * dz));
        return Math.max(pave.heightAt(x, z), mound);
      },
      slopeAt: (x, z) => (this.ground.heightAt(x + 0.4, z) - this.ground.heightAt(x - 0.4, z)) / 0.8,
      rollAngle: () => 0,
    };
  }

  /** Compile what Stage 5 adds (second faces, limbs, vines, the path's debris) before anyone needs it. */
  prewarm(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const H = this.env.house;
    for (const c of this.corruption.values()) {
      c.p.secondEyes = c.p.secondFace = c.p.limbs = c.p.shadowForm = 1;
      c.p.eyes = 0.5;
      c.apply(0);
    }
    const vines = [H.escapeVine, H.doorReach, ...H.doorVines];
    for (const v of vines) {
      v.setPath([camera.position.clone().add(new THREE.Vector3(0, -1, -4)), camera.position.clone().add(new THREE.Vector3(1, -1, -4))]);
      v.extent = 1;
      v.update();
    }
    this.snag.setPath([camera.position.clone().add(new THREE.Vector3(0, 0, -3)), camera.position.clone().add(new THREE.Vector3(0.5, 0, -3))]);
    this.snag.extent = 1;
    this.snag.update(0);
    this.path.group.visible = true;
    // The gown and veil are first seen indoors; Stage 5 takes them outside, under the moon.
    this.house.dress.reveal = 0.5;
    this.house.dress.veil.begin(0);
    renderer.render(scene, camera);
    // And real frames from where Stage 5's outdoor cameras stand (the landing, the run, the
    // closing shot): whatever those views draw for the first time is compiled now, not mid-story.
    const cam = (camera as THREE.PerspectiveCamera).clone();
    const views: Array<[THREE.Vector3, THREE.Vector3]> = [
      [new THREE.Vector3(LAND.x - 2.4, 0.5, LAND.z + 1.8), new THREE.Vector3(LAND.x, 1.6, LAND.z - 1)],
      [new THREE.Vector3(LAND.x - 7, 1.5, LAND.z + 6.5), new THREE.Vector3(COURSE.houseX - 2, 5.5, COURSE.houseZ + 4)],
      [new THREE.Vector3(RUN_FROM + 6.8, 4, 6.6), new THREE.Vector3(RUN_FROM - 8, 1, 0)],
      [new THREE.Vector3(FRIENDS_X + 12, 1, 1.7), new THREE.Vector3(FRIENDS_X, 1.6, 0)],
      [new THREE.Vector3(COURSE.houseX - 64, 1.7, 5.5), new THREE.Vector3(COURSE.houseX - 4, 11.5, COURSE.houseZ - 1)],
    ];
    for (const [p, l] of views) {
      cam.position.copy(p);
      cam.lookAt(l);
      cam.updateMatrixWorld();
      renderer.render(scene, cam);
    }
    this.house.dress.reset();
    for (const c of this.corruption.values()) c.reset();
    for (const v of vines) {
      v.extent = 0;
      v.update();
    }
    this.snag.extent = 0;
    this.snag.update(0);
    this.path.group.visible = false;
  }

  get active(): boolean {
    return this.phase !== 'off' && this.phase !== 'done';
  }

  /** The playable run: the chase camera and the chase's controls own her. */
  get running(): boolean {
    return this.phase === 'run' && this.revealAt < 0;
  }

  get isOutdoors(): boolean {
    return this.outdoors;
  }

  private get perf() {
    return this.visitor.performer;
  }

  private get interior() {
    return this.house.interior;
  }

  private get win() {
    return this.house.interior.window;
  }

  private sound(id: FinaleSound, gain?: number): void {
    this.s.bus.emit('finale:sound', { id, gain });
  }

  private setBeat(b: StoryState): void {
    if (this.beat === b) return;
    this.beat = b;
    this.onBeat(b);
  }

  private setCues(cues: Cue[]): void {
    this.cues = cues.sort((a, b) => a.at - b.at);
    this.cueIndex = 0;
  }

  private enter(phase: Phase, cues: Cue[], shots?: Shot[]): void {
    this.phase = phase;
    this.time = 0;
    this.setCues(cues);
    if (shots) {
      this.director.setShots(shots);
      this.director.startFrom(this.director.out.pos, this.director.out.look, this.director.out.fov);
    }
  }

  // ------------------------------------------------------------------ flow

  /** Everything back as it was before Stage 5. */
  reset(): void {
    this.phase = 'off';
    this.time = 0;
    this.victory = false;
    this.friendsX = FRIENDS_X;
    this.beat = null;
    this.cues = [];
    this.cueIndex = 0;
    this.wipes = this.stays = this.pulls = 0;
    this.hush = this.hope = 0;
    this.wiping = -1;
    this.struggle = 0;
    this.snagFree = false;
    this.fallT = -1;
    this.revealAt = -1;
    this.unease = 0;
    this.sync = false;
    this.shadowK = 0;
    this.lungeT = -1;
    this.lift = 0;
    this.outdoors = false;
    this.aim = null;
    this.targetHeading = null;
    STRUGGLE.lean = STRUGGLE.heave = 0;
    this.snag.extent = 0;
    this.snag.update(0);
    for (const c of this.corruption.values()) c.reset();
    for (const f of this.prologue.friends) {
      f.char.phone.visible = false;
      f.char.phone.scale.set(1, 1, 1);
      f.char.setPhoneScreen(new THREE.MeshBasicMaterial({ color: 0x111111, toneMapped: false }));
    }
    const H = this.env.house;
    H.escapeOpen = 0;
    H.glow = 1;
    for (const v of [H.escapeVine, H.doorReach, ...H.doorVines]) {
      v.extent = 0;
      v.update();
    }
    this.path.reset();
    this.path.group.visible = false;
    this.env.lightOverride = null;
    this.env.calm = 0;
    this.visitor.moodOverride = null;
    this.visitor.gazeOverride = null;
    this.visitor.character.object.rotation.x = 0;
    this.s.camera.dir = 1;
    this.s.camera.menace = 0;
    this.s.prompt(null);
    this.s.choice(null, 0);
    this.s.caption(null);
    this.s.phone(null);
  }

  /**
   * 1v1, the Visitor wins: the house never gets her. No cut — she runs straight on out of the
   * chase, in her own clothes, with nothing left to dodge, and her friends are there ahead of
   * her on the path. The same reveal follows, then her date's last message.
   */
  beginVictoryRun(): void {
    const c = this.visitor.controller;
    const speed = c.speed;
    this.reset();
    this.victory = true;
    this.friendsX = c.x - 72;
    const H = this.env.house;
    H.group.position.set(COURSE.houseX, H.group.position.y, COURSE.houseZ);
    H.glow = 0.62;
    this.outdoors = true;
    this.env.setIndoors(false);
    this.interior.visible = false;
    this.placeFriendsOnPath();
    this.env.pavement.lowerInclines();
    this.env.calm = 1;
    this.beginRun(false);
    c.speed = Math.max(9, speed);
  }

  /** The gown is on and the sheet is off the mirror: she hears laughter outside. */
  start(): void {
    this.reset();
    this.env.house.group.position.set(COURSE.houseX, this.env.house.group.position.y, COURSE.houseZ);
    this.env.house.rise = 1;
    this.env.house.snapRise();
    this.visitor.useGeneratedBody(true);
    this.heading = this.visitor.heading;
    this.speed = this.targetSpeed = 0;
    if (this.house.dress.reveal < 1) this.house.dress.wearNow();
    this.placeFriendsOnLawn();
    this.director.setShots(this.windowShots());
    this.director.startFrom(this.s.camera.camera.position.clone(), this.interior.toWorld(ROOM.mirrorX - 1.2, 1.55, 0), this.s.camera.camera.fov);
    this.enter('window', this.windowCues());
    this.setBeat('WINDOW_DISCOVERY');
  }

  /** Debug / test: start at a later point, with everything that point needs. */
  jump(to: FinaleJump): void {
    this.start();
    if (to === 'window') return;
    if (to === 'choice') {
      this.time = 0;
      this.cueIndex = this.cues.length;
      this.placeVisitorIndoors(STAND.x, STAND.z, Math.PI);
      this.updateFriends(0);
      this.win.fog.cover = 1;
      this.win.fog.frost = 1;
      this.drawFaces(true, 0);
      for (let i = 0; i < 200; i++) this.win.fog.update(0.05);
      this.wipes = WIPES;
      this.beginChoice();
      return;
    }
    this.beginRun(true);
    if (to === 'reveal') {
      const c = this.visitor.controller;
      c.x = this.friendsX + STOP_AT;
      c.z = LANES[1];
      c.lane = 1;
      c.speed = 0;
      this.visitor.place(c.x, c.z, -Math.PI / 2, this.ground);
      this.unease = 1;
      this.sync = true;
      this.beginReveal(true);
    }
  }

  /**
   * Hold-Esc skip: inside, straight out onto the path for the run; during
   * the reveal, straight to the closing shot; at the end, to the card. The
   * caller fades around this.
   */
  skip(): void {
    if (this.victory && this.phase === 'reveal') this.beginBlack();
    else if (this.victory && this.phase === 'black') this.finish();
    else if (this.phase === 'reveal' || this.phase === 'black') this.beginEnding(true);
    else if (this.phase === 'ending') this.finish();
    else if (this.phase !== 'run') this.beginRun(true);
  }

  private finish(): void {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.s.caption(null);
    this.s.phone(null);
    this.s.fade(1, 0.6);
    this.onComplete();
  }

  // --------------------------------------------------------------- update

  /** One frame. Returns the directed shot, or null while the chase camera owns the run. */
  update(dt: number): ShotFrame | null {
    // Stage 6 pacing: the landing and the reveal run on a faster clock — the same beats, less waiting.
    this.time += dt * this.clockScale;
    // A cue may start the next phase (a new clock and new cues): always compare against the live clock.
    while (this.cueIndex < this.cues.length && this.cues[this.cueIndex].at <= this.time) this.cues[this.cueIndex++].run();
    const t = this.time;
    this.tickWindow(dt);
    switch (this.phase) {
      case 'window':
      case 'return':
      case 'stay':
      case 'escape':
        this.drive(dt);
        break;
      case 'wipe':
        this.updateWipe(dt);
        break;
      case 'choice':
        this.updateChoice(dt);
        break;
      case 'struggle':
        this.updateStruggle(dt);
        break;
      case 'fall':
        this.updateFall(dt);
        break;
      case 'landing':
        this.drive(dt);
        this.updateLanding(dt);
        break;
      case 'run':
        this.updateRun(dt);
        break;
      case 'reveal':
        this.updateReveal(dt);
        break;
      case 'black':
      case 'ending':
      case 'done':
        this.updateEnding(dt);
        break;
    }
    if (this.phase !== 'off') this.updateFriends(dt);
    if (!this.outdoors) {
      this.interior.update(dt);
      this.updateSnag();
    }
    this.house.dress.update(dt);
    this.env.house.escapeVine.update(t);
    for (const v of this.env.house.doorVines) v.update(t);
    this.env.house.doorReach.update(t);
    if (this.running) return null;
    return this.director.update(t, dt);
  }

  /** Walk (or be walked) toward `aim`; turn toward the target heading. */
  private drive(dt: number): void {
    const v = this.visitor;
    const c = v.controller;
    this.speed = damp(this.speed, this.targetSpeed, 2.6, dt);
    let move = this.heading;
    if (this.aim) {
      const d = Math.hypot(this.aim.x - c.x, this.aim.z - c.z);
      if (d < 0.1) {
        this.targetSpeed = 0;
        this.speed = Math.min(this.speed, d * 4);
      }
      move = Math.atan2(this.aim.x - c.x, this.aim.z - c.z);
    }
    const want = this.targetHeading ?? (this.speed > 0.2 ? move : this.heading);
    this.heading += clamp(wrapAngle(want - this.heading), -2.4 * dt, 2.4 * dt);
    v.place(c.x + Math.sin(move) * this.speed * dt, c.z + Math.cos(move) * this.speed * dt, this.heading, this.outdoors ? this.ground : this.floor);
    v.updateCinematic(dt, this.speed);
  }

  private placeVisitorIndoors(x: number, z: number, heading: number): void {
    const w = this.interior.toWorld(x, 0, z, this.tmp);
    this.heading = heading;
    this.targetHeading = heading;
    this.visitor.place(w.x, w.z, heading, this.floor);
  }

  private walkTo(x: number, z: number, speed: number, heading: number | null = null): void {
    this.aim = this.outdoors ? new THREE.Vector3(x, 0, z) : this.interior.toWorld(x, 0, z);
    this.targetSpeed = speed;
    this.targetHeading = heading;
  }

  // ------------------------------------------------------------- friends

  private friendChar(id: FriendId) {
    return this.prologue.friend(id);
  }

  private placeFriendsOnLawn(): void {
    for (const [id, st] of this.friends) {
      this.interior.toWorld(LAWN[id].x, LAWN[id].y, LAWN[id].z, st.pos);
      st.heading = Math.atan2(WINDOW.x - LAWN[id].x, 0 - LAWN[id].z) * 0.35;
      st.frozen = false;
      st.speed = 0;
      st.waving = true;
      st.waveT = id === 'juno' ? 1.2 : id === 'wren' ? 4.5 : 3;
      const f = this.friendChar(id);
      f.perf.reset();
      f.perf.autoFidget = true;
      f.char.object.visible = true;
      f.perf.express({ smile: 0.45 }, 3);
    }
    this.prologue.twin.setActive(false);
  }

  private placeFriendsOnPath(): void {
    for (const [id, st] of this.friends) {
      st.pos.set(this.friendsX + (id === 'juno' ? 0.4 : 0), 0, PATH_Z[id]);
      st.pos.y = this.ground.heightAt(st.pos.x, st.pos.z);
      st.heading = Math.PI / 2;
      st.frozen = false;
      st.speed = 0;
      st.waving = true;
      st.waveT = id === 'juno' ? 0.5 : id === 'odette' ? 1.6 : 2.6;
      const f = this.friendChar(id);
      f.perf.reset();
      f.perf.autoFidget = true;
      f.char.object.visible = true;
      f.perf.express({ smile: 0.5 }, 3);
      this.corruption.get(id)!.reset();
    }
  }

  private updateFriends(dt: number): void {
    const vEyes = this.visitor.eyesWorld(this.eyes);
    for (const [id, st] of this.friends) {
      const f = this.friendChar(id);
      if (!f.char.object.visible) continue;
      if (st.waving && !st.frozen) {
        st.waveT -= dt;
        if (st.waveT <= 0) {
          st.waveT = 3.2 + (id === 'wren' ? 2.5 : id === 'odette' ? 1.2 : 0);
          f.perf.play(id === 'juno' && this.phase === 'run' ? 'beckon' : 'wave', id === 'odette' ? -1 : 1);
        }
      }
      if (st.speed > 0) {
        st.pos.x += Math.sin(st.heading) * st.speed * dt;
        st.pos.z += Math.cos(st.heading) * st.speed * dt;
        if (this.outdoors) st.pos.y = this.ground.heightAt(st.pos.x, st.pos.z);
      }
      f.char.object.position.copy(st.pos);
      f.char.object.rotation.set(0, st.heading, 0);
      // On the path they watch her come; at the window they watch the window.
      if (this.sync || (this.phase === 'run' && !st.frozen)) f.perf.lookAt(vEyes, this.sync ? 1 : 0.6);
      f.perf.update(st.frozen ? 0 : dt, { speed: st.speed });
      this.corruption.get(id)!.apply(dt);
      // The phone in her hand turns its screen to us: the same conversation.
      if (f.char.phone.visible) f.char.aimPhone(this.s.camera.camera.position, 1);
      f.char.updateSecondary(dt, { velocity: this.tmp2.set(0, 0, 0), accel: this.tmp2, wind: this.outdoors ? 0.05 : 0.02, slide: 0 });
    }
    if (this.outdoors) this.prologue.twin.update(dt);
  }

  // -------------------------------------------------------------- window

  /** Window-local glass point → world. */
  private glassWorld(x: number, y: number, out: THREE.Vector3): THREE.Vector3 {
    return this.interior.toWorld(this.win.left + x, WINDOW.sill + y, this.win.glassZ, out);
  }

  /**
   * The invisible finger: their true faces, drawn on the glass exactly over
   * them as seen from ALIGN_EYE. Each feature is designed in metres around
   * the friend's own head and carried onto the glass by projection, so the
   * marks fit wherever the friends happen to stand. `urgent` draws it again
   * fast and harder, with slashes.
   */
  private drawFaces(urgent: boolean, delay: number, duration = urgent ? 3.4 : 5.6): void {
    const fog = this.win.fog;
    for (const st of this.friends.values()) st.frozen = true;
    const eye = ALIGN_EYE;
    const lines: Array<{ pts: Array<[number, number]>; w: number; len: number }> = [];
    const order: FriendId[] = urgent ? ['wren', 'odette', 'juno'] : ['odette', 'juno', 'wren'];
    for (const id of order) {
      const f = this.friendChar(id);
      const head = f.char.getEyesWorld(new THREE.Vector3()).sub(this.interior.group.position);
      const proj = this.win.project(eye, head);
      // Friend-metres around the eyes → glass metres. The drawing is larger than life:
      // a mask laid over each of them, not a portrait.
      const k = proj.scale * 2.1;
      const P = (x: number, y: number): [number, number] => [proj.x + x * k, proj.y + y * k];
      const line = (pts: Array<[number, number]>, w = 0.011) => {
        const g = pts.map(([x, y]) => P(x, y));
        let len = 0;
        for (let i = 1; i < g.length; i++) len += Math.hypot(g[i][0] - g[i - 1][0], g[i][1] - g[i - 1][1]);
        lines.push({ pts: g, w, len });
      };
      const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 18, wob = 0): Array<[number, number]> =>
        Array.from({ length: n + 1 }, (_, i) => {
          const a = a0 + ((a1 - a0) * i) / n;
          const w = wob ? 1 + Math.sin(i * 2.7) * wob : 1;
          return [cx + Math.cos(a) * rx * w, cy + Math.sin(a) * ry * w] as [number, number];
        });
      const spiral = (cx: number, cy: number, r: number, turns: number): Array<[number, number]> =>
        Array.from({ length: Math.round(turns * 14) + 1 }, (_, i) => {
          const f2 = i / (turns * 14);
          const a = f2 * turns * Math.PI * 2;
          return [cx + Math.cos(a) * r * (1 - f2 * 0.8), cy + Math.sin(a) * r * 1.25 * (1 - f2 * 0.8)] as [number, number];
        });
      const reps = urgent ? 2 : 1;
      for (let r = 0; r < reps; r++) {
        const j = r * 0.012;
        if (id === 'odette') {
          // A long skull, the jaw dragged down on one side; a smile from ear to ear and past them;
          // two holes where her eyes are.
          line([...arc(0, 0.02, 0.15 + j, 0.2, Math.PI * 0.1, Math.PI * 0.9, 16), [-0.16, -0.12], [-0.12, -0.42], [0.02, -0.5], [0.14, -0.3], [0.15, -0.05]]);
          line(spiral(-0.05, 0.0, 0.04, 2.6), 0.02);
          line(spiral(0.05, 0.0, 0.04, 2.6), 0.02);
          line(arc(0, 0.02, 0.27 + j, 0.24, Math.PI * 1.08, Math.PI * 1.92, 22));
          for (let i = 0; i < 9; i++) {
            const a = Math.PI * (1.15 + (i / 8) * 0.7);
            const x = Math.cos(a) * 0.27;
            const y = 0.02 + Math.sin(a) * 0.24;
            line([
              [x, y + 0.03],
              [x, y - 0.035],
            ], 0.01);
          }
        } else if (id === 'juno') {
          // A face pulled long; four eyes; a lipless smile of teeth.
          line(arc(0, -0.19, 0.12 + j, 0.36, 0, Math.PI * 2, 26, 0.05));
          for (const [x, y] of [
            [-0.045, -0.07],
            [0.045, -0.07],
            [-0.05, 0.03],
            [0.05, 0.03],
          ] as const)
            line(arc(x, y, 0.022, 0.016, 0, Math.PI * 2, 10), 0.012);
          line([
            [-0.08, -0.33],
            [0.08, -0.33],
          ]);
          for (let i = 0; i < 7; i++)
            line(
              [
                [-0.07 + i * 0.023, -0.3],
                [-0.07 + i * 0.023, -0.36],
              ],
              0.009,
            );
        } else {
          // The head far too high on a neck like a stalk; a crooked seam of a mouth;
          // more eyes than a face has; long jointed limbs out of her shoulders.
          const up = 0.38;
          line([
            [-0.04, -0.3],
            [-0.03, -0.05],
            [-0.025, up - 0.1],
          ]);
          line([
            [0.04, -0.3],
            [0.035, -0.05],
            [0.025, up - 0.1],
          ]);
          line(arc(0.01, up, 0.11 + j, 0.15, -Math.PI * 0.4, Math.PI * 1.4, 20, 0.08));
          line(
            [
              [-0.08, up - 0.06],
              [-0.04, up - 0.03],
              [-0.01, up - 0.08],
              [0.03, up - 0.04],
              [0.07, up - 0.09],
            ],
            0.012,
          );
          for (const [x, y] of [
            [-0.05, up + 0.04],
            [0.05, up + 0.05],
            [0.1, up + 0.11],
            [-0.11, up + 0.09],
          ] as const)
            line(
              [
                [x - 0.02, y],
                [x + 0.02, y + 0.004],
              ],
              0.012,
            );
          for (const s of [-1, 1])
            line([
              [s * 0.16, -0.3],
              [s * 0.34, -0.06],
              [s * 0.42, -0.38],
              [s * 0.46, -0.66],
            ]);
        }
      }
      if (urgent)
        // Slashes under each of them, as if the finger is pointing, again and again.
        for (let i = 0; i < 2; i++)
          line([
            [-0.1 + i * 0.2, -0.6],
            [-0.02 + i * 0.12, -1.0],
          ]);
    }
    // One finger, one line at a time, at whatever pace finishes it in `duration`.
    const gap = urgent ? 0.025 : 0.07;
    const total = lines.reduce((s, l) => s + l.len, 0);
    const speed = clamp(total / Math.max(0.5, duration - gap * lines.length), 0.3, 3);
    let at = delay;
    for (const l of lines) {
      fog.stroke(l.pts, at, speed, l.w);
      at += l.len / speed + gap;
    }
  }

  /** Marks the finger makes before it finds what it means to draw. */
  private drawScratches(delay: number): void {
    const fog = this.win.fog;
    const W = WINDOW.width;
    const H = WINDOW.height;
    let at = delay;
    const seeds = [0.21, 0.67, 0.43, 0.82, 0.35];
    for (let i = 0; i < seeds.length; i++) {
      const cx = W * (0.2 + seeds[i] * 0.6);
      const cy = H * (0.45 + ((i * 0.37) % 0.35));
      const pts: Array<[number, number]> = [];
      for (let k = 0; k < 9; k++) pts.push([cx + Math.sin(k * 1.9 + i) * 0.07, cy + Math.cos(k * 2.6 + i * 2) * 0.05 - k * 0.012]);
      fog.stroke(pts, at, 0.5, 0.012);
      at += 0.45;
    }
  }

  private windowCues(): Cue[] {
    const V = this.perf;
    const I = this.interior;
    const juno = () => this.friendChar('juno').char.getEyesWorld(new THREE.Vector3());
    const glassMid = this.glassWorld(WINDOW.width * 0.55, 1.0, new THREE.Vector3());
    return [
      { at: 0.0, run: () => (this.sound('laughFar'), this.friendChar('juno').perf.play('laugh'), this.friendChar('odette').perf.play('arms', 1, 30)) },
      { at: 0.3, run: () => (V.lookAt(I.toWorld(WINDOW.x, 1.8, -4.2), 0.8), V.express({ concern: 0.5, surprise: 0.4 }, 3)) },
      { at: 0.9, run: () => (this.targetHeading = Math.atan2(STAND.x - ROOM.altarX, STAND.z)) },
      { at: 1.5, run: () => this.walkTo(STAND.x, STAND.z, 1.35) },
      { at: 2.6, run: () => this.sound('laughFar', 0.7) },
      // She sees who it is.
      { at: 4.6, run: () => (V.lookAt(juno(), 0.9), V.express({ smile: 0.55, surprise: 0.3, concern: 0.25 }, 2.5), (V.nervous = 0.2)) },
      { at: 5.6, run: () => (this.targetHeading = Math.PI) },
      { at: 6.0, run: () => V.play('palmsGlass', 1, 600) },
      { at: 7.2, run: () => (V.stop('palmsGlass'), V.play('knock', -1)) },
      { at: 8.0, run: () => (this.sound('frame'), (this.win.stir = 0.35), this.holdFriends(), this.setBeat('WINDOW_CONDENSATION')) },
      { at: 8.4, run: () => V.play('palmsGlass', 1, 600) },
      { at: 8.6, run: () => this.sound('frost') },
      { at: 10.0, run: () => (V.lookAt(glassMid, 0.9), V.express({ concern: 0.7, surprise: 0.2 }, 3), this.walkTo(STAND.x, STAND.z - 0.1, 0.25, Math.PI)) },
      { at: 11.0, run: () => this.sound('scrape', 0.6) },
      // The finger: first nothing anyone could read, then their faces.
      { at: 13.0, run: () => (this.setBeat('WINDOW_WARNING'), this.drawScratches(0), V.stop('palmsGlass')) },
      { at: 13.2, run: () => this.sound('scrape') },
      { at: 15.2, run: () => (this.drawFaces(false, 0), this.sound('scrape')) },
      { at: 17.0, run: () => (V.lookAt(juno(), 0.9), V.express({ concern: 0.7, fear: 0.35, surprise: 0.3 }, 2)) },
      { at: 18.5, run: () => this.sound('scrape', 0.8) },
      { at: 20.5, run: () => this.sound('scrape', 0.8) },
      {
        at: 22.0,
        run: () => {
          V.play('recoil');
          V.express({ fear: 0.6, surprise: 0.5, concern: 0.5 }, 5);
          this.sound('breath');
        },
      },
      { at: 22.6, run: () => this.walkTo(STAND.x, STAND.z + 0.45, 0.45, Math.PI) },
      // She doesn't believe it. She wants it gone.
      { at: 24.4, run: () => (V.express({ determined: 0.55, distress: 0.4, concern: 0.4 }, 2.5), this.walkTo(STAND.x + 0.15, STAND.z, 0.6, Math.PI)) },
      { at: 25.6, run: () => this.beginWipe() },
    ];
  }

  private windowShots(): Shot[] {
    const v = this.visitor;
    const I = this.interior;
    const E = new THREE.Vector3();
    const friendsAt = (o: THREE.Vector3) => o.copy(this.friendChar('juno').char.object.position).add(new THREE.Vector3(0, 1.4, 0));
    return [
      {
        // From the arch: she turns from the mirror and goes to the window.
        name: 'to-window',
        start: 0,
        blend: 2.4,
        frame: (t, o) => {
          const k = smoothstep(1, 5.5, t);
          o.pos.copy(I.toWorld(lerp(13.0, 13.9, k), 1.75, lerp(0.9, 0.2, k)));
          o.look.copy(I.toWorld(lerp(15.2, WINDOW.x, k), lerp(1.5, 1.8, k), -4.2));
          o.fov = 40;
        },
      },
      {
        // Over her right shoulder: her friends beyond the glass.
        name: 'shoulder',
        start: 4.6,
        blend: 2.0,
        frame: (_t, o) => {
          v.eyesWorld(E);
          o.pos.copy(E).add(new THREE.Vector3(0.48, 0.1, 0.95));
          friendsAt(o.look);
          o.fov = 36;
        },
      },
      {
        // Slowly toward the glass.
        name: 'to-glass',
        start: 8.0,
        blend: 4.5,
        frame: (_t, o) => {
          o.pos.copy(I.toWorld(ALIGN_EYE.x + 0.15, ALIGN_EYE.y, ALIGN_EYE.z + 0.55));
          friendsAt(o.look);
          o.fov = 30;
        },
      },
      {
        // The drawing's own point of view: from here it lies exactly over them.
        name: 'align',
        start: 12.4,
        blend: 1.6,
        frame: (_t, o) => {
          o.pos.copy(I.toWorld(ALIGN_EYE.x, ALIGN_EYE.y, ALIGN_EYE.z));
          o.look.copy(I.toWorld(ALIGN_LOOK.x, ALIGN_LOOK.y, ALIGN_LOOK.z));
          o.fov = 24;
        },
      },
      {
        // She steps back from it: her face, the glass behind her.
        name: 'recoil',
        start: 21.8,
        blend: 1.2,
        frame: (_t, o) => {
          v.eyesWorld(E);
          o.pos.copy(E).add(new THREE.Vector3(-0.85, -0.05, -0.55));
          o.look.copy(E).add(new THREE.Vector3(0, -0.03, 0));
          o.fov = 30;
        },
      },
      {
        name: 'align-again',
        start: 24.0,
        blend: 1.4,
        frame: (_t, o) => {
          o.pos.copy(I.toWorld(ALIGN_EYE.x - 0.5, ALIGN_EYE.y + 0.05, ALIGN_EYE.z + 0.4));
          o.look.copy(I.toWorld(ALIGN_LOOK.x - 0.4, ALIGN_LOOK.y - 0.1, ALIGN_LOOK.z));
          o.fov = 32;
        },
      },
    ];
  }

  // ---------------------------------------------------------------- wipe

  private beginWipe(): void {
    this.enter('wipe', [], [
      {
        name: 'wipe-close',
        start: 0,
        blend: 1.2,
        frame: (_t, o) => {
          const c = this.visitor.controller;
          o.pos.set(c.x + 0.95, 1.55, c.z + 0.55);
          o.look.set(c.x + 0.25, 1.4, this.interior.toWorld(0, 0, this.win.glassZ).z);
          o.fov = 38;
        },
      },
    ]);
    this.setBeat('WINDOW_WIPE');
    this.wiping = -1;
    this.s.prompt('TAP SPACE — <span>WIPE GLASS</span>');
  }

  private updateWipe(dt: number): void {
    this.drive(dt);
    const fog = this.win.fog;
    if (this.wiping < 0 && this.wipes < WIPES && this.s.input.consume('sprint')) {
      this.wiping = 0;
      this.perf.play('wipe', -1);
      this.sound('scrape', 0.35);
      this.s.prompt(null);
    }
    if (this.wiping >= 0) {
      this.wiping += dt;
      // Where her sleeve actually is, pressed to the glass.
      const w = this.visitor.character.getBoneWorld('wristR', this.tmp);
      const e = this.visitor.character.getBoneWorld('elbowR', this.tmp2);
      const contact = smoothstep(0.08, 0.2, this.wiping) * (1 - smoothstep(0.85, 1.0, this.wiping));
      if (contact > 0) {
        for (const p of [w, e.lerp(w, 0.5)]) {
          const local = p.sub(this.interior.group.position);
          fog.wipe(clamp(local.x - this.win.left, 0, WINDOW.width), clamp(local.y - WINDOW.sill, 0, WINDOW.height), 0.13, 0.26 * contact);
        }
        // The sweep also clears the band its arc passes through (her arm is longer than her wrist).
        const sweep = Math.sin(smoothstep(0.08, 0.95, this.wiping) * Math.PI * 2);
        const bx = clamp(this.visitor.controller.x - this.interior.group.position.x - this.win.left + 0.55 + sweep * 0.28, 0, WINDOW.width);
        fog.wipe(bx, 0.7 + Math.cos(this.wiping * 6.3) * 0.2, 0.16, 0.2 * contact);
      }
      if (this.wiping > 1.05) {
        this.wiping = -1;
        this.wipes++;
        if (this.wipes < WIPES) {
          // A step along the glass for the next one.
          this.walkTo(STAND.x + 0.15 + this.wipes * 0.42, STAND.z, 0.7, Math.PI);
          this.s.prompt('TAP SPACE — <span>WIPE GLASS</span>');
        } else this.glassCleared();
      }
    }
  }

  /** Clear. Just her friends, waving, by the lamp. Then it comes back. */
  private glassCleared(): void {
    const fog = this.win.fog;
    for (const st of this.friends.values()) st.frozen = false;
    const V = this.perf;
    this.enter(
      'return',
      [
        { at: 0.0, run: () => ((fog.cover = 0), fog.refog(0.8), (this.win.stir = 0.1)) },
        { at: 0.5, run: () => (this.walkTo(STAND.x - 0.05, STAND.z + 0.12, 0.8, Math.PI), V.express({ smile: 0.5, concern: 0.15 }, 2.4), (V.nervous = 0)) },
        { at: 1.4, run: () => (this.friendChar('juno').perf.play('wave'), this.sound('laughFar', 0.5)) },
        { at: 3.4, run: () => (this.setBeat('WINDOW_WARNING_RETURN'), this.sound('frame'), this.sound('frost'), (this.win.stir = 0.75)) },
        { at: 4.1, run: () => this.holdFriends() },
        { at: 3.6, run: () => this.sound('scrape') },
        { at: 4.6, run: () => (this.drawFaces(true, 0), this.sound('scrape')) },
        { at: 5.6, run: () => (this.sound('scrape'), V.express({ fear: 0.4, determined: 0.5, distress: 0.5, concern: 0.4 }, 3)) },
        { at: 6.8, run: () => (this.sound('scrape'), V.play('tilt', -1)) },
        // She thinks it is the house frightening her away from the only people on her side.
        { at: 8.2, run: () => (V.express({ determined: 0.7, distress: 0.45 }, 2), V.lookAt(this.interior.toWorld(WINDOW.x + 0.45, 1.3, -4.2), 0.8)) },
        { at: 9.6, run: () => this.beginChoice() },
      ],
      [
        {
          name: 'cleared',
          start: 0,
          blend: 1.6,
          frame: (_t, o) => {
            o.pos.copy(this.interior.toWorld(ALIGN_EYE.x, ALIGN_EYE.y, ALIGN_EYE.z));
            o.look.copy(this.interior.toWorld(ALIGN_LOOK.x, ALIGN_LOOK.y, ALIGN_LOOK.z));
            o.fov = 28;
          },
        },
        {
          name: 'align-urgent',
          start: 4.2,
          blend: 1.4,
          frame: (t, o) => {
            // A slow push in as it draws.
            const k = smoothstep(4.2, 9.6, t);
            o.pos.copy(this.interior.toWorld(ALIGN_EYE.x, ALIGN_EYE.y, ALIGN_EYE.z - k * 0.25));
            o.look.copy(this.interior.toWorld(ALIGN_LOOK.x, ALIGN_LOOK.y, ALIGN_LOOK.z));
            o.fov = 24 - k * 2;
          },
        },
      ],
    );
    // The glass dries first (cover back to 0 under refog), then fogs fast again.
    this.fogRamp = { from: 0, to: 1, t0: 3.4, t1: 5.0 };
  }

  /** Condensation creeping in or drying, on the phase clock. */
  private fogRamp: { from: number; to: number; t0: number; t1: number } | null = null;

  // -------------------------------------------------------------- choice

  private beginChoice(): void {
    for (const st of this.friends.values()) st.frozen = false;
    this.enter('choice', [], [
      {
        // Her, small against the tall window, the marks still on the glass.
        name: 'choice',
        start: 0,
        blend: 2.2,
        frame: (t, o) => {
          o.pos.copy(this.interior.toWorld(17.9 + Math.sin(t * 0.2) * 0.05, 1.85, -1.35));
          o.look.copy(this.interior.toWorld(15.9, 1.45, -4.0));
          o.fov = 38;
        },
      },
    ]);
    this.setBeat('WINDOW_CHOICE');
    this.choiceIndex = 0;
    this.choiceReady = 0.8;
    this.s.choice(CHOICES, this.choiceIndex);
    this.perf.lookAt(this.interior.toWorld(WINDOW.x + 0.3, 1.5, -4.3), 0.7);
  }

  private updateChoice(dt: number): void {
    this.drive(dt);
    const inp = this.s.input;
    // Presses that arrive before the choice is shown are not answers.
    if (this.choiceReady > 0) {
      this.choiceReady -= dt;
      inp.consume('sprint');
      inp.consume('up');
      inp.consume('down');
      return;
    }
    const up = inp.consume('up');
    const down = inp.consume('down');
    if ((up && this.choiceIndex !== 0) || (down && this.choiceIndex !== 1)) {
      this.choiceIndex = up ? 0 : 1;
      this.s.choice(CHOICES, this.choiceIndex);
      this.sound('frame', 0.25);
    }
    if (inp.consume('sprint') || inp.consume('confirm')) this.choose(this.choiceIndex);
  }

  /** Clicking an option on screen does the same as confirming it. */
  choose(i: number): void {
    if (this.phase !== 'choice' || this.choiceReady > 0) return;
    this.s.choice(null, 0);
    if (i === 0) this.beginEscape();
    else this.beginStay();
  }

  // ---------------------------------------------------------------- stay

  /**
   * She steps back from the window. The house goes still — relieved — and
   * outside, for a moment, they forget to be her friends.
   */
  private beginStay(): void {
    this.stays++;
    const V = this.perf;
    const fog = this.win.fog;
    const odette = this.corruption.get('odette')!;
    const wren = this.corruption.get('wren')!;
    const wrenSt = this.friends.get('wren')!;
    const wrenHome = wrenSt.pos.clone();
    const first = this.stays === 1;
    const cues: Cue[] = [
      { at: 0.0, run: () => (V.play('recoil'), this.walkTo(STAND.x - 0.1, STAND.z + 1.2, 0.45, Math.PI), V.express({ concern: 0.5, distress: 0.3 }, 2)) },
      { at: 1.0, run: () => ((this.win.stir = 0), this.sound('exhale')) },
      // The glass clears a little, as though the house has stopped holding its breath.
      { at: 1.4, run: () => (this.fogRamp = { from: fog.cover, to: 0.45, t0: 1.4, t1: 3.2 }) },
      {
        at: 2.2,
        run: () => {
          for (const st of this.friends.values()) {
            st.waving = false;
            this.friendChar(st.id).perf.stop('wave');
          }
        },
      },
    ];
    if (first) {
      cues.push(
        // A fraction of a second too tall.
        { at: 3.4, run: () => ((odette.p.legs = 1), (odette.p.neck = 0.9), this.sound('bone', 0.5)) },
        { at: 3.72, run: () => ((odette.p.legs = 0), (odette.p.neck = 0)) },
        { at: 4.5, run: () => (V.express({ fear: 0.45, concern: 0.6, surprise: 0.4 }, 4), this.sound('breath', 0.6)) },
        // While she looks away: a hand on the glass, with too many joints in its fingers.
        {
          at: 4.8,
          run: () => {
            const p = this.interior.toWorld(WINDOW.x + 0.35, LAWN_Y, this.win.glassZ - 0.42);
            wrenSt.pos.copy(p);
            wrenSt.heading = 0;
            wrenSt.frozen = false;
            const f = this.friendChar('wren');
            f.perf.play('palmsGlass', 1, 600);
            wren.p.fingers = 1;
            wren.p.arms = 0.35;
            f.perf.express({ smile: 0.6 }, 10);
          },
        },
        { at: 5.6, run: () => (this.sound('frame', 0.6), this.printHand()) },
        { at: 6.0, run: () => (V.play('flinch'), V.express({ fear: 0.75, surprise: 0.5 }, 8), this.s.shake(0.12)) },
        // And gone.
        {
          at: 8.0,
          run: () => {
            wrenSt.pos.copy(wrenHome);
            wrenSt.heading = Math.atan2(WINDOW.x - LAWN.wren.x, 0 - LAWN.wren.z) * 0.35;
            this.friendChar('wren').perf.stop('palmsGlass');
            wren.p.fingers = 0;
            wren.p.arms = 0;
            fog.refog(2.5);
          },
        },
        { at: 9.4, run: () => (this.friendChar('juno').perf.play('wave'), V.express({ concern: 0.65, fear: 0.3 }, 2)) },
        { at: 9.6, run: () => (this.friends.get('juno')!.waving = true) },
        { at: 11.0, run: () => this.beginChoice() },
      );
    } else {
      // They only stand and look at the window, all three, and take one step closer together.
      cues.push(
        { at: 3.2, run: () => this.friendsStep(0.55, 0.6) },
        { at: 4.4, run: () => (V.express({ fear: 0.5, concern: 0.6 }, 3), this.sound('breath', 0.5)) },
        { at: 6.4, run: () => (this.friends.get('juno')!.waving = true) },
        { at: 7.0, run: () => this.beginChoice() },
      );
    }
    const v = this.visitor;
    const E = new THREE.Vector3();
    this.enter('stay', cues, [
      {
        name: 'stay-wide',
        start: 0,
        blend: 1.8,
        frame: (_t, o) => {
          o.pos.copy(this.interior.toWorld(WINDOW.x - 0.2, 1.7, -0.6));
          o.look.copy(this.interior.toWorld(WINDOW.x + 0.1, 1.5, -9));
          o.fov = 34;
        },
      },
      ...(first
        ? [
            {
              name: 'stay-face',
              start: 4.4,
              blend: 0.9,
              frame: (_t: number, o: ShotFrame) => {
                v.eyesWorld(E);
                o.pos.copy(E).add(new THREE.Vector3(0.6, 0.0, -0.75));
                o.look.copy(E);
                o.fov = 30;
              },
            },
            {
              name: 'stay-hand',
              start: 5.3,
              blend: 0.5,
              frame: (_t: number, o: ShotFrame) => {
                o.pos.copy(this.interior.toWorld(WINDOW.x + 0.1, 1.55, -2.2));
                o.look.copy(this.interior.toWorld(WINDOW.x + 0.3, 1.45, -4.6));
                o.fov = 30;
              },
            },
            {
              name: 'stay-face-2',
              start: 7.5,
              blend: 0.8,
              frame: (_t: number, o: ShotFrame) => {
                v.eyesWorld(E);
                o.pos.copy(E).add(new THREE.Vector3(-0.55, 0.02, -0.7));
                o.look.copy(E);
                o.fov = 30;
              },
            },
            {
              name: 'stay-after',
              start: 8.6,
              blend: 1.4,
              frame: (_t: number, o: ShotFrame) => {
                o.pos.copy(this.interior.toWorld(WINDOW.x - 0.2, 1.7, -0.6));
                o.look.copy(this.interior.toWorld(WINDOW.x + 0.1, 1.5, -9));
                o.fov = 34;
              },
            },
          ]
        : []),
    ]);
    this.setBeat('WINDOW_STAY_WARNING');
  }

  /** The hand on the outside of the glass leaves long finger marks through the fog on the inside. */
  private printHand(): void {
    const fog = this.win.fog;
    const f = this.friendChar('wren').char;
    for (const side of ['L', 'R'] as const) {
      const w = f.getBoneWorld(`wrist${side}`, new THREE.Vector3()).sub(this.interior.group.position);
      const x = w.x - this.win.left;
      const y = w.y - WINDOW.sill;
      fog.wipe(x, y, 0.07, 0.8);
      for (let k = 0; k < 4; k++) {
        const dx = (k - 1.5) * 0.028 * (side === 'L' ? 1 : -1);
        fog.stroke(
          [
            [x + dx, y + 0.03],
            [x + dx * 1.4, y + 0.14],
            [x + dx * 1.9, y + 0.27],
            [x + dx * 2.2, y + 0.36],
          ],
          k * 0.06,
          2.2,
          0.014,
        );
      }
    }
  }

  /**
   * The friends stand still and watch the window while the finger draws over them, so the
   * drawing (projected from where they stand) stays on their faces.
   */
  private holdFriends(): void {
    for (const st of this.friends.values()) {
      st.waving = false;
      const p = this.friendChar(st.id).perf;
      p.stop('wave');
      p.stop('laugh');
      p.autoFidget = false;
      p.lookAt(this.interior.toWorld(WINDOW.x, 1.8, -4.2), 0.8);
    }
  }

  private friendsStep(dist: number, seconds: number): void {
    for (const st of this.friends.values()) {
      st.speed = dist / seconds;
      st.heading = 0;
    }
    this.cues.push({
      at: this.time + seconds,
      run: () => {
        for (const st of this.friends.values()) st.speed = 0;
      },
    });
    this.cues.sort((a, b) => a.at - b.at);
    this.cueIndex = this.cues.findIndex((c) => c.at > this.time);
    if (this.cueIndex < 0) this.cueIndex = this.cues.length;
  }

  // -------------------------------------------------------------- escape

  private beginEscape(): void {
    const V = this.perf;
    const win = this.win;
    const fog = win.fog;
    const I = this.interior;
    const v = this.visitor;
    const E = new THREE.Vector3();
    this.enter(
      'escape',
      [
        { at: 0.0, run: () => (this.walkTo(WINDOW.x - 0.05, STAND.z, 0.8, Math.PI), V.express({ determined: 0.7, fear: 0.3 }, 3), V.lookAt(I.toWorld(WINDOW.x + 0.2, 1.4, -4.2), 0.8)) },
        // The house panics: drapes thrash, the frame groans, the door behind her too.
        { at: 0.4, run: () => ((win.violence = 1), (win.stir = 1), this.sound('curtain'), this.sound('frame')) },
        { at: 1.1, run: () => (this.sound('groan'), this.s.shake(0.1)) },
        { at: 1.4, run: () => (V.play('latch', -1), (this.fogRamp = { from: fog.cover, to: 1, t0: 1.4, t1: 2.0 })) },
        { at: 2.1, run: () => (this.sound('latch'), (win.open = 0.18), this.s.shake(0.08)) },
        { at: 2.9, run: () => (this.sound('frame', 0.9), (win.open = 0.12)) },
        { at: 3.3, run: () => (V.play('latch', -1), this.sound('latch', 0.6)) },
        // It gives. Night air: the fog thins at once.
        { at: 4.0, run: () => ((win.open = 0.85), this.sound('groan', 0.6), (this.fogRamp = { from: 1, to: 0.2, t0: 4.0, t1: 5.2 })) },
        { at: 4.6, run: () => (V.play('sill', 1, 600), (this.climb = 0)) },
        { at: 6.6, run: () => this.catchGown() },
        { at: 8.2, run: () => this.beginStruggle() },
      ],
      [
        {
          name: 'escape-side',
          start: 0,
          blend: 1.4,
          frame: (_t, o) => {
            o.pos.copy(I.toWorld(WINDOW.x - 2.4, 1.6, -2.4));
            o.look.copy(I.toWorld(WINDOW.x, 1.4, -4.2));
            o.fov = 38;
          },
        },
        {
          name: 'latch',
          start: 1.4,
          blend: 1.0,
          frame: (_t, o) => {
            v.eyesWorld(E);
            o.pos.copy(E).add(new THREE.Vector3(1.0, -0.2, 0.7));
            o.look.copy(I.toWorld(WINDOW.x, 1.35, -4.25));
            o.fov = 34;
          },
        },
        {
          // Three-quarter on the window as she climbs: the gown, the frame.
          name: 'climb',
          start: 4.4,
          blend: 1.4,
          frame: (_t, o) => {
            o.pos.copy(I.toWorld(WINDOW.x + 2.3, 1.95, -1.9));
            o.look.copy(I.toWorld(WINDOW.x - 0.1, 1.25, -4.2));
            o.fov = 44;
          },
        },
      ],
    );
    this.setBeat('WINDOW_ESCAPE');
  }

  private resettleVeil(): void {
    const d = this.house.dress;
    const len = d.veil.length;
    d.wearNow();
    d.veil.length = len;
  }

  /** Up onto the sill: 0 → 1 over the climb. */
  private climb = -1;

  private catchGown(): void {
    this.sound('strain', 0.7);
    this.sound('roots');
    this.snag.extent = 0;
    this.snagFree = false;
    this.perf.lookAt(this.s.camera.camera.position.clone(), 0.9);
    this.perf.express({ fear: 0.8, surprise: 0.5, distress: 0.4 }, 6);
    this.s.shake(0.15);
  }

  private beginStruggle(): void {
    const I = this.interior;
    this.enter('struggle', [], [
      {
        name: 'struggle',
        start: 0,
        blend: 1.2,
        frame: (t, o) => {
          const k = this.struggle;
          o.pos.copy(I.toWorld(WINDOW.x + 2.1 - k * 0.3, 1.85, -2.0 - k * 0.3));
          o.look.copy(I.toWorld(WINDOW.x - 0.15, 1.2, -4.35 - k * 0.25));
          o.fov = 44 - Math.sin(t * 0.5) * 0.5;
        },
      },
    ]);
    this.setBeat('WINDOW_STRUGGLE');
    this.perf.stop('sill');
    this.perf.play('pullFree', 1, 600);
    this.perf.lookAt(I.toWorld(WINDOW.x, 0.4, -12), 0.6);
    this.perf.express({ fear: 0.6, determined: 0.7, distress: 0.5 }, 4);
    this.sinceTap = 0;
    this.s.prompt('TAP SPACE — <span>PULL FREE</span>');
  }

  private updateStruggle(dt: number): void {
    STRUGGLE.heave = damp(STRUGGLE.heave, 0, 3.5, dt);
    this.sinceTap += dt;
    if (this.s.input.consume('sprint')) {
      this.pulls++;
      this.struggle = Math.min(1, this.struggle + 1 / PULLS + 0.01);
      STRUGGLE.heave = 1;
      this.sinceTap = 0;
      this.s.shake(0.12);
      this.sound('strain', 0.5 + this.struggle * 0.5);
      if (this.pulls % 2 === 1) this.sound('roots', 0.6);
      this.perf.express({ fear: 0.5, determined: 0.9, distress: 0.6 }, 10);
    }
    // The vines take back a little of every inch she doesn't hold.
    if (this.sinceTap > 1.2) this.struggle = Math.max(0, this.struggle - dt * 0.035);
    STRUGGLE.lean = damp(STRUGGLE.lean, this.struggle, 6, dt);
    this.s.prompt(this.sinceTap > 4 && this.struggle < 1 ? 'TAP SPACE — <span>PULL FREE</span>' : this.pulls > 0 && this.sinceTap < 4 ? null : 'TAP SPACE — <span>PULL FREE</span>');
    // On the sill, leaning further out with each pull.
    const p = this.interior.toWorld(WINDOW.x - 0.05, 0, this.win.glassZ - 0.08 - STRUGGLE.lean * 0.18, this.tmp);
    this.lift = WINDOW.sill + 0.1;
    this.heading = Math.PI;
    this.visitor.place(p.x, p.z, Math.PI, this.floor);
    this.visitor.updateCinematic(dt, 0);
    if (this.struggle >= 1) this.tearFree();
  }

  /** The fabric gives. */
  private tearFree(): void {
    this.s.prompt(null);
    this.sound('tear');
    this.s.shake(0.4);
    this.house.dress.tear = 1;
    // The veil tears too: what's left of it is short and ragged.
    this.house.dress.veil.length = 0.62;
    this.snagFree = true;
    this.perf.express({ fear: 0.9, surprise: 0.8 }, 12);
    this.perf.stop('pullFree');
    this.fallT = 0;
    this.phase = 'fall';
    this.time = 0;
    this.cues = [];
    this.cueIndex = 0;
  }

  /** Out of the window, onto the lawn — then the cut outside. */
  private updateFall(dt: number): void {
    this.fallT += dt;
    const u = clamp(this.fallT / 0.55, 0, 1);
    const p = this.interior.toWorld(WINDOW.x - 0.05, 0, this.win.glassZ - 0.26 - u * 0.9, this.tmp);
    this.lift = lerp(WINDOW.sill, LAWN_Y, u * u);
    this.visitor.place(p.x, p.z, Math.PI, this.floor);
    this.visitor.character.object.rotation.x = u * 0.9;
    this.visitor.updateCinematic(dt, 0);
    if (this.fallT > 0.12 && this.fallT - dt <= 0.12) this.s.fade(1, 0.35);
    if (this.fallT > 0.5) {
      this.sound('land');
      this.beginLanding();
    }
  }

  /** The snagged gown: from the nail in the frame to the back of her skirt; vines wind round it. */
  private updateSnag(): void {
    const struggling = this.phase === 'struggle' || (this.phase === 'escape' && this.time > 6.6);
    const fall = this.phase === 'fall' || this.snagFree;
    // The catch: a split in the sill's inner edge, on the side nearest the room.
    const nail = this.interior.toWorld(WINDOW.x + 0.72, WINDOW.sill + 0.03, -ROOM.halfWidth + 0.24, new THREE.Vector3());
    if (!struggling && !fall) {
      this.snag.extent = 0;
      this.snag.update(this.time);
      for (const v of this.win.vines) {
        v.extent = 0;
        v.update();
      }
      return;
    }
    const hem = this.visitor.character.getBoneWorld('coatBack', new THREE.Vector3());
    hem.y = Math.max(hem.y - 0.25, nail.y + 0.02);
    let end: THREE.Vector3;
    if (fall) {
      // Torn: a rag of silk hangs from the nail, swinging.
      const sw = Math.sin(this.time * 4) * 0.05 * Math.exp(-this.time * 0.8);
      end = nail.clone().add(new THREE.Vector3(sw, -0.5, -0.04));
    } else end = hem;
    const pts = [nail, nail.clone().lerp(end, 0.33).add(new THREE.Vector3(0, -0.06 * (1 - this.struggle), 0)), nail.clone().lerp(end, 0.66), end];
    this.snag.setPath(pts);
    this.snag.width = fall ? 0.18 : 0.3 - this.struggle * 0.1;
    const grow = this.phase === 'escape' ? smoothstep(6.6, 7.6, this.time) : 1;
    this.snag.extent = fall ? 1 : grow;
    this.snag.update(this.time);
    // Vines out of the frame: they wind round the snag and reach for her ankles.
    const ankle = this.visitor.character.getBoneWorld('ankleR', new THREE.Vector3());
    const ankle2 = this.visitor.character.getBoneWorld('ankleL', new THREE.Vector3());
    this.win.vines.forEach((v, k) => {
      const root = this.interior.toWorld(WINDOW.x + [0.98, -0.98, 0.85, 0.6, 0.3][k], WINDOW.sill + [0.5, 0.35, 0.02, 0.02, 0.02][k], k < 2 ? this.win.glassZ + 0.04 : -ROOM.halfWidth + 0.22, new THREE.Vector3());
      const target = k < 2 ? (k === 0 ? ankle : ankle2) : end.clone().lerp(nail, 0.3 + k * 0.15);
      const pts2: THREE.Vector3[] = [];
      for (let i = 0; i <= 6; i++) {
        const f = i / 6;
        const p = root.clone().lerp(target, f);
        // Winding: the later ones spiral round the silk.
        const a = f * Math.PI * 4 + k * 1.3 + this.time * 0.6;
        const r = (k >= 2 ? 0.05 : 0.08) * Math.sin(f * Math.PI) * (1 - this.struggle * 0.5);
        p.x += Math.cos(a) * r;
        p.y += Math.sin(a) * r + Math.sin(f * Math.PI) * 0.06;
        pts2.push(p);
      }
      v.setPath(pts2);
      const want = fall ? (k < 2 ? 0.25 : 0.7) : grow * (k < 2 ? 0.98 - STRUGGLE.heave * 0.06 : 1);
      v.extent = damp(v.extent, want, fall ? 3 : 2.2, 1 / 60);
      v.update(this.time);
    });
  }

  // ------------------------------------------------------------- landing

  private beginLanding(): void {
    this.outdoors = true;
    this.env.setIndoors(false);
    this.interior.visible = false;
    this.lift = 0;
    this.snag.extent = 0;
    this.snag.update(0);
    for (const v of this.win.vines) {
      v.extent = 0;
      v.update();
    }
    this.house.dress.dirt = 1;
    const H = this.env.house;
    H.escapeOpen = 1;
    H.glow = 1.15;
    // Her friends are at the end of the path now, by the lamps, waiting.
    this.placeFriendsOnPath();
    this.path.group.visible = true;
    this.env.pavement.reset();
    this.env.calm = 1;
    this.visitor.character.object.rotation.x = 0;
    // She came out face first: away from the house, toward the lawn.
    this.heading = 0;
    this.targetHeading = 0;
    this.speed = this.targetSpeed = 0;
    this.aim = null;
    this.route = -1;
    this.visitor.place(LAND.x, LAND.z, 0, this.ground);
    // The veil is cloth in world space: settle it again where she is now.
    this.resettleVeil();
    this.perf.reset();
    this.perf.play('fallen', 1, 600);
    this.perf.express({ fear: 0.5, distress: 0.6 }, 20);
    STRUGGLE.lean = STRUGGLE.heave = 0;
    const V = this.perf;
    const win = new THREE.Vector3(COURSE.houseX + ESCAPE_WINDOW.x, ESCAPE_WINDOW.sillY + 1.0, COURSE.houseZ + ESCAPE_WINDOW.z);
    const v = this.visitor;
    const E = new THREE.Vector3();
    this.enter(
      'landing',
      [
        { at: 0.0, run: () => this.s.fade(0, 1.4) },
        { at: 1.3, run: () => this.sound('breath', 0.8) },
        { at: 2.0, run: () => (V.stop('fallen'), V.express({ fear: 0.4, distress: 0.5, concern: 0.4 }, 2)) },
        // She looks back at the house.
        { at: 3.6, run: () => ((this.targetHeading = Math.PI), V.lookAt(win, 1)) },
        { at: 4.6, run: () => (this.sound('roots', 0.7), (this.reachT = 0)) },
        { at: 5.6, run: () => (V.play('recoil'), V.express({ fear: 0.75, surprise: 0.4 }, 5)) },
        // It stops short of her. It goes back in. The window shuts. Nothing is said.
        { at: 9.6, run: () => ((H.escapeOpen = 0), this.sound('latch', 0.5)) },
        { at: 10.4, run: () => ((H.glow = 0.62), V.express({ concern: 0.55, distress: 0.3 }, 1.5)) },
        { at: 11.6, run: () => (this.targetHeading = -Math.PI / 2) },
        { at: 12.2, run: () => (V.lookAt(new THREE.Vector3(this.friendsX, 1.6, 0), 0.7), V.express({ concern: 0.3, smile: 0.2 }, 1.5), (this.route = 0), this.walkTo(ROUTE[0].x, ROUTE[0].z, 3.5)) },
        { at: 12.8, run: () => (this.targetSpeed = 5.2) },
      ],
      [
        {
          // Low on the grass: her, and the open window above her.
          name: 'land-low',
          start: 0,
          blend: 0,
          frame: (_t, o) => {
            o.pos.set(LAND.x - 2.4, this.ground.heightAt(LAND.x - 2.4, LAND.z + 1.8) + 0.32, LAND.z + 1.8);
            o.look.set(LAND.x + 0.3, 1.45, LAND.z - 0.9);
            o.fov = 42;
          },
        },
        {
          name: 'look-back',
          start: 3.4,
          blend: 1.8,
          frame: (_t, o) => {
            o.pos.set(LAND.x - 1.0, 1.35, LAND.z + 2.2);
            o.look.copy(win).add(new THREE.Vector3(0, -0.3, 0));
            o.fov = 40;
          },
        },
        {
          name: 'reach',
          start: 5.0,
          blend: 1.6,
          frame: (t, o) => {
            v.eyesWorld(E);
            const k = smoothstep(5, 8, t);
            o.pos.set(LAND.x + 1.9, 0.9, LAND.z + 1.6 - k * 0.3);
            o.look.copy(E).lerp(win, 0.45);
            o.fov = 38;
          },
        },
        {
          // The house, still and dark, as she turns away from it.
          name: 'house-still',
          start: 9.0,
          blend: 2.0,
          frame: (_t, o) => {
            o.pos.set(LAND.x - 7, 1.5, LAND.z + 6.5);
            o.look.set(COURSE.houseX - 2, 5.5, COURSE.houseZ + 4);
            o.fov = 40;
          },
        },
        {
          name: 'away',
          start: 11.4,
          blend: 2.2,
          frame: (_t, o) => {
            const p = v.position;
            o.pos.set(p.x + 3.0, p.y + 1.6, p.z + 3.6);
            o.look.set(p.x - 4, p.y + 1.2, p.z - 0.5);
            o.fov = 42;
          },
        },
      ],
    );
    this.setBeat('OUTSIDE_LANDING');
  }

  private reachT = -1;
  private runHint = false;
  /** Which leg of ROUTE she is walking (-1 = not yet). */
  private route = -1;

  private updateLanding(dt: number): void {
    const H = this.env.house;
    const v = H.escapeVine;
    if (this.route === 0) {
      const c = this.visitor.controller;
      if (Math.hypot(ROUTE[0].x - c.x, ROUTE[0].z - c.z) < 1.2) {
        this.route = 1;
        this.aim = ROUTE[1].clone();
      }
    }
    // The vine: out over the sill, down toward her — and stopping short.
    if (this.reachT >= 0) {
      this.reachT += dt * this.clockScale;
      const sill = new THREE.Vector3(ESCAPE_WINDOW.x, ESCAPE_WINDOW.sillY + 0.05, ESCAPE_WINDOW.z + 0.1);
      const her = this.visitor.eyesWorld(this.tmp).sub(HOUSE_POS);
      her.y -= 0.35;
      const short = sill.clone().lerp(her, 0.86);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 6; i++) {
        const f = i / 6;
        const p = sill.clone().lerp(short, f);
        p.y += Math.sin(f * Math.PI) * 0.55 + Math.sin(f * 9 + this.reachT * 1.3) * 0.04;
        p.x += Math.sin(f * 5 + this.reachT) * 0.08;
        pts.push(p);
      }
      v.setPath(pts);
      const r = this.reachT;
      v.extent = smoothstep(0, 3.2, r) * 0.98 * (1 - smoothstep(4.2, 6.6, r));
      // It hesitates at full reach: a slight curl at the tip.
      if (r > 3.2 && r < 4.2) v.extent -= Math.sin((r - 3.2) * Math.PI) * 0.03;
    }
    // At the path: hand her to the player.
    const c = this.visitor.controller;
    if (this.time > 12.2 && c.x < RUN_FROM + 2.6) this.beginRun(false);
  }

  // ----------------------------------------------------------------- run

  /** The chase's own controls, back along the park — which, for once, leaves her alone. */
  beginRun(snap: boolean): void {
    if (!this.outdoors) {
      // A skip from inside: straight out onto the path, torn and stained.
      if (this.phase === 'off') this.start();
      this.outdoors = true;
      this.env.setIndoors(false);
      this.interior.visible = false;
      this.house.dress.wearNow();
      this.house.dress.tear = 1;
      this.house.dress.dirt = 1;
      this.house.dress.veil.length = 0.62;
      this.env.house.escapeOpen = 0;
      this.env.house.glow = 0.62;
      this.snag.extent = 0;
      this.snag.update(0);
      this.placeFriendsOnPath();
      this.path.group.visible = true;
      this.env.pavement.reset();
      this.env.calm = 1;
      this.visitor.place(RUN_FROM, 0, -Math.PI / 2, this.ground);
      this.resettleVeil();
    }
    this.env.house.escapeVine.extent = 0;
    this.s.prompt(null);
    this.s.choice(null, 0);
    STRUGGLE.lean = STRUGGLE.heave = 0;
    this.visitor.character.object.rotation.x = 0;
    this.perf.reset();
    this.phase = 'run';
    this.time = 0;
    this.cues = [];
    this.cueIndex = 0;
    this.revealAt = -1;
    this.unease = 0;
    this.sync = false;
    const c = this.visitor.controller;
    const z = c.z;
    c.reset(c.x);
    c.z = z;
    c.lane = (z < -1.3 ? 0 : z > 1.3 ? 2 : 1) as LaneIndex;
    c.y = this.ground.heightAt(c.x, c.z);
    c.dir = -1;
    c.start();
    // She runs on her own now: nothing to dodge, nothing to tap.
    c.controllable = false;
    c.speed = snap ? 4 : Math.max(4, this.speed);
    this.path.group.visible = false;
    this.visitor.heading = -Math.PI / 2;
    this.visitor.moodOverride = { smile: 0.25, concern: 0.35, distress: 0.2 };
    this.path.reset();
    const cam = this.s.camera;
    cam.dir = -1;
    cam.menace = 0;
    const subject = { position: this.visitor.position, speed: c.speed, slide: 0 };
    if (snap) cam.snap(subject);
    else cam.beginHandoff(subject, 2.6);
    this.setBeat('FINAL_RUN');
    // The chase's own controls, reminded once.
    this.s.prompt(null);
    this.runHint = false;
    if (snap) this.s.fade(0, 1.2);
  }

  private updateRun(dt: number): void {
    const v = this.visitor;
    const c = v.controller;
    if (this.revealAt >= 0) {
      this.updateApproachEnd(dt);
      return;
    }
    // Running hard for them, easing off only when something feels wrong (speedCap, below).
    // After a won chase she runs flat out: she thinks she is free.
    c.effort = this.victory ? 0.85 : 0.62;
    v.update(dt, this.s.input, this.ground);
    if (this.runHint && this.time > 4.5) {
      this.runHint = false;
      this.s.prompt(null);
    }
    // Ordinary debris: a log, a stone, a fallen branch. Nothing moves.
    if (this.path.group.visible && this.path.hit(c.x, c.lane) && c.stumbleTime < 0) {
      c.stumbleTime = 0;
      c.stumbleSide = c.z > 0 ? 'R' : 'L';
      c.speed *= 0.5;
      c.effort *= 0.5;
      v.performer.play('flinch');
      this.sound('land', 0.5);
      this.s.shake(0.2);
    }
    const d = c.x - this.friendsX;
    const vEyes = v.eyesWorld(this.eyes);
    const st = (id: FriendId) => this.friends.get(id)!;
    const cor = (id: FriendId) => this.corruption.get(id)!;
    // --- Relief: the path is just a path. Her friends wave. The music is kind. ---
    this.hope = damp(this.hope, d > 34 ? 1 : 0, d > 34 ? 1.2 : 0.5, dt);
    this.hush = damp(this.hush, d < 32 ? 1 : 0, 0.8, dt);
    const tired = smoothstep(0, 6, this.time);
    v.moodOverride = d > 58 ? { smile: 0.2 + 0.25 * tired, concern: 0.35 - 0.2 * tired, determined: c.effort * 0.5, distress: 0.2 * (1 - tired) } : v.moodOverride;
    v.gazeOverride = this.tmp2.set(this.friendsX, 1.6, PATH_Z.juno);
    if (d < 66 && d + c.speed * dt >= 66) {
      this.sound('call');
      this.friendChar('juno').perf.play('beckon', 1);
    }
    // --- Unease: one stops waving, one turns her head too far, one is too still. ---
    if (d < 58) {
      this.setBeat('FINAL_UNEASE');
      const k = smoothstep(58, 44, d);
      this.unease = Math.max(this.unease, k);
      st('odette').waving = false;
      this.friendChar('odette').perf.stare = true;
      this.friendChar('odette').perf.express({ smile: 0.6 }, 2);
      cor('juno').p.headTurn = smoothstep(55, 42, d) * 1.15;
      cor('juno').p.tilt = smoothstep(55, 42, d) * 0.3;
      st('wren').waving = false;
      st('wren').frozen = d < 52;
      v.moodOverride = { smile: lerp(0.4, 0.15, k), concern: lerp(0.2, 0.45, k), determined: c.effort * 0.4 };
    }
    // --- Their shadows are wrong. ---
    this.shadowK = smoothstep(48, 30, d);
    if (this.shadowK > 0) {
      const tw = this.prologue.twin;
      if (!tw.object.visible) tw.setActive(true);
      tw.lag = 0.55;
      for (const id of ['odette', 'juno'] as const) cor(id).p.shadowForm = this.shadowK;
      // A low light from behind them, from nowhere: their shadows run up the path to her.
      const elev = lerp(0.42, 0.13, this.shadowK);
      this.env.lightOverride = {
        dir: this.tmp.set(-Math.cos(elev), Math.sin(elev), 0.12).normalize().clone(),
        focus: new THREE.Vector3(this.friendsX + 6, 0, 0),
        weight: smoothstep(0, 0.3, this.shadowK),
      };
    }
    // --- The music goes, the wind goes; they turn to her all at once. ---
    if (d < 28 && !this.sync) {
      this.sync = true;
      for (const [id, s2] of this.friends) {
        s2.waving = false;
        s2.frozen = false;
        const f = this.friendChar(id);
        f.perf.autoFidget = false;
        f.perf.stop('wave');
        f.perf.stop('beckon');
        f.perf.express({ smile: 0.55 }, 30);
        f.perf.stare = true;
        cor(id).p.headTurn = 0;
        cor(id).p.tilt = 0;
        cor(id).p.menace = 0.35;
      }
      this.sound('rumble', 0.4);
    }
    if (this.sync) {
      for (const id of this.friends.keys()) this.friendChar(id).perf.lookAt(vEyes, 1);
      this.s.camera.menace = smoothstep(28, 13, d);
      const k = smoothstep(27, 12, d);
      v.moodOverride = { concern: lerp(0.4, 0.85, k), fear: k * 0.35, smile: lerp(0.15, 0, k), surprise: k * 0.2 };
      // She slows: the player still runs her, but her legs will not hurry toward them.
      c.speedCap = lerp(12.5, 1.6, smoothstep(26, 12, d));
    }
    this.s.effort(0, false, false);
    if (d < STOP_AT + 4 && this.revealAt < 0) {
      c.controllable = false;
      c.speedCap = 0;
      this.revealAt = 0;
      const cam = this.s.camera.camera;
      const look = cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(10).add(cam.position);
      this.director.setShots(this.revealShots(true));
      this.director.startFrom(cam.position.clone(), look, cam.fov);
      this.s.effort(0, false, false);
    }
  }

  /** She has stopped of her own accord; the reveal takes the lens. */
  private updateApproachEnd(dt: number): void {
    const v = this.visitor;
    v.update(dt, this.s.input, this.ground);
    this.revealAt += dt;
    if (v.controller.speed < 0.25 || this.revealAt > 2.2) this.beginReveal(false);
  }

  // -------------------------------------------------------------- reveal

  private beginReveal(snap: boolean): void {
    const c = this.visitor.controller;
    c.mode = 'idle';
    c.controllable = false;
    this.heading = -Math.PI / 2;
    this.targetHeading = -Math.PI / 2;
    this.speed = this.targetSpeed = 0;
    this.aim = null;
    this.visitor.moodOverride = null;
    this.visitor.gazeOverride = null;
    this.s.camera.menace = 0;
    this.s.camera.dir = 1;
    this.s.prompt(null);
    this.runHint = false;
    this.env.lightOverride = null;
    this.prologue.twin.setActive(false);
    for (const cor of this.corruption.values()) cor.p.shadowForm = 0;
    this.hush = 1;
    this.hope = 0;
    for (const [id] of this.friends) {
      const f = this.friendChar(id);
      f.perf.autoFidget = false;
      f.perf.stare = true;
      f.perf.express({ smile: 0.55 }, 30);
    }
    this.perf.express({ concern: 0.7, fear: 0.2 }, 2);
    this.perf.lookAt(this.friendChar('juno').char.getEyesWorld(new THREE.Vector3()), 0.9);
    const shots = this.revealShots(false);
    this.enter('reveal', this.revealCues(), undefined);
    this.director.setShots(shots);
    if (snap) this.director.startFrom(this.director.out.pos.clone(), this.director.out.look.clone(), 40);
    else this.director.startFrom(this.director.out.pos.clone(), this.director.out.look.clone(), this.director.out.fov);
    this.setBeat('FRIENDS_REVEAL');
  }

  private updateReveal(dt: number): void {
    this.drive(dt);
    const t = this.time;
    const O = this.corruption.get('odette')!.p;
    const J = this.corruption.get('juno')!.p;
    const W = this.corruption.get('wren')!.p;
    // FRIEND ONE — Odette: the smile that keeps going.
    const o = t - 1.2;
    O.smile = smoothstep(0, 3, o);
    O.jaw = smoothstep(1.6, 4.2, o) * 0.85;
    O.eyes = smoothstep(1.0, 3.2, o);
    O.tilt = smoothstep(2.0, 4.0, o) * 0.55;
    O.neck = smoothstep(2.6, 5.4, o);
    O.fingers = smoothstep(3.0, 5.2, o);
    O.arms = smoothstep(3.4, 5.8, o);
    O.twist = smoothstep(4.0, 6.4, o) * 0.85;
    O.legs = smoothstep(4.6, 6.8, o);
    O.pallor = smoothstep(1, 6, o);
    O.menace = smoothstep(5.5, 7, o);
    // FRIEND TWO — Juno: the puppet, a movement at a time, with stillness between.
    const j = t - 7.6;
    J.shoulderBreak = smoothstep(1.8, 2.15, j);
    J.elbowBreak = smoothstep(2.9, 3.3, j);
    J.arch = smoothstep(3.9, 4.5, j) * (1 - smoothstep(6.4, 7.4, j) * 0.75);
    J.faceLock = smoothstep(3.6, 4.0, j);
    J.fold = smoothstep(4.7, 5.5, j) * (1 - smoothstep(6.4, 7.4, j) * 0.85);
    J.twist = smoothstep(4.7, 5.5, j) * 1.25 * (1 - smoothstep(6.4, 7.4, j) * 0.6);
    J.arms = smoothstep(5.4, 6.4, j);
    J.fingers = smoothstep(5.4, 6.6, j);
    J.secondEyes = smoothstep(5.0, 6.2, j);
    J.longFace = smoothstep(5.2, 6.8, j);
    J.legs = smoothstep(6.4, 7.4, j);
    J.eyes = smoothstep(5.0, 6.0, j);
    J.pallor = smoothstep(2, 7, j);
    J.menace = smoothstep(7, 8, j);
    // FRIEND THREE — Wren: still herself, until her head keeps turning.
    const w = t - 14.6;
    W.tilt = smoothstep(2.0, 2.8, w) * 0.35 - smoothstep(5.6, 6.6, w) * 0.75;
    W.headTurn = smoothstep(3.0, 5.6, w) * Math.PI;
    W.neck = smoothstep(3.2, 6.0, w) * 0.85;
    W.secondFace = smoothstep(3.6, 5.2, w);
    W.fold = smoothstep(5.6, 6.6, w) * 0.4;
    W.limbs = smoothstep(6.0, 8.0, w);
    W.legs = smoothstep(6.2, 7.6, w);
    W.arms = smoothstep(6.0, 7.4, w) * 0.6;
    W.pallor = smoothstep(3, 7, w);
    W.menace = smoothstep(7.5, 8.5, w);
    // The final attack: one of them moves faster than anything that size should.
    if (this.lungeT >= 0) {
      this.lungeT += dt;
      const st = this.friends.get('odette')!;
      const target = this.visitor.position.clone();
      const u = clamp(this.lungeT / 0.3, 0, 1);
      const dir = target.clone().sub(this.lungeFrom).setY(0);
      const len = dir.length();
      dir.normalize();
      st.pos.copy(this.lungeFrom).addScaledVector(dir, (len - 0.55) * u * u);
      st.heading = Math.atan2(dir.x, dir.z);
      O.fold = u * 0.5;
      O.arms = 1;
    }
  }

  private revealCues(): Cue[] {
    const V = this.perf;
    const eyesOf = (id: FriendId) => this.friendChar(id).char.getEyesWorld(new THREE.Vector3());
    const st = (id: FriendId) => this.friends.get(id)!;
    const odette = this.friendChar('odette');
    return [
      { at: 0.4, run: () => V.lookAt(eyesOf('odette'), 0.9) },
      { at: 2.2, run: () => this.sound('breathWrong', 0.6) },
      { at: 3.8, run: () => this.sound('bone', 0.6) },
      { at: 4.6, run: () => (V.express({ concern: 0.8, surprise: 0.4 }, 3), V.play('hesitate')) },
      { at: 5.0, run: () => this.sound('bone', 0.8) },
      { at: 6.0, run: () => this.sound('bone') },
      // Juno: confused; a step toward her; and stopping, all at once.
      { at: 7.6, run: () => (this.friendChar('juno').perf.express({ concern: 0.6, smile: 0.2 }, 4), V.lookAt(eyesOf('juno'), 0.9)) },
      { at: 7.9, run: () => ((st('juno').speed = 0.85), (st('juno').heading = Math.PI / 2)) },
      { at: 8.7, run: () => ((st('juno').speed = 0), (st('juno').frozen = true)) },
      { at: 9.4, run: () => this.sound('bone') },
      { at: 10.5, run: () => this.sound('bone', 0.9) },
      { at: 11.4, run: () => (this.sound('strain', 0.5), V.express({ fear: 0.5, surprise: 0.6, concern: 0.6 }, 3)) },
      { at: 12.3, run: () => (this.sound('bone'), this.sound('strain', 0.6)) },
      { at: 14.0, run: () => ((st('juno').frozen = false), this.sound('laughWrong', 0.7)) },
      // Wren: the most ordinary of them; one slow step.
      { at: 14.6, run: () => (V.lookAt(eyesOf('wren'), 0.9), this.friendChar('wren').perf.express({ smile: 0.45 }, 2)) },
      { at: 15.1, run: () => ((st('wren').speed = 0.42), (st('wren').heading = Math.PI / 2)) },
      { at: 16.5, run: () => (st('wren').speed = 0) },
      { at: 18.0, run: () => this.sound('bone', 0.7) },
      { at: 19.2, run: () => this.sound('breathWrong') },
      { at: 20.6, run: () => (this.sound('rumble', 0.6), this.sound('bone', 0.8)) },
      // VISITOR_REALIZATION — the phone in Odette's hand: the same conversation.
      {
        at: 22.4,
        run: () => {
          this.setBeat('VISITOR_REALIZATION');
          const app = this.prologue.app;
          app.update(APP_BEATS.end);
          odette.char.setPhoneScreen(app.material);
          odette.char.phone.visible = true;
          this.corruption.get('odette')!.keepRightHand = true;
          // Undo the arm's thinning on the prop.
          odette.char.phone.scale.set(1 / 0.58, 1, 1 / 0.58);
          this.sound('call', 0.25);
        },
      },
      { at: 23.6, run: () => (V.lookAt(eyesOf('odette'), 0.9), V.express({ concern: 0.9, surprise: 0.3 }, 3)) },
      { at: 24.2, run: () => (V.lookAt(eyesOf('juno'), 0.9), V.express({ surprise: 0.7, concern: 0.7, fear: 0.3 }, 3)) },
      { at: 24.8, run: () => (V.lookAt(eyesOf('wren'), 0.9), V.express({ surprise: 0.9, fear: 0.5, distress: 0.3 }, 3)) },
      { at: 25.5, run: () => (V.express({ fear: 1, distress: 0.6, surprise: 0.5 }, 4), V.play('handsMouth'), this.walkTo(this.visitor.position.x + 0.45, this.visitor.position.z, 0.35, -Math.PI / 2)) },
      // The house, far behind her, warm in every window.
      { at: 26.6, run: () => ((this.env.house.glow = 1.35), V.lookAt(new THREE.Vector3(COURSE.houseX, 6, COURSE.houseZ), 0.6)) },
      { at: 27.2, run: () => (this.targetHeading = Math.PI / 2) },
      { at: 28.0, run: () => (V.express({ distress: 0.7, fear: 0.45, concern: 0.6 }, 1.2), this.sound('sigh', 0.35)) },
      // FINAL_ATTACK
      { at: 30.0, run: () => (this.setBeat('FINAL_ATTACK'), (this.corruption.get('odette')!.p.tilt = 0.9)) },
      { at: 30.3, run: () => ((st('wren').speed = 1.6), (this.corruption.get('wren')!.p.float = 1)) },
      { at: 30.6, run: () => ((this.targetHeading = -Math.PI / 2), V.play('shield', 1, 30), V.express({ fear: 1, distress: 0.7 }, 6)) },
      { at: 30.9, run: () => ((st('juno').speed = 7.5), this.sound('bone')) },
      { at: 31.25, run: () => (st('juno').speed = 0) },
      { at: 31.4, run: () => this.walkTo(this.visitor.position.x + 1.2, this.visitor.position.z, 0.6, -Math.PI / 2) },
      { at: 32.6, run: () => ((this.lungeT = 0), this.lungeFrom.copy(st('odette').pos), this.sound('lunge'), (st('wren').speed = 0)) },
      // Black, before it reaches her. Silence.
      { at: 32.86, run: () => this.beginBlack() },
    ];
  }

  private revealShots(approach: boolean): Shot[] {
    const v = this.visitor;
    const E = new THREE.Vector3();
    const F = new THREE.Vector3();
    const head = (id: FriendId, o: THREE.Vector3) => this.friendChar(id).char.getEyesWorld(o);
    const base = (id: FriendId) => this.friends.get(id)!.pos;
    if (approach)
      return [
        {
          name: 'approach',
          start: 0,
          blend: 1.6,
          frame: (_t, o) => {
            const p = v.position;
            o.pos.set(p.x + 2.6, p.y + 0.9, p.z + 1.9);
            o.look.set(this.friendsX, 1.7, 0);
            o.fov = 36;
          },
        },
      ];
    return [
      {
        // Low behind her shoulder: the three of them, smiling.
        name: 'three',
        start: 0,
        blend: 1.6,
        frame: (_t, o) => {
          const p = v.position;
          o.pos.set(p.x + 2.5, p.y + 0.95, p.z + 1.7);
          o.look.set(this.friendsX, 1.65, (base('odette').z + base('wren').z) / 2);
          o.fov = 34;
        },
      },
      {
        name: 'odette',
        start: 1.0,
        blend: 1.8,
        frame: (t, o) => {
          head('odette', F);
          const k = smoothstep(3, 8, t);
          o.pos.set(F.x + 2.6 + k * 0.8, F.y - 0.25 - k * 0.6, F.z + 1.1);
          o.look.copy(F).add(new THREE.Vector3(0, -0.15 - k * 0.3, 0));
          o.fov = 30 + k * 6;
        },
      },
      {
        name: 'face-1',
        start: 4.4,
        blend: 0.8,
        frame: (_t, o) => {
          v.eyesWorld(E);
          o.pos.copy(E).add(new THREE.Vector3(-0.9, -0.05, 0.35));
          o.look.copy(E);
          o.fov = 28;
        },
      },
      {
        name: 'odette-tall',
        start: 5.4,
        blend: 1.2,
        frame: (_t, o) => {
          const b = base('odette');
          head('odette', F);
          o.pos.set(b.x + 3.6, b.y + 0.55, b.z + 1.6);
          o.look.set(b.x, F.y - 0.5, b.z);
          o.fov = 40;
        },
      },
      {
        name: 'juno',
        start: 7.4,
        blend: 1.4,
        frame: (_t, o) => {
          const b = base('juno');
          head('juno', F);
          o.pos.set(b.x + 3.0, b.y + 1.25, b.z - 1.5);
          o.look.set(b.x, Math.max(1.0, F.y - 0.35), b.z);
          o.fov = 38;
        },
      },
      {
        name: 'face-2',
        start: 11.2,
        blend: 0.7,
        frame: (_t, o) => {
          v.eyesWorld(E);
          o.pos.copy(E).add(new THREE.Vector3(-0.8, 0.0, -0.45));
          o.look.copy(E);
          o.fov = 28;
        },
      },
      {
        name: 'juno-2',
        start: 12.0,
        blend: 1.0,
        frame: (_t, o) => {
          const b = base('juno');
          head('juno', F);
          o.pos.set(b.x + 3.4, b.y + 0.7, b.z + 1.0);
          o.look.set(b.x, F.y - 0.4, b.z);
          o.fov = 40;
        },
      },
      {
        name: 'wren',
        start: 14.4,
        blend: 1.4,
        frame: (t, o) => {
          head('wren', F);
          const k = smoothstep(17, 21, t);
          o.pos.set(F.x + 2.2 + k * 1.2, F.y - 0.2 - k * 0.5, F.z - 0.9 - k * 0.4);
          o.look.copy(F).add(new THREE.Vector3(0, -0.1 - k * 0.4, 0));
          o.fov = 30 + k * 8;
        },
      },
      {
        // All three, towering over her.
        name: 'three-tall',
        start: 21.4,
        blend: 1.0,
        frame: (_t, o) => {
          const p = v.position;
          o.pos.set(p.x + 2.2, p.y + 0.4, p.z + 1.4);
          o.look.set(this.friendsX + 1, 2.4, 0);
          o.fov = 44;
        },
      },
      {
        name: 'phone',
        start: 22.5,
        blend: 0.6,
        frame: (_t, o) => {
          const odette = this.friendChar('odette').char;
          odette.phoneScreen.getWorldPosition(F);
          o.pos.copy(F).add(new THREE.Vector3(0.55, 0.12, 0.15));
          o.look.copy(F);
          o.fov = 30;
        },
      },
      {
        name: 'realize',
        start: 23.5,
        blend: 0.6,
        frame: (_t, o) => {
          v.eyesWorld(E);
          o.pos.copy(E).add(new THREE.Vector3(-0.85, -0.04, 0.12));
          o.look.copy(E);
          o.fov = 27;
        },
      },
      {
        // In front of her, low: past her, the house — the only lit thing in the dark.
        name: 'refuge',
        start: 26.4,
        blend: 2.0,
        frame: (t, o) => {
          const p = v.position;
          const k = smoothstep(26.4, 30, t);
          o.pos.set(p.x - 2.6 - k * 0.6, p.y + 0.85, p.z + 0.9);
          o.look.set(lerp(p.x + 4, COURSE.houseX, 0.6), lerp(1.4, 6.5, 0.55), lerp(p.z, COURSE.houseZ, 0.4));
          o.fov = 34;
        },
      },
      {
        name: 'attack-wide',
        start: 30.0,
        blend: 1.0,
        frame: (_t, o) => {
          const p = v.position;
          o.pos.set(p.x - 3.5, p.y + 1.2, p.z + 6.8);
          o.look.set(p.x - 3.0, 1.6, p.z);
          o.fov = 40;
        },
      },
      {
        // One sharp change: her face.
        name: 'attack-face',
        start: 32.6,
        blend: 0,
        frame: (_t, o) => {
          v.eyesWorld(E);
          o.pos.copy(E).add(new THREE.Vector3(-0.62, 0.0, 0.5));
          o.look.copy(E);
          o.fov = 30;
        },
      },
    ];
  }

  // -------------------------------------------------------------- ending

  private beginBlack(): void {
    this.s.fade(1, 0);
    this.phase = 'black';
    this.time = 0;
    this.cueIndex = 0;
    this.hush = 1;
    this.sound('cut');
    this.setBeat('FINAL_ENDING');
    if (!this.victory) {
      this.cues = [{ at: 1.5, run: () => this.beginEnding(false) }];
      return;
    }
    // The Visitor's ending: no house, no closing shot. Her phone lights up in the dark.
    const app = this.prologue.app;
    this.cues = [
      { at: WARN_SHOW, run: () => (app.update(APP_BEATS.warn - 0.7), this.s.phone(app.screen, true)) },
      { at: WARN_SHOW + 0.7 + (APP_BEATS.warnMsg - APP_BEATS.warn), run: () => this.sound('call', 0.3) },
      { at: WARN_HIDE, run: () => this.s.phone(null) },
      { at: WARN_HIDE + 0.9, run: () => this.finish() },
    ];
  }

  /** The house, alone under the moon. The path is empty. */
  private beginEnding(fromSkip: boolean): void {
    const H = this.env.house;
    this.visitor.character.object.visible = false;
    for (const f of this.prologue.friends) f.char.object.visible = false;
    for (const c of this.corruption.values()) for (const l of c.limbs) l.mesh.visible = false;
    this.path.group.visible = false;
    this.env.lightOverride = null;
    this.env.calm = 0.6;
    H.glow = 1.2;
    H.doorOpen = 0;
    H.escapeOpen = 0;
    H.escapeVine.extent = 0;
    this.hush = 1;
    this.hope = 0;
    this.s.prompt(null);
    this.s.choice(null, 0);
    // The door is grown shut.
    const door = new THREE.Vector3(HOUSE_FRONT - 0.2, HOUSE_FLOOR, 0);
    H.doorVines.forEach((v, k) => {
      const y0 = 0.3 + k * 0.85;
      const pts = [new THREE.Vector3(door.x, door.y + y0, -1.6), new THREE.Vector3(door.x - 0.15, door.y + y0 + 0.4, -0.5), new THREE.Vector3(door.x - 0.12, door.y + y0 - 0.2, 0.6), new THREE.Vector3(door.x, door.y + y0 + 0.3, 1.6)];
      v.setPath(pts);
      v.extent = 1;
    });
    this.phase = 'ending';
    this.time = 0;
    const reach = H.doorReach;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const f = i / 10;
      const x = HOUSE_FRONT - 0.25 - f * 9;
      const z = 0.2 + Math.sin(f * 5) * 0.35;
      // Over the porch boards, down the step, along the ground toward the path.
      const ground = this.ground.heightAt(x + HOUSE_POS.x, z + HOUSE_POS.z);
      const y = x > HOUSE_FRONT - 4 ? HOUSE_FLOOR + 0.07 : Math.max(ground, x > HOUSE_FRONT - 5 ? HOUSE_FLOOR * 0.5 : 0) + 0.07;
      pts.push(new THREE.Vector3(x, y, z));
    }
    reach.setPath(pts);
    reach.extent = 0;
    this.setCues([
      { at: 0.0, run: () => this.s.fade(0, fromSkip ? 1.2 : 2.2) },
      { at: 1.8, run: () => this.sound('sigh', 0.25) },
      { at: 6.0, run: () => this.sound('sigh', 0.6) },
      { at: 6.8, run: () => this.s.fade(0.62, 1.8) },
      { at: 7.4, run: () => this.s.caption('IT WAS NEVER THE HOUSE YOU SHOULD HAVE FEARED.') },
      { at: 11.6, run: () => (this.s.caption(null), this.s.fade(1, 1.8)) },
      { at: 13.8, run: () => this.finish() },
    ]);
    const shot: Shot = {
      name: 'house-alone',
      start: 0,
      blend: 0,
      frame: (t, o) => {
        const k = smoothstep(0, 12, t);
        o.pos.set(COURSE.houseX - 64 + k * 11, 1.7 - k * 0.4, 5.5 - k * 0.8);
        o.look.set(COURSE.houseX - 4, 11.5, COURSE.houseZ - 1);
        o.fov = 40;
      },
    };
    this.director.setShots([shot]);
    const f0: ShotFrame = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 38 };
    shot.frame(0, f0);
    this.director.startFrom(f0.pos, f0.look, f0.fov);
    this.setBeat('FINAL_ENDING');
  }

  private updateEnding(dt: number): void {
    if (this.phase === 'black' && this.victory && this.time >= WARN_SHOW) this.prologue.app.update(APP_BEATS.warn - 0.7 + (this.time - WARN_SHOW));
    if (this.phase !== 'ending') return;
    const t = this.time;
    const reach = this.env.house.doorReach;
    // From under the door, along the porch toward the path. It stops. It hesitates. It stays.
    reach.extent = smoothstep(2.0, 6.0, t) * 0.62 + (t > 6.0 && t < 7.2 ? Math.sin((t - 6.0) * Math.PI / 1.2) * 0.015 : 0);
    void dt;
  }

  /** Prompt for the camera's per-frame fog ramp (window phases). */
  tickFog(): void {
    const r = this.fogRamp;
    if (!r || this.outdoors) return;
    const k = smoothstep(r.t0, r.t1, this.time);
    this.win.fog.cover = lerp(r.from, r.to, k);
    if (this.time >= r.t1) this.fogRamp = null;
  }

  /** Window-phase continuous effects that run on the clock (condensation, frost, the climb). */
  tickWindow(dt: number): void {
    if (this.outdoors) return;
    const fog = this.win.fog;
    const t = this.time;
    if (this.phase === 'window') {
      fog.frost = smoothstep(8.4, 10.5, t);
      fog.cover = smoothstep(8.2, 13.2, t);
    }
    if (this.phase === 'return') fog.frost = 1;
    this.tickFog();
    // Up onto the sill.
    if (this.climb >= 0 && this.phase === 'escape') {
      this.climb = Math.min(1, this.climb + dt / 1.4);
      const k = smoothstep(0, 1, this.climb);
      this.lift = (WINDOW.sill + 0.1) * k;
      const p = this.interior.toWorld(WINDOW.x - 0.05, 0, lerp(STAND.z, this.win.glassZ - 0.08, k), this.tmp);
      this.aim = null;
      this.targetSpeed = 0;
      this.visitor.place(p.x, p.z, Math.PI, this.floor);
    }
    if (this.phase !== 'escape') this.climb = -1;
  }
}
