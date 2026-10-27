import * as THREE from 'three';
import { mulberry32 } from '../core/math';

/**
 * Procedurally painted textures. These keep Stage 1 asset-free while avoiding
 * the flat "untextured prototype" look. Each can later be swapped for authored
 * texture files without touching the systems that use them.
 */

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, srgb = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Wraps drawing so shapes near an edge also appear on the opposite edge (seamless tiling). */
function drawWrapped(size: number, x: number, y: number, r: number, fn: (x: number, y: number) => void) {
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      const px = x + dx;
      const py = y + dy;
      if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue;
      fn(px, py);
    }
  }
}

export interface CobbleSet {
  map: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
  rough: THREE.CanvasTexture;
}

export function cobblestone(seed = 7): CobbleSet {
  const S = 512;
  const rand = mulberry32(seed);
  const [c, g] = canvas(S);
  const [bc, bg] = canvas(S);
  const [rc, rg] = canvas(S);

  g.fillStyle = '#17141c';
  g.fillRect(0, 0, S, S);
  bg.fillStyle = '#000';
  bg.fillRect(0, 0, S, S);
  rg.fillStyle = '#fff';
  rg.fillRect(0, 0, S, S);

  // Irregular rows of worn stones.
  const rows = 9;
  const rowH = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = rand() * 30;
    const y0 = r * rowH + rowH / 2;
    while (x < S + 30) {
      const w = rowH * (0.8 + rand() * 0.7);
      const h = rowH * (0.78 + rand() * 0.18);
      const cx = x + w / 2;
      const cy = y0 + (rand() - 0.5) * 6;
      const tone = 52 + rand() * 38;
      const hueShift = rand() * 10;
      const rot = (rand() - 0.5) * 0.25;
      const pts: Array<[number, number]> = [];
      // Squarish setts: a superellipse with a little irregularity per vertex.
      const n = 16;
      const ex = 0.32 + rand() * 0.2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.2;
        const k = 0.9 + rand() * 0.1;
        const c = Math.cos(a);
        const s = Math.sin(a);
        pts.push([Math.sign(c) * Math.pow(Math.abs(c), ex) * (w / 2) * k, Math.sign(s) * Math.pow(Math.abs(s), ex) * (h / 2) * k]);
      }
      drawWrapped(S, cx, cy, w, (px, py) => {
        const path = () => {
          const ctxs: CanvasRenderingContext2D[] = [g, bg, rg];
          for (const ctx of ctxs) {
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(rot);
            ctx.beginPath();
            pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
            ctx.closePath();
          }
          return ctxs;
        };
        const [cg, cb, cr] = path();
        const grad = cg.createRadialGradient(-w * 0.15, -h * 0.2, 2, 0, 0, w * 0.6);
        grad.addColorStop(0, `rgb(${tone + 22},${tone + 16 + hueShift},${tone + 34})`);
        grad.addColorStop(1, `rgb(${tone - 18},${tone - 22},${tone - 6})`);
        cg.fillStyle = grad;
        cg.fill();
        cg.restore();
        const bgrad = cb.createRadialGradient(0, 0, 2, 0, 0, w * 0.55);
        bgrad.addColorStop(0, '#fff');
        bgrad.addColorStop(0.75, '#bbb');
        bgrad.addColorStop(1, '#333');
        cb.fillStyle = bgrad;
        cb.fill();
        cb.restore();
        const rv = Math.floor(120 + rand() * 80);
        cr.fillStyle = `rgb(${rv},${rv},${rv})`; // wet stones are glossier
        cr.fill();
        cr.restore();
      });
      x += w + 3 + rand() * 4;
    }
  }

  // Grime, moss in the cracks, puddle sheen.
  for (let i = 0; i < 2600; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = rand() * 2.2;
    g.fillStyle = rand() < 0.5 ? 'rgba(20,30,18,0.35)' : 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 6; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 20 + rand() * 50;
    drawWrapped(S, x, y, r, (px, py) => {
      const pg = rg.createRadialGradient(px, py, 0, px, py, r);
      pg.addColorStop(0, 'rgba(10,10,10,0.9)');
      pg.addColorStop(1, 'rgba(10,10,10,0)');
      rg.fillStyle = pg;
      rg.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }

  return { map: toTexture(c), bump: toTexture(bc, false), rough: toTexture(rc, false) };
}

export function groundGrass(seed = 3): THREE.CanvasTexture {
  const S = 512;
  const rand = mulberry32(seed);
  const [c, g] = canvas(S);
  g.fillStyle = '#0d1410';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 30 + rand() * 90;
    drawWrapped(S, x, y, r, (px, py) => {
      const gr = g.createRadialGradient(px, py, 0, px, py, r);
      const dark = rand() < 0.5;
      gr.addColorStop(0, dark ? 'rgba(5,8,10,0.6)' : 'rgba(28,40,30,0.45)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  for (let i = 0; i < 9000; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const l = 3 + rand() * 7;
    const a = -Math.PI / 2 + (rand() - 0.5) * 0.9;
    const v = 20 + rand() * 40;
    g.strokeStyle = `rgba(${v * 0.7},${v + 12},${v * 0.8},0.5)`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // Dead leaves.
  for (let i = 0; i < 220; i++) {
    const x = rand() * S;
    const y = rand() * S;
    g.fillStyle = rand() < 0.6 ? 'rgba(70,38,26,0.8)' : 'rgba(90,64,30,0.7)';
    g.beginPath();
    g.ellipse(x, y, 2 + rand() * 3, 1 + rand() * 1.5, rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  return toTexture(c);
}

export function bark(seed = 11): THREE.CanvasTexture {
  const W = 256;
  const H = 512;
  const rand = mulberry32(seed);
  const [c, g] = canvas(W, H);
  g.fillStyle = '#1c1619';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    let x = rand() * W;
    let y = 0;
    const v = 10 + rand() * 30;
    g.strokeStyle = `rgba(${v + 16},${v + 8},${v + 14},${0.4 + rand() * 0.5})`;
    g.lineWidth = 1 + rand() * 3;
    g.beginPath();
    g.moveTo(x, y);
    while (y < H) {
      y += 8 + rand() * 18;
      x += (rand() - 0.5) * 7;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath();
    g.ellipse(rand() * W, rand() * H, 2 + rand() * 6, 6 + rand() * 18, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = toTexture(c);
  return t;
}

export function moonTexture(): THREE.CanvasTexture {
  const S = 512;
  const rand = mulberry32(42);
  const [c, g] = canvas(S);
  const grad = g.createRadialGradient(S * 0.45, S * 0.42, S * 0.05, S / 2, S / 2, S / 2);
  grad.addColorStop(0, '#fbf6e8');
  grad.addColorStop(0.7, '#e3dcc8');
  grad.addColorStop(0.96, '#b9b2a6');
  grad.addColorStop(1, 'rgba(180,170,160,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2);
  g.clip();
  // Maria — large dark basins.
  for (let i = 0; i < 9; i++) {
    const x = S * (0.25 + rand() * 0.5);
    const y = S * (0.25 + rand() * 0.5);
    const r = S * (0.06 + rand() * 0.12);
    const m = g.createRadialGradient(x, y, 0, x, y, r);
    m.addColorStop(0, 'rgba(120,112,118,0.45)');
    m.addColorStop(1, 'rgba(120,112,118,0)');
    g.fillStyle = m;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 70; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 2 + rand() * 12;
    g.strokeStyle = 'rgba(90,85,90,0.35)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.arc(x - r * 0.2, y - r * 0.2, r * 0.7, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  return toTexture(c, true, false);
}

/** Soft radial gradient used for glows, halos and light pools. */
export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.CanvasTexture {
  const S = 128;
  const [c, g] = canvas(S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.45)'));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return toTexture(c, true, false);
}

export function leafTexture(): THREE.CanvasTexture {
  const S = 64;
  const [c, g] = canvas(S);
  g.translate(S / 2, S / 2);
  g.rotate(0.6);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(0, -26);
  g.quadraticCurveTo(18, -6, 0, 26);
  g.quadraticCurveTo(-18, -6, 0, -26);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, -22);
  g.lineTo(0, 24);
  g.stroke();
  return toTexture(c, true, false);
}

/** Crack decal used to telegraph where roots will burst out. */
export function crackTexture(seed = 5): THREE.CanvasTexture {
  const S = 256;
  const rand = mulberry32(seed);
  const [c, g] = canvas(S);
  g.clearRect(0, 0, S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(160,30,40,0.55)');
  grad.addColorStop(1, 'rgba(160,30,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,90,70,1)';
  g.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    let x = S / 2;
    let y = S / 2;
    let a = rand() * Math.PI * 2;
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      a += (rand() - 0.5) * 1.1;
      x += Math.cos(a) * 14;
      y += Math.sin(a) * 14;
      g.lineWidth = Math.max(0.6, 3.5 - s * 0.4);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return toTexture(c, true, false);
}
