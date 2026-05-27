"use client";

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  lastCollision: number;
}

export interface PhysicsParams {
  centerX: number;
  centerY: number;
  circleRadius: number;
  bounceSpeed: number;
  bounceJitter: number;
  tangentialImpulse: number;
  restitution: number;
  maxSpeed: number;
  drag: number;
}

const randomInRange = (min: number, max: number) =>
  min + Math.random() * (max - min);

const vectorLength = (x: number, y: number) => Math.sqrt(x * x + y * y);

const normalize = (x: number, y: number) => {
  const length = vectorLength(x, y) || 1;
  return { x: x / length, y: y / length };
};

const clampVector = (vx: number, vy: number, maxSpeed: number) => {
  const speed = vectorLength(vx, vy);
  if (speed <= maxSpeed) return { vx, vy };
  const factor = maxSpeed / speed;
  return { vx: vx * factor, vy: vy * factor };
};

const randomBallColor = () => {
  const hue = Math.floor(Math.random() * 360);
  const saturation = 65 + Math.random() * 15;
  const lightness = 50 + Math.random() * 10;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

export const createBall = (
  x: number,
  y: number,
  vx: number,
  vy: number,
  radius: number,
  color = randomBallColor(),
): Ball => ({
  x,
  y,
  vx,
  vy,
  radius,
  color,
  lastCollision: 0,
});

export const updatePosition = (ball: Ball) => {
  ball.x += ball.vx;
  ball.y += ball.vy;
};

export const applyDrag = (ball: Ball, drag: number) => {
  ball.vx *= drag;
  ball.vy *= drag;
};

export const clampSpeed = (ball: Ball, maxSpeed: number) => {
  const { vx, vy } = clampVector(ball.vx, ball.vy, maxSpeed);
  ball.vx = vx;
  ball.vy = vy;
};

export const setBallSpeed = (ball: Ball, targetSpeed: number) => {
  const speed = vectorLength(ball.vx, ball.vy) || 1;
  const factor = targetSpeed / speed;
  ball.vx *= factor;
  ball.vy *= factor;
};

export const reflectBoundary = (ball: Ball, params: PhysicsParams) => {
  const {
    centerX,
    centerY,
    circleRadius,
    bounceSpeed,
    bounceJitter,
    tangentialImpulse,
    restitution,
    maxSpeed,
  } = params;
  const dx = ball.x - centerX;
  const dy = ball.y - centerY;
  const distance = vectorLength(dx, dy);
  const maxDistance = circleRadius - ball.radius;
  if (distance <= maxDistance) return;

  const { x: nx, y: ny } = normalize(dx, dy);
  // push ball to boundary surface
  ball.x = centerX + nx * maxDistance;
  ball.y = centerY + ny * maxDistance;

  // reflect current velocity about normal
  const dotProduct = ball.vx * nx + ball.vy * ny;
  const reflectX = ball.vx - 2 * dotProduct * nx;
  const reflectY = ball.vy - 2 * dotProduct * ny;

  // restitution (with slight random jitter) and tangential kick
  const e = restitution * randomInRange(1 - bounceJitter, 1 + bounceJitter);
  const { x: tx, y: ty } = { x: -ny, y: nx };
  const tangential = randomInRange(-0.5, 0.5) * tangentialImpulse;

  // apply restitution to reflected velocity and add tangential component
  const vx = reflectX * e + tx * tangential;
  const vy = reflectY * e + ty * tangential;

  const finalSpeed = Math.min(bounceSpeed, maxSpeed);
  const { x: nrmX, y: nrmY } = normalize(vx, vy);
  ball.vx = nrmX * finalSpeed;
  ball.vy = nrmY * finalSpeed;
};

export type CollisionResult = {
  newBall: Ball | null;
  collided: boolean;
};

export const collideBalls = (
  ball1: Ball,
  ball2: Ball,
  bounceSpeed: number,
  bounceJitter: number,
  tangentialImpulse: number,
  restitution: number,
  maxSpeed: number,
  cooldownMs: number,
  now: number,
  ballsArray: Ball[],
  maxBalls: number,
  ballRadius: number,
): CollisionResult | null => {
  const dx = ball2.x - ball1.x;
  const dy = ball2.y - ball1.y;
  const distance = vectorLength(dx, dy);
  const minDistance = ball1.radius + ball2.radius;
  if (distance >= minDistance) return null;

  const { x: nx, y: ny } = distance === 0 ? { x: 1, y: 0 } : normalize(dx, dy);
  const { x: tx, y: ty } = { x: -ny, y: nx };
  const overlap = minDistance - distance;

  // positional correction to separate overlapping balls
  ball1.x -= (overlap / 2) * nx;
  ball1.y -= (overlap / 2) * ny;
  ball2.x += (overlap / 2) * nx;
  ball2.y += (overlap / 2) * ny;

  // masses proportional to area (radius^2)
  const m1 = Math.max(1, ball1.radius * ball1.radius);
  const m2 = Math.max(1, ball2.radius * ball2.radius);

  // relative velocity
  const rvx = ball2.vx - ball1.vx;
  const rvy = ball2.vy - ball1.vy;
  const velAlongNormal = rvx * nx + rvy * ny;

  // only resolve if moving towards each other
  if (velAlongNormal > 0) {
    // still record collision but do not apply impulse if separating
  }

  // restitution with jitter
  const e = restitution * randomInRange(1 - bounceJitter, 1 + bounceJitter);

  // impulse scalar (standard impulse resolution)
  const j = (-(1 + e) * velAlongNormal) / (1 / m1 + 1 / m2 || 1);
  const impulseX = j * nx;
  const impulseY = j * ny;

  // apply normal impulse
  ball1.vx -= impulseX / m1;
  ball1.vy -= impulseY / m1;
  ball2.vx += impulseX / m2;
  ball2.vy += impulseY / m2;

  // add small tangential/random kick to simulate surface friction/roughness
  const tangential1 = randomInRange(-0.5, 0.5) * tangentialImpulse;
  const tangential2 = randomInRange(-0.5, 0.5) * tangentialImpulse;
  ball1.vx += tx * tangential1;
  ball1.vy += ty * tangential1;
  ball2.vx += tx * tangential2;
  ball2.vy += ty * tangential2;

  setBallSpeed(ball1, Math.min(bounceSpeed, maxSpeed));
  setBallSpeed(ball2, Math.min(bounceSpeed, maxSpeed));

  const canSpawn =
    ball1.lastCollision < now - cooldownMs &&
    ball2.lastCollision < now - cooldownMs;
  let spawned: Ball | null = null;

  if (ballsArray.length < maxBalls && canSpawn) {
    const midX = (ball1.x + ball2.x) / 2 + randomInRange(-3, 3);
    const midY = (ball1.y + ball2.y) / 2 + randomInRange(-3, 3);
    const angle =
      Math.atan2(ball2.y - ball1.y, ball2.x - ball1.x) +
      randomInRange(-0.4, 0.4);
    const speed = Math.min(bounceSpeed, maxSpeed) * randomInRange(0.98, 1.02);

    spawned = createBall(
      Math.max(midX, ballRadius),
      Math.max(midY, ballRadius),
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      ballRadius,
    );
  }

  ball1.lastCollision = now;
  ball2.lastCollision = now;

  return { newBall: spawned, collided: true };
};
