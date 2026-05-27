import type { ExplosionParticle, ShockwaveRing, TrailParticle } from "../types";

export const createBlankExplosionParticle = (): ExplosionParticle => ({
  active: false,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  life: 0,
  maxLife: 1,
  radius: 1,
  color: "rgba(125, 249, 255, ALPHA)",
});

export const createBlankTrailParticle = (): TrailParticle => ({
  active: false,
  x: 0,
  y: 0,
  life: 0,
  maxLife: 1,
  radius: 1,
  color: "rgba(125, 249, 255, ALPHA)",
});

export const createBlankShockwave = (): ShockwaveRing => ({
  active: false,
  x: 0,
  y: 0,
  age: 0,
  duration: 0.68,
  maxRadius: 0,
  width: 8,
  alpha: 0.5,
});

