import type { FaceShape } from './geo/head';
import type { Proportions } from './rig/CharacterRig';
import type { FabricKind, Makeup } from './textures';

export type CharacterId = 'visitor' | 'odette' | 'juno' | 'wren';

export type HairKind = 'visitor' | 'long' | 'curly' | 'asym';

export interface HairStyle {
  kind: HairKind;
  color: number;
  /** Highlight tint. */
  sheen: number;
}

/** How she stands when nothing is asking anything of her. */
export type IdleStyle = 'open' | 'composed' | 'animated' | 'reserved';

/**
 * Identity: what stays the same across every chapter (face, body, hair, the
 * way she holds herself). Clothing is a separate Outfit.
 */
export interface CharacterDesign {
  id: CharacterId;
  name: string;
  proportions: Proportions;
  face: FaceShape;
  makeup: Makeup;
  skin: number;
  eye: { iris: string; dark: string };
  hair: HairStyle;
  idle: IdleStyle;
  /** World scale applied to the whole figure (the park is stylized larger than life). */
  scale: number;
}

export interface Garment {
  color: number;
  fabric: FabricKind;
  /** 0..1 sheen (velvet, wool nap). */
  sheen?: number;
  sheenColor?: number;
  roughness?: number;
}

export interface Outfit {
  id: string;
  top: Garment & {
    kind: 'coat' | 'jacket' | 'sweater';
    /** Hem height as a fraction of the leg (0 = hips, 1 = ankle). */
    length: number;
    /** Front opening of the skirt, radians either side of centre. 0 = closed. */
    open: number;
    collar: 'shawl' | 'stand' | 'none';
    collarGarment?: Garment;
    belt?: number;
    buttons?: number;
    /** Extra looseness (oversized knit). */
    loose?: number;
  };
  /** Shown at the neckline / under an open jacket. */
  under?: Garment;
  skirt?: Garment & { length: number; flare: number };
  legs: Garment & { kind: 'tights' | 'trousers' };
  shoes: Garment & { kind: 'laced' | 'pointed' | 'chunky' | 'flat'; shaft: number };
  scarf?: Garment;
}
