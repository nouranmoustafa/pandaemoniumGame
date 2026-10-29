import * as THREE from 'three';
import { ahead, CHASE, COURSE, MODE_TUNING } from '../../config';
import { CinematicDirector, type ShotFrame } from '../../camera/CinematicDirector';
import { CAST } from '../../characters/cast';
import { GltfAvatar } from '../../characters/gltf/GltfAvatar';
import { visitorAsset } from '../../characters/gltf/manifest';
import { damp, smoothstep } from '../../core/math';
import { DemonAbilitySystem } from '../../demon/abilities/DemonAbilitySystem';
import { AIDemonDirector } from '../../demon/AIDemonDirector';
import type { DemonContext, DemonDirector } from '../../demon/DemonDirector';
import { DemonMind } from '../../demon/DemonMind';
import { PARK_LINES } from '../../demon/DemonVoice';
import { HumanDemonDirector } from '../../demon/HumanDemonDirector';
import { Sarcasm } from '../../demon/Sarcasm';
import { Tricks } from '../../demon/Tricks';
import { VisitorObserver } from '../../demon/VisitorObserver';
import type { ObstacleContext } from '../../obstacles/Obstacle';
import { ObstacleManager } from '../../obstacles/ObstacleManager';
import { WindGust } from '../../obstacles/WindGust';
import { DemonPanel } from '../../ui/DemonPanel';
import { Visitor } from '../../visitor/Visitor';
import { Environment } from '../../world/Environment';
import { Graves } from '../../world/props/Graves';
import { Inscriptions } from '../../world/Inscriptions';
import { ENTRANCE } from '../../world/ParkEntrance';
import { TargetingOverlay } from '../../world/TargetingOverlay';
import type { Chapter, ChapterServices } from '../Chapter';
import { type FinaleJump, FinaleSequence } from '../finale/Finale';
import { HouseSequence } from '../house/HouseSequence';
import { HANDOFF_AT, Prologue } from '../prologue/Prologue';
import { Approach } from './Approach';
import { CourseDirector } from './CourseDirector';
import { PARK_COURSE } from './course';
import { Reroute } from './Reroute';

/** Passing out, as [seconds, fade opacity, fade seconds]: her eyes close, open, close for good. */
const BLINKS: Array<[number, number, number]> = [
  [0.3, 0.8, 0.22],
  [0.6, 0.15, 0.35],
  [1.15, 0.9, 0.25],
  [1.45, 0.45, 0.35],
  [1.95, 1, 0.45],
];

/** Where the chase is decided: she runs on to her friends, or the road turns her round. */
const DECIDE_X = CHASE.end - 30 * CHASE.dir;

export type GameMode = 'single' | 'versus';

/**
 * The park chase. The Visitor runs toward a date who isn't there; the park —
 * and the Demon behind it — herds her toward the house.
 *
 * Both modes share everything (world, hazards, collisions, fairness rules,
 * tricks); only the Demon director differs: AI in single player, the second
 * player's mouse in local 1v1.
 *
 * Stage 3: the chapter opens on the prologue (friends, the match, the walk
 * in), played identically in both modes. The Demon's systems don't run at
 * all until the chase begins; the prologue hands her over at the gate.
 *
 * Stage 4: the chase no longer ends at the door. When she arrives, the
 * house sequence takes over (the threshold, the hall, the gown); the
 * chapter is complete when it ends.
 */
export class ParkChapter implements Chapter {
  readonly id = 'park' as const;
  readonly env: Environment;
  readonly visitor: Visitor;
  readonly obstacles: ObstacleManager;
  readonly abilities: DemonAbilitySystem;
  readonly mind: DemonMind;
  readonly observer: VisitorObserver;
  readonly tricks: Tricks;
  readonly sarcasm: Sarcasm;
  readonly ai: AIDemonDirector;
  readonly human: HumanDemonDirector;
  readonly panel: DemonPanel;
  readonly prologue: Prologue;
  readonly house: HouseSequence;
  readonly finale: FinaleSequence;
  readonly cine = new CinematicDirector();
  readonly approach: Approach;
  mode: GameMode = 'single';
  complete = false;
  /** False during the title backdrop and the prologue. */
  chaseActive = false;
  private titleFrame: ShotFrame | null = null;
  /** The Visitor's body: generated, or a GLB (loading / ready / failed → generated fallback). */
  bodyStatus: 'generated' | 'loading' | 'glb' | 'failed' = 'generated';
  /** Called once, when the house takes over from the chase. */
  onHouseBegin: () => void = () => {};
  /** Called once, when the prologue hands her to the player. */
  onPrologueHandoff: () => void = () => {};

  private course: CourseDirector;
  private inscriptions: Inscriptions;
  private overlay = new TargetingOverlay();
  private obstacleCtx: ObstacleContext;
  private demonCtx: DemonContext;
  /** 0..1 — she is passing out (tunnel vision, drained colour; read by the post-processing). */
  tunnel = 0;
  /** Seconds into her fainting after the road turned her round (-1 = not fainting). */
  private faint = -1;
  /** Unconscious, carried down the slide to the house. */
  private carried = false;
  /** Seconds into the cut from the slide to her waking at the door (-1 = none). */
  private wakeCut = -1;
  /** The road turning her round when the house wins the chase. */
  readonly reroute: Reroute;
  /** The chase has been decided (at DECIDE_X); the Demon's hand is off her. */
  private decided = false;
  private hintTimer = 0;
  private hintShown = false;
  private tapped = false;
  private openingSaid = false;
  private time = 0;
  private timeScale = 1;
  private startX = 0;
  private unsub: Array<() => void> = [];
  /** The chase's result, kept when the house takes her (the final run re-uses her controller). */
  private chaseCaught = 0;
  private chaseTime = 0;
  private chaseWinner: 'demon' | 'visitor' = 'visitor';

  constructor(
    private s: ChapterServices,
    opts: { startX?: number } = {},
  ) {
    this.startX = opts.startX ?? COURSE.start;
    const treeXs = PARK_COURSE.filter((o) => o.type === 'branch').map((o) => o.x);
    this.env = new Environment(s.scene, s.bus, treeXs);
    this.visitor = new Visitor(s.bus);
    s.scene.add(this.visitor.object);
    // Four headstones: back in the dark behind the park railings, where her friends stand talking —
    // and again on a rise in the long grass beside the house (on its hill, so they rise and sink with it).
    s.scene.add(new Graves(-14.5, -5.8, -1.04, 3, undefined, 1.4).group);
    const hill = (x: number, z: number) => -0.8 + 1.1 * Math.sqrt(Math.max(0, 1 - ((x - 10) / 42) ** 2 - (z / 40) ** 2));
    this.env.house.group.add(new Graves(-10, -20, -1.37, 7, (x, z) => hill(x, z) + 0.55, 2.1).group);
    this.obstacles = new ObstacleManager(PARK_COURSE, this.env.pavement, this.env.barkMaterial);
    s.scene.add(this.obstacles.group);

    this.abilities = new DemonAbilitySystem(s.scene, s.bus, this.obstacles.obstacles);
    this.course = new CourseDirector(this.obstacles, this.abilities);
    this.observer = new VisitorObserver(s.bus, () => this.visitor.controller, () => this.abilities.obstacles);
    this.mind = new DemonMind(s.bus);
    this.inscriptions = new Inscriptions(this.env.pavement);
    s.scene.add(this.inscriptions.group);
    this.tricks = new Tricks(s.bus, this.env);
    s.scene.add(this.tricks.group);
    this.sarcasm = new Sarcasm(s.bus, this.inscriptions, { sign: () => this.tricks.sign, bench: () => this.tricks.bench });
    this.ai = new AIDemonDirector();
    this.human = new HumanDemonDirector();
    s.scene.add(this.overlay.group);

    this.obstacleCtx = { visitor: this.visitor, pavement: this.env.pavement, bus: s.bus, time: 0, camera: s.camera.camera };
    this.demonCtx = {
      visitor: this.visitor,
      env: this.env,
      obstacleCtx: this.obstacleCtx,
      bus: s.bus,
      abilities: this.abilities,
      mind: this.mind,
      observer: this.observer,
      peaceful: false,
    };
    this.panel = new DemonPanel(s.canvas, s.camera.camera, this.abilities, this.human, this.overlay, this.env.pavement, () => this.obstacleCtx);
    this.prologue = new Prologue(s.scene, s.bus, this.env, this.visitor, this.cine);
    this.prologue.onHandoff = () => this.onPrologueHandoff();
    this.prologue.onPhone = (c) => s.ui.showPhone(c);
    this.approach = new Approach(this.env, this.visitor, this.prologue.app, this.cine, s.camera, s.bus, {
      prompt: (html) => s.ui.setPrompt(html),
      hint: (v) => s.ui.showHint(v),
      phone: (c) => s.ui.showPhone(c),
      fade: (o, sec) => s.ui.setFade(o, sec),
    });
    this.reroute = new Reroute(s.scene, this.env, this.visitor, s.camera, s.bus);
    // Round the half-circle, she passes out.
    this.reroute.onTurned = () => {
      this.faint = 0;
      s.camera.shake(0.3);
    };
    this.approach.onChase = () => this.beginChase(false);
    this.house = new HouseSequence(s.scene, this.env, this.visitor, {
      bus: s.bus,
      input: s.input,
      say: (text, d) => s.ui.say(text, d),
      fade: (o, sec) => s.ui.setFade(o, sec),
      shake: (a) => s.camera.shake(a),
      prompt: (html) => s.ui.setPrompt(html),
    });
    this.finale = new FinaleSequence(s.scene, this.env, this.visitor, this.house, this.prologue, {
      bus: s.bus,
      input: s.input,
      camera: s.camera,
      fade: (o, sec) => s.ui.setFade(o, sec),
      shake: (a) => s.camera.shake(a),
      prompt: (html) => s.ui.setPrompt(html),
      choice: (options, i) => s.ui.showChoice(options, i, (k) => this.finale.choose(k)),
      caption: (text) => s.ui.setCaption(text),
      effort: (v, tapped, visible) => s.ui.setEffort(v, tapped, visible),
      phone: (screen, over) => s.ui.showPhone(screen, over),
    });
    // Stage 4 hands straight on to Stage 5: the mirror, then laughter outside.
    this.house.onComplete = () => {
      this.panel.setActive(false);
      this.finale.start();
    };
    this.finale.onComplete = () => {
      this.complete = true;
      s.bus.emit('chapter:complete', {
        caught: this.chaseCaught,
        time: this.chaseTime,
        winner: this.mode === 'versus' ? this.chaseWinner : undefined,
        resisted: this.house.resists,
        finale: true,
      });
    };

    this.loadVisitorBody();

    // Registered once, here — never on start/reset, so replays don't stack handlers.
    this.unsub.push(
      s.bus.on('visitor:caught', () => s.camera.shake(0.55)),
      s.bus.on('visitor:dodge', () => {
        // A beat of slow motion: the relief of a clean escape.
        this.timeScale = 0.55;
        s.ui.flashDodge();
      }),
      s.bus.on('visitor:blown', () => s.camera.shake(0.25)),
      s.bus.on('visitor:sprintTap', () => (this.tapped = true)),
      s.bus.on('demon:line', ({ text, duration }) => s.ui.say(text, duration)),
      s.bus.on('pavement:rise', () => s.camera.shake(0.35)),
      s.bus.on('pavement:slide', () => s.camera.shake(0.45)),
      s.bus.on('pavement:sarcasm', () => s.camera.shake(0.2)),
      s.bus.on('trick:shortcut', ({ active }) => {
        if (!active) s.camera.shake(0.3);
      }),
    );
  }

  /** A supplied (or ?visitor=test) GLB replaces the generated body; a missing file falls back silently to it. */
  private loadVisitorBody(): void {
    const entry = visitorAsset();
    if (!entry) return;
    this.bodyStatus = 'loading';
    const v = CAST.visitor;
    GltfAvatar.load(entry, v.proportions.height * v.scale, import.meta.env.BASE_URL)
      .then((avatar) => {
        this.visitor.attachGlb(avatar);
        this.bodyStatus = 'glb';
      })
      .catch((e) => {
        console.warn(`Visitor model ${entry.url} could not be loaded; using the generated character.`, e);
        this.bodyStatus = 'failed';
      });
  }

  get director(): DemonDirector {
    return this.mode === 'versus' ? this.human : this.ai;
  }

  setMode(mode: GameMode): void {
    this.mode = mode;
    this.s.ui.setMode(mode);
  }

  enterTitle(): void {
    this.reset();
    this.panel.setActive(false);
  }

  /** Roll the opening: the camera eases out of the title shot into the first set-up. */
  beginPrologue(): void {
    this.panel.setActive(false);
    const from = this.titleFrame;
    this.prologue.start();
    if (from) this.cine.startFrom(from.pos, from.look, from.fov);
  }

  /** Jump the prologue to its end state (the caller fades to black around this). */
  skipPrologue(): void {
    this.prologue.skip();
    this.start(true);
  }

  /**
   * The chase begins where the prologue left her. After a skip the camera
   * is placed directly (we are behind a fade); otherwise it eases from the
   * last cinematic shot into the chase framing.
   */
  start(snap = false): void {
    this.prologue.release();
    this.chaseActive = true;
    if (!snap) {
      // From the prologue: up the path to the house first (see Approach).
      this.approach.begin();
      return;
    }
    // Retry: straight into the chase, where she read the invitation.
    this.approach.cancel();
    this.approach.placeFirstHouse();
    this.visitor.place(CHASE.start, 0, Math.PI / 2 * CHASE.dir, this.env.pavement);
    this.beginChase(true);
  }

  /** The chase proper: in her eyes, away from the house — toward her friends. */
  private beginChase(snap: boolean): void {
    const c = this.visitor.controller;
    c.dir = CHASE.dir;
    if (c.mode === 'idle') c.start();
    c.controllable = true;
    c.speed = Math.max(c.speed, 4.5);
    this.visitor.setFirstPerson(true);
    this.s.camera.fpv = true;
    this.s.camera.dir = CHASE.dir;
    if (snap) {
      this.visitor.heading = (Math.PI / 2) * CHASE.dir;
      this.s.camera.snap(this.cameraSubject());
    } else this.s.camera.beginHandoff(this.cameraSubject(), 0.9);
    // Behind her, the house goes back under: it will be waiting when the road brings her round.
    this.env.house.riseRate = 0.5;
    this.env.house.rise = 0;
    this.hintShown = true;
    this.hintTimer = 0;
    this.s.ui.showHint(true);
    this.panel.setActive(this.mode === 'versus');
  }

  reset(): void {
    this.s.audio.resetAmbience();
    this.s.audio.surface = 'cobble';
    this.complete = false;
    this.chaseActive = false;
    this.titleFrame = null;
    this.faint = -1;
    this.tunnel = 0;
    this.carried = false;
    this.wakeCut = -1;
    this.decided = false;
    this.reroute.reset();
    this.hintShown = false;
    this.hintTimer = 0;
    this.openingSaid = false;
    this.timeScale = 1;
    this.env.pavement.reset();
    this.approach.reset();
    this.finale.reset();
    this.house.reset();
    this.env.reset();
    this.obstacles.reset();
    this.abilities.reset();
    this.ai.reset();
    this.human.reset();
    this.mind.reset();
    this.observer.reset();
    this.tricks.reset();
    this.sarcasm.reset();
    this.inscriptions.clear();
    this.panel.reset();
    this.overlay.hide();
    this.visitor.reset(this.startX, this.env.pavement);
    // Debug skip-ahead (?x=…) starts in the park; otherwise she starts with her friends.
    if (this.startX <= COURSE.start) this.prologue.reset();
    for (const f of this.prologue.friends) f.char.object.visible = true;
    // The house waits at the top of the path; the camera is third person again.
    this.approach.placeFirstHouse();
    this.s.camera.fpv = false;
    this.s.camera.dir = 1;
    this.visitor.setFirstPerson(false);
    // Debug skip-ahead into the hill: bring the set-piece up instantly.
    if (this.startX > COURSE.pavementStart - 20) this.env.pavement.beginRise();
    if (this.startX > COURSE.hillCrest - 26) {
      this.env.pavement.beginSlide();
      this.approach.placeFinalHouse();
      this.env.house.rise = 1;
      this.env.house.snapRise();
    }
    this.s.ui.showHint(false);
    this.s.ui.clearSubtitle();
    this.s.camera.snap(this.cameraSubject());
  }

  private eyesTmp = new THREE.Vector3();

  private cameraSubject() {
    const c = this.visitor.controller;
    return { position: this.visitor.position, speed: c.speed, slide: c.slideBlend, eyes: this.visitor.eyesWorld(this.eyesTmp), heading: this.visitor.heading };
  }

  /** Title backdrop and prologue: the world lives, the Demon waits. */
  private updateCinematic(dt: number): void {
    const frame = this.prologue.active ? this.prologue.update(dt) : this.prologue.updateTitle(dt);
    if (!this.prologue.active) this.titleFrame = frame;
    if (!this.chaseActive) this.s.camera.setCinematic(frame.pos, frame.look, frame.fov);
    this.placeFaceLight(frame);
    const r = this.prologue.grassRipple();
    this.env.rippleGrass(r.x, r.amp);
    this.env.warmth = this.warmthAt(this.visitor.position.x);
    this.s.audio.surface = this.visitor.position.x < ENTRANCE.gateX ? 'flagstone' : 'cobble';
    this.env.setGust(0);
    this.env.setAnxiety(0);
    this.env.update(dt, this.s.camera.camera, this.visitor.position);
    this.s.audio.update(dt, { speed: 0, sliding: false, gust: 0, playing: false, peace: false, anxiety: 0, city: this.env.warmth, prologue: true });
  }

  /** Up the path to the house, the invitation, and the first flight back toward the gate. */
  private updateApproach(dt: number): void {
    const frame = this.approach.update(dt, this.s.input);
    if (frame) this.s.camera.setCinematic(frame.pos, frame.look, frame.fov);
    else this.s.camera.update(dt, this.approach.subject());
    const x = this.visitor.position.x;
    this.env.warmth = this.warmthAt(x);
    this.env.setAnxiety(0.4);
    this.env.update(dt, this.s.camera.camera, this.visitor.position);
    const hide = x > ENTRANCE.gateX + 14;
    for (const f of this.prologue.friends) f.char.object.visible = !hide;
    const c = this.visitor.controller;
    this.s.audio.update(dt, { speed: c.speed, sliding: false, gust: 0.3, playing: true, peace: false, anxiety: 0.5, city: this.env.warmth });
  }

  /** Beside and a little above the lens; strong only when the camera is close to someone. */
  private placeFaceLight(frame: ShotFrame): void {
    const fl = this.env.entrance.faceLight;
    const toSubject = frame.look.clone().sub(frame.pos);
    const dist = toSubject.length();
    const right = toSubject.clone().normalize().cross(new THREE.Vector3(0, 1, 0)).normalize();
    fl.position.copy(frame.pos).addScaledVector(right, 1.1).add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(toSubject.normalize(), -0.4);
    fl.intensity = 1.1 * smoothstep(4, 1.2, dist) * this.env.warmth;
  }

  /** The ordinary evening holds on the plaza and drains away inside the gate. */
  private warmthAt(x: number): number {
    return 1 - smoothstep(ENTRANCE.gateX - 2, ENTRANCE.handoffX - 2, x);
  }

  /** Seconds of prologue still to run (for UI). */
  get prologueRemaining(): number {
    return Math.max(0, HANDOFF_AT - this.prologue.time);
  }

  /** Hold-Escape skip during the house: straight to its end (or, in Stage 5, to its next part). */
  skipHouse(): void {
    if (this.finale.phase !== 'off') this.finale.skip();
    else this.house.finish();
  }

  /** Debug / test: start Stage 5 at a checkpoint (?stage5=window|choice|run|reveal). */
  jumpFinale(to: FinaleJump): void {
    this.approach.placeFinalHouse();
    this.chaseActive = true;
    this.panel.setActive(false);
    this.chaseCaught = 0;
    this.chaseTime = 0;
    this.chaseWinner = 'visitor';
    if (to === 'window' || to === 'choice') {
      this.house.jumpToTableau();
      const f = this.house.update(0);
      this.s.camera.setCinematic(f.pos, f.look, f.fov);
    }
    this.finale.jump(to);
    this.s.ui.setFade(0, 1.0);
  }

  /** Stage 5: the window, the escape, the run and the reveal. */
  private updateFinale(dt: number): void {
    const F = this.finale;
    const frame = F.update(dt);
    if (frame) this.s.camera.setCinematic(frame.pos, frame.look, frame.fov);
    this.s.camera.update(dt, this.cameraSubject());
    const out = F.isOutdoors;
    if (out) {
      this.env.warmth = 0;
      this.env.setGust(0);
      this.env.setAnxiety(0);
      this.env.rippleGrass(0, 0);
      this.env.update(dt, this.s.camera.camera, this.visitor.position);
    }
    const c = this.visitor.controller;
    this.s.audio.surface = out ? 'cobble' : 'flagstone';
    this.s.audio.update(dt, {
      speed: F.running ? c.speed : 0,
      sliding: false,
      gust: 0,
      playing: true,
      peace: out && F.hope > 0.3,
      anxiety: 0,
      city: 0,
      indoor: !out,
      hush: F.hush,
      hope: F.hope,
    });
  }

  /** The house has her: only its sequence, the world and the sound run. */
  private updateHouse(dt: number): void {
    const frame = this.house.update(dt);
    this.s.camera.setCinematic(frame.pos, frame.look, frame.fov);
    this.s.camera.update(dt, this.cameraSubject());
    const indoors = this.house.indoors;
    if (!indoors) {
      this.env.warmth = 0;
      this.env.update(dt, this.s.camera.camera, this.visitor.position);
    }
    this.s.audio.surface = indoors ? 'flagstone' : 'cobble';
    this.s.audio.update(dt, { speed: 0, sliding: false, gust: 0, playing: true, peace: false, anxiety: indoors ? 0.3 : this.mind.anxiety, city: 0, indoor: indoors });
  }

  update(rawDt: number): void {
    if (this.finale.phase !== 'off') {
      this.updateFinale(rawDt);
      return;
    }
    if (this.house.phase !== 'off') {
      this.updateHouse(rawDt);
      return;
    }
    if (!this.chaseActive) {
      this.updateCinematic(rawDt);
      return;
    }
    if (this.approach.active) {
      this.updateApproach(rawDt);
      return;
    }
    // She passes out: the dark closes in, her eyes close, open, close.
    if (this.faint >= 0) {
      const f0 = this.faint;
      this.faint += rawDt;
      this.tunnel = smoothstep(0, 1.6, this.faint);
      for (const [at, o, sec] of BLINKS) if (f0 < at && this.faint >= at) this.s.ui.setFade(o, sec);
      if (this.faint > 2.6) this.beginCarried();
    }
    // The end of the slide: black, and she wakes at the door (see HouseSequence.startWake).
    if (this.carried && this.visitor.controller.x >= COURSE.pavementEnd - 2) {
      this.carried = false;
      this.wakeCut = 0;
      this.s.ui.setFade(1, 0.45);
    }
    if (this.wakeCut >= 0) {
      this.wakeCut += rawDt;
      if (this.wakeCut > 0.6 && !this.house.active) {
        const c = this.visitor.controller;
        this.wakeCut = -1;
        this.chaseCaught = c.caughtCount;
        this.chaseTime = c.elapsed;
        this.chaseWinner = this.versusWinner;
        this.house.startWake();
        this.onHouseBegin();
        return;
      }
    }
    this.timeScale = damp(this.timeScale, 1, 5, rawDt);
    const dt = rawDt * this.timeScale;
    this.time += dt;
    const c = this.visitor.controller;
    this.obstacleCtx.time = this.time;
    this.demonCtx.peaceful = this.tricks.peaceful;

    if (!this.reroute.active) this.visitor.update(dt, this.s.input, this.env.pavement);
    this.reroute.update(dt, this.s.input);
    this.observer.update(dt);
    this.mind.update(dt, c, this.observer);
    if (!this.decided) this.course.update(this.obstacleCtx);
    if (!this.decided) this.director.update(dt, this.demonCtx);
    this.abilities.update(dt, this.obstacleCtx);
    this.obstacles.update(dt, this.obstacleCtx);
    if (!this.decided) {
      this.tricks.update(dt, c, this.observer, this.mind, this.sarcasm);
      this.sarcasm.update(dt, c, this.observer);
    }
    this.inscriptions.update(dt, c.x);

    // The Demon's gusts move the whole park: grass, trees, leaves.
    let gust = 0;
    for (const h of this.abilities.hazards) if (h instanceof WindGust) gust = Math.max(gust, h.gustStrength);
    this.env.setGust(gust * 0.9);
    this.env.setAnxiety(this.mind.anxiety);
    this.env.warmth = this.warmthAt(c.x);
    this.env.rippleGrass(0, 0);
    this.env.entrance.faceLight.intensity = 0;
    this.visitor.dread = this.mind.anxiety;
    // Her friends stay at the gate; once she's well inside, they're out of every shot.
    const hide = c.x > ENTRANCE.gateX + 14;
    for (const f of this.prologue.friends) f.char.object.visible = !hide;
    this.env.update(dt, this.s.camera.camera, this.visitor.position);
    this.s.camera.update(rawDt, this.reroute.active ? this.reroute.subject() : this.cameraSubject());
    this.overlay.update(rawDt);
    this.panel.update(rawDt);

    if (!this.openingSaid && ahead(CHASE.start, c.x) > 6 && c.mode === 'run') {
      this.openingSaid = true;
      this.s.ui.say(PARK_LINES.opening, 4.8);
    }

    // Tutorial hint fades once she's learned both controls (or after a while).
    if (this.hintShown) {
      this.hintTimer += dt;
      const learned = c.usedDodge && c.sprintTaps >= 3;
      if ((learned && this.hintTimer > (this.mode === 'versus' ? 6 : 3)) || this.hintTimer > 12) {
        this.s.ui.showHint(false);
        this.hintShown = false;
      }
    }
    this.s.ui.setEffort(c.effort, this.tapped, c.controllable);
    this.tapped = false;

    this.s.audio.update(rawDt, {
      speed: c.speed,
      sliding: c.mode === 'slide',
      gust,
      playing: c.mode !== 'idle',
      peace: this.tricks.peaceful,
      anxiety: this.mind.anxiety,
      city: this.env.warmth,
    });

    // --- Arrival at the house ---
    // --- The chase is decided ---
    // 1v1: if the Demon caught her often enough, the road turns her round and takes her back to
    // the door (the full story). If not, she runs straight on to her friends. Single player always
    // belongs to the house.
    if (!this.decided && c.dir === CHASE.dir && c.mode === 'run' && ahead(c.x, DECIDE_X) <= 0) {
      this.decided = true;
      this.panel.setActive(false);
      this.s.ui.showHint(false);
      this.hintShown = false;
      if (this.mode === 'versus' && this.versusWinner === 'visitor') {
        this.chaseCaught = c.caughtCount;
        this.chaseTime = c.elapsed;
        this.chaseWinner = 'visitor';
        this.abilities.reset();
        // Out of her eyes as she runs on: free, she thinks.
        this.s.camera.fpv = false;
        this.visitor.setFirstPerson(false);
        this.finale.beginVictoryRun();
        this.onHouseBegin();
        return;
      }
      this.abilities.reset();
      this.reroute.begin();
    }
  }

  /**
   * Behind the black: the park has her. The path is already a hill and a slide (the road
   * rerouted under her), and she goes down it unconscious, toward the house, seen from outside.
   */
  private beginCarried(): void {
    const c = this.visitor.controller;
    const pav = this.env.pavement;
    this.faint = -1;
    this.tunnel = 0;
    this.reroute.reset();
    this.abilities.reset();
    pav.reset();
    pav.beginSlide();
    pav.rise = pav.slide = 1;
    this.env.house.rise = 1;
    this.env.house.snapRise();
    c.dir = 1;
    c.mode = 'run';
    c.x = COURSE.hillCrest + 95;
    c.z = 0;
    c.lane = 1;
    c.speed = 20;
    c.controllable = false;
    c.startSlide();
    this.visitor.heading = Math.PI / 2;
    this.visitor.setFirstPerson(false);
    this.s.camera.fpv = false;
    this.s.camera.dir = 1;
    this.s.camera.snap(this.cameraSubject());
    this.carried = true;
    this.s.ui.setFade(0, 1.4);
  }

  get versusWinner(): 'demon' | 'visitor' {
    return this.visitor.controller.caughtCount >= MODE_TUNING.versusCatchesToWin ? 'demon' : 'visitor';
  }

  get focus(): THREE.Vector3 {
    return this.visitor.position;
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
  }
}
