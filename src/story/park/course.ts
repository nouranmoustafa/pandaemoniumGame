import type { ObstacleSpec } from '../../obstacles/ObstacleManager';

/**
 * The park's own scripted hazards, as data. The Demon (AI or human) adds its
 * powers on top of these. Lanes: 0 = far/upper, 1 = middle, 2 = near/lower.
 *
 *   0–40     settle in, learn the controls
 *   40–115   the grass wakes up (tutorial)
 *   126–166  the false shortcut — deliberately empty
 *   168–215  the trees join in
 *   222–292  the pavement rises into a hill
 *   292–540  the hill folds into a slide toward the house
 */
export const PARK_COURSE: ObstacleSpec[] = [
  // Grass — singles, then a pair that forces a specific lane.
  { type: 'grass', x: 46, lane: 1 },
  { type: 'grass', x: 68, lane: 0 },
  { type: 'grass', x: 88, lane: 2 },
  { type: 'grass', x: 88, lane: 1 },
  { type: 'grass', x: 108, lane: 0 },

  // Trees.
  { type: 'branch', x: 172, style: 'sweep', lanes: [0, 1] },
  { type: 'branch', x: 188, style: 'drop', lanes: [2] },
  { type: 'branch', x: 205, style: 'sweep', lanes: [0] },
  { type: 'grass', x: 205, lane: 2 },

  // On the rising hill.
  { type: 'grass', x: 250, lane: 1 },
  { type: 'branch', x: 280, style: 'drop', lanes: [2] },

  // The slide.
  { type: 'branch', x: 334, style: 'drop', lanes: [1] },
  { type: 'branch', x: 384, style: 'sweep', lanes: [0, 1] },
  { type: 'branch', x: 412, style: 'drop', lanes: [0] },
  { type: 'branch', x: 456, style: 'drop', lanes: [2] },
  { type: 'branch', x: 482, style: 'sweep', lanes: [0] },
  { type: 'grass', x: 506, lane: 1 },
];

/** Where the false shortcut opens and closes. */
export const SHORTCUT = { start: 124, end: 166 };
