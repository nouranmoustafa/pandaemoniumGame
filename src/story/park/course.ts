import { CHASE } from '../../config';
import type { ObstacleSpec } from '../../obstacles/ObstacleManager';

/**
 * The park's own scripted hazards, as data. The Demon (AI or human) adds its
 * powers on top of these. Lanes: 0 = far/upper, 1 = middle, 2 = near/lower.
 *
 * The chase runs toward −X (see CHASE), so the layout reads backwards, by
 * distance from where she starts running (CHASE.start):
 *
 *   0–40     settle in, learn the controls
 *   40–115   the grass wakes up (tutorial)
 *   124–166  the false shortcut — deliberately empty
 *   172–228  the trees join in
 *   255      the chase is decided; a Demon win turns her round just past it,
 *            and the road carries her back up the hill (185–245) and down the slide
 */
const at = (fromStart: number) => CHASE.start + fromStart * CHASE.dir;

export const PARK_COURSE: ObstacleSpec[] = [
  // Grass — singles, then a pair that forces a specific lane.
  { type: 'grass', x: at(46), lane: 1 },
  { type: 'grass', x: at(68), lane: 0 },
  { type: 'grass', x: at(88), lane: 2 },
  { type: 'grass', x: at(88), lane: 1 },
  { type: 'grass', x: at(108), lane: 0 },

  // Trees.
  { type: 'branch', x: at(172), style: 'sweep', lanes: [0, 1] },
  { type: 'branch', x: at(188), style: 'drop', lanes: [2] },
  { type: 'grass', x: at(205), lane: 1 },
  { type: 'branch', x: at(228), style: 'drop', lanes: [2] },
  { type: 'branch', x: at(240), style: 'sweep', lanes: [1, 2] },
];

/** Where the false shortcut opens (she reaches it first) and closes, in world X. */
export const SHORTCUT = { start: at(124), end: at(166) };
