import * as THREE from 'three';
import { FAIRNESS, LANES, type LaneIndex, MODE_TUNING, POWERS } from '../config';
import type { PowerKind } from '../core/Events';
import { type DemonAbilitySystem, POWER_ORDER } from '../demon/abilities/DemonAbilitySystem';
import type { HumanDemonDirector } from '../demon/HumanDemonDirector';
import type { ObstacleContext } from '../obstacles/Obstacle';
import type { Pavement } from '../world/Pavement';
import type { TargetingOverlay } from '../world/TargetingOverlay';

const GLYPHS: Record<PowerKind, string> = {
  grass: '<path d="M6 21c1-6 0-10-2-14M10 21c0-7 1-11 4-15M14 21c1-5 3-8 6-10M9 14c-2-1-4-1-5 1" />',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h8" />',
  water: '<path d="M12 3c3 5 6 8 6 12a6 6 0 0 1-12 0c0-4 3-7 6-12z" /><path d="M9 15a3 3 0 0 0 3 3" />',
  fire: '<path d="M12 3c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5 1-2 1-5 0-9z" />',
};

const HINTS: Record<PowerKind, string> = {
  grass: 'Roots grab whoever runs through that lane.',
  wind: 'A gust herds her toward the chosen lane and drags her speed.',
  water: 'A puddle erupts into a fountain, then leaves the stones slick.',
  fire: 'A wall of cold flame burns across one lane, then falls to ash.',
};

/**
 * Local 1v1 — the Demon's controls. Pick a power, aim at the path, click.
 * Valid areas are lit on the path itself; the footprint turns red with a
 * stated reason when a cast would break the rules.
 */
export class DemonPanel {
  private root = document.createElement('div');
  private buttons = new Map<PowerKind, HTMLButtonElement>();
  private status = document.createElement('div');
  private tip = document.createElement('div');
  private score = document.createElement('div');
  private selected: PowerKind | null = null;
  private mouse = new THREE.Vector2();
  private mouseIn = false;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();
  private target: { x: number; lane: LaneIndex } | null = null;
  private statusTimer = 0;
  private active = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.Camera,
    private abilities: DemonAbilitySystem,
    private director: HumanDemonDirector,
    private overlay: TargetingOverlay,
    private pavement: Pavement,
    private ctx: () => ObstacleContext,
  ) {
    this.root.className = 'demon-panel';
    this.root.innerHTML = '<div class="dp-title">THE DEMON <span>· MOUSE</span></div>';
    this.score.className = 'dp-score';
    this.root.appendChild(this.score);
    const row = document.createElement('div');
    row.className = 'dp-row';
    for (const k of POWER_ORDER) {
      const b = document.createElement('button');
      b.className = 'dp-power';
      b.tabIndex = -1;
      b.dataset.power = k;
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[k]}</svg><span class="dp-name">${POWERS[k].label}</span><i class="dp-cd"></i>`;
      // pointerdown + preventDefault keeps focus off the button, so Space never "clicks" it.
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.button === 0) this.select(this.selected === k ? null : k);
      });
      this.buttons.set(k, b);
      row.appendChild(b);
    }
    this.root.appendChild(row);
    this.status.className = 'dp-status';
    this.root.appendChild(this.status);
    this.tip.className = 'dp-tip';
    document.body.append(this.root, this.tip);

    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerleave', () => (this.mouseIn = false));
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('contextmenu', (e) => {
      if (this.active) e.preventDefault();
    });
  }

  setActive(v: boolean): void {
    this.active = v;
    this.root.classList.toggle('show', v);
    if (!v) this.select(null);
  }

  reset(): void {
    this.select(null);
    this.say('');
  }

  private select(k: PowerKind | null): void {
    this.selected = k;
    this.buttons.forEach((b, key) => b.classList.toggle('selected', key === k));
    document.body.classList.toggle('demon-aiming', k !== null);
    if (k) this.say(HINTS[k], 0);
    else {
      this.overlay.hide();
      this.tip.classList.remove('show');
    }
  }

  private say(text: string, hold = 2.6): void {
    this.status.textContent = text;
    this.statusTimer = hold;
    this.status.classList.toggle('show', !!text);
  }

  private onMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.mouseIn = true;
    this.tip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 14}px)`;
  };

  private onDown = (e: PointerEvent) => {
    if (!this.active || !this.selected) return;
    if (e.button === 2) {
      this.select(null);
      return;
    }
    if (e.button !== 0) return;
    const k = this.selected;
    if (!this.target) {
      this.say('Aim at the path.');
      return;
    }
    const res = this.director.cast(k, this.target);
    if (res.ok) {
      this.overlay.confirm(this.pavement, this.target.x, this.target.lane);
      const b = this.buttons.get(k)!;
      b.classList.remove('fired');
      void b.offsetWidth;
      b.classList.add('fired');
      this.say(`${POWERS[k].label} — done.`, 1.4);
      this.select(null);
    } else {
      this.say(res.reason ?? 'Not there.');
      this.root.classList.remove('refuse');
      void this.root.offsetWidth;
      this.root.classList.add('refuse');
    }
  };

  /** Project the mouse onto the moving pavement surface. */
  private pick(): { x: number; lane: LaneIndex | null } | null {
    if (!this.mouseIn) return null;
    this.ray.setFromCamera(this.mouse, this.camera);
    const v = this.ctx().visitor.controller;
    let h = v.y;
    for (let i = 0; i < 4; i++) {
      this.plane.constant = -h;
      if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return null;
      h = this.pavement.heightAt(this.hit.x, this.hit.z);
    }
    let lane: LaneIndex | null = null;
    let best = 1.35;
    LANES.forEach((z, i) => {
      const d = Math.abs(this.hit.z - z);
      if (d < best) {
        best = d;
        lane = i as LaneIndex;
      }
    });
    return { x: this.hit.x, lane };
  }

  update(dt: number): void {
    if (this.statusTimer > 0) {
      this.statusTimer -= dt;
      if (this.statusTimer <= 0 && !this.selected) this.status.classList.remove('show');
    }
    if (!this.active) return;
    const c = this.ctx();
    const v = c.visitor.controller;
    this.score.innerHTML = `CAUGHT <b>${v.caughtCount}</b> / ${MODE_TUNING.versusCatchesToWin}`;

    // Cooldown rings.
    for (const k of POWER_ORDER) {
      const b = this.buttons.get(k)!;
      const f = this.abilities.cooldownFraction(k);
      b.style.setProperty('--cd', String(f));
      b.classList.toggle('cooling', f > 0);
      const left = this.abilities.cooldownLeft(k);
      (b.querySelector('.dp-cd') as HTMLElement).textContent = left > 0 ? left.toFixed(0) : '';
    }

    const k = this.selected;
    if (!k) return;
    const near = v.x + this.abilities.minLead(k, c);
    const far = v.x + FAIRNESS.maxRange;
    this.overlay.showRange(this.pavement, near, far);

    const p = this.pick();
    if (!p || p.lane === null) {
      this.target = null;
      this.overlay.hideFootprint();
      this.tip.textContent = p ? 'Not on the path' : '';
      this.tip.classList.toggle('show', !!p);
      this.tip.classList.add('bad');
      return;
    }
    // Wind is aimed at the start of its zone; centre it under the cursor.
    this.target = { x: p.x, lane: p.lane };
    const check = this.director.check(k, this.target);
    const windDir = k === 'wind' ? Math.sign(LANES[p.lane] - v.z) || 0 : null;
    this.overlay.showFootprint(this.pavement, p.x, p.lane, POWERS[k].footprint, check.ok, windDir);
    this.tip.textContent = check.ok ? `${POWERS[k].label} · click` : check.reason ?? '';
    this.tip.classList.add('show');
    this.tip.classList.toggle('bad', !check.ok);
  }
}
