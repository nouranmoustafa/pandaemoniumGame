import * as THREE from 'three';
import { COURSE, MODE_TUNING } from '../../config';
import { damp } from '../../core/math';
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
import { Inscriptions } from '../../world/Inscriptions';
import { TargetingOverlay } from '../../world/TargetingOverlay';
import type { Chapter, ChapterServices } from '../Chapter';
import { CourseDirector } from './CourseDirector';
import { PARK_COURSE } from './course';

export type GameMode = 'single' | 'versus';

/**
 * The park chase. The Visitor runs toward a date who isn't there; the park —
 * and the Demon behind it — herds her toward the house.
 *
 * Both modes share everything (world, hazards, collisions, fairness rules,
 * tricks); only the Demon director differs: AI in single player, the second
 * player's mouse in local 1v1.
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
  mode: GameMode = 'single';
  complete = false;

  private course: CourseDirector;
  private inscriptions: Inscriptions;
  private overlay = new TargetingOverlay();
  private obstacleCtx: ObstacleContext;
  private demonCtx: DemonContext;
  private arriveTime = -1;
  private hintTimer = 0;
  private hintShown = false;
  private tapped = false;
  private openingSaid = false;
  private time = 0;
  private timeScale = 1;
  private startX = 0;
  private unsub: Array<() => void> = [];

  constructor(
    private s: ChapterServices,
    opts: { startX?: number } = {},
  ) {
    this.startX = opts.startX ?? COURSE.start;
    const treeXs = PARK_COURSE.filter((o) => o.type === 'branch').map((o) => o.x);
    this.env = new Environment(s.scene, s.bus, treeXs);
    this.visitor = new Visitor(s.bus);
    s.scene.add(this.visitor.object);
    this.obstacles = new ObstacleManager(PARK_COURSE, this.env.pavement, this.env.barkMaterial);
    s.scene.add(this.obstacles.group);

    this.abilities = new DemonAbilitySystem(s.scene, s.bus, this.obstacles.obstacles);
    this.course = new CourseDirector(this.obstacles, this.abilities, this.env);
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
    this.s.camera.setMode('title');
  }

  start(): void {
    this.visitor.controller.start();
    this.s.camera.setMode('chase');
    this.hintShown = true;
    this.hintTimer = 0;
    this.s.ui.showHint(true);
    this.panel.setActive(this.mode === 'versus');
  }

  reset(): void {
    this.complete = false;
    this.arriveTime = -1;
    this.hintShown = false;
    this.hintTimer = 0;
    this.openingSaid = false;
    this.timeScale = 1;
    this.env.pavement.reset();
    this.env.house.doorOpen = 0;
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
    // Debug skip-ahead into the hill: bring the set-piece up instantly.
    if (this.startX > COURSE.pavementStart - 20) this.env.pavement.beginRise();
    if (this.startX > COURSE.hillCrest - 26) this.env.pavement.beginSlide();
    this.s.ui.showHint(false);
    this.s.ui.clearSubtitle();
    this.s.camera.snap(this.cameraSubject());
  }

  private cameraSubject() {
    const c = this.visitor.controller;
    return { position: this.visitor.position, speed: c.speed, slide: c.slideBlend };
  }

  update(rawDt: number): void {
    this.timeScale = damp(this.timeScale, 1, 5, rawDt);
    const dt = rawDt * this.timeScale;
    this.time += dt;
    const c = this.visitor.controller;
    this.obstacleCtx.time = this.time;
    this.demonCtx.peaceful = this.tricks.peaceful;

    this.visitor.update(dt, this.s.input, this.env.pavement);
    this.observer.update(dt);
    this.mind.update(dt, c, this.observer);
    this.course.update(this.obstacleCtx);
    this.director.update(dt, this.demonCtx);
    this.abilities.update(dt, this.obstacleCtx);
    this.obstacles.update(dt, this.obstacleCtx);
    this.tricks.update(dt, c, this.observer, this.mind, this.sarcasm);
    this.sarcasm.update(dt, c, this.observer);
    this.inscriptions.update(dt, c.x);

    // The Demon's gusts move the whole park: grass, trees, leaves.
    let gust = 0;
    for (const h of this.abilities.hazards) if (h instanceof WindGust) gust = Math.max(gust, h.gustStrength);
    this.env.setGust(gust * 0.9);
    this.env.setAnxiety(this.mind.anxiety);
    this.env.update(dt, this.s.camera.camera, this.visitor.position);
    this.s.camera.update(rawDt, this.cameraSubject());
    this.overlay.update(rawDt);
    this.panel.update(rawDt);

    if (!this.openingSaid && c.x > 6 && c.mode === 'run') {
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
    });

    // --- Arrival at the house ---
    if (c.mode !== 'idle' && c.mode !== 'arrive' && c.x >= COURSE.finish) {
      c.mode = 'arrive';
      c.controllable = false;
      this.arriveTime = 0;
      this.panel.setActive(false);
      this.s.camera.setMode('arrive');
      this.s.ui.showHint(false);
      let line: string = c.caughtCount === 0 ? PARK_LINES.untouched : PARK_LINES.arrive;
      if (this.mode === 'versus') line = this.versusWinner === 'demon' ? PARK_LINES.versusDemon : PARK_LINES.versusVisitor;
      this.s.ui.say(line, 4);
    }
    if (this.arriveTime >= 0) {
      this.arriveTime += dt;
      this.env.house.doorOpen = damp(this.env.house.doorOpen, this.arriveTime > 1.2 ? 1 : 0, 1.5, dt);
      if (this.arriveTime > 5.2 && !this.complete) {
        this.complete = true;
        this.s.bus.emit('chapter:complete', {
          caught: c.caughtCount,
          time: c.elapsed,
          winner: this.mode === 'versus' ? this.versusWinner : undefined,
        });
      }
    }
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
