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
  invulnerable: 1.7,
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
  /** The house stands right where the slide ends (Stage 4: she goes in). */
  houseX: 578,
  houseZ: -6,
};

export const CAMERA = {
  fov: 44,
  offset: { x: -6.8, y: 4.0, z: 6.6 },
  lookAhead: { x: 7.5, y: 1.0 },
  /** Fraction of lane offset the camera follows (keeps lanes readable). */
  laneFollow: 0.25,
};

/** The Demon's four elemental powers. */
export const POWERS = {
  grass: { cooldown: 5.5, windup: 1.3, footprint: 1.4, label: 'Grass' },
  wind: { cooldown: 9, windup: 1.2, footprint: 8, label: 'Wind' },
  water: { cooldown: 8, windup: 1.3, footprint: 1.7, label: 'Water' },
  fire: { cooldown: 10, windup: 1.45, footprint: 3.1, label: 'Fire' },
} as const;

/**
 * Rules every Demon (AI or human) must obey. Threat comes from timing and
 * misdirection, never from unavoidable attacks.
 */
export const FAIRNESS = {
  /** Seconds a player needs after seeing a warning to change lanes. */
  reaction: 0.55,
  /** Minimum visible warning before any attack can land. */
  minWarning: 0.9,
  /** Minimum clear metres between two blocking hazards in the same lane (no stun-locks). */
  sameLaneGap: 9,
  /** Metres around a hazard within which at least one lane must stay open. */
  laneWindow: 6.5,
  maxRange: 72,
  maxActive: 4,
  /** No new casts this long after she is caught (no stun-locks). */
  graceAfterHit: 1.6,
  /** The same power can't be used more than this many times in a row. */
  maxRepeat: 2,
  /** Metres before the finish where the Demon stops interfering. */
  noCastBeforeFinish: 30,
  /** Minimum gap between any two casts. */
  castSpacing: 0.7,
};

export const MODE_TUNING = {
  ai: { cooldownScale: 1.0 },
  human: { cooldownScale: 1.0 },
  /** 1v1: the Demon wins if it catches her this many times. */
  versusCatchesToWin: 5,
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
