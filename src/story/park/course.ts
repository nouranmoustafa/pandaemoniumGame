import type { ObstacleSpec } from '../../obstacles/ObstacleManager';

/**
 * The park chase, as data. Lanes: 0 = far/upper, 1 = middle, 2 = near/lower.
 *
 *   0–40     settle in, learn the controls
 *   40–130   the grass wakes up
 *   130–215  the trees join in
 *   222–292  the pavement rises into a hill (obstacles continue)
 *   292–540  the hill folds into a slide toward the house
 */
export const PARK_COURSE: ObstacleSpec[] = [
  // Grass — singles, then pairs that force a specific lane.
  { type: 'grass', x: 46, lane: 1 },
  { type: 'grass', x: 68, lane: 0 },
  { type: 'grass', x: 88, lane: 2 },
  { type: 'grass', x: 88, lane: 1 },
  { type: 'grass', x: 108, lane: 0 },
  { type: 'grass', x: 124, lane: 0 },
  { type: 'grass', x: 124, lane: 2 },

  // Trees.
  { type: 'branch', x: 148, style: 'sweep', lanes: [0] },
  { type: 'branch', x: 170, style: 'sweep', lanes: [0, 1] },
  { type: 'branch', x: 190, style: 'drop', lanes: [2] },
  { type: 'branch', x: 208, style: 'sweep', lanes: [0] },
  { type: 'grass', x: 208, lane: 2 },

  // On the rising hill.
  { type: 'grass', x: 248, lane: 1 },
  { type: 'grass', x: 266, lane: 0 },
  { type: 'branch', x: 280, style: 'drop', lanes: [2] },

  // The slide.
  { type: 'branch', x: 334, style: 'drop', lanes: [1] },
  { type: 'grass', x: 358, lane: 0 },
  { type: 'grass', x: 358, lane: 2 },
  { type: 'branch', x: 384, style: 'sweep', lanes: [0, 1] },
  { type: 'branch', x: 410, style: 'drop', lanes: [0] },
  { type: 'grass', x: 432, lane: 1 },
  { type: 'branch', x: 456, style: 'drop', lanes: [2] },
  { type: 'branch', x: 480, style: 'sweep', lanes: [0] },
  { type: 'grass', x: 480, lane: 2 },
  { type: 'grass', x: 506, lane: 1 },
];
