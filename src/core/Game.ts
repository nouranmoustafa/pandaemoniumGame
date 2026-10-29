import * as THREE from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { ChaseCamera } from '../camera/ChaseCamera';
import { ParkChapter } from '../story/park/ParkChapter';
import type { FinaleJump } from '../story/finale/Finale';
import type { HouseBeat } from '../story/house/HouseSequence';
import type { PrologueBeat } from '../story/prologue/Prologue';
import { TOUCH, TOUCH_PACE } from '../ui/touch';
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
  /** Debug/testing: start Stage 5 at a checkpoint (?stage5=window|choice|run|reveal). */
  stage5?: FinaleJump;
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
 *   title → prologue → playing → house → ended → (retry chase | replay story | title)
 *   (prologue, playing and house can each pause)
 *
 * alongside a story-state machine (TITLE_SCREEN … STAGE_4_END) that systems
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
  private endInfo: { caught: number; time: number; winner?: 'demon' | 'visitor'; resisted?: number; finale?: boolean } = { caught: 0, time: 0 };
  private fade: Fade | null = null;
  private resumeTo: 'prologue' | 'playing' | 'house' = 'playing';
  private skipHold = 0;
  private skipPrompt = 0;
  private opts: GameOptions;
  /** Frames rendered — exposed for automated smoke tests. */
  frames = 0;
  /** Integrated / software GPUs get a lighter lighting setup (see applyLowQuality). */
  readonly lowGpu: boolean;
  private readonly maxPixelRatio: number;
  private pixelRatio: number;
  private frameTimeAvg = 1 / 60;
  private qualityTimer = 0;
  private qualityAge = 0;
  private fastStreak = 0;

  constructor(container: HTMLElement, opts: GameOptions = {}) {
    this.opts = opts;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.lowGpu = Game.detectLowGpu(this.renderer);
    this.maxPixelRatio = Math.min(window.devicePixelRatio, this.lowGpu ? 1.25 : 1.75);
    this.pixelRatio = this.maxPixelRatio;
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
      onRetryChase: () => this.restart('chase'),
      onReplayStory: () => this.restart('story'),
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
    // Before the warm-up below, so every shader is compiled once, for the lights it will keep.
    if (this.lowGpu) this.applyLowQuality();
    // Warm the Demon's shaders now rather than mid-chase, and the house's so
    // Stage 4 doesn't stall at the door. Compiled against the composer's
    // target: the scene is drawn there (linear, untonemapped), not to the screen.
    this.renderer.setRenderTarget(this.post.composer.renderTarget1);
    this.chapter.abilities.prewarm(this.renderer, this.scene, this.camera.camera);
    this.chapter.house.prewarm(this.renderer, this.scene, this.camera.camera);
    this.chapter.finale.prewarm(this.renderer, this.scene, this.camera.camera);
    this.renderer.setRenderTarget(null);
    // Upload every texture now. Three uploads a texture the first time something using it is
    // drawn, so whole parts of the park (unseen since the gate) used to upload together on the
    // first frame back outside after the window — a multi-second stall.
    const seen = new Set<THREE.Texture>();
    this.scene.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      if (!mats) return;
      for (const m of Array.isArray(mats) ? mats : [mats])
        for (const v of Object.values(m)) if ((v as THREE.Texture)?.isTexture && !seen.has(v as THREE.Texture)) seen.add(v as THREE.Texture);
    });
    for (const t of seen) this.renderer.initTexture(t);

    this.bus.on('visitor:caught', () => {
      this.post.pulseHurt();
      this.ui.flashHurt();
    });
    this.bus.on('chapter:complete', (info) => {
      this.endInfo = info;
      this.states.go('ended');
    });
    this.chapter.prologue.onBeat = (b: PrologueBeat) => this.story.go(b);
    this.chapter.house.onBeat = (b: HouseBeat) => this.story.go(b);
    this.chapter.finale.onBeat = (b: StoryState) => this.story.go(b);
    this.chapter.onHouseBegin = () => {
      if (this.states.is('playing')) this.states.go('house');
    };
    this.chapter.onPrologueHandoff = () => {
      if (!this.states.is('prologue')) return;
      this.chapter.start(false);
      this.states.go('playing');
    };

    this.registerFlow();
    this.registerStory();
    this.bindInput();
    this.ui.bindTouch(this.input);

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.states.is('playing') || this.states.is('prologue') || this.states.is('house'))) this.pause();
    });

    this.states.go('title');
    this.ui.setFade(0, 2.2);
    this.renderer.setAnimationLoop(this.loop);
  }

  /** ?quality=low|high overrides; otherwise integrated, mobile and software renderers count as weak. */
  private static detectLowGpu(renderer: THREE.WebGLRenderer): boolean {
    const q = new URLSearchParams(location.search).get('quality');
    if (q === 'low' || q === 'high') return q === 'low';
    // Phones and tablets (iPhones report only "Apple GPU", like Macs do).
    if (TOUCH) return true;
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    return /Intel|SwiftShader|llvmpipe|Basic Render|Mali|Adreno|PowerVR|Radeon.TM. Graphics|Radeon Graphics|Vega [0-9]+ Graphics/i.test(name) && !/Intel.*Arc/i.test(name);
  }

  /**
   * Measured on an Intel iGPU: the frame is bound by per-pixel lighting, not resolution. Every
   * point light costs each lit pixel even at zero intensity, and the plaza's key light renders a
   * second shadow pass. Trim the always-present pools and that pass; the look stays the same.
   */
  private applyLowQuality(): void {
    const env = this.chapter.env;
    env.lamps.trimPool(2);
    this.chapter.abilities.trimFireLights(1);
    env.entrance.faceLight.visible = false;
    env.entrance.keyLight.castShadow = false;
    env.moonLight.shadow.mapSize.set(1024, 1024);
  }

  private registerFlow(): void {
    this.states
      .register('title', {
        enter: () => {
          this.ui.showPad(false);
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
          this.ui.showPad(false);
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
          this.ui.showPad(true);
          this.ui.showPause(false);
          this.ui.setLetterbox(false);
          if (from !== 'paused') this.story.go('CHASE_GAMEPLAY');
        },
      })
      .register('house', {
        enter: (from) => {
          this.ui.showPad(true);
          this.ui.showPause(false);
          this.ui.showHint(false);
          this.ui.setLetterbox(!this.chapter.finale.running);
          if (from !== 'paused') this.skipPrompt = 4;
        },
        exit: () => {
          this.skipHold = 0;
          this.skipPrompt = 0;
          this.ui.showSkip(false, 0);
        },
      })
      .register('paused', { enter: () => (this.ui.showPad(false), this.ui.showPause(true)), exit: () => this.ui.showPause(false) })
      .register('ended', {
        enter: () => {
          this.ui.showPad(false);
          this.story.go('FINAL_ENDING');
          this.ui.setLetterbox(false);
          if (this.endInfo.finale) {
            // Black, silence, and the way back in. (The card itself is black: the fade lifts off it.)
            this.ui.showFinaleEnd(this.endInfo.caught, this.endInfo.time, this.endInfo.winner);
            this.ui.setFade(0, 1.2);
            return;
          }
          const lines = [
            'It always did have your measurements.',
            'Something old. Something borrowed. Someone new.',
            'The chairs thought it was a lovely service.',
          ];
          const versusLines = {
            demon: 'She is inside, and dressed. The Demon thanks you for your assistance.',
            visitor: 'She arrived on her own terms. The gown is pretending that was the plan.',
          };
          const line = this.endInfo.winner ? versusLines[this.endInfo.winner] : lines[Math.floor(Math.random() * lines.length)];
          this.ui.showEnd(this.endInfo.caught, this.endInfo.time, line, this.endInfo.winner, this.endInfo.resisted ?? 0);
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
      })
      // Stage 5: the final run is played like the chase (no bars, Escape pauses); the reveal is not.
      .register('FINAL_RUN', {
        enter: () => {
          this.ui.setLetterbox(false);
          this.skipPrompt = 0;
        },
      })
      .register('FRIENDS_REVEAL', {
        enter: () => {
          this.ui.setLetterbox(true);
          this.ui.setEffort(0, false, false);
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
        // In the prologue and the house Escape is held to skip (see loop); it never pauses there —
        // except on Stage 5's final run, which plays like the chase.
        if (s === 'house' && this.chapter.finale.running) this.pause();
        else if (s === 'prologue' || s === 'house') this.skipPrompt = Math.max(this.skipPrompt, 3);
        else if (s === 'playing') this.pause();
        else if (s === 'paused') this.resume();
      } else if (a === 'pause') {
        if (s === 'playing' || s === 'prologue' || s === 'house') this.pause();
        else if (s === 'paused') this.resume();
      } else if (a === 'restart' && (s === 'ended' || s === 'paused')) {
        this.restart('chase');
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
    if (this.opts.stage5) {
      this.chapter.jumpFinale(this.opts.stage5);
      this.states.go('house');
      return;
    }
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
    if (s !== 'playing' && s !== 'prologue' && s !== 'house') return;
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

  /** Hold-Escape skip in the house: behind a fade, straight to the gowned tableau and the end card. */
  skipHouse(): void {
    if (!this.states.is('house') || this.fade) return;
    this.runFade(0.4, 1.2, () => this.chapter.skipHouse());
  }

  /**
   * Start over. Both paths go back through the title state (which resets
   * the chapter: Demon, cooldowns, hazards, tricks, timelines, the cast) and
   * keep the selected mode. 'chase' resumes at the gate; 'story' replays the prologue.
   */
  restart(from: 'chase' | 'story' = 'chase'): void {
    if (this.fade) return;
    this.audio.unlock();
    this.runFade(0.45, 0.9, () => {
      this.input.endFrame();
      this.states.go('title');
      this.ui.showTitle(false);
      if (from === 'chase') {
        this.chapter.skipPrologue();
        this.states.go('playing');
      } else this.beginRun();
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
    // Each change reallocates the post-processing buffers (a visible black flash), so changes are
    // rare: none in the first seconds (shader warm-up stalls), down only when it is persistently
    // slow, and back up only after a long, comfortably fast stretch. No oscillation.
    this.frameTimeAvg += (rawDt - this.frameTimeAvg) * 0.05;
    this.qualityTimer += rawDt;
    this.qualityAge += rawDt;
    if (this.qualityTimer < 3 || this.qualityAge < 8) return;
    this.qualityTimer = 0;
    const ms = this.frameTimeAvg * 1000;
    const prev = this.pixelRatio;
    this.fastStreak = ms < 11 ? this.fastStreak + 1 : 0;
    // Not below 0.7: lower is blurry and, on the GPUs that get here, barely faster.
    if (ms > 24) this.pixelRatio = Math.max(0.7, this.pixelRatio - 0.15);
    else if (this.fastStreak >= 5) {
      this.fastStreak = 0;
      this.pixelRatio = Math.min(this.maxPixelRatio, this.pixelRatio + 0.1);
    }
    if (prev !== this.pixelRatio) {
      this.renderer.setPixelRatio(this.pixelRatio);
      this.post.setSize(window.innerWidth, window.innerHeight);
    }
  }

  /** Chase-side story states follow the run itself; they only ever move forward. */
  private trackChaseStory(): void {
    const c = this.chapter.visitor.controller;
    // Once the house has her, its own beats own the story.
    if (this.story.is('FINAL_ENDING') || this.chapter.house.phase !== 'off' || this.chapter.finale.phase !== 'off') return;
    if (c.mode === 'slide' || c.mode === 'arrive') this.story.go('PAVEMENT_SLIDE');
    else if (this.story.is('CHASE_GAMEPLAY') && this.chapter.mind.phase !== 'amused') this.story.go('CHASE_ESCALATION');
  }

  private loop = () => {
    this.timer.update();
    const rawDt = this.timer.getDelta();
    const dt = Math.min(rawDt, 1 / 20);
    const s = this.states.state;
    const running = s === 'house' && this.chapter.finale.running;
    if ((s === 'prologue' || s === 'house') && !running) {
      if (this.input.isHeld('escape') && !this.fade) this.skipHold += dt;
      else this.skipHold = Math.max(0, this.skipHold - dt * 3);
      this.skipPrompt = Math.max(0, this.skipPrompt - dt);
      this.ui.showSkip(this.skipPrompt > 0 || this.skipHold > 0, this.skipHold / SKIP_HOLD, s === 'house' ? 'HOLD ESC — SKIP' : undefined);
      if (this.skipHold >= SKIP_HOLD) {
        if (s === 'house') this.skipHouse();
        else this.skipPrologue();
      }
    } else if (running) {
      this.skipHold = 0;
      this.ui.showSkip(false, 0);
    }
    // Phones: the running parts play slower (the arrows are harder to work than keys).
    const gameDt = TOUCH && (s === 'playing' || running) ? dt * TOUCH_PACE : dt;
    if (s !== 'paused') this.chapter.update(gameDt);
    if (s === 'playing') this.trackChaseStory();
    this.post.setWarmth(this.chapter.env.warmth);
    this.post.setTunnel(this.chapter.tunnel);
    this.updateFade(rawDt > 0.5 ? 0.05 : rawDt);
    this.ui.update(dt);
    // Resize (if the render scale changes) before drawing: resizing clears the canvas, and doing it
    // after the frame left a blank (black) frame on screen.
    if (rawDt > 0 && rawDt < 0.5) this.adaptQuality(rawDt);
    this.post.render(dt);
    this.input.endFrame();
    this.frames++;
  };
}
