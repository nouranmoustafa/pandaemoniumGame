import type * as THREE from 'three';
import type { AudioEngine } from '../audio/AudioEngine';
import type { ChaseCamera } from '../camera/ChaseCamera';
import type { EventBus } from '../core/Events';
import type { Input } from '../core/Input';
import type { UI } from '../ui/UI';

export interface ChapterServices {
  scene: THREE.Scene;
  camera: ChaseCamera;
  input: Input;
  bus: EventBus;
  audio: AudioEngine;
  ui: UI;
}

/**
 * A playable story segment. The Game owns the renderer, loop and top-level
 * state; chapters own their world and rules. Later chapters (house interior,
 * wedding dress, mirror, window, reveal) implement this same contract.
 */
export interface Chapter {
  readonly id: ChapterId;
  /** Frame shown behind the title screen. */
  enterTitle(): void;
  /** Begin gameplay from the chapter's start. */
  start(): void;
  /** Restore the chapter to its initial state. */
  reset(): void;
  update(dt: number): void;
  /** True once the chapter's ending sequence has finished. */
  readonly complete: boolean;
  dispose(): void;
}

export type ChapterId = 'park' | 'house-interior' | 'wedding' | 'mirror' | 'window' | 'reveal';

/** Story order. Only 'park' is implemented in Stage 1. */
export const CHAPTER_ORDER: ChapterId[] = ['park', 'house-interior', 'wedding', 'mirror', 'window', 'reveal'];
