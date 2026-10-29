import * as THREE from 'three';
import { clamp, mulberry32 } from '../core/math';

/** Pixels of mask per metre of glass. */
const PX = 256;

interface Stroke {
  /** Polyline in mask pixels. */
  pts: Float32Array;
  /** Cumulative length at each point. */
  acc: Float32Array;
  total: number;
  /** Seconds after it was queued that the finger starts. */
  delay: number;
  /** Pixels per second. */
  speed: number;
  width: number;
  drawn: number;
  age: number;
}

interface Drip {
  x: number;
  y: number;
  len: number;
  max: number;
  speed: number;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMask;
uniform float uCover;
uniform float uTime;
uniform float uFrost;
uniform float uAspect;
uniform vec3 uTint;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec2 uv = vUv;
  // Condensation creeps in from the frame: distance to the nearest edge, broken up by noise.
  float edge = min(min(uv.x, 1.0 - uv.x) * uAspect, min(uv.y, 1.0 - uv.y));
  float n = fbm(uv * vec2(4.0 * uAspect, 4.0) + 3.1);
  float grow = uCover * 0.95 - edge * 1.6 + (n - 0.5) * 0.45;
  float fog = smoothstep(0.0, 0.16, grow);
  // Its body: uneven, thicker low down where it gathers, very slowly breathing.
  float body = 0.6 + 0.4 * fbm(uv * vec2(11.0 * uAspect, 11.0) + vec2(0.0, uTime * 0.012));
  body *= 0.9 + 0.1 * sin(uTime * 0.8 + n * 6.0);
  body *= 1.0 + 0.25 * (1.0 - uv.y);
  float m = texture2D(uMask, uv).r;
  float cleared = smoothstep(0.1, 0.62, m);
  // Water gathers along the edge of every cleared line: a brighter rim of beads.
  float rim = smoothstep(0.04, 0.3, m) * (1.0 - smoothstep(0.32, 0.7, m));
  // Droplets, scattered on a jittered grid.
  vec2 g = uv * vec2(70.0 * uAspect, 70.0);
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash(id);
  vec2 o = vec2(hash(id + 1.3), hash(id + 7.1)) - 0.5;
  float r = length(f - o * 0.55);
  float big = step(0.86, h);
  float drop = big * smoothstep(0.06 + 0.2 * (h - 0.86) * 6.0, 0.02, r);
  float dropHi = big * smoothstep(0.05, 0.0, length(f - o * 0.55 - vec2(-0.05, 0.06)));
  // A finer mist of beads between them.
  vec2 g2 = uv * vec2(190.0 * uAspect, 190.0);
  float h2 = hash(floor(g2));
  float fine = step(0.8, h2) * smoothstep(0.32, 0.1, length(fract(g2) - 0.5 - (vec2(hash(floor(g2) + 3.1), hash(floor(g2) + 5.7)) - 0.5) * 0.5));
  drop = max(drop, fine * 0.5);
  float a = fog * body * (1.0 - cleared);
  a = max(a, rim * fog * 0.75);
  vec3 col = uTint * (0.75 + 0.35 * n);
  col += uTint * rim * 0.6;
  // A bead darkens what's behind it and catches one highlight.
  float beads = drop * fog * (1.0 - cleared * 0.7);
  col = mix(col, uTint * 0.35, beads * 0.6) + vec3(dropHi * fog * 0.9) * uTint * 2.0;
  float alpha = clamp(a * 0.6 + beads * 0.2, 0.0, 0.7);
  // The glass itself has gone cold.
  col = mix(col, vec3(0.5, 0.6, 0.74) * uTint * 2.0, 0.2 * uFrost);
  alpha = max(alpha, uFrost * 0.05);
  gl_FragColor = vec4(col, alpha);
}`;

/**
 * Condensation on the window glass, as if something on the other side
 * were breathing on it.
 *
 * The fog itself is a shader on the leaves of the window (so it swings
 * with them when the window opens), growing in from the frame by `cover`.
 * What has been cleared — the invisible finger's lines, her sleeve's
 * wipes, the drips that run from both — is painted into a mask canvas
 * the shader reads. Strokes are drawn progressively along their length,
 * at a finger's pace, so the drawing appears as it is made; `refog()`
 * lets the condensation close back over everything.
 *
 * Coordinates are window-local metres: x from the left jamb, y up from the sill.
 */
export class WindowFog {
  readonly material: THREE.ShaderMaterial;
  readonly texture: THREE.CanvasTexture;
  /** 0..1 — how far the condensation has crept in from the frame. */
  cover = 0;
  /** 0..1 — the glass gone cold (a faint blue cast even before it fogs). */
  frost = 0;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private strokes: Stroke[] = [];
  private drips: Drip[] = [];
  private returning = 0;
  private dirty = true;
  private time = 0;
  private rand = mulberry32(404);

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.canvas.width = Math.round(width * PX);
    this.canvas.height = Math.round(height * PX);
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMask: { value: this.texture },
        uCover: { value: 0 },
        uTime: { value: 0 },
        uFrost: { value: 0 },
        uAspect: { value: width / height },
        uTint: { value: new THREE.Color(0.3, 0.29, 0.3) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.reset();
  }

  /** The plane for one leaf of the window: x0..x1 (window-local), with the shared mask's UVs. */
  leafGeometry(x0: number, x1: number): THREE.BufferGeometry {
    const geo = new THREE.PlaneGeometry(x1 - x0, this.height);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (x0 + uv.getX(i) * (x1 - x0)) / this.width);
    return geo;
  }

  /** Light falling on the glass from the room (candles warm it a little). */
  setTint(c: THREE.Color): void {
    (this.material.uniforms.uTint.value as THREE.Color).copy(c);
  }

  reset(): void {
    this.g.fillStyle = '#000';
    this.g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.strokes = [];
    this.drips = [];
    this.cover = 0;
    this.frost = 0;
    this.returning = 0;
    this.time = 0;
    this.dirty = true;
  }

  private toPx(x: number, y: number): [number, number] {
    return [x * PX, (this.height - y) * PX];
  }

  /**
   * Queue a finger line (window-local metres). It starts after `delay`
   * seconds and is drawn at `speed` metres per second.
   */
  stroke(points: Array<[number, number]>, delay: number, speed = 0.55, width = 0.018): void {
    if (points.length < 2) return;
    const pts = new Float32Array(points.length * 2);
    const acc = new Float32Array(points.length);
    let total = 0;
    points.forEach(([x, y], i) => {
      const [px, py] = this.toPx(x, y);
      pts[i * 2] = px;
      pts[i * 2 + 1] = py;
      if (i > 0) total += Math.hypot(px - pts[i * 2 - 2], py - pts[i * 2 - 1]);
      acc[i] = total;
    });
    this.strokes.push({ pts, acc, total, delay, speed: speed * PX, width: width * PX, drawn: 0, age: 0 });
  }

  /** Seconds until every queued stroke has been drawn. */
  get drawingLeft(): number {
    let t = 0;
    for (const s of this.strokes) t = Math.max(t, s.delay - s.age + (s.total - s.drawn) / s.speed);
    return Math.max(0, t);
  }

  /** Cancel strokes not yet drawn (what is already on the glass stays). */
  stopDrawing(): void {
    this.strokes = [];
  }

  /** Her sleeve against the glass: a soft, streaked clearing around (x, y). */
  wipe(x: number, y: number, radius: number, strength = 0.5): void {
    const [cx, cy] = this.toPx(x, y);
    const r = radius * PX;
    const g = this.g;
    const gr = g.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
    gr.addColorStop(0, `rgba(255,255,255,${strength})`);
    gr.addColorStop(0.7, `rgba(255,255,255,${strength * 0.55})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = gr;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
    // Fabric leaves streaks: a few fine darker lines through the clean patch.
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = `rgba(0,0,0,${0.12 * strength})`;
    g.lineWidth = 1.5;
    for (let k = 0; k < 3; k++) {
      const oy = (this.rand() - 0.5) * r;
      g.beginPath();
      g.moveTo(cx - r * 0.7, cy + oy);
      g.quadraticCurveTo(cx, cy + oy - r * 0.2, cx + r * 0.7, cy + oy);
      g.stroke();
    }
    if (this.rand() < 0.35) this.drips.push({ x: cx + (this.rand() - 0.5) * r, y: cy + r * 0.6, len: 0, max: 30 + this.rand() * 90, speed: 25 + this.rand() * 25 });
    this.dirty = true;
  }

  /** The condensation closes back over the glass, swallowing lines and wipes, over `seconds`. */
  refog(seconds: number): void {
    this.returning = seconds;
    this.strokes = [];
  }

  /** How much of the glass is clear (0..1), sampled coarsely. */
  clearness(): number {
    const g = this.g;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const data = g.getImageData(0, 0, w, h).data;
    let sum = 0;
    let n = 0;
    // Only the middle of the glass counts (the edges always keep a little fog).
    for (let y = Math.floor(h * 0.15); y < h * 0.85; y += 8)
      for (let x = Math.floor(w * 0.12); x < w * 0.88; x += 8) {
        sum += data[(y * w + x) * 4] / 255;
        n++;
      }
    return n ? sum / n : 0;
  }

  update(dt: number): void {
    this.time += dt;
    const g = this.g;
    // Returning: fade the cleared marks back toward fog.
    if (this.returning > 0) {
      const k = clamp(dt / this.returning, 0, 1) * 2.2;
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = `rgba(0,0,0,${Math.min(0.5, k)})`;
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.returning = Math.max(0, this.returning - dt);
      this.dirty = true;
    }
    // Strokes: the finger moves on.
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const s of this.strokes) {
      s.age += dt;
      if (s.age < s.delay || s.drawn >= s.total) continue;
      const from = s.drawn;
      const to = Math.min(s.total, s.drawn + s.speed * dt);
      s.drawn = to;
      this.drawSpan(s, from, to);
      this.dirty = true;
      // Now and then a bead breaks loose from the line and runs.
      if (this.rand() < dt * 1.3) {
        const [x, y] = this.pointAt(s, to);
        this.drips.push({ x, y, len: 0, max: 20 + this.rand() * 70, speed: 18 + this.rand() * 30 });
      }
    }
    this.strokes = this.strokes.filter((s) => s.drawn < s.total);
    // Drips run down, slowing, leaving a thin clear trail.
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = 1.2;
    for (const d of this.drips) {
      if (d.len >= d.max) continue;
      const step = d.speed * dt * (1 - d.len / d.max * 0.7);
      g.beginPath();
      g.moveTo(d.x, d.y + d.len);
      d.len = Math.min(d.max, d.len + step);
      d.x += (this.rand() - 0.5) * 0.6;
      g.lineTo(d.x, d.y + d.len);
      g.stroke();
      this.dirty = true;
    }
    this.drips = this.drips.filter((d) => d.len < d.max);
    g.globalCompositeOperation = 'source-over';
    if (this.dirty) {
      this.texture.needsUpdate = true;
      this.dirty = false;
    }
    const u = this.material.uniforms;
    u.uCover.value = this.cover;
    u.uFrost.value = this.frost;
    u.uTime.value = this.time;
  }

  private pointAt(s: Stroke, d: number): [number, number] {
    let i = 1;
    while (i < s.acc.length - 1 && s.acc[i] < d) i++;
    const a = s.acc[i - 1];
    const b = s.acc[i];
    const f = b > a ? (d - a) / (b - a) : 0;
    return [s.pts[(i - 1) * 2] + (s.pts[i * 2] - s.pts[(i - 1) * 2]) * f, s.pts[(i - 1) * 2 + 1] + (s.pts[i * 2 + 1] - s.pts[(i - 1) * 2 + 1]) * f];
  }

  private drawSpan(s: Stroke, from: number, to: number): void {
    const g = this.g;
    const [x0, y0] = this.pointAt(s, from);
    // The finger presses harder in the middle of a line than at its ends.
    const f = to / s.total;
    const press = 0.75 + 0.25 * Math.sin(Math.min(1, f) * Math.PI);
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = s.width * press;
    g.beginPath();
    g.moveTo(x0, y0);
    let i = 1;
    while (i < s.acc.length && s.acc[i] <= from) i++;
    for (; i < s.acc.length && s.acc[i] < to; i++) g.lineTo(s.pts[i * 2], s.pts[i * 2 + 1]);
    const [x1, y1] = this.pointAt(s, to);
    g.lineTo(x1, y1);
    g.stroke();
    // A soft halo: water pushed aside by the finger.
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = s.width * 2.4;
    g.stroke();
  }
}
