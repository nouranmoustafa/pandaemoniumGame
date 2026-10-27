import * as THREE from 'three';
import { COURSE } from '../../config';
import { damp } from '../../core/math';
import { AIDemonDirector } from '../../demon/AIDemonDirector';
import type { DemonContext } from '../../demon/DemonDirector';
import { PARK_LINES } from '../../demon/DemonVoice';
import type { ObstacleContext } from '../../obstacles/Obstacle';
import { ObstacleManager } from '../../obstacles/ObstacleManager';
import { Visitor } from '../../visitor/Visitor';
import { Environment } from '../../world/Environment';
import type { Chapter, ChapterServices } from '../Chapter';
import { PARK_COURSE } from './course';

/**
 * Stage 1: the park chase. The Visitor runs toward a date who isn't there;
 * the park herds her toward the house.
 */
export class ParkChapter implements Chapter {
  readonly id = 'park' as const;
  readonly env: Environment;
  readonly visitor: Visitor;
  readonly obstacles: ObstacleManager;
  readonly demon: AIDemonDirector;
  complete = false;

  private obstacleCtx: ObstacleContext;
  private demonCtx: DemonContext;
  private arriveTime = -1;
  private hintTimer = 0;
  private hintShown = false;
  private tapped = false;
  private time = 0;
  private startX = 0;
  private unsub: Array<() => void> = [];

  constructor(private s: ChapterServices, opts: { startX?: number } = {}) {
    this.startX = opts.startX ?? COURSE.start;
    const treeXs = PARK_COURSE.filter((o) => o.type === 'branch').map((o) => o.x);
    this.env = new Environment(s.scene, s.bus, treeXs);
    this.visitor = new Visitor(s.bus);
    s.scene.add(this.visitor.object);
    this.obstacles = new ObstacleManager(PARK_COURSE, this.env.pavement, this.env.barkMaterial);
    s.scene.add(this.obstacles.group);
    this.demon = new AIDemonDirector(s.bus);

    this.obstacleCtx = { visitor: this.visitor, pavement: this.env.pavement, bus: s.bus, time: 0 };
    this.demonCtx = {
      visitor: this.visitor,
      env: this.env,
      obstacles: this.obstacles.obstacles,
      obstacleCtx: this.obstacleCtx,
      bus: s.bus,
    };

    this.unsub.push(
      s.bus.on('visitor:caught', () => s.camera.shake(0.55)),
      s.bus.on('visitor:sprintTap', () => (this.tapped = true)),
      s.bus.on('demon:line', ({ text, duration }) => s.ui.say(text, duration)),
      s.bus.on('pavement:rise', () => s.camera.shake(0.35)),
      s.bus.on('pavement:slide', () => s.camera.shake(0.45)),
    );
  }

  enterTitle(): void {
    this.reset();
    this.s.camera.setMode('title');
  }

  start(): void {
    this.visitor.controller.start();
    this.s.camera.setMode('chase');
    this.hintShown = true;
    this.hintTimer = 0;
    this.s.ui.showHint(true);
  }

  reset(): void {
    this.complete = false;
    this.arriveTime = -1;
    this.hintShown = false;
    this.hintTimer = 0;
    this.env.pavement.reset();
    this.env.house.doorOpen = 0;
    this.env.setGust(0);
    this.obstacles.reset();
    this.demon.reset();
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

  update(dt: number): void {
    this.time += dt;
    const c = this.visitor.controller;
    this.obstacleCtx.time = this.time;

    this.visitor.update(dt, this.s.input, this.env.pavement);
    this.demon.update(dt, this.demonCtx);
    this.obstacles.update(dt, this.obstacleCtx);
    this.env.update(dt, this.s.camera.camera, this.visitor.position);
    this.s.camera.update(dt, this.cameraSubject());

    // Tutorial hint fades once she's learned both controls (or after a while).
    if (this.hintShown) {
      this.hintTimer += dt;
      const learned = c.usedDodge && c.sprintTaps >= 3;
      if ((learned && this.hintTimer > 3) || this.hintTimer > 10) {
        this.s.ui.showHint(false);
        this.hintShown = false;
      }
    }
    this.s.ui.setEffort(c.effort, this.tapped, c.controllable);
    this.tapped = false;

    this.s.audio.update(dt, {
      speed: c.speed,
      sliding: c.mode === 'slide',
      gust: 0,
      playing: c.mode !== 'idle',
    });

    // --- Arrival at the house ---
    if (c.mode !== 'idle' && c.mode !== 'arrive' && c.x >= COURSE.finish) {
      c.mode = 'arrive';
      c.controllable = false;
      this.arriveTime = 0;
      this.s.camera.setMode('arrive');
      this.s.ui.showHint(false);
      this.s.ui.say(c.caughtCount === 0 ? PARK_LINES.untouched : PARK_LINES.arrive, 4);
    }
    if (this.arriveTime >= 0) {
      this.arriveTime += dt;
      this.env.house.doorOpen = damp(this.env.house.doorOpen, this.arriveTime > 1.2 ? 1 : 0, 1.5, dt);
      if (this.arriveTime > 5.2 && !this.complete) {
        this.complete = true;
        this.s.bus.emit('chapter:complete', { caught: c.caughtCount, time: c.elapsed });
      }
    }
  }

  get focus(): THREE.Vector3 {
    return this.visitor.position;
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
    this.demon.dispose();
  }
}
