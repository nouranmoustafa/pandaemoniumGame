import * as THREE from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { ChaseCamera } from '../camera/ChaseCamera';
import { ParkChapter } from '../story/park/ParkChapter';
import type { PrologueBeat } from '../story/prologue/Prologue';
import { UI } from '../ui/UI';
import { EventBus } from './Events';
import { Input } from './Input';
import { PostFX } from './PostFX';
import { type GameStateId, StateMachine, type StoryState } from './StateMachine';

export interface GameOptions {
  /** Debug: start the run further along the course (?x=300). Skips the prologue. */
  startX?: number;
  /** Debug/testing: go straight to the chase (?skipintro). */
  skipIntro?: boolean;
}

/** Seconds Escape must be held to skip the prologue. */
const SKIP_HOLD = 1.0;

interface Fade {
  t: number;
  out: number;
  in: number;
  mid: () => void;
  midDone: boolean;
}

/**
 * Owns the renderer, the main loop and top-level flow:
 *
 *   title → prologue → playing ⇄ paused → ended → (restart | title)
 *
 * alongside a story-state machine (TITLE_SCREEN … STAGE_2_END) that systems
 * hook for enter/exit work. Transitions that fade run on the frame clock —
 * no timers — so they can't overlap or double-fire.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly bus = new EventBus();
  readonly input = new Input();
  readonly states = new StateMachine<GameStateId>();
  readonly story = new StateMachine<StoryState>();
  readonly camera: ChaseCamera;
  readonly audio: AudioEngine;
  readonly ui: UI;
  readonly chapter: ParkChapter;
  private post: PostFX;
  private timer = new THREE.Timer();
  private endInfo: { caught: number; time: number; winner?: 'demon' | 'visitor' } = { caught: 0, time: 0 };
  private fade: Fade | null = null;
  private resumeTo: 'prologue' | 'playing' = 'playing';
  private skipHold = 0;
  private skipPrompt = 0;
  private opts: GameOptions;
  /** Frames rendered — exposed for automated smoke tests. */
  frames = 0;
  private readonly maxPixelRatio = Math.min(window.devicePixelRatio, 1.75);
  private pixelRatio = this.maxPixelRatio;
  private frameTimeAvg = 1 / 60;
  private qualityTimer = 0;

  constructor(container: HTMLElement, opts: GameOptions = {}) {
    this.opts = opts;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera = new ChaseCamera(window.innerWidth / window.innerHeight);
    this.audio = new AudioEngine(this.bus);
    this.ui = new UI({
      onPlay: (mode) => this.play(mode),
      onRestart: () => this.restart(),
      onResume: () => this.resume(),
      onQuit: () => this.toTitle(),
      onToggleMute: () => {
        this.audio.setMuted(!this.audio.isMuted);
        return this.audio.isMuted;
      },
      onRevealMenu: () => this.revealMenu(),
    });
    this.chapter = new ParkChapter(
      { scene: this.scene, canvas: this.renderer.domElement, camera: this.camera, input: this.input, bus: this.bus, audio: this.audio, ui: this.ui },
      { startX: opts.startX },
    );
    this.post = new PostFX(this.renderer, this.scene, this.camera.camera);
    // Warm the Demon's shaders now rather than mid-chase.
    this.chapter.abilities.prewarm(this.renderer, this.scene, this.camera.camera);

    this.bus.on('visitor:caught', () => {
      this.post.pulseHurt();
      this.ui.flashHurt();
    });
    this.bus.on('chapter:complete', (info) => {
      this.endInfo = info;
      this.states.go('ended');
    });
    this.chapter.prologue.onBeat = (b: PrologueBeat) => this.story.go(b);
    this.chapter.onPrologueHandoff = () => {
      if (!this.states.is('prologue')) return;
      this.chapter.start(false);
      this.states.go('playing');
    };

    this.registerFlow();
    this.registerStory();
    this.bindInput();

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.states.is('playing') || this.states.is('prologue'))) this.pause();
    });

    this.states.go('title');
    this.ui.setFade(0, 2.2);
    this.renderer.setAnimationLoop(this.loop);
  }

  private registerFlow(): void {
    this.states
      .register('title', {
        enter: () => {
          this.chapter.enterTitle();
          this.ui.showTitle(true);
          this.ui.hideEnd();
          this.ui.showPause(false);
          this.ui.setLetterbox(false);
          this.story.go('TITLE_SCREEN');
        },
      })
      .register('prologue', {
        enter: () => {
          this.ui.showPause(false);
          this.ui.setLetterbox(true);
        },
        exit: () => {
          this.skipHold = 0;
          this.skipPrompt = 0;
          this.ui.showSkip(false, 0);
        },
      })
      .register('playing', {
        enter: (from) => {
          this.ui.showPause(false);
          this.ui.setLetterbox(false);
          if (from !== 'paused') this.story.go('CHASE_GAMEPLAY');
        },
      })
      .register('paused', { enter: () => this.ui.showPause(true), exit: () => this.ui.showPause(false) })
      .register('ended', {
        enter: () => {
          this.story.go('STAGE_2_END');
          const lines = [
            'You found it after all. It was so hoping you would.',
            'It kept the light on for you.',
            'Inside, something is laying out a dress in your size.',
          ];
          const versusLines = {
            demon: 'She is inside now. The Demon thanks you for your assistance.',
            visitor: 'She arrived on her own terms. The house is pretending that was the plan.',
          };
          const line = this.endInfo.winner ? versusLines[this.endInfo.winner] : lines[Math.floor(Math.random() * lines.length)];
          this.ui.showEnd(this.endInfo.caught, this.endInfo.time, line, this.endInfo.winner);
        },
        exit: () => this.ui.hideEnd(),
      });
  }

  private registerStory(): void {
    this.story
      .register('TITLE_SCREEN', { enter: () => this.ui.setTitleStage('press') })
      .register('MODE_SELECTION', { enter: () => this.ui.setTitleStage('menu') })
      .register('PROLOGUE_ESTABLISHING', {
        enter: () => {
          // The skip prompt shows itself for a few seconds at the start.
          this.skipPrompt = 5;
        },
      });
  }

  private bindInput(): void {
    this.input.onAnyKey((code) => {
      if (this.story.is('TITLE_SCREEN') && !this.fade && code !== 'Escape') this.revealMenu();
    });
    this.input.onPress((a) => {
      const s = this.states.state;
      if (a === 'escape') {
        // In the prologue Escape is held to skip (see loop); it never pauses there.
        if (s === 'prologue') this.skipPrompt = Math.max(this.skipPrompt, 3);
        else if (s === 'playing') this.pause();
        else if (s === 'paused') this.resume();
      } else if (a === 'pause') {
        if (s === 'playing' || s === 'prologue') this.pause();
        else if (s === 'paused') this.resume();
      } else if (a === 'restart' && (s === 'ended' || s === 'paused')) {
        this.restart();
      } else if (a === 'confirm' && this.story.is('MODE_SELECTION')) {
        this.play('single');
      }
      if (s === 'prologue' && (a === 'sprint' || a === 'up' || a === 'down' || a === 'confirm')) this.skipPrompt = Math.max(this.skipPrompt, 3);
    });
  }

  private revealMenu(): void {
    if (this.story.is('TITLE_SCREEN')) this.story.go('MODE_SELECTION');
  }

  play(mode: 'single' | 'versus' = 'single'): void {
    if (!this.states.is('title') || this.fade) return;
    this.audio.unlock();
    this.revealMenu();
    this.chapter.setMode(mode);
    this.ui.showTitle(false);
    this.beginRun();
  }

  /** A new run: the prologue, unless a debug option asks for the chase directly. */
  private beginRun(): void {
    if (this.opts.startX !== undefined || this.opts.skipIntro) {
      if (this.opts.skipIntro && this.opts.startX === undefined) this.chapter.skipPrologue();
      else this.chapter.start(true);
      this.states.go('playing');
      return;
    }
    this.chapter.beginPrologue();
    this.states.go('prologue');
  }

  pause(): void {
    const s = this.states.state;
    if (s !== 'playing' && s !== 'prologue') return;
    this.resumeTo = s;
    this.states.go('paused');
  }

  resume(): void {
    if (this.states.is('paused')) this.states.go(this.resumeTo);
  }

  /** Hold-Escape skip: behind a short fade, jump the prologue to its end and start the chase. */
  skipPrologue(): void {
    if (!this.states.is('prologue') || this.fade) return;
    this.runFade(0.4, 0.8, () => {
      this.chapter.skipPrologue();
      this.states.go('playing');
    });
  }

  restart(): void {
    if (this.fade) return;
    this.audio.unlock();
    this.runFade(0.45, 0.9, () => {
      this.input.endFrame();
      // A fresh run: back through the title state (which resets the chapter), then the prologue again.
      this.states.go('title');
      this.ui.showTitle(false);
      this.beginRun();
    });
  }

  toTitle(): void {
    if (this.fade) return;
    this.runFade(0.6, 1.4, () => this.states.go('title'));
  }

  private runFade(out: number, inSec: number, mid: () => void): void {
    this.fade = { t: 0, out, in: inSec, mid, midDone: false };
    this.ui.setFade(1, out);
  }

  private updateFade(dt: number): void {
    const f = this.fade;
    if (!f) return;
    f.t += dt;
    if (!f.midDone && f.t >= f.out + 0.05) {
      f.midDone = true;
      f.mid();
      this.ui.setFade(0, f.in);
    }
    if (f.midDone && f.t >= f.out + 0.05 + f.in) this.fade = null;
  }

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
    this.camera.resize(w / h);
  };

  /**
   * Dynamic resolution: weak GPUs drop render scale to hold frame rate,
   * strong ones climb back to full sharpness.
   */
  private adaptQuality(rawDt: number): void {
    this.frameTimeAvg += (rawDt - this.frameTimeAvg) * 0.05;
    this.qualityTimer += rawDt;
    if (this.qualityTimer < 1.5) return;
    this.qualityTimer = 0;
    const ms = this.frameTimeAvg * 1000;
    const prev = this.pixelRatio;
    if (ms > 21) this.pixelRatio = Math.max(0.6, this.pixelRatio - 0.15);
    else if (ms < 13) this.pixelRatio = Math.min(this.maxPixelRatio, this.pixelRatio + 0.1);
    if (prev !== this.pixelRatio) {
      this.renderer.setPixelRatio(this.pixelRatio);
      this.post.setSize(window.innerWidth, window.innerHeight);
    }
  }

  /** Chase-side story states follow the run itself; they only ever move forward. */
  private trackChaseStory(): void {
    const c = this.chapter.visitor.controller;
    if (this.story.is('STAGE_2_END')) return;
    if (c.mode === 'slide' || c.mode === 'arrive') this.story.go('PAVEMENT_SLIDE');
    else if (this.story.is('CHASE_GAMEPLAY') && this.chapter.mind.phase !== 'amused') this.story.go('CHASE_ESCALATION');
  }

  private loop = () => {
    this.timer.update();
    const rawDt = this.timer.getDelta();
    const dt = Math.min(rawDt, 1 / 20);
    const s = this.states.state;
    if (s === 'prologue') {
      if (this.input.isHeld('escape') && !this.fade) this.skipHold += dt;
      else this.skipHold = Math.max(0, this.skipHold - dt * 3);
      this.skipPrompt = Math.max(0, this.skipPrompt - dt);
      this.ui.showSkip(this.skipPrompt > 0 || this.skipHold > 0, this.skipHold / SKIP_HOLD);
      if (this.skipHold >= SKIP_HOLD) this.skipPrologue();
    }
    if (s !== 'paused') this.chapter.update(dt);
    if (s === 'playing') this.trackChaseStory();
    this.post.setWarmth(this.chapter.env.warmth);
    this.updateFade(rawDt > 0.5 ? 0.05 : rawDt);
    this.ui.update(dt);
    this.post.render(dt);
    this.input.endFrame();
    this.frames++;
    if (rawDt > 0 && rawDt < 0.5) this.adaptQuality(rawDt);
  };
}
