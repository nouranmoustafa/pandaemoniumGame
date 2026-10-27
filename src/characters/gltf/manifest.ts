import type { CharacterId } from '../design';

/**
 * Third-party character assets, with their provenance. Every external file
 * the game loads is listed here; nothing is loaded that isn't.
 *
 * Stage 3 ships no third-party character for the cast — the four women are
 * generated in code (characters/GeneratedCharacter). The one entry below is
 * a CC0 test model used only to validate this import pipeline in the dev lab.
 */
export interface AssetEntry {
  /** Path under /public. */
  url: string;
  title: string;
  author: string;
  license: 'CC0-1.0' | 'CC-BY-4.0' | 'original' | string;
  source: string;
  notes?: string;
}

export const PIPELINE_TEST: AssetEntry = {
  url: 'characters/pipeline-test/RobotExpressive.glb',
  title: 'RobotExpressive',
  author: 'Tomás Laulhé (Quaternius); morph targets added by Don McCurdy',
  license: 'CC0-1.0',
  source: 'https://github.com/mrdoob/three.js/tree/r170/examples/models/gltf/RobotExpressive',
  notes: 'Pipeline validation only (skeleton, AnimationMixer clips, facial morphs). Not used as a game character.',
};

/**
 * Where a supplied, professionally modelled cast member goes. When a GLB is
 * listed here, the dev lab (?lab&glb=<id>) loads it through GltfAvatar.
 * See public/characters/README.md for the required rig, clips and morphs.
 */
export const CAST_ASSETS: Partial<Record<CharacterId, AssetEntry>> = {};
