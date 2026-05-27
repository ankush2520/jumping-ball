import { BALL_COUNT, BALL_SPEED_SCALE, BASE_HOLE_RADIUS, EXPLOSION_LAUNCH_SCALE, MAX_RADIUS, MIN_RADIUS, palette } from "../constants";
import type { Arena, GravityBall } from "../types";
import { randomBetween } from "./blackHole";

export const createBlankBall = (): GravityBall => ({
  active: false,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  radius: MIN_RADIUS,
  mass: MIN_RADIUS * MIN_RADIUS,
  color: palette[0].color,
  glow: palette[0].glow,
  slowTime: 0,
});

export const resetOrbitBall = (
  ball: GravityBall,
  arena: Arena,
  index: number,
  speedScale: number,
) => {
  const radius = randomBetween(MIN_RADIUS, MAX_RADIUS);
  const angle = randomBetween(0, Math.PI * 2);
  const orbitRadius = randomBetween(
    Math.min(arena.width, arena.height) * 0.22,
    Math.min(arena.width, arena.height) * 0.45,
  );
  const speed = randomBetween(120, 285);
  const tone = palette[index % palette.length];

  ball.active = true;
  ball.x = arena.width / 2 + Math.cos(angle) * orbitRadius;
  ball.y = arena.height / 2 + Math.sin(angle) * orbitRadius;
  ball.vx =
    (Math.cos(angle + Math.PI / 2) * speed + randomBetween(-90, 90)) *
    BALL_SPEED_SCALE *
    speedScale;
  ball.vy =
    (Math.sin(angle + Math.PI / 2) * speed + randomBetween(-90, 90)) *
    BALL_SPEED_SCALE *
    speedScale;
  ball.radius = radius;
  ball.mass = radius * radius;
  ball.color = tone.color;
  ball.glow = tone.glow;
  ball.slowTime = 0;
};

export const resetExplosionBall = (
  ball: GravityBall,
  arena: Arena,
  index: number,
  speedScale: number,
  explosionScale: number,
  originX = arena.width / 2,
  originY = arena.height / 2,
) => {
  const radius = randomBetween(MIN_RADIUS, MAX_RADIUS);
  const angle = (index / BALL_COUNT) * Math.PI * 2 + randomBetween(-0.16, 0.16);
  const speed = randomBetween(430, 760);
  const tone = palette[index % palette.length];

  ball.active = true;
  ball.x = originX + Math.cos(angle) * (BASE_HOLE_RADIUS + radius + 4);
  ball.y = originY + Math.sin(angle) * (BASE_HOLE_RADIUS + radius + 4);
  ball.vx =
    (Math.cos(angle) * speed + randomBetween(-70, 70)) *
    BALL_SPEED_SCALE *
    EXPLOSION_LAUNCH_SCALE *
    speedScale *
    explosionScale;
  ball.vy =
    (Math.sin(angle) * speed + randomBetween(-70, 70)) *
    BALL_SPEED_SCALE *
    EXPLOSION_LAUNCH_SCALE *
    speedScale *
    explosionScale;
  ball.radius = radius;
  ball.mass = radius * radius;
  ball.color = tone.color;
  ball.glow = tone.glow;
  ball.slowTime = 0;
};

