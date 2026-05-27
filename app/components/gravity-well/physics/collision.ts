import { BASE_HOLE_RADIUS, BALL_RESTITUTION, MAX_SPEED, MIN_SPEED, WALL_RESTITUTION } from "../constants";
import type { Arena, BlackHole, GravityBall } from "../types";

export const clampSpeed = (ball: GravityBall) => {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed <= MAX_SPEED) return;
  const scale = MAX_SPEED / speed;
  ball.vx *= scale;
  ball.vy *= scale;
};

export const enforceMinimumSpeed = (
  ball: GravityBall,
  blackHole: BlackHole,
  dt: number,
  minSpeedScale = 1,
) => {
  const minSpeed = MIN_SPEED * minSpeedScale;
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed >= minSpeed) {
    ball.slowTime = 0;
    return;
  }

  const dx = blackHole.x - ball.x;
  const dy = blackHole.y - ball.y;
  const distance = Math.hypot(dx, dy) || 1;
  const nx = dx / distance;
  const ny = dy / distance;
  const directionX = speed > 0.001 ? ball.vx / speed : -ny;
  const directionY = speed > 0.001 ? ball.vy / speed : nx;
  const boostScale = minSpeed / Math.max(speed, 1);

  ball.vx = directionX * speed * boostScale;
  ball.vy = directionY * speed * boostScale;
  ball.slowTime += dt;

  if (ball.slowTime > 0.5) {
    const impulse = minSpeed * 0.42;
    const massScale = blackHole.radius / BASE_HOLE_RADIUS;
    ball.vx += (-ny * 0.75 - nx * 0.25) * impulse * massScale;
    ball.vy += (nx * 0.75 - ny * 0.25) * impulse * massScale;
    ball.slowTime = 0;
  }
};

export const resolveWallCollision = (ball: GravityBall, arena: Arena) => {
  if (ball.x - ball.radius < 0) {
    ball.x = ball.radius;
    ball.vx = Math.abs(ball.vx) * WALL_RESTITUTION;
  } else if (ball.x + ball.radius > arena.width) {
    ball.x = arena.width - ball.radius;
    ball.vx = -Math.abs(ball.vx) * WALL_RESTITUTION;
  }

  if (ball.y - ball.radius < 0) {
    ball.y = ball.radius;
    ball.vy = Math.abs(ball.vy) * WALL_RESTITUTION;
  } else if (ball.y + ball.radius > arena.height) {
    ball.y = arena.height - ball.radius;
    ball.vy = -Math.abs(ball.vy) * WALL_RESTITUTION;
  }
};

export const resolveBallCollision = (
  ballA: GravityBall,
  ballB: GravityBall,
) => {
  const dx = ballB.x - ballA.x;
  const dy = ballB.y - ballA.y;
  const distance = Math.hypot(dx, dy) || 1;
  const minDistance = ballA.radius + ballB.radius;

  if (distance >= minDistance) return 0;

  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = minDistance - distance;
  const totalMass = ballA.mass + ballB.mass;

  ballA.x -= nx * overlap * (ballB.mass / totalMass);
  ballA.y -= ny * overlap * (ballB.mass / totalMass);
  ballB.x += nx * overlap * (ballA.mass / totalMass);
  ballB.y += ny * overlap * (ballA.mass / totalMass);

  const relativeVx = ballB.vx - ballA.vx;
  const relativeVy = ballB.vy - ballA.vy;
  const velocityAlongNormal = relativeVx * nx + relativeVy * ny;

  if (velocityAlongNormal > 0) return 0;
  const impact = Math.min(1, Math.abs(velocityAlongNormal) / 260);

  const impulse =
    (-(1 + BALL_RESTITUTION) * velocityAlongNormal) /
    (1 / ballA.mass + 1 / ballB.mass);

  ballA.vx -= (impulse * nx) / ballA.mass;
  ballA.vy -= (impulse * ny) / ballA.mass;
  ballB.vx += (impulse * nx) / ballB.mass;
  ballB.vy += (impulse * ny) / ballB.mass;

  clampSpeed(ballA);
  clampSpeed(ballB);
  return impact;
};
