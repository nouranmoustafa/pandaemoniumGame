import './styles.css';
import { MODE_TUNING } from '../config';

export interface UIHandlers {
  onPlay: (mode: 'single' | 'versus') => void;
  /** Straight back into the chase at the gate (same mode). */
  onRetryChase: () => void;
  /** The whole story again, from the prologue (same mode). */
  onReplayStory: () => void;
  onResume: () => void;
  onQuit: () => void;
  onToggleMute: () => boolean;
  /** Title: the "press any key" prompt was clicked. */
  onRevealMenu: () => void;
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
  /** Stage 4's in-scene prompt (pull back), styled like the hint. */
  private prompt = el('div', 'hint prompt');
  private subtitle = el('div', 'subtitle');
  /** Stage 5: the choice at the window, set into the bottom of the frame. */
  private choice = el('div', 'choice');
  /** Stage 5: the last line, over the closing shot (above the fade). */
  private caption = el('div', 'caption');
  private effort = el('div', 'effort', '<i></i>');
  private hurt = el('div', 'hurt');
  private dodge = el('div', 'dodge-flash');
  private fade = el('div', 'fade');
  private press = el('div', 'press-any', 'PRESS ANY KEY');
  private menu!: HTMLDivElement;
  private skip = el('div', 'skip-intro', 'HOLD ESC — SKIP INTRO<i></i>');
  private barTop = el('div', 'letterbox top');
  private barBottom = el('div', 'letterbox bottom');
  private pause = el('div', 'card');
  private end = el('div', 'card');
  private subtitleTimer = 0;
  private effortIdle = 0;

  constructor(handlers: UIHandlers) {
    this.title.innerHTML = `
      <h1>The House<br><span class="want">Wants</span> You</h1>
      <p class="tag">You matched with someone lovely. They asked to meet in the old park, after dark.</p>`;
    const menu = el('div', 'menu');
    this.menu = menu;
    this.press.addEventListener('click', () => handlers.onRevealMenu());
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
      <p>At the house, <kbd>SPACE</kbd> pulls back against whatever has hold of her. It won't help. It will be noted.</p>
      <p>At the window, <kbd>SPACE</kbd> wipes the glass; <kbd>↑</kbd><kbd>↓</kbd> and <kbd>SPACE</kbd> choose; <kbd>SPACE</kbd>, tapped hard, pulls her free.</p>
      <p><kbd>ESC</kbd> or <kbd>P</kbd> pause. During the opening and the house, <em>hold</em> <kbd>ESC</kbd> to skip.</p>`;
    this.title.append(this.press, menu, this.howto, el('div', 'stage-mark', 'STAGE V — THE WINDOW'));

    this.pause.innerHTML = '<h2>Paused</h2><p class="line">It will wait. It is very good at waiting.</p>';
    const pm = el('div', 'menu');
    const resume = el('button', '', 'RESUME');
    const retry = el('button', '', 'RETRY CHASE');
    const replay = el('button', '', 'REPLAY STORY');
    const quit = el('button', '', 'QUIT TO TITLE');
    resume.addEventListener('click', handlers.onResume);
    retry.addEventListener('click', handlers.onRetryChase);
    replay.addEventListener('click', handlers.onReplayStory);
    quit.addEventListener('click', handlers.onQuit);
    pm.append(resume, retry, replay, quit);
    this.pause.append(pm);

    const mute = el('button', 'mute', 'SOUND ON');
    mute.addEventListener('click', () => {
      const muted = handlers.onToggleMute();
      mute.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
      mute.blur();
    });

    this.end.dataset.role = 'end';
    this.root.append(this.barTop, this.barBottom, this.skip, this.hurt, this.dodge, this.hint, this.prompt, this.choice, this.subtitle, this.effort, this.title, this.pause, this.end, mute, this.fade, this.caption);
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

  /** Title: first a quiet "press any key", then the menu. */
  setTitleStage(stage: 'press' | 'menu'): void {
    this.press.classList.toggle('hidden', stage !== 'press');
    this.menu.classList.toggle('hidden', stage !== 'menu');
    if (stage === 'press') this.howto.classList.remove('open');
  }

  /** "HOLD ESC — SKIP INTRO", with a meter that fills while it's held. */
  showSkip(v: boolean, progress: number, label = 'HOLD ESC — SKIP INTRO'): void {
    this.skip.classList.toggle('show', v);
    if (this.skip.firstChild) this.skip.firstChild.textContent = label;
    (this.skip.lastElementChild as HTMLElement).style.transform = `scaleX(${Math.min(1, progress).toFixed(3)})`;
  }

  /** Cinematic bars for the prologue; they withdraw when she's handed to the player. */
  setLetterbox(v: boolean): void {
    this.barTop.classList.toggle('show', v);
    this.barBottom.classList.toggle('show', v);
  }

  showHint(v: boolean): void {
    this.hint.classList.toggle('show', v);
  }

  /** A short in-scene prompt (null hides it). */
  setPrompt(html: string | null): void {
    if (html) this.prompt.innerHTML = html;
    this.prompt.classList.toggle('show', !!html);
  }

  /**
   * The window's choice: a few words in the lower frame, the selected one
   * lit. null hides it. Clicking an option picks it.
   */
  showChoice(options: string[] | null, selected: number, onPick?: (i: number) => void): void {
    this.choice.classList.toggle('show', !!options);
    if (!options) return;
    this.choice.innerHTML = '';
    options.forEach((o, i) => {
      const b = el('button', i === selected ? 'on' : '', o);
      b.addEventListener('click', () => {
        b.blur();
        onPick?.(i);
      });
      this.choice.append(b);
    });
    this.choice.append(el('p', 'choice-keys', '↑ / ↓ — SELECT &nbsp;·&nbsp; SPACE — CONFIRM'));
  }

  setCaption(text: string | null): void {
    if (text) this.caption.textContent = text;
    this.caption.classList.toggle('show', !!text);
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

  showEnd(caught: number, time: number, line: string, winner?: 'demon' | 'visitor', resisted = 0): void {
    this.end.classList.remove('finale');
    const title = winner === 'demon' ? 'The Demon Wins' : winner === 'visitor' ? 'The Visitor Wins' : 'The Dress Fits';
    this.end.innerHTML = `
      <h2>${title}</h2>
      <p class="line">${line}</p>
      <p class="stats">CAUGHT ${caught}&nbsp;&nbsp;·&nbsp;&nbsp;${time.toFixed(1)}s&nbsp;&nbsp;·&nbsp;&nbsp;PULLED BACK ${resisted}</p>`;
    const m = el('div', 'menu');
    const retry = el('button', '', 'RETRY CHASE');
    const replay = el('button', '', 'REPLAY STORY');
    const quit = el('button', '', 'TITLE');
    retry.addEventListener('click', this.endHandlers.onRetryChase);
    replay.addEventListener('click', this.endHandlers.onReplayStory);
    quit.addEventListener('click', this.endHandlers.onQuit);
    m.append(retry, replay, quit);
    const hint = el('p', 'stats', 'THE MIRROR — TO BE CONTINUED &nbsp;·&nbsp; R RETRIES THE CHASE');
    hint.style.marginTop = '2.4em';
    hint.style.fontSize = '0.75rem';
    this.end.append(m, hint);
    this.end.classList.add('show');
  }

  /** Stage 5's end: black, a moment of silence, then the way back in. */
  showFinaleEnd(caught: number, time: number, winner?: 'demon' | 'visitor'): void {
    const chase = winner === 'demon' ? 'THE DEMON WON THE CHASE' : winner === 'visitor' ? 'THE VISITOR WON THE CHASE' : `CAUGHT ${caught}&nbsp;&nbsp;·&nbsp;&nbsp;${time.toFixed(1)}s`;
    this.end.innerHTML = `<p class="stats">${chase}</p>`;
    const m = el('div', 'menu');
    const replay = el('button', '', 'REPLAY STORY');
    const retry = el('button', '', 'RETRY CHASE');
    const quit = el('button', '', 'MAIN MENU');
    replay.addEventListener('click', this.endHandlers.onReplayStory);
    retry.addEventListener('click', this.endHandlers.onRetryChase);
    quit.addEventListener('click', this.endHandlers.onQuit);
    m.append(replay, retry, quit);
    this.end.append(m);
    this.end.classList.add('show', 'finale');
  }

  hideEnd(): void {
    this.end.classList.remove('finale');
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
