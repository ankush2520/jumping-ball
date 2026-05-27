import { BASE_GRAVITY, BINARY_DAMPING, BINARY_GRAVITY, BINARY_SOFTENING } from "../constants";
import type { Arena, BlackHole, GravityBall } from "../types";

export const randomBetween = (min: number, max: number) =>
  min + Math.random() * (max - min);

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const getHungerStage = (absorbedCount: number) => {
  if (absorbedCount >= 20) return "Critical";
  if (absorbedCount >= 14) return "Voracious";
  if (absorbedCount >= 8) return "Hungry";
  if (absorbedCount >= 3) return "Awake";
  return "Dormant";
};

export const getAbsorbedCount = (
  blackHole: BlackHole | null,
  secondBlackHole: BlackHole | null,
) =>
  Math.max(
    0,
    Math.round(
      (blackHole?.mass ?? 0) +
        (secondBlackHole?.active ? secondBlackHole.mass : 0) -
        (secondBlackHole?.active ? 2 : 1),
    ),
  );

export const createPlacedBlackHole = (
  arena: Arena,
  x: number,
  y: number,
): BlackHole => {
  const isMobile = arena.width < 600;
  const margin = Math.min(
    120,
    Math.max(48, Math.min(arena.width, arena.height) * 0.28),
  );
  const initialRadius = isMobile ? 2.2 : 3;
  const targetRadius = isMobile ? 5.8 : 9;

  return {
    active: true,
    x: clamp(x, margin, arena.width - margin),
    y: clamp(y, margin, arena.height - margin),
    vx: 0,
    vy: 0,
    radius: initialRadius,
    targetRadius,
    strength: BASE_GRAVITY * 0.05,
    mass: 1,
    rotationAngle: randomBetween(0, Math.PI * 2),
    rotationSpeed: randomBetween(0.42, 0.52),
  };
};

export const pickDominantBlackHole = (
  first: BlackHole | null,
  second: BlackHole | null,
  ball: GravityBall,
) => {
  if (!first?.active) return null;
  if (!second?.active) return first;

  const firstDx = first.x - ball.x;
  const firstDy = first.y - ball.y;
  const secondDx = second.x - ball.x;
  const secondDy = second.y - ball.y;
  const firstScore =
    (first.mass + first.radius * 0.35) /
    (firstDx * firstDx + firstDy * firstDy + BINARY_SOFTENING);
  const secondScore =
    (second.mass + second.radius * 0.35) /
    (secondDx * secondDx + secondDy * secondDy + BINARY_SOFTENING);

  return secondScore > firstScore ? second : first;
};

export const stepBinaryBlackHolePair = (
  first: BlackHole,
  second: BlackHole,
  arena: Arena,
  dt: number,
) => {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const distance = Math.hypot(dx, dy) || 1;
  const nx = dx / distance;
  const ny = dy / distance;
  const firstMass = Math.max(6, first.mass + first.radius * 0.42);
  const secondMass = Math.max(6, second.mass + second.radius * 0.42);
  const force =
    (BINARY_GRAVITY * firstMass * secondMass) /
    (distance * distance + BINARY_SOFTENING);

  first.vx += (nx * force * dt) / firstMass;
  first.vy += (ny * force * dt) / firstMass;
  second.vx -= (nx * force * dt) / secondMass;
  second.vy -= (ny * force * dt) / secondMass;

  first.vx *= BINARY_DAMPING;
  first.vy *= BINARY_DAMPING;
  second.vx *= BINARY_DAMPING;
  second.vy *= BINARY_DAMPING;

  first.x += first.vx * dt;
  first.y += first.vy * dt;
  second.x += second.vx * dt;
  second.y += second.vy * dt;

  const margin = Math.min(
    96,
    Math.max(42, Math.min(arena.width, arena.height) * 0.18),
  );
  first.x = clamp(first.x, margin, arena.width - margin);
  first.y = clamp(first.y, margin, arena.height - margin);
  second.x = clamp(second.x, margin, arena.width - margin);
  second.y = clamp(second.y, margin, arena.height - margin);

  return distance < first.radius + second.radius * 0.9;
};

export const mergeBlackHolePair = (first: BlackHole, second: BlackHole) => {
  const totalMass = first.mass + second.mass;
  const x = (first.x * first.mass + second.x * second.mass) / totalMass;
  const y = (first.y * first.mass + second.y * second.mass) / totalMass;
  const mergedRadius = Math.sqrt(
    first.radius * first.radius + second.radius * second.radius,
  );

  first.x = x;
  first.y = y;
  first.vx = (first.vx * first.mass + second.vx * second.mass) / totalMass;
  first.vy = (first.vy * first.mass + second.vy * second.mass) / totalMass;
  first.mass = totalMass;
  first.radius = mergedRadius;
  first.targetRadius = Math.max(first.targetRadius, mergedRadius + 4);
  first.strength += second.strength * 0.82;
  first.rotationSpeed += 0.16;
  second.active = false;

  return { x, y };
};
