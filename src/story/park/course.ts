import type { ObstacleSpec } from '../../obstacles/ObstacleManager';

/**
 * The park's own scripted hazards, as data. The Demon (AI or human) adds its
 * powers on top of these. Lanes: 0 = far/upper, 1 = middle, 2 = near/lower.
 *
 *   0–40     settle in, learn the controls
 *   40–115   the grass wakes up (tutorial)
 *   126–166  the false shortcut — deliberately empty
 *   168–200  the trees join in
 *   185–245  the pavement rises into a hill
 *   245–412  the hill folds into a slide — and the house rises at the end of it
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

  // On the rising hill.
  { type: 'grass', x: 205, lane: 1 },
  { type: 'branch', x: 228, style: 'drop', lanes: [2] },

  // The slide.
  { type: 'branch', x: 290, style: 'drop', lanes: [1] },
  { type: 'branch', x: 330, style: 'sweep', lanes: [0, 1] },
  { type: 'branch', x: 368, style: 'drop', lanes: [2] },
];

/** Where the false shortcut opens and closes. */
export const SHORTCUT = { start: 124, end: 166 };
