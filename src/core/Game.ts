import * as THREE from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { ChaseCamera } from '../camera/ChaseCamera';
import { ParkChapter } from '../story/park/ParkChapter';
import { UI } from '../ui/UI';
import { EventBus } from './Events';
import { Input } from './Input';
import { PostFX } from './PostFX';
import { StateMachine } from './StateMachine';

export interface GameOptions {
  /** Debug: start the run further along the course (?x=300). */
  startX?: number;
}

/**
 * Owns the renderer, the main loop and top-level flow:
 * title → playing ⇄ paused → ended → (restart | title).
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly bus = new EventBus();
  readonly input = new Input();
  readonly states = new StateMachine();
  readonly camera: ChaseCamera;
  readonly audio: AudioEngine;
  readonly ui: UI;
  readonly chapter: ParkChapter;
  private post: PostFX;
  private timer = new THREE.Timer();
  private endInfo: { caught: number; time: number; winner?: 'demon' | 'visitor' } = { caught: 0, time: 0 };
  private transitioning = false;
  /** Frames rendered — exposed for automated smoke tests. */
  frames = 0;
  private readonly maxPixelRatio = Math.min(window.devicePixelRatio, 1.75);
  private pixelRatio = this.maxPixelRatio;
  private frameTimeAvg = 1 / 60;
  private qualityTimer = 0;

  constructor(container: HTMLElement, opts: GameOptions = {}) {
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
      onResume: () => this.states.go('playing'),
      onQuit: () => this.toTitle(),
      onToggleMute: () => {
        this.audio.setMuted(!this.audio.isMuted);
        return this.audio.isMuted;
      },
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

    this.states
      .register('title', {
        enter: () => {
          this.chapter.enterTitle();
          this.ui.showTitle(true);
          this.ui.hideEnd();
          this.ui.showPause(false);
        },
      })
      .register('playing', { enter: () => this.ui.showPause(false) })
      .register('paused', { enter: () => this.ui.showPause(true) })
      .register('ended', {
        enter: () => {
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

    this.input.onPress((a) => {
      const s = this.states.state;
      if (a === 'pause') {
        if (s === 'playing') this.states.go('paused');
        else if (s === 'paused') this.states.go('playing');
      } else if (a === 'restart' && (s === 'ended' || s === 'paused')) {
        this.restart();
      } else if (a === 'confirm' && s === 'title') {
        this.play('single');
      }
    });

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.states.is('playing')) this.states.go('paused');
    });

    this.states.go('title');
    this.ui.setFade(0, 2.2);
    this.renderer.setAnimationLoop(this.loop);
  }

  play(mode: 'single' | 'versus' = 'single'): void {
    if (!this.states.is('title') || this.transitioning) return;
    this.audio.unlock();
    this.chapter.setMode(mode);
    this.ui.showTitle(false);
    this.chapter.start();
    this.states.go('playing');
  }

  restart(): void {
    if (this.transitioning) return;
    this.audio.unlock();
    this.transitioning = true;
    this.ui.setFade(1, 0.45);
    setTimeout(() => {
      this.ui.showTitle(false);
      this.chapter.reset();
      this.chapter.start();
      this.input.endFrame();
      this.states.go('playing');
      this.ui.setFade(0, 0.9);
      this.transitioning = false;
    }, 480);
  }

  toTitle(): void {
    if (this.transitioning) return;
    this.transitioning = true;
    this.ui.setFade(1, 0.6);
    setTimeout(() => {
      this.states.go('title');
      this.ui.setFade(0, 1.4);
      this.transitioning = false;
    }, 650);
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

  private loop = () => {
    this.timer.update();
    const rawDt = this.timer.getDelta();
    const dt = Math.min(rawDt, 1 / 20);
    const s = this.states.state;
    if (s !== 'paused') this.chapter.update(dt);
    this.ui.update(dt);
    this.post.render(dt);
    this.input.endFrame();
    this.frames++;
    if (rawDt > 0 && rawDt < 0.5) this.adaptQuality(rawDt);
  };
}
