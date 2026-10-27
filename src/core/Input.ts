export type InputAction = 'up' | 'down' | 'sprint' | 'pause' | 'restart' | 'confirm';

const KEYMAP: Record<string, InputAction> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  Space: 'sprint',
  Escape: 'pause',
  KeyP: 'pause',
  KeyR: 'restart',
  Enter: 'confirm',
};

/**
 * Edge-triggered keyboard input. Systems consume "presses" once per frame,
 * which is what tap-to-run and lane dodging need (holding a key does not repeat).
 */
export class Input {
  private pressed = new Set<InputAction>();
  private held = new Set<InputAction>();
  private listeners: Array<(a: InputAction) => void> = [];

  constructor(target: Window = window) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', () => this.held.clear());
  }

  private onDown = (e: KeyboardEvent) => {
    const action = KEYMAP[e.code];
    if (!action) return;
    e.preventDefault();
    if (e.repeat) return;
    this.pressed.add(action);
    this.held.add(action);
    for (const l of this.listeners) l(action);
  };

  private onUp = (e: KeyboardEvent) => {
    const action = KEYMAP[e.code];
    if (action) this.held.delete(action);
  };

  /** Returns true once per physical press. */
  consume(action: InputAction): boolean {
    if (this.pressed.has(action)) {
      this.pressed.delete(action);
      return true;
    }
    return false;
  }

  isHeld(action: InputAction): boolean {
    return this.held.has(action);
  }

  onPress(fn: (a: InputAction) => void): void {
    this.listeners.push(fn);
  }

  /** Inject a press (used by touch buttons / automated tests). */
  simulate(action: InputAction): void {
    this.pressed.add(action);
    for (const l of this.listeners) l(action);
  }

  endFrame(): void {
    this.pressed.clear();
  }
}
