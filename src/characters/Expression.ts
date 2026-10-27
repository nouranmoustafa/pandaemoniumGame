import { type FaceParams, NEUTRAL_FACE } from './textures';

/**
 * Facial state: painted features (FaceParams) plus the eyelids. Presets
 * are deliberately small movements — the brows, lids and mouth corners
 * carry the emotion; nothing is mugged.
 */
export interface FaceState extends FaceParams {
  /** Upper lid raised (+) or lowered (-). */
  lidUp: number;
  /** Lower lid raised: the smile in the eyes. */
  squint: number;
}

export const NEUTRAL: FaceState = { ...NEUTRAL_FACE, lidUp: 0, squint: 0 };

export const EXPRESSIONS = ['neutral', 'smile', 'concern', 'fear', 'surprise', 'distress', 'laugh', 'determined'] as const;
export type ExpressionName = (typeof EXPRESSIONS)[number];

export const PRESETS: Record<ExpressionName, Partial<FaceState>> = {
  neutral: {},
  smile: { smile: 0.7, squint: 0.35, browOuterUp: 0.1, flush: 0.15 },
  laugh: { smile: 1, open: 0.45, squint: 0.6, browInnerUp: 0.2, flush: 0.45 },
  concern: { browInnerUp: 0.55, browKnit: 0.35, frown: 0.25, lidUp: 0.05 },
  fear: { browInnerUp: 0.9, browKnit: 0.45, browOuterUp: 0.2, lidUp: 0.55, wide: 0.6, open: 0.25 },
  surprise: { browInnerUp: 0.7, browOuterUp: 0.8, lidUp: 0.5, open: 0.4, pout: 0.25 },
  distress: { browInnerUp: 0.8, browKnit: 0.7, frown: 0.6, squint: 0.25, lidUp: -0.15, open: 0.12 },
  determined: { browDown: 0.45, browKnit: 0.3, lidUp: -0.1, squint: 0.15, frown: 0.1 },
};

export type ExpressionMix = Partial<Record<ExpressionName, number>>;

/** Weighted blend of presets (weights need not sum to 1; neutral fills the rest). */
export function mixExpression(mix: ExpressionMix, out: FaceState = { ...NEUTRAL }): FaceState {
  Object.assign(out, NEUTRAL);
  for (const [name, w] of Object.entries(mix) as Array<[ExpressionName, number]>) {
    if (!w) continue;
    const p = PRESETS[name];
    for (const k in p) (out as unknown as Record<string, number>)[k] += (p[k as keyof FaceState] as number) * w;
  }
  return out;
}

export function dampFace(cur: FaceState, target: FaceState, rate: number, dt: number): void {
  const k = 1 - Math.exp(-rate * dt);
  for (const key in target) {
    const kk = key as keyof FaceState;
    cur[kk] += (target[kk] - cur[kk]) * k;
  }
}
