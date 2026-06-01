export const performanceMode = true;
export const MAX_BALLS = 60;
export const MAX_EXPLOSION_PARTICLES = 70;
export const MAX_TRAIL_PARTICLES = 120;
export const MAX_SHOCKWAVES = 3;
export const BALL_COUNT = Math.min(26, MAX_BALLS);
export const BALL_SPEED_SCALE = 0.6;
export const MIN_RADIUS = 7;
export const MAX_RADIUS = 19;
export const BASE_HOLE_RADIUS = 18;
export const BASE_GRAVITY = 52000;
export const WALL_RESTITUTION = 0.94;
export const BALL_RESTITUTION = 0.9;
export const MAX_SPEED = 880;
export const MIN_SPEED = 70;
export const SUPERNOVA_COLLAPSE_STAGE = 0.5;
export const SUPERNOVA_IGNITION_STAGE = 0.12;
export const SUPERNOVA_BLOOM_FADE_STAGE = 0.9;
export const SUPERNOVA_RETURN_STAGE = 0.4;
export const COLLAPSE_PAUSE = SUPERNOVA_COLLAPSE_STAGE;
export const EXPLOSION_TIME =
  SUPERNOVA_IGNITION_STAGE +
  SUPERNOVA_BLOOM_FADE_STAGE +
  SUPERNOVA_RETURN_STAGE;
export const DESKTOP_CALM_PHASE = 3.5;
export const DESKTOP_AWAKENING_PHASE = 4.5;
export const MOBILE_CALM_PHASE = 5;
export const MOBILE_AWAKENING_PHASE = 6.5;
export const CRITICAL_MIN_DURATION = 2.5;
export const CRITICAL_MAX_DURATION = 3.5;
export const CRITICAL_SLOW_MIN = 0.52;
export const CRITICAL_SLOW_MAX = 0.6;
export const CRITICAL_TRIGGER_RATIO = 0.82;
export const CRITICAL_ZOOM = 1.025;
export const EXPLOSION_PARTICLE_COUNT = performanceMode ? 58 : 70;
export const MOBILE_EXPLOSION_PARTICLE_COUNT = 35;
export const EXPLOSION_LAUNCH_SCALE = 1.85;
export const SHAKE_DURATION = 0.3;
export const TARGET_FPS = performanceMode ? 45 : 60;
export const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
export const DESKTOP_DPR_CAP = 1.5;
export const MOBILE_DPR_CAP = 3;
export const HUD_UPDATE_INTERVAL = 0.18;
export const BINARY_GRAVITY = 82000;
export const BINARY_SOFTENING = 4200;
export const BINARY_DAMPING = 0.9992;

export const palette = [
  { color: "#67e8f9", glow: "rgba(103, 232, 249, 0.62)" },
  { color: "#60a5fa", glow: "rgba(96, 165, 250, 0.58)" },
  { color: "#a78bfa", glow: "rgba(167, 139, 250, 0.58)" },
  { color: "#22d3ee", glow: "rgba(34, 211, 238, 0.56)" },
  { color: "#f0abfc", glow: "rgba(240, 171, 252, 0.5)" },
];
