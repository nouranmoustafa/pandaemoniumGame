export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => clamp((v - a) / (b - a), 0, 1);

export const smoothstep = (a: number, b: number, v: number): number => {
  const t = invLerp(a, b, v);
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential approach. */
export const damp = (current: number, target: number, rate: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeInCubic = (t: number): number => t * t * t;
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;

/** Deterministic PRNG so the park looks the same every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap smooth 1D value noise. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const s = Math.sin((n + seed * 57.13) * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u) * 2 - 1;
}

/** Critically-damped-ish spring for scalars. Returns new [value, velocity]. */
export function spring(
  value: number,
  velocity: number,
  target: number,
  stiffness: number,
  damping: number,
  dt: number,
): [number, number] {
  const a = (target - value) * stiffness - velocity * damping;
  const v = velocity + a * dt;
  return [value + v * dt, v];
}
