export type GravityBall = {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  color: string;
  glow: string;
  slowTime: number;
};

export type ExplosionParticle = {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  radius: number;
  color: string;
};

export type TrailParticle = {
  active: boolean;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  radius: number;
  color: string;
};

export type ShockwaveRing = {
  active: boolean;
  x: number;
  y: number;
  age: number;
  duration: number;
  maxRadius: number;
  width: number;
  alpha: number;
};

export type HudStats = {
  mass: number;
  stability: number;
  charge: number;
  stage: string;
};

export type BlackHole = {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  targetRadius: number;
  strength: number;
  mass: number;
  rotationAngle: number;
  rotationSpeed: number;
};

export type Arena = {
  width: number;
  height: number;
  dpr: number;
};

export type PhysicsScale = {
  mobileScale: number;
  speedScale: number;
  gravityScale: number;
  growthScale: number;
  visualScale: number;
  blackHoleVisualScale: number;
  explosionScale: number;
  calmDuration: number;
  awakeningDuration: number;
  minCycleTime: number;
};

export type CycleState = {
  phase:
    | "calm"
    | "awakening"
    | "active"
    | "critical"
    | "collapse"
    | "explosion";
  phaseStartedAt: number;
  shockwaveAt: number;
  phaseDuration?: number;
};
