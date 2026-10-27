import './styles.css';
import { MODE_TUNING } from '../config';

export interface UIHandlers {
  onPlay: (mode: 'single' | 'versus') => void;
  onRestart: () => void;
  onResume: () => void;
  onQuit: () => void;
  onToggleMute: () => boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** DOM overlay: title, tutorial hint, Demon subtitles, pause and end cards. */
export class UI {
  private root = el('div', 'ui-layer');
  private title = el('div', 'title-screen');
  private howto = el('div', 'howto');
  private hint = el('div', 'hint', 'UP / DOWN — <span>DODGE</span><br>TAP SPACE — <span>RUN</span>');
  private subtitle = el('div', 'subtitle');
  private effort = el('div', 'effort', '<i></i>');
  private hurt = el('div', 'hurt');
  private dodge = el('div', 'dodge-flash');
  private fade = el('div', 'fade');
  private pause = el('div', 'card');
  private end = el('div', 'card');
  private subtitleTimer = 0;
  private effortIdle = 0;

  constructor(handlers: UIHandlers) {
    this.title.innerHTML = `
      <h1>The House<br><span class="want">Wants</span> You</h1>
      <p class="tag">You matched with someone lovely. They asked to meet in the old park, after dark.</p>`;
    const menu = el('div', 'menu');
    const play = el('button', '', 'PLAY ALONE');
    const versus = el('button', '', 'LOCAL 1V1');
    const how = el('button', '', 'HOW TO PLAY');
    play.addEventListener('click', () => handlers.onPlay('single'));
    versus.addEventListener('click', () => handlers.onPlay('versus'));
    how.addEventListener('click', () => this.howto.classList.toggle('open'));
    menu.append(play, versus, how);
    this.howto.innerHTML = `
      <p>She runs on her own. The park would rather she didn't.</p>
      <p><kbd>↑</kbd><kbd>↓</kbd> change lanes — dodge whatever the park sends.</p>
      <p><kbd>SPACE</kbd> <em>tap</em> repeatedly to run faster. Stop, and she tires back to a jog.</p>
      <p>Every attack is announced: thrashing grass, red cracks, a lifted limb, gathering wind, bubbling water, pale embers. Steer against a gust to brace.</p>
      <p class="ht-head">Local 1v1</p>
      <p>Player one is the Visitor, on the keyboard. Player two is the <em>Demon</em>, with the <kbd>MOUSE</kbd>: choose Grass, Wind, Water or Fire, then click the lit path ahead of her. Right-click cancels.</p>
      <p>The Demon wins if she is caught ${MODE_TUNING.versusCatchesToWin} times before the house. It may not close every lane, strike without warning, or kick her while she's down.</p>
      <p><kbd>ESC</kbd> pause.</p>`;
    this.title.append(menu, this.howto, el('div', 'stage-mark', 'STAGE II — THE DEMON'));

    this.pause.innerHTML = '<h2>Paused</h2><p class="line">It will wait. It is very good at waiting.</p>';
    const pm = el('div', 'menu');
    const resume = el('button', '', 'RESUME');
    const restart = el('button', '', 'RESTART');
    const quit = el('button', '', 'QUIT TO TITLE');
    resume.addEventListener('click', handlers.onResume);
    restart.addEventListener('click', handlers.onRestart);
    quit.addEventListener('click', handlers.onQuit);
    pm.append(resume, restart, quit);
    this.pause.append(pm);

    const mute = el('button', 'mute', 'SOUND ON');
    mute.addEventListener('click', () => {
      const muted = handlers.onToggleMute();
      mute.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
      mute.blur();
    });

    this.end.dataset.role = 'end';
    this.root.append(this.hurt, this.dodge, this.hint, this.subtitle, this.effort, this.title, this.pause, this.end, mute, this.fade);
    document.body.appendChild(this.root);
    this.endHandlers = handlers;

    // Keep keyboard focus off buttons so Space never "clicks" them mid-run.
    this.root.addEventListener('mouseup', () => (document.activeElement as HTMLElement | null)?.blur?.());
  }

  private endHandlers: UIHandlers;

  showTitle(v: boolean): void {
    this.title.classList.toggle('hidden', !v);
    if (!v) this.howto.classList.remove('open');
  }

  showHint(v: boolean): void {
    this.hint.classList.toggle('show', v);
  }

  showPause(v: boolean): void {
    this.pause.classList.toggle('show', v);
  }

  say(text: string, duration = 4): void {
    // Light emphasis markup: *word* → <em>.
    this.subtitle.innerHTML = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    this.subtitle.classList.add('show');
    this.subtitleTimer = duration;
  }

  /** Hint lines adapt to the mode (1v1 adds the Demon's control). */
  setMode(mode: 'single' | 'versus'): void {
    this.hint.innerHTML =
      mode === 'versus'
        ? 'VISITOR · UP / DOWN — <span>DODGE</span> · TAP SPACE — <span>RUN</span><br>DEMON · MOUSE — <span>CHOOSE A POWER, CLICK THE PATH</span>'
        : 'UP / DOWN — <span>DODGE</span><br>TAP SPACE — <span>RUN</span>';
    this.hint.classList.toggle('wide', mode === 'versus');
  }

  /** A brief pale breath at the edges: a clean escape. */
  flashDodge(): void {
    this.dodge.classList.remove('flash');
    void this.dodge.offsetWidth;
    this.dodge.classList.add('flash');
  }

  flashHurt(): void {
    this.hurt.classList.add('flash');
    setTimeout(() => this.hurt.classList.remove('flash'), 90);
  }

  setFade(opacity: number, seconds = 1.6): void {
    this.fade.style.transition = `opacity ${seconds}s ease`;
    this.fade.style.opacity = String(opacity);
  }

  setEffort(v: number, tapped: boolean, visible: boolean): void {
    if (tapped) this.effortIdle = 0;
    this.effort.classList.toggle('show', visible && this.effortIdle < 2.5);
    (this.effort.firstElementChild as HTMLElement).style.transform = `scaleX(${v.toFixed(3)})`;
  }

  showEnd(caught: number, time: number, line: string, winner?: 'demon' | 'visitor'): void {
    const title = winner === 'demon' ? 'The Demon Wins' : winner === 'visitor' ? 'The Visitor Wins' : 'The Door Is Open';
    this.end.innerHTML = `
      <h2>${title}</h2>
      <p class="line">${line}</p>
      <p class="stats">CAUGHT ${caught}&nbsp;&nbsp;·&nbsp;&nbsp;${time.toFixed(1)}s</p>`;
    const m = el('div', 'menu');
    const again = el('button', '', 'RUN AGAIN');
    const quit = el('button', '', 'TITLE');
    again.addEventListener('click', this.endHandlers.onRestart);
    quit.addEventListener('click', this.endHandlers.onQuit);
    m.append(again, quit);
    const hint = el('p', 'stats', 'END OF STAGE I &nbsp;·&nbsp; PRESS R TO RUN AGAIN');
    hint.style.marginTop = '2.4em';
    hint.style.fontSize = '0.75rem';
    this.end.append(m, hint);
    this.end.classList.add('show');
  }

  hideEnd(): void {
    this.end.classList.remove('show');
  }

  update(dt: number): void {
    this.effortIdle += dt;
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.subtitle.classList.remove('show');
    }
  }

  clearSubtitle(): void {
    this.subtitleTimer = 0;
    this.subtitle.classList.remove('show');
  }
}
