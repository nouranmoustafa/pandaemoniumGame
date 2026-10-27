import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { faceUV } from './geo/head';

/** Everything the painted face needs to draw one expression. */
export interface FaceParams {
  smile: number;
  frown: number;
  open: number;
  /** Fear: mouth stretched sideways. */
  wide: number;
  pout: number;
  browInnerUp: number;
  browOuterUp: number;
  browKnit: number;
  browDown: number;
  /** Extra flush in the cheeks (laughter, embarrassment). */
  flush: number;
}

export const NEUTRAL_FACE: FaceParams = {
  smile: 0,
  frown: 0,
  open: 0,
  wide: 0,
  pout: 0,
  browInnerUp: 0,
  browOuterUp: 0,
  browKnit: 0,
  browDown: 0,
  flush: 0,
};

export interface Makeup {
  skin: string;
  skinShadow: string;
  blush: string;
  lip: string;
  lipDark: string;
  brow: string;
  browThickness: number;
  /** Brow arch height. */
  browArch: number;
  freckles?: number;
  /** Darker, tired under-eyes. */
  underEye: number;
  /** Beauty mark, in unit face coordinates. */
  mark?: [number, number];
  browHeight: number;
  eyeSpacing: number;
  mouthWidth: number;
}

const SIZE = 1024;

/**
 * Paints the face onto a canvas mapped across the front of the head. Brows
 * and lips are drawn from expression parameters; the head's morph targets
 * move the surface beneath them. Redraws are throttled to 12 per second,
 * which gives expressions a deliberate, stop-motion "replacement face"
 * cadence while the morphs stay smooth.
 */
export class FacePainter {
  readonly texture: THREE.CanvasTexture;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private base = document.createElement('canvas');
  private last: FaceParams = { ...NEUTRAL_FACE, smile: -1 };
  private cooldown = 0;

  constructor(private m: Makeup) {
    this.canvas.width = this.canvas.height = SIZE;
    this.base.width = this.base.height = SIZE;
    this.g = this.canvas.getContext('2d')!;
    this.paintBase();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.draw(NEUTRAL_FACE);
  }

  /** Unit-sphere face coordinates → canvas pixels. */
  private px(x: number, y: number): [number, number] {
    const z = Math.sqrt(Math.max(0.02, 1 - x * x - y * y));
    const [u, v] = faceUV(x, y, z);
    return [u * SIZE, (1 - v) * SIZE];
  }

  private paintBase(): void {
    const g = this.base.getContext('2d')!;
    const m = this.m;
    g.fillStyle = m.skin;
    g.fillRect(0, 0, SIZE, SIZE);
    const blob = (x: number, y: number, r: number, color: string, alpha: number) => {
      const [cx, cy] = this.px(x, y);
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, color);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = alpha;
      g.fillStyle = gr;
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
      g.globalAlpha = 1;
    };
    // Soft modelling: socket shadows, under-eye, jaw, temples.
    for (const s of [1, -1]) {
      blob(s * 0.35 * m.eyeSpacing, 0.03, 70, m.skinShadow, 0.45);
      blob(s * 0.33 * m.eyeSpacing, -0.1, 50, m.skinShadow, 0.25 + m.underEye * 0.4);
      blob(s * 0.4, -0.3, 95, m.blush, 0.32);
      blob(s * 0.62, 0.18, 90, m.skinShadow, 0.25);
    }
    blob(0, -0.27, 30, m.blush, 0.25);
    blob(0, -0.85, 160, m.skinShadow, 0.35);
    if (m.freckles) {
      const rand = mulberry32(7);
      g.fillStyle = 'rgba(120,60,40,0.35)';
      for (let i = 0; i < 90 * m.freckles; i++) {
        const x = (rand() - 0.5) * 0.7;
        const y = -0.12 - rand() * 0.22;
        const [cx, cy] = this.px(x, y);
        g.beginPath();
        g.arc(cx, cy, 1.2 + rand() * 1.8, 0, Math.PI * 2);
        g.fill();
      }
    }
    if (m.mark) {
      const [cx, cy] = this.px(m.mark[0], m.mark[1]);
      g.fillStyle = 'rgba(40,20,20,0.8)';
      g.beginPath();
      g.arc(cx, cy, 3.2, 0, Math.PI * 2);
      g.fill();
    }
  }

  /** Request an expression; redraws only on a "frame" and only if changed. */
  update(dt: number, p: FaceParams): void {
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    let diff = 0;
    for (const k in p) diff = Math.max(diff, Math.abs(p[k as keyof FaceParams] - this.last[k as keyof FaceParams]));
    if (diff < 0.025) return;
    this.cooldown = 1 / 12;
    this.draw(p);
  }

  private draw(p: FaceParams): void {
    this.last = { ...p };
    const g = this.g;
    const m = this.m;
    g.drawImage(this.base, 0, 0);
    if (p.flush > 0.01) {
      for (const s of [1, -1]) {
        const [cx, cy] = this.px(s * 0.4, -0.28);
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 90);
        gr.addColorStop(0, m.blush);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = p.flush * 0.45;
        g.fillStyle = gr;
        g.fillRect(cx - 90, cy - 90, 180, 180);
        g.globalAlpha = 1;
      }
    }

    // --- Brows ---
    const by = 0.205 * m.browHeight;
    for (const s of [1, -1]) {
      const innerY = by + 0.045 * p.browInnerUp - 0.03 * p.browDown - 0.022 * p.browKnit;
      const outerY = by + 0.03 * p.browOuterUp - 0.012 * p.browDown + 0.012 * p.browInnerUp - 0.022 + 0.005 * m.browArch;
      const innerX = (0.11 - 0.025 * p.browKnit) * s;
      const outerX = 0.52 * s;
      const archX = 0.36 * s;
      const archY = Math.max(innerY, outerY) + 0.035 * m.browArch + 0.012 * p.browOuterUp - 0.02 * p.browKnit * 0.5;
      const t = m.browThickness;
      const pts: Array<[number, number, number]> = [];
      for (let i = 0; i <= 16; i++) {
        const k = i / 16;
        const x = (1 - k) * (1 - k) * innerX + 2 * (1 - k) * k * archX + k * k * outerX;
        const y = (1 - k) * (1 - k) * innerY + 2 * (1 - k) * k * archY + k * k * outerY;
        // Thick at the head, tapering to a fine tail.
        const w = t * (0.03 * (1 - k) + 0.009 * k + 0.012 * Math.sin(k * Math.PI));
        pts.push([x, y, w]);
      }
      g.fillStyle = m.brow;
      g.beginPath();
      pts.forEach(([x, y, w], i) => {
        const [cx, cy] = this.px(x, y + w * 0.5);
        if (i === 0) g.moveTo(cx, cy);
        else g.lineTo(cx, cy);
      });
      for (let i = pts.length - 1; i >= 0; i--) {
        const [x, y, w] = pts[i];
        const [cx, cy] = this.px(x, y - w * 0.5);
        g.lineTo(cx, cy);
      }
      g.closePath();
      g.globalAlpha = 0.92;
      g.fill();
      g.globalAlpha = 1;
    }
    // A worry line between knitted brows.
    if (p.browKnit + p.browInnerUp * 0.5 > 0.35) {
      const a = Math.min(1, p.browKnit + p.browInnerUp * 0.5 - 0.35);
      g.strokeStyle = `rgba(90,45,45,${0.35 * a})`;
      g.lineWidth = 2;
      for (const s of [1, -1]) {
        const [x0, y0] = this.px(s * 0.04, by - 0.02);
        const [x1, y1] = this.px(s * 0.03, by + 0.06);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
    }

    // --- Mouth ---
    const mw = 0.205 * m.mouthWidth * (1 + 0.12 * p.smile + 0.18 * p.wide - 0.2 * p.pout);
    const lineY = -0.508;
    const cornerY = lineY + 0.04 * p.smile - 0.035 * p.frown - 0.012 * p.wide;
    const open = Math.min(1, p.open);
    const gap = 0.012 + 0.075 * open + 0.012 * p.wide;
    const upperTop = lineY + 0.048;
    const lowerBot = lineY - 0.06 - gap * 0.6;
    // Curve helpers across the mouth width (k: -1..1).
    const curve = (k: number, center: number, edge: number, bow = 0) => {
      const e = Math.pow(Math.abs(k), 1.8);
      return center + (edge - center) * e + bow * Math.exp(-Math.pow((Math.abs(k) - 0.3) / 0.18, 2));
    };
    const N = 24;
    const lipPath = (topFn: (k: number) => number, botFn: (k: number) => number) => {
      g.beginPath();
      for (let i = 0; i <= N; i++) {
        const k = -1 + (2 * i) / N;
        const [cx, cy] = this.px(k * mw, topFn(k));
        if (i === 0) g.moveTo(cx, cy);
        else g.lineTo(cx, cy);
      }
      for (let i = N; i >= 0; i--) {
        const k = -1 + (2 * i) / N;
        const [cx, cy] = this.px(k * mw, botFn(k));
        g.lineTo(cx, cy);
      }
      g.closePath();
    };
    const innerTop = (k: number) => curve(k, lineY + gap * 0.25, cornerY);
    const innerBot = (k: number) => curve(k, lineY - gap * 0.75, cornerY);
    // Interior.
    if (gap > 0.014) {
      lipPath(innerTop, innerBot);
      g.fillStyle = '#1a0608';
      g.fill();
      if (open > 0.25) {
        // A suggestion of upper teeth.
        g.save();
        g.clip();
        lipPath(innerTop, (k) => innerTop(k) - 0.014 * (1 - Math.abs(k)));
        g.fillStyle = 'rgba(230,220,210,0.75)';
        g.fill();
        g.restore();
      }
    }
    // Upper lip (with a cupid's bow), lower lip (fuller).
    const lipGrad = (y0: number, y1: number) => {
      const [, a] = this.px(0, y0);
      const [, b] = this.px(0, y1);
      const gr = g.createLinearGradient(0, a, 0, b);
      gr.addColorStop(0, m.lipDark);
      gr.addColorStop(0.5, m.lip);
      gr.addColorStop(1, m.lipDark);
      return gr;
    };
    lipPath((k) => curve(k, upperTop, cornerY + 0.004, 0.008), innerTop);
    g.fillStyle = lipGrad(upperTop, lineY);
    g.fill();
    lipPath(innerBot, (k) => curve(k, lowerBot, cornerY - 0.004));
    g.fillStyle = lipGrad(lineY, lowerBot);
    g.fill();
    // Highlight on the lower lip.
    const [hx, hy] = this.px(0, lowerBot + 0.022);
    const hg = g.createRadialGradient(hx, hy, 0, hx, hy, 22);
    hg.addColorStop(0, 'rgba(255,235,230,0.28)');
    hg.addColorStop(1, 'rgba(255,235,230,0)');
    g.fillStyle = hg;
    g.fillRect(hx - 30, hy - 30, 60, 60);
    // The lip line itself.
    g.strokeStyle = 'rgba(40,8,12,0.75)';
    g.lineWidth = 2.2;
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const k = -1 + (2 * i) / N;
      const [cx, cy] = this.px(k * mw, (innerTop(k) + innerBot(k)) / 2);
      if (i === 0) g.moveTo(cx, cy);
      else g.lineTo(cx, cy);
    }
    g.stroke();
    // Dimples at the corners when smiling.
    if (p.smile > 0.3) {
      g.strokeStyle = `rgba(110,55,55,${0.3 * (p.smile - 0.3)})`;
      g.lineWidth = 2;
      for (const s of [1, -1]) {
        const [x0, y0] = this.px(s * (mw + 0.015), cornerY + 0.03);
        const [x1, y1] = this.px(s * (mw + 0.025), cornerY - 0.02);
        g.beginPath();
        g.moveTo(x0, y0);
        g.quadraticCurveTo(x1 + s * 6, (y0 + y1) / 2, x1, y1);
        g.stroke();
      }
    }
    this.texture.needsUpdate = true;
  }
}

/** Iris, pupil and sclera on an equirect, with the iris at the top pole. */
export function eyeTexture(iris: string, irisDark: string): THREE.CanvasTexture {
  const W = 256;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const sclera = g.createLinearGradient(0, 0, 0, H);
  sclera.addColorStop(0, '#f2ece6');
  sclera.addColorStop(0.5, '#e6d8d2');
  sclera.addColorStop(1, '#b89a98');
  g.fillStyle = sclera;
  g.fillRect(0, 0, W, H);
  const irisRows = H * 0.19;
  const pupilRows = H * 0.075;
  const rand = mulberry32(3);
  for (let y = 0; y < irisRows; y++) {
    const t = y / irisRows;
    g.fillStyle = t > 0.88 ? irisDark : iris;
    g.globalAlpha = t > 0.88 ? 0.9 : 1;
    g.fillRect(0, y, W, 1);
  }
  g.globalAlpha = 1;
  // Radial streaks (vertical lines in equirect space).
  for (let i = 0; i < 160; i++) {
    const x = rand() * W;
    g.strokeStyle = rand() < 0.5 ? 'rgba(255,240,210,0.18)' : 'rgba(0,0,0,0.22)';
    g.lineWidth = 1 + rand();
    g.beginPath();
    g.moveTo(x, pupilRows);
    g.lineTo(x, irisRows * (0.8 + rand() * 0.2));
    g.stroke();
  }
  g.fillStyle = '#040203';
  g.fillRect(0, 0, W, pupilRows);
  // Painted catchlight: the stylized spark of life.
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.ellipse(W * 0.82, irisRows * 0.55, 10, 5, 0, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export type FabricKind = 'wool' | 'velvet' | 'leather' | 'knit' | 'cord' | 'tights' | 'silk' | 'cotton';

const fabricCache = new Map<string, { map: THREE.CanvasTexture; bump: THREE.CanvasTexture }>();

/** Tileable cloth/leather surfaces (greyscale detail, tinted by the material colour). */
export function fabric(kind: FabricKind): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const hit = fabricCache.get(kind);
  if (hit) return hit;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const b = document.createElement('canvas');
  b.width = b.height = S;
  const gb = b.getContext('2d')!;
  const rand = mulberry32(kind.length * 17 + kind.charCodeAt(0));
  g.fillStyle = '#d8d8d8';
  g.fillRect(0, 0, S, S);
  gb.fillStyle = '#808080';
  gb.fillRect(0, 0, S, S);
  const speck = (n: number, a: number, size: number) => {
    for (let i = 0; i < n; i++) {
      const v = rand() < 0.5 ? 0 : 255;
      g.fillStyle = `rgba(${v},${v},${v},${a * rand()})`;
      g.fillRect(rand() * S, rand() * S, size, size);
    }
  };
  switch (kind) {
    case 'wool':
    case 'cotton':
      for (let y = 0; y < S; y += 2) {
        for (let x = 0; x < S; x += 2) {
          const twill = ((x + y) >> 1) % 4 < 2 ? 1 : 0;
          gb.fillStyle = twill ? '#9a9a9a' : '#6a6a6a';
          gb.fillRect(x, y, 2, 2);
        }
      }
      speck(4000, kind === 'wool' ? 0.12 : 0.06, 1);
      break;
    case 'velvet':
      speck(6000, 0.08, 2);
      for (let i = 0; i < 40; i++) {
        const gr = g.createRadialGradient(rand() * S, rand() * S, 0, rand() * S, rand() * S, 60);
        gr.addColorStop(0, 'rgba(255,255,255,0.05)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, S, S);
      }
      break;
    case 'leather':
      for (let i = 0; i < 1600; i++) {
        const x = rand() * S;
        const y = rand() * S;
        gb.strokeStyle = `rgba(0,0,0,${0.2 + rand() * 0.3})`;
        gb.lineWidth = 1;
        gb.beginPath();
        gb.moveTo(x, y);
        gb.lineTo(x + (rand() - 0.5) * 8, y + (rand() - 0.5) * 8);
        gb.stroke();
      }
      speck(1500, 0.08, 2);
      break;
    case 'knit':
      for (let y = 0; y < S; y += 8) {
        for (let x = 0; x < S; x += 8) {
          gb.fillStyle = '#b0b0b0';
          gb.beginPath();
          gb.ellipse(x + 2, y + 4, 2.2, 4, -0.5, 0, Math.PI * 2);
          gb.ellipse(x + 6, y + 4, 2.2, 4, 0.5, 0, Math.PI * 2);
          gb.fill();
        }
      }
      speck(2000, 0.1, 1);
      break;
    case 'cord':
      for (let x = 0; x < S; x += 6) {
        const gr = gb.createLinearGradient(x, 0, x + 6, 0);
        gr.addColorStop(0, '#505050');
        gr.addColorStop(0.5, '#b8b8b8');
        gr.addColorStop(1, '#505050');
        gb.fillStyle = gr;
        gb.fillRect(x, 0, 6, S);
      }
      speck(2000, 0.08, 1);
      break;
    case 'tights':
    case 'silk':
      speck(3000, 0.04, 1);
      break;
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(b);
  for (const t of [map, bump]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  const out = { map, bump };
  fabricCache.set(kind, out);
  return out;
}

/** Strand texture: lines run along v, so lofted hair (u around, v along) streams. */
export function hairTexture(seed: number): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9a9a9a';
  g.fillRect(0, 0, W, H);
  const rand = mulberry32(seed);
  for (let i = 0; i < 900; i++) {
    const x = rand() * W;
    const l = rand() < 0.5 ? 255 : 0;
    g.strokeStyle = `rgba(${l},${l},${l},${0.03 + rand() * 0.1})`;
    g.lineWidth = 0.6 + rand() * 1.6;
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + (rand() - 0.5) * 10, H * 0.3, x + (rand() - 0.5) * 14, H * 0.7, x + (rand() - 0.5) * 8, H);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}
