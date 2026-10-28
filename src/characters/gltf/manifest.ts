import type { CharacterId } from '../design';

/**
 * Third-party character assets, with their provenance. Every external file
 * the game loads is listed here; nothing is loaded that isn't.
 *
 * The cast ships as original, code-generated characters
 * (characters/GeneratedCharacter). The one entry below is a CC0 test model
 * used to prove the GLB path end to end, in the dev lab and in the real
 * chase (?visitor=test). It is a robot, not a stand-in for the Visitor's design.
 */
export interface AssetEntry {
  /** Path under /public. */
  url: string;
  title: string;
  author: string;
  license: 'CC0-1.0' | 'CC-BY-4.0' | 'original' | string;
  source: string;
  notes?: string;
  /** Semantic clip → this model's clip name, where the defaults don't match. */
  clips?: Record<string, string>;
  /** Speed (m/s, at game scale) each locomotion clip was authored for. */
  clipSpeeds?: Partial<Record<'walk' | 'run' | 'sprint', number>>;
  /** Outfit name → mesh-name prefixes to show; every prefix listed in any outfit is a layer. */
  outfits?: Record<string, string[]>;
}

export const PIPELINE_TEST: AssetEntry = {
  url: 'characters/pipeline-test/RobotExpressive.glb',
  title: 'RobotExpressive',
  author: 'Tomás Laulhé (Quaternius); morph targets added by Don McCurdy',
  license: 'CC0-1.0',
  source: 'https://github.com/mrdoob/three.js/tree/r170/examples/models/gltf/RobotExpressive',
  notes: 'Pipeline validation only (skeleton, AnimationMixer clips, facial morphs). Not a design for any cast member.',
  // The robot has no stumble/slide clips of its own; these are its closest stand-ins.
  clips: { stumble: 'Jump', slide: 'Sitting', talk: 'Yes', laugh: 'Yes', fear: 'No', hesitate: 'No', wave: 'Wave' },
  clipSpeeds: { walk: 1.7, run: 4.8 },
};

/**
 * Where a supplied, professionally modelled cast member goes. A Visitor
 * entry here replaces the generated Visitor in the game automatically
 * (falling back to the generated one if the file fails to load).
 * See public/characters/README.md for the required rig, clips and morphs.
 */
export const CAST_ASSETS: Partial<Record<CharacterId, AssetEntry>> = {};

/** The Visitor's model for this session: ?visitor=test forces the CC0 test model. */
export function visitorAsset(): AssetEntry | null {
  const q = new URLSearchParams(location.search).get('visitor');
  if (q === 'test') return PIPELINE_TEST;
  if (q === 'generated') return null;
  return CAST_ASSETS.visitor ?? null;
}
