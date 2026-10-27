/**
 * Central tuning values. Gameplay feel lives here so it can be adjusted
 * without digging through systems.
 *
 * World axes: the Visitor runs along +X toward the house.
 * Lanes are spread along Z. Lane 0 is the far ("upper" on screen) lane,
 * lane 2 the near ("lower") lane.
 */
export const LANES = [-2.6, 0, 2.6] as const;
export type LaneIndex = 0 | 1 | 2;

export const PATH_HALF_WIDTH = 4.3;

export const RUN = {
  /** Automatic jog speed with no effort (m/s). */
  jogSpeed: 5.2,
  /** Speed at full effort. */
  sprintSpeed: 12.5,
  /** Effort added per Space tap (0..1 scale). */
  effortPerTap: 0.2,
  /** Effort lost per second when the player stops tapping. */
  effortDecay: 0.32,
  /** How fast actual speed chases the target (1/s). */
  accel: 3.2,
  decel: 1.6,
  /** Lane spring stiffness — higher is snappier. */
  laneStiffness: 70,
  laneDamping: 15,
  /** Speed multiplier immediately after being caught. */
  stumbleSpeedFactor: 0.35,
  stumbleDuration: 1.05,
  /** Grace period after a hit. */
  invulnerable: 1.3,
  /** How much uphill slope slows her (per unit of dh/dx). */
  slopeDrag: 26,
};

export const SLIDE = {
  minSpeed: 10,
  maxSpeed: 21,
  gravity: 34,
  friction: 0.35,
  paddleBoost: 1.4,
};

/** Course layout (X positions). */
export const COURSE = {
  start: 0,
  pavementStart: 222,
  hillCrest: 292,
  pavementEnd: 548,
  finish: 540,
  houseX: 612,
  houseZ: -6,
};

export const CAMERA = {
  fov: 44,
  offset: { x: -6.8, y: 4.0, z: 6.6 },
  lookAhead: { x: 7.5, y: 1.0 },
  /** Fraction of lane offset the camera follows (keeps lanes readable). */
  laneFollow: 0.25,
};

export const COLORS = {
  fog: 0x1b1630,
  skyTop: 0x05040b,
  skyHorizon: 0x2b2148,
  moon: 0xe9e2d0,
  moonLight: 0x8a95d6,
  amber: 0xffa347,
  hemiSky: 0x3a3a78,
  hemiGround: 0x120a14,
};
