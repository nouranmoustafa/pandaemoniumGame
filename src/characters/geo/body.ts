import * as THREE from 'three';
import type { Garment, Outfit } from '../design';
import { type BoneName, type BoneSegment, type CharacterRig, FINGERS, type Side } from '../rig/CharacterRig';
import { type Influences, skinByDistance, skinRigid } from '../rig/skinning';
import { ellipsoid, loft, type Ring } from './loft';

interface SkirtOptions {
  /** Extra back length running along the floor (fraction of height). */
  train?: number;
  /** Lining slot name; null for none. */
  liningSlot?: string | null;
  fold?: number;
  folds?: number;
}

interface BuiltSkirt {
  rings: Ring[];
  geo: THREE.BufferGeometry;
}

/** A skinned piece of geometry and the material slot it belongs to. */
export interface Part {
  geo: THREE.BufferGeometry;
  slot: string;
}

const sstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Builds the body and clothing as skinned geometry in bind pose. Material
 * slots: 'skin', 'top', 'collar', 'under', 'skirt', 'legs', 'shoes',
 * 'belt', 'buttons', 'scarf'.
 */
export class BodyBuilder {
  readonly parts: Part[] = [];
  private H: number;

  constructor(
    private rig: CharacterRig,
    private outfit: Outfit,
  ) {
    this.H = rig.p.height;
  }

  private segs(names: Array<BoneName | [BoneName, BoneName]>): BoneSegment[] {
    return names.map((n) => (Array.isArray(n) ? this.rig.segment(n[0], n[1]) : this.rig.segment(n)));
  }

  private add(geo: THREE.BufferGeometry, slot: string): void {
    this.parts.push({ geo, slot });
  }

  /** Model-space torso profile, as a function of t from crotch (0) to neck base (1). */
  torsoRings(inflate = 0, from = -0.04, to = 1): Ring[] {
    const { hipJointY, neckBaseY } = this.rig.m;
    const p = this.rig.p;
    const H = this.H;
    const len = neckBaseY - hipJointY;
    // t, rx, zf, zb (fractions of height), with the body factor that scales each.
    const table: Array<[number, number, number, number, 'hip' | 'waist' | 'bust' | 'shoulder' | 'neck']> = [
      [-0.04, 0.086, 0.054, 0.06, 'hip'],
      [0.06, 0.103, 0.062, 0.077, 'hip'],
      [0.16, 0.097, 0.058, 0.067, 'hip'],
      [0.36, 0.077, 0.051, 0.052, 'waist'],
      [0.52, 0.082, 0.058, 0.055, 'bust'],
      [0.63, 0.086, 0.067, 0.055, 'bust'],
      [0.75, 0.088, 0.06, 0.056, 'shoulder'],
      [0.88, 0.083, 0.05, 0.054, 'shoulder'],
      [0.95, 0.068, 0.043, 0.047, 'shoulder'],
      [1.0, 0.056, 0.036, 0.038, 'neck'],
    ];
    const factor = { hip: p.hip, waist: p.waist, bust: 1, shoulder: p.shoulder / 0.105, neck: 1 };
    return table
      .filter(([t]) => t >= from - 1e-6 && t <= to + 1e-6)
      .map(([t, rx, zf, zb, k]) => {
        const f = factor[k];
        const bz = k === 'bust' ? p.bust : 1;
        const infl = inflate * (k === 'neck' ? 0.4 : 1);
        return {
          y: hipJointY + t * len,
          rx: rx * H * f + infl,
          zf: zf * H * bz + infl,
          zb: zb * H + infl,
          cz: -0.006 * H,
          sq: k === 'shoulder' ? 2.25 : 2.1,
        };
      });
  }

  build(): Part[] {
    this.neck();
    this.hands();
    this.top();
    this.legs();
    this.shoes();
    if (this.outfit.skirt) this.skirt(this.outfit.skirt, this.outfit.skirt.length, this.outfit.skirt.flare, 0, 'skirt', 0.55);
    if (this.outfit.scarf) this.scarf(this.outfit.scarf);
    return this.parts;
  }

  /**
   * The wedding gown, on the same skeleton as her everyday clothes: a fitted
   * bodice, a high lace collar, long sleeves ending in lace bells, and a
   * floor-length skirt with a short train. Slots: 'gown' (silk), 'gownLace'
   * (an overlay whose pattern and asymmetric sweep come from its material),
   * 'gownTrim' (the sash), 'gownPearl', 'gownLining'.
   */
  buildGown(): Part[] {
    const r = this.rig;
    const H = this.H;
    const infl = 0.0125 * H;
    // Bodice: from under the skirt's waistband to the base of the neck.
    const bodice = loft(this.torsoRings(infl, 0.16, 0.97), { segments: 40, subdiv: 3 });
    skinByDistance(bodice, this.segs(['hips', 'spine', 'chest', 'neck', ['shoulderL', 'elbowL'], ['shoulderR', 'elbowR']]), 4);
    this.add(bodice, 'gown');
    // Lace over the bodice, a hair proud of the silk.
    const bl = loft(this.torsoRings(infl + 0.0028 * H, 0.36, 0.97), { segments: 40, subdiv: 3 });
    skinByDistance(bl, this.segs(['hips', 'spine', 'chest', 'neck', ['shoulderL', 'elbowL'], ['shoulderR', 'elbowR']]), 4);
    this.add(bl, 'gownLace');
    // High collar of lace, up the throat.
    const nb = r.bindPos.get('neck')!;
    const hd = r.bindPos.get('head')!;
    const w = 0.037 * H;
    const cr: Ring[] = [
      { y: nb.y - 0.034 * H, rx: 0.07 * H + infl, zf: 0.046 * H + infl, zb: 0.05 * H + infl, cz: -0.006 * H },
      { y: nb.y - 0.008 * H, rx: w * 1.3 + 0.007 * H, zf: w * 1.2 + 0.007 * H, zb: w * 1.25 + 0.007 * H, cz: nb.z },
      { y: (nb.y + hd.y) / 2, rx: w + 0.006 * H, zf: w * 1.08 + 0.006 * H, zb: w + 0.006 * H, cz: (nb.z + hd.z) / 2 },
      { y: (nb.y + hd.y) / 2 + 0.016 * H, rx: w * 1.06 + 0.008 * H, zf: w * 1.12 + 0.008 * H, zb: w * 1.04 + 0.008 * H, cz: (nb.z + hd.z) / 2 },
    ];
    const collar = loft(cr, { segments: 28, subdiv: 2 });
    skinByDistance(collar, this.segs(['chest', 'neck', 'head']), 5);
    this.add(collar, 'gownLace');
    for (const s of ['L', 'R'] as const) this.gownSleeve(s, infl);
    // Floor-length skirt with a train; then the lace overskirt and the sash at the seam.
    const legLen = r.m.hipJointY - r.m.ankleY;
    const length = (r.m.hipJointY - 0.006 * H) / legLen;
    this.skirt(this.outfit.top, length, 3.1, 0, 'gown', 0.2, infl, { train: 0.2, liningSlot: 'gownLining', fold: 1.25, folds: 13 });
    this.skirt(this.outfit.top, length * 0.985, 3.1, 0, 'gownLace', 0.2, infl + 0.004 * H, { train: 0.2, liningSlot: null, fold: 1.25, folds: 13 });
    const wy = r.m.hipJointY + 0.36 * (r.m.neckBaseY - r.m.hipJointY);
    const br = this.torsoRings(infl + 0.005 * H).reduce((a, b) => (Math.abs(b.y - wy) < Math.abs(a.y - wy) ? b : a));
    const sash = loft(
      [
        { ...br, y: wy + 0.016 * H, rx: br.rx + 0.002 * H, zf: br.zf + 0.002 * H, zb: br.zb + 0.002 * H },
        { ...br, y: wy, rx: br.rx + 0.0045 * H, zf: br.zf + 0.0045 * H, zb: br.zb + 0.0045 * H },
        { ...br, y: wy - 0.016 * H, rx: br.rx + 0.004 * H, zf: br.zf + 0.004 * H, zb: br.zb + 0.004 * H },
      ],
      { segments: 40, subdiv: 2 },
    );
    skinByDistance(sash, this.segs(['hips', 'spine']), 4);
    this.add(sash, 'gownTrim');
    // A satin rose on the left hip: off-centre, like the lace.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const petal = ellipsoid(0.012 * H, 0.009 * H, 0.004 * H, 8, 6);
      petal.rotateZ(a);
      petal.rotateY(0.5);
      petal.translate(br.rx * 0.78 + Math.cos(a) * 0.008 * H, wy + Math.sin(a) * 0.008 * H, br.zf * 0.62 + 0.006 * H);
      skinRigid(petal, r.index('hips'));
      this.add(petal, 'gownTrim');
    }
    // Pearl buttons down the front of the bodice.
    const chestRings = this.torsoRings(infl);
    for (let i = 0; i < 8; i++) {
      const t = 0.42 + i * 0.07;
      const y = r.m.hipJointY + t * (r.m.neckBaseY - r.m.hipJointY);
      const ring = chestRings.reduce((a, b) => (Math.abs(b.y - y) < Math.abs(a.y - y) ? b : a));
      const b = ellipsoid(0.0042 * H, 0.0042 * H, 0.0032 * H, 8, 6);
      b.translate(0, y, ring.zf + (ring.cz ?? 0) + 0.0045 * H);
      skinRigid(b, r.index(y > r.m.chestY ? 'chest' : 'spine'));
      this.add(b, 'gownPearl');
    }
    return this.parts;
  }

  /** Long fitted silk sleeve, a little fullness at the shoulder, a lace bell over the hand. */
  private gownSleeve(s: Side, infl: number): void {
    const r = this.rig;
    const H = this.H;
    const sh = r.bindPos.get(`shoulder${s}`)!;
    const el = r.bindPos.get(`elbow${s}`)!;
    const wr = r.bindPos.get(`wrist${s}`)!;
    const sx = s === 'L' ? 1 : -1;
    const R = (v: number, puff = 1) => v * H * puff + infl;
    const rings: Ring[] = [
      { y: sh.y + 0.016 * H, rx: R(0.015), zf: R(0.021), zb: R(0.023), cx: sh.x - sx * 0.02 * H, cz: sh.z },
      { y: sh.y + 0.006 * H, rx: R(0.026, 1.25), zf: R(0.028, 1.25), zb: R(0.029, 1.25), cx: sh.x - sx * 0.002 * H, cz: sh.z },
      { y: sh.y - 0.05 * H, rx: R(0.027, 1.15), zf: R(0.027, 1.15), zb: R(0.027, 1.15), cx: sh.x, cz: sh.z },
      { y: el.y + 0.01 * H, rx: R(0.021), zf: R(0.021), zb: R(0.023), cx: el.x, cz: el.z },
      { y: el.y - 0.05 * H, rx: R(0.019), zf: R(0.019), zb: R(0.019), cx: el.x, cz: el.z },
      { y: wr.y + 0.022 * H, rx: R(0.016), zf: R(0.017), zb: R(0.017), cx: wr.x, cz: wr.z },
      { y: wr.y + 0.004 * H, rx: R(0.0175), zf: R(0.0185), zb: R(0.0185), cx: wr.x, cz: wr.z },
    ];
    const g = loft(rings, { segments: 18, subdiv: 2 });
    skinByDistance(g, this.segs(['chest', `shoulder${s}`, `elbow${s}`, [`wrist${s}`, `middle1${s}` as BoneName]]), 4.5);
    this.add(g, 'gown');
    // The lace bell: it opens over the back of the hand.
    const bell = loft(
      [
        { y: wr.y + 0.034 * H, rx: R(0.017), zf: R(0.018), zb: R(0.018), cx: wr.x, cz: wr.z },
        { y: wr.y, rx: R(0.022), zf: R(0.024), zb: R(0.024), cx: wr.x, cz: wr.z },
        { y: wr.y - 0.03 * H, rx: R(0.031), zf: R(0.034), zb: R(0.034), cx: wr.x - sx * 0.004 * H, cz: wr.z },
      ],
      { segments: 20, subdiv: 2 },
    );
    skinByDistance(bell, this.segs([`elbow${s}`, [`wrist${s}`, `middle1${s}` as BoneName]]), 6);
    this.add(bell, 'gownLace');
  }

  // ---------------------------------------------------------------- skin

  private neck(): void {
    const r = this.rig;
    const H = this.H;
    const nb = r.bindPos.get('neck')!;
    const hd = r.bindPos.get('head')!;
    const w = 0.037 * H;
    const rings: Ring[] = [
      { y: nb.y - 0.04 * H, rx: w * 1.45, zf: w * 1.15, zb: w * 1.1, cz: nb.z },
      { y: nb.y, rx: w * 1.25, zf: w * 1.15, zb: w * 1.2, cz: nb.z },
      { y: (nb.y + hd.y) / 2, rx: w, zf: w * 1.08, zb: w, cz: (nb.z + hd.z) / 2 },
      { y: hd.y + 0.035 * H, rx: w * 1.06, zf: w * 1.1, zb: w * 1.05, cz: hd.z + 0.004 * H },
    ];
    const g = loft(rings, { segments: 20, subdiv: 2 });
    skinByDistance(g, this.segs(['chest', 'neck', 'head']), 5);
    this.add(g, 'skin');
  }

  private hands(): void {
    for (const s of ['L', 'R'] as const) this.hand(s);
  }

  private hand(s: Side): void {
    const r = this.rig;
    const H = this.H;
    const wr = r.bindPos.get(`wrist${s}`)!;
    const palm = r.m.palm;
    const sx = s === 'L' ? 1 : -1;
    // Palm: thin in X (back of hand ↔ palm), wide in Z (thumb ↔ little finger).
    const rings: Ring[] = [
      { y: wr.y + 0.012 * H, rx: 0.011 * H, zf: 0.016 * H, zb: 0.015 * H, cx: wr.x, cz: wr.z },
      { y: wr.y - palm * 0.15, rx: 0.012 * H, zf: 0.021 * H, zb: 0.019 * H, cx: wr.x, cz: wr.z + 0.001 * H },
      { y: wr.y - palm * 0.65, rx: 0.0125 * H, zf: 0.024 * H, zb: 0.02 * H, cx: wr.x - sx * 0.001 * H, cz: wr.z + 0.002 * H },
      { y: wr.y - palm * 1.02, rx: 0.0105 * H, zf: 0.022 * H, zb: 0.017 * H, cx: wr.x - sx * 0.0015 * H, cz: wr.z + 0.002 * H },
    ];
    const pg = loft(rings, { segments: 18, subdiv: 2, capBottom: true });
    const fingerSegs = FINGERS.filter((f) => f !== 'thumb').map((f) => r.segment(`${f}1${s}` as BoneName));
    skinByDistance(pg, [r.segment(`wrist${s}`, `middle1${s}` as BoneName), r.segment(`elbow${s}`), ...fingerSegs], 6);
    this.add(pg, 'skin');
    for (const f of FINGERS) {
      const b1 = r.bindPos.get(`${f}1${s}` as BoneName)!;
      const b2 = r.bindPos.get(`${f}2${s}` as BoneName)!;
      const tip = r.segment(`${f}2${s}` as BoneName).b;
      const rad = (f === 'thumb' ? 0.0062 : f === 'pinky' ? 0.0046 : 0.0054) * H;
      // Fingers run from base (b1) downward through b2 to the tip.
      const pts = [b1, b2, tip];
      const fr: Ring[] = [];
      const steps = 8;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const seg = t < 0.5 ? 0 : 1;
        const lt = t < 0.5 ? t * 2 : (t - 0.5) * 2;
        const a = pts[seg];
        const b = pts[seg + 1];
        const taper = 1 - t * 0.28 - (t > 0.9 ? (t - 0.9) * 4 : 0);
        fr.push({ y: a.y + (b.y - a.y) * lt, rx: rad * taper * 0.92, zf: rad * taper, zb: rad * taper, cx: a.x + (b.x - a.x) * lt, cz: a.z + (b.z - a.z) * lt });
      }
      const fg = loft(fr, { segments: 10, capBottom: true });
      skinByDistance(fg, [r.segment(`${f}1${s}` as BoneName), r.segment(`${f}2${s}` as BoneName), r.segment(`wrist${s}`, `${f}1${s}` as BoneName)], 7);
      this.add(fg, 'skin');
      // Fingernail hint.
      if (f !== 'thumb') {
        const nail = ellipsoid(rad * 0.55, rad * 1.2, rad * 0.35, 8, 6);
        nail.translate(tip.x - sx * rad * 0.55, tip.y + rad * 1.3, tip.z);
        skinRigid(nail, r.index(`${f}2${s}` as BoneName));
        this.add(nail, 'nails');
      }
    }
  }

  // ---------------------------------------------------------------- clothes

  private top(): void {
    const o = this.outfit.top;
    const r = this.rig;
    const H = this.H;
    const loose = o.loose ?? 0;
    const infl = 0.009 * H + loose * 0.012 * H;
    // Bodice from the hips to the neck.
    const rings = this.torsoRings(infl, o.kind === 'jacket' ? 0.05 : -0.04, 0.96);
    if (loose) for (const ring of rings) if (ring.y < r.m.chestY) ring.rx += loose * 0.01 * H * (1 - (ring.y - r.m.hipJointY) / (r.m.chestY - r.m.hipJointY));
    const body = loft(rings, { segments: 36, subdiv: 3 });
    skinByDistance(body, this.segs(['hips', 'spine', 'chest', 'neck', ['shoulderL', 'elbowL'], ['shoulderR', 'elbowR'], ['thighL', 'kneeL'], ['thighR', 'kneeR']]), 4);
    this.add(body, 'top');
    // The garment underneath shows at the neckline.
    if (this.outfit.under) {
      const nr = this.torsoRings(infl * 0.6, 0.86, 1.0);
      nr[nr.length - 1].rx *= 1.15;
      const ng = loft(nr, { segments: 24, subdiv: 2 });
      skinByDistance(ng, this.segs(['chest', 'neck']), 4);
      this.add(ng, 'under');
    }
    // Sleeves.
    for (const s of ['L', 'R'] as const) this.sleeve(s, infl, o.kind === 'sweater' ? 'top' : 'top', loose);
    // Skirt of the coat.
    if (o.length > 0.05) this.skirt(o, o.length, o.kind === 'coat' ? 0.6 : 0.3, o.open, 'top', o.open > 0 ? 0.25 : 0.5, infl);
    // Collar.
    if (o.collar !== 'none') this.collar(o.collar, infl);
    if (o.belt !== undefined) {
      const wy = r.m.hipJointY + 0.36 * (r.m.neckBaseY - r.m.hipJointY);
      const br = this.torsoRings(infl + 0.004 * H).find((x) => Math.abs(x.y - wy) < 0.01)!;
      const g = loft(
        [
          { ...br, y: wy + 0.012 * H, rx: br.rx + 0.002 * H, zf: br.zf + 0.002 * H, zb: br.zb + 0.002 * H },
          { ...br, y: wy - 0.012 * H, rx: br.rx + 0.003 * H, zf: br.zf + 0.003 * H, zb: br.zb + 0.003 * H },
        ],
        { segments: 36 },
      );
      skinByDistance(g, this.segs(['hips', 'spine']), 4);
      this.add(g, 'belt');
      const buckle = new THREE.BoxGeometry(0.022 * H, 0.02 * H, 0.004 * H);
      buckle.translate(0, wy, br.zf + br.cz! + 0.004 * H);
      skinRigid(buckle, r.index('spine'));
      this.add(buckle, 'buttons');
    }
    if (o.buttons !== undefined) {
      const chestRings = this.torsoRings(infl);
      for (let i = 0; i < 4; i++) {
        const t = 0.42 + i * 0.13;
        const y = r.m.hipJointY + t * (r.m.neckBaseY - r.m.hipJointY);
        const ring = chestRings.reduce((a, b) => (Math.abs(b.y - y) < Math.abs(a.y - y) ? b : a));
        const b = ellipsoid(0.0055 * H, 0.0055 * H, 0.003 * H, 8, 6);
        b.translate(0.014 * H * (o.open > 0 ? 1 : 0), y, ring.zf + (ring.cz ?? 0) + 0.002 * H);
        skinRigid(b, r.index(y > r.m.chestY ? 'chest' : 'spine'));
        this.add(b, 'buttons');
      }
    }
  }

  private sleeve(s: Side, infl: number, slot: string, loose: number): void {
    const r = this.rig;
    const H = this.H;
    const sh = r.bindPos.get(`shoulder${s}`)!;
    const el = r.bindPos.get(`elbow${s}`)!;
    const wr = r.bindPos.get(`wrist${s}`)!;
    const sx = s === 'L' ? 1 : -1;
    const k = 1 + loose * 0.18;
    const R = (v: number) => v * H * k + infl;
    const rings: Ring[] = [
      { y: sh.y + 0.014 * H, rx: R(0.014), zf: R(0.02), zb: R(0.022), cx: sh.x - sx * 0.02 * H, cz: sh.z },
      { y: sh.y + 0.004 * H, rx: R(0.026), zf: R(0.028), zb: R(0.029), cx: sh.x - sx * 0.004 * H, cz: sh.z },
      { y: sh.y - 0.06 * H, rx: R(0.027), zf: R(0.027), zb: R(0.027), cx: sh.x, cz: sh.z },
      { y: el.y + 0.01 * H, rx: R(0.022), zf: R(0.022), zb: R(0.024), cx: el.x, cz: el.z },
      { y: el.y - 0.05 * H, rx: R(0.021), zf: R(0.021), zb: R(0.021), cx: el.x, cz: el.z },
      { y: wr.y + 0.022 * H, rx: R(0.0175), zf: R(0.0185), zb: R(0.0185), cx: wr.x, cz: wr.z },
      { y: wr.y + 0.004 * H, rx: R(0.019), zf: R(0.02), zb: R(0.02), cx: wr.x, cz: wr.z },
    ];
    const g = loft(rings, { segments: 18, subdiv: 2 });
    skinByDistance(g, this.segs(['chest', `shoulder${s}`, `elbow${s}`, [`wrist${s}`, `middle1${s}` as BoneName]]), 4.5);
    this.add(g, slot);
    // Inside of the cuff, so the open end isn't see-through.
    const cuff = loft(
      [
        { y: wr.y + 0.006 * H, rx: R(0.0185), zf: R(0.0195), zb: R(0.0195), cx: wr.x, cz: wr.z },
        { y: wr.y + 0.004 * H, rx: 0.012 * H, zf: 0.014 * H, zb: 0.014 * H, cx: wr.x, cz: wr.z },
      ],
      { segments: 18 },
    );
    skinRigid(cuff, r.index(`wrist${s}`));
    this.add(cuff, 'lining');
  }

  private collar(kind: 'shawl' | 'stand', infl: number): void {
    const r = this.rig;
    const H = this.H;
    const nb = r.bindPos.get('neck')!;
    const rings: Ring[] =
      kind === 'shawl'
        ? [
            { y: nb.y - 0.06 * H, rx: 0.1 * H + infl, zf: 0.064 * H + infl, zb: 0.058 * H + infl, cz: -0.004 * H },
            { y: nb.y - 0.025 * H, rx: 0.07 * H + infl, zf: 0.055 * H + infl, zb: 0.05 * H + infl, cz: -0.004 * H },
            { y: nb.y + 0.0 * H, rx: 0.05 * H + infl, zf: 0.045 * H + infl, zb: 0.045 * H + infl, cz: -0.006 * H },
            { y: nb.y + 0.012 * H, rx: 0.046 * H + infl, zf: 0.044 * H + infl, zb: 0.047 * H + infl, cz: -0.008 * H },
          ]
        : [
            { y: nb.y - 0.03 * H, rx: 0.062 * H + infl, zf: 0.05 * H + infl, zb: 0.052 * H + infl, cz: -0.006 * H },
            { y: nb.y + 0.005 * H, rx: 0.04 * H + infl, zf: 0.04 * H + infl, zb: 0.042 * H + infl, cz: -0.008 * H },
            { y: nb.y + 0.04 * H, rx: 0.038 * H + infl, zf: 0.04 * H + infl, zb: 0.042 * H + infl, cz: -0.006 * H },
          ];
    // Shawl collars open into a V at the front.
    const g = loft(rings, { segments: 32, subdiv: 2, arc: kind === 'shawl' ? [0.32, Math.PI * 2 - 0.32] : undefined });
    skinByDistance(g, this.segs(['chest', 'neck']), 4);
    this.add(g, 'collar');
  }

  /**
   * A skirt or coat tail. The top follows the hips; lower down it is shared
   * between the thighs (so a stride carries it) and the panel bones (which
   * spring behind her as she runs).
   */
  private skirt(_g: Garment, length: number, flare: number, open: number, slot: string, legShare: number, infl = 0, opts: SkirtOptions = {}): BuiltSkirt {
    const r = this.rig;
    const H = this.H;
    const topT = 0.36;
    const topY = r.m.hipJointY + topT * (r.m.neckBaseY - r.m.hipJointY);
    const legLen = r.m.hipJointY - r.m.ankleY;
    const hemY = r.m.hipJointY - length * legLen;
    const base = this.torsoRings(infl + 0.004 * H);
    const foldK = opts.fold ?? 1;
    const at = (y: number) => base.reduce((a, b) => (Math.abs(b.y - y) < Math.abs(a.y - y) ? b : a));
    const rings: Ring[] = [];
    const N = 8;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const y = topY + (hemY - topY) * t;
      const hipRing = at(Math.max(y, r.m.hipJointY));
      const widen = Math.pow(Math.max(0, t - 0.2) / 0.8, 1.4) * flare * 0.07 * H;
      rings.push({
        y,
        rx: Math.max(hipRing.rx, 0.1 * H * r.p.hip) + widen + (y < r.m.hipJointY ? 0.006 * H : 0),
        zf: Math.max(hipRing.zf, 0.07 * H) + widen * 0.9,
        zb: Math.max(hipRing.zb, 0.08 * H) + widen * 1.1,
        cz: -0.006 * H,
        fold: 0.1 * Math.pow(t, 1.3) * (0.6 + Math.min(flare, 1.6) * 0.4) * foldK,
        folds: opts.folds ?? 11,
      });
    }
    // A train: the back of the hem runs out along the floor behind her.
    if (opts.train) {
      const hem = rings[rings.length - 1];
      for (let i = 1; i <= 2; i++) {
        const k = i / 2;
        rings.push({ ...hem, y: hemY - (hemY - 0.003 * H) * k, rx: hem.rx + 0.02 * H * k, zf: hem.zf + 0.012 * H * k, zb: hem.zb + opts.train * H * k * k, fold: (hem.fold ?? 0) * (1 - 0.4 * k) });
      }
    }
    // Hide the seam between bodice and skirt under the belt line.
    rings[0].rx -= 0.003 * H;
    const g = loft(rings, { segments: 40, subdiv: 2, arc: open > 0 ? [open, Math.PI * 2 - open] : undefined });
    const hips = r.index('hips');
    const tL = r.index('thighL');
    const tR = r.index('thighR');
    const cb = r.index('coatBack');
    const cl = r.index('coatL');
    const cr = r.index('coatR');
    const p = new THREE.Vector3();
    skinByDistance(g, [], 1, (v): Influences => {
      p.copy(v);
      const h = Math.min(1, Math.max(0, (topY - p.y) / (topY - hemY)));
      const wh = Math.pow(1 - h, 2.2);
      const rest = 1 - wh;
      const sL = sstep(-0.35, 0.35, p.x / (0.1 * H));
      const theta = Math.atan2(p.x, p.z + 0.006 * H);
      const back = sstep(0.1, -0.7, Math.cos(theta));
      const leg = rest * legShare * (1 - back * 0.6);
      const panel = rest - leg;
      return [
        [hips, wh],
        [tL, leg * sL],
        [tR, leg * (1 - sL)],
        [cb, panel * back],
        [cl, panel * (1 - back) * sL],
        [cr, panel * (1 - back) * (1 - sL)],
      ];
    });
    this.add(g, slot);
    const lSlot = opts.liningSlot === undefined ? 'lining' : opts.liningSlot;
    if (lSlot === null) return { rings, geo: g };
    // Lining so the inside of the hem reads as cloth, not a hole.
    const lining = loft(
      rings.slice(-3).map((x) => ({ ...x, rx: x.rx - 0.003 * H, zf: x.zf - 0.003 * H, zb: x.zb - 0.003 * H })),
      { segments: 40, arc: open > 0 ? [open, Math.PI * 2 - open] : undefined },
    );
    const idx = lining.getIndex()!.array as Uint16Array;
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    lining.computeVertexNormals();
    skinByDistance(lining, [], 1, () => [[hips, 1]]);
    // Re-skin the lining with the skirt's own weights by nearest skirt vertex.
    copyNearestWeights(lining, g);
    this.add(lining, lSlot);
    return { rings, geo: g };
  }

  private legs(): void {
    const o = this.outfit.legs;
    const r = this.rig;
    const H = this.H;
    const trousers = o.kind === 'trousers';
    for (const s of ['L', 'R'] as const) {
      const th = r.bindPos.get(`thigh${s}`)!;
      const kn = r.bindPos.get(`knee${s}`)!;
      const an = r.bindPos.get(`ankle${s}`)!;
      const sx = s === 'L' ? 1 : -1;
      const tw = trousers ? 1.12 : 1;
      const rings: Ring[] = [
        { y: th.y + 0.025 * H, rx: 0.046 * H, zf: 0.05 * H, zb: 0.056 * H, cx: th.x - sx * 0.014 * H, cz: th.z - 0.004 * H },
        { y: th.y - 0.03 * H, rx: 0.05 * H * tw, zf: 0.052 * H * tw, zb: 0.056 * H * tw, cx: th.x + sx * 0.002 * H, cz: th.z },
        { y: th.y - 0.12 * H, rx: 0.041 * H * tw, zf: 0.043 * H * tw, zb: 0.043 * H * tw, cx: th.x + sx * 0.002 * H, cz: th.z },
        { y: kn.y + 0.025 * H, rx: 0.031 * H * tw, zf: 0.033 * H * tw, zb: 0.032 * H * tw, cx: kn.x, cz: kn.z + 0.002 * H },
        { y: kn.y - 0.01 * H, rx: 0.031 * H * tw, zf: 0.032 * H * tw, zb: 0.031 * H * tw, cx: kn.x, cz: kn.z },
        { y: kn.y - 0.07 * H, rx: 0.031 * H * tw, zf: 0.028 * H * tw, zb: 0.038 * H * tw, cx: kn.x, cz: kn.z - 0.003 * H },
        { y: kn.y - 0.15 * H, rx: 0.022 * H * tw, zf: 0.021 * H * tw, zb: 0.024 * H * tw, cx: an.x, cz: an.z },
        { y: an.y + 0.02 * H, rx: 0.017 * H * tw, zf: 0.018 * H * tw, zb: 0.019 * H * tw, cx: an.x, cz: an.z },
        { y: an.y - 0.005 * H, rx: 0.019 * H * tw, zf: 0.02 * H * tw, zb: 0.021 * H * tw, cx: an.x, cz: an.z },
      ];
      const g = loft(rings, { segments: 22, subdiv: 2 });
      skinByDistance(g, this.segs(['hips', `thigh${s}`, `knee${s}`, `ankle${s}`]), 4);
      this.add(g, 'legs');
    }
  }

  private shoes(): void {
    const o = this.outfit.shoes;
    const r = this.rig;
    const H = this.H;
    for (const s of ['L', 'R'] as const) {
      const kn = r.bindPos.get(`knee${s}`)!;
      const an = r.bindPos.get(`ankle${s}`)!;
      const chunky = o.kind === 'chunky' ? 1.18 : 1;
      const pointed = o.kind === 'pointed';
      // Boot shaft around the lower leg.
      const shaftTop = an.y + o.shaft * (kn.y - an.y);
      if (o.shaft > 0.02) {
        const sr: Ring[] = [];
        const N = 5;
        for (let i = 0; i <= N; i++) {
          const t = i / N;
          const y = shaftTop + (an.y - 0.01 * H - shaftTop) * t;
          const legT = (kn.y - y) / (kn.y - an.y);
          const calf = 0.031 - 0.012 * Math.min(1, Math.max(0, (legT - 0.25) / 0.75));
          const rr = (calf + 0.004) * H * chunky;
          sr.push({ y, rx: rr * 0.95, zf: rr, zb: rr * 1.05, cx: an.x, cz: an.z });
        }
        const g = loft(sr, { segments: 22, subdiv: 2 });
        skinByDistance(g, this.segs([`knee${s}`, `ankle${s}`]), 6);
        this.add(g, 'shoes');
        // Lacing band down the front.
        if (o.kind === 'laced' || o.kind === 'chunky') {
          for (let i = 0; i < 5; i++) {
            const y = an.y + 0.012 * H + i * ((shaftTop - an.y - 0.02 * H) / 5);
            const lace = new THREE.BoxGeometry(0.02 * H, 0.0025 * H, 0.004 * H);
            const legT = (kn.y - y) / (kn.y - an.y);
            const calf = (0.031 - 0.012 * Math.min(1, Math.max(0, (legT - 0.25) / 0.75)) + 0.004) * H * chunky;
            lace.rotateZ(i % 2 ? 0.3 : -0.3);
            lace.translate(an.x, y, an.z + calf + 0.001 * H);
            skinRigid(lace, r.index(y > an.y + 0.06 * H ? `knee${s}` : `ankle${s}`));
            this.add(lace, 'belt');
          }
        }
      }
      // Foot: lofted heel → toe along Y, then rotated to point forward (+Z).
      const fl = 0.135 * H * (pointed ? 1.08 : 1) * (chunky > 1 ? 1.04 : 1);
      const soleY = -(an.y - 0.002 * H);
      const fr: Ring[] = [
        { y: -0.03 * H, rx: 0.018 * H * chunky, zf: 0.0, zb: 0.03 * H, sq: 3 },
        { y: -0.022 * H, rx: 0.022 * H * chunky, zf: 0.0, zb: 0.04 * H, sq: 3 },
        { y: 0.01 * H, rx: 0.023 * H * chunky, zf: 0.0, zb: 0.04 * H, sq: 3 },
        { y: 0.05 * H, rx: 0.024 * H * chunky, zf: 0.0, zb: 0.026 * H * chunky, sq: 3 },
        { y: 0.085 * H, rx: 0.026 * H * chunky, zf: 0.0, zb: 0.019 * H * chunky, sq: 3 },
        { y: fl - 0.02 * H, rx: (pointed ? 0.014 : 0.022) * H * chunky, zf: 0.0, zb: 0.014 * H * chunky, sq: 2.6 },
        { y: fl, rx: (pointed ? 0.003 : 0.01) * H * chunky, zf: 0.0, zb: 0.007 * H, sq: 2.2 },
      ];
      // zf = 0: the sole sits flat on the ground plane after rotation.
      for (const ring of fr) ring.zf = 0.003 * H;
      const fg = loft(fr, { segments: 22, subdiv: 2, capTop: true, capBottom: true });
      fg.rotateX(Math.PI / 2);
      // After rotation: ring "front" points down; length runs +Z.
      fg.translate(an.x, an.y + soleY + 0.003 * H, an.z + 0.0 * H);
      skinRigid(fg, r.index(`ankle${s}`));
      this.add(fg, 'shoes');
      // Heel block / sole.
      const heelH = o.kind === 'pointed' ? 0.03 * H : o.kind === 'chunky' ? 0.022 * H : o.kind === 'laced' ? 0.018 * H : 0.008 * H;
      const heel = new THREE.BoxGeometry(0.03 * H * chunky, heelH, 0.035 * H);
      heel.translate(an.x, an.y + soleY + heelH / 2, an.z - 0.012 * H);
      skinRigid(heel, r.index(`ankle${s}`));
      this.add(heel, 'sole');
      const sole = new THREE.BoxGeometry(0.044 * H * chunky, 0.006 * H * chunky, fl * 0.7);
      sole.translate(an.x, an.y + soleY + 0.003 * H, an.z + fl * 0.48);
      skinRigid(sole, r.index(`ankle${s}`));
      this.add(sole, 'sole');
    }
  }

  /** A long knit scarf: a wrap around the throat and two tails on the spring chain. */
  private scarf(_g: Garment): void {
    const r = this.rig;
    const H = this.H;
    const nb = r.bindPos.get('neck')!;
    const wrap = loft(
      [
        { y: nb.y - 0.045 * H, rx: 0.078 * H, zf: 0.062 * H, zb: 0.06 * H, cz: nb.z + 0.004 * H, fold: 0.12, folds: 7 },
        { y: nb.y - 0.015 * H, rx: 0.064 * H, zf: 0.06 * H, zb: 0.054 * H, cz: nb.z + 0.008 * H, fold: 0.14, folds: 7 },
        { y: nb.y + 0.012 * H, rx: 0.052 * H, zf: 0.054 * H, zb: 0.048 * H, cz: nb.z + 0.008 * H, fold: 0.1, folds: 7 },
        { y: nb.y + 0.024 * H, rx: 0.046 * H, zf: 0.048 * H, zb: 0.044 * H, cz: nb.z + 0.004 * H },
      ],
      { segments: 28, subdiv: 2 },
    );
    skinByDistance(wrap, this.segs(['chest', 'neck']), 4);
    this.add(wrap, 'scarf');
    const chain = r.chains.get('scarf0');
    if (!chain) return;
    // The long tail follows the chain down her front.
    const pts = chain.map((b) => r.bindPos.get(b)!.clone());
    pts.push(r.segment(chain[chain.length - 1]).b);
    const rings: Ring[] = pts.map((p, i) => ({
      y: p.y,
      rx: 0.034 * H * (1 - i * 0.03),
      zf: 0.008 * H,
      zb: 0.008 * H,
      cx: p.x,
      cz: p.z,
      sq: 4,
    }));
    const tail = loft(rings, { segments: 16, subdiv: 3, capBottom: true });
    skinByDistance(tail, [r.segment('chest'), ...chain.map((b) => r.segment(b))], 5);
    this.add(tail, 'scarf');
    // Fringe at the end.
    const end = pts[pts.length - 1];
    for (let i = 0; i < 9; i++) {
      const f = new THREE.CylinderGeometry(0.0018 * H, 0.0012 * H, 0.03 * H, 4);
      f.translate(end.x - 0.03 * H + i * 0.0075 * H, end.y - 0.015 * H, end.z);
      skinRigid(f, r.index(chain[chain.length - 1]));
      this.add(f, 'scarf');
    }
  }
}

/** Give each vertex of `target` the skin weights of the nearest vertex in `source`. */
export function copyNearestWeights(target: THREE.BufferGeometry, source: THREE.BufferGeometry): void {
  const tp = target.getAttribute('position');
  const sp = source.getAttribute('position');
  const si = source.getAttribute('skinIndex');
  const sw = source.getAttribute('skinWeight');
  const ti = new Uint16Array(tp.count * 4);
  const tw = new Float32Array(tp.count * 4);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i < tp.count; i++) {
    a.fromBufferAttribute(tp, i);
    let best = 0;
    let bd = Infinity;
    for (let j = 0; j < sp.count; j++) {
      b.fromBufferAttribute(sp, j);
      const d = a.distanceToSquared(b);
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    for (let k = 0; k < 4; k++) {
      ti[i * 4 + k] = si.getComponent(best, k);
      tw[i * 4 + k] = sw.getComponent(best, k);
    }
  }
  target.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(ti, 4));
  target.setAttribute('skinWeight', new THREE.Float32BufferAttribute(tw, 4));
}
