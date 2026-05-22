"use client";

import React, { useEffect, useRef, useState } from "react";

type GravityBall = {
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

type ExplosionParticle = {
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

type TrailParticle = {
  active: boolean;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  radius: number;
  color: string;
};

type ShockwaveRing = {
  active: boolean;
  age: number;
  duration: number;
  maxRadius: number;
  width: number;
  alpha: number;
};

type HudStats = {
  mass: number;
  stability: number;
  charge: number;
  stage: string;
};

type BlackHole = {
  x: number;
  y: number;
  radius: number;
  targetRadius: number;
  strength: number;
  mass: number;
};

type Arena = {
  width: number;
  height: number;
  dpr: number;
};

type PhysicsScale = {
  mobileScale: number;
  speedScale: number;
  gravityScale: number;
  growthScale: number;
  minCycleTime: number;
};

type CycleState = {
  phase: "running" | "collapse" | "explosion";
  phaseStartedAt: number;
  shockwaveAt: number;
};

const performanceMode = true;
const MAX_BALLS = 40;
const MAX_EXPLOSION_PARTICLES = 70;
const MAX_TRAIL_PARTICLES = 120;
const MAX_SHOCKWAVES = 3;
const BALL_COUNT = Math.min(26, MAX_BALLS);
const BALL_SPEED_SCALE = 1.2;
const MIN_RADIUS = 7;
const MAX_RADIUS = 19;
const BASE_HOLE_RADIUS = 18;
const BASE_GRAVITY = 52000;
const WALL_RESTITUTION = 0.94;
const BALL_RESTITUTION = 0.9;
const MAX_SPEED = 880;
const MIN_SPEED = 140;
const COLLAPSE_PAUSE = 1.3;
const CONTRACTION_PAUSE = 0.4;
const EXPLOSION_TIME = 1.25;
const EXPLOSION_PARTICLE_COUNT = performanceMode ? 44 : 56;
const EXPLOSION_LAUNCH_SCALE = 1.35;
const FLASH_DURATION = 0.16;
const SHAKE_DURATION = 0.34;
const TARGET_FPS = performanceMode ? 45 : 60;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
const DPR_CAP = performanceMode ? 1.5 : 2;
const HUD_UPDATE_INTERVAL = 0.18;

const palette = [
  { color: "#67e8f9", glow: "rgba(103, 232, 249, 0.62)" },
  { color: "#60a5fa", glow: "rgba(96, 165, 250, 0.58)" },
  { color: "#a78bfa", glow: "rgba(167, 139, 250, 0.58)" },
  { color: "#22d3ee", glow: "rgba(34, 211, 238, 0.56)" },
  { color: "#f0abfc", glow: "rgba(240, 171, 252, 0.5)" },
];

const getHungerStage = (absorbedCount: number) => {
  if (absorbedCount >= 20) return "Critical";
  if (absorbedCount >= 14) return "Voracious";
  if (absorbedCount >= 8) return "Hungry";
  if (absorbedCount >= 3) return "Awake";
  return "Dormant";
};

const randomBetween = (min: number, max: number) =>
  min + Math.random() * (max - min);

const createBlankBall = (): GravityBall => ({
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

const createBlankExplosionParticle = (): ExplosionParticle => ({
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

const createBlankTrailParticle = (): TrailParticle => ({
  active: false,
  x: 0,
  y: 0,
  life: 0,
  maxLife: 1,
  radius: 1,
  color: "rgba(125, 249, 255, ALPHA)",
});

const createBlankShockwave = (): ShockwaveRing => ({
  active: false,
  age: 0,
  duration: 0.68,
  maxRadius: 0,
  width: 8,
  alpha: 0.5,
});

const clampSpeed = (ball: GravityBall) => {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed <= MAX_SPEED) return;
  const scale = MAX_SPEED / speed;
  ball.vx *= scale;
  ball.vy *= scale;
};

const enforceMinimumSpeed = (
  ball: GravityBall,
  blackHole: BlackHole,
  dt: number,
) => {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed >= MIN_SPEED) {
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
  const boostScale = MIN_SPEED / Math.max(speed, 1);

  ball.vx = directionX * speed * boostScale;
  ball.vy = directionY * speed * boostScale;
  ball.slowTime += dt;

  if (ball.slowTime > 0.5) {
    const impulse = MIN_SPEED * 0.42;
    const massScale = blackHole.radius / BASE_HOLE_RADIUS;
    ball.vx += (-ny * 0.75 - nx * 0.25) * impulse * massScale;
    ball.vy += (nx * 0.75 - ny * 0.25) * impulse * massScale;
    ball.slowTime = 0;
  }
};

const createBlackHole = (arena: Arena): BlackHole => ({
  x: arena.width / 2,
  y: arena.height / 2,
  radius: BASE_HOLE_RADIUS,
  targetRadius: BASE_HOLE_RADIUS,
  strength: BASE_GRAVITY,
  mass: 1,
});

const resetOrbitBall = (
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

const resetExplosionBall = (
  ball: GravityBall,
  arena: Arena,
  index: number,
  speedScale: number,
) => {
  const radius = randomBetween(MIN_RADIUS, MAX_RADIUS);
  const angle = (index / BALL_COUNT) * Math.PI * 2 + randomBetween(-0.16, 0.16);
  const speed = randomBetween(430, 760);
  const tone = palette[index % palette.length];

  ball.active = true;
  ball.x = arena.width / 2 + Math.cos(angle) * (BASE_HOLE_RADIUS + radius + 4);
  ball.y = arena.height / 2 + Math.sin(angle) * (BASE_HOLE_RADIUS + radius + 4);
  ball.vx =
      (Math.cos(angle) * speed + randomBetween(-70, 70)) *
      BALL_SPEED_SCALE *
      EXPLOSION_LAUNCH_SCALE *
      speedScale;
  ball.vy =
    (Math.sin(angle) * speed + randomBetween(-70, 70)) *
    BALL_SPEED_SCALE *
    EXPLOSION_LAUNCH_SCALE *
    speedScale;
  ball.radius = radius;
  ball.mass = radius * radius;
  ball.color = tone.color;
  ball.glow = tone.glow;
  ball.slowTime = 0;
};

const resizeCanvas = (canvas: HTMLCanvasElement): Arena => {
  const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
  const width = window.innerWidth;
  const height = window.innerHeight;

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  return { width, height, dpr };
};

const getPhysicsScale = (arena: Arena): PhysicsScale => {
  const minDim = Math.min(arena.width, arena.height);
  const mobileScale = Math.min(1, minDim / 900);
  const isMobile = mobileScale < 0.82;

  return {
    mobileScale,
    speedScale: 0.6 + mobileScale * 0.4,
    gravityScale: 0.45 + mobileScale * 0.55,
    growthScale: 0.55 + mobileScale * 0.45,
    minCycleTime: isMobile ? 9 : 6,
  };
};

const resolveWallCollision = (ball: GravityBall, arena: Arena) => {
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

const resolveBallCollision = (ballA: GravityBall, ballB: GravityBall) => {
  const dx = ballB.x - ballA.x;
  const dy = ballB.y - ballA.y;
  const distance = Math.hypot(dx, dy) || 1;
  const minDistance = ballA.radius + ballB.radius;

  if (distance >= minDistance) return;

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

  if (velocityAlongNormal > 0) return;

  const impulse =
    (-(1 + BALL_RESTITUTION) * velocityAlongNormal) /
    (1 / ballA.mass + 1 / ballB.mass);

  ballA.vx -= (impulse * nx) / ballA.mass;
  ballA.vy -= (impulse * ny) / ballA.mass;
  ballB.vx += (impulse * nx) / ballB.mass;
  ballB.vy += (impulse * ny) / ballB.mass;

  clampSpeed(ballA);
  clampSpeed(ballB);
};

const drawBackground = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  time: number,
  blackHole: BlackHole,
  alpha = 1,
) => {
  const { width, height } = arena;
  const massGlow = Math.min(1, (blackHole.mass - 1) / BALL_COUNT);
  const darkening = 0.08 + massGlow * 0.32;

  ctx.save();
  ctx.globalAlpha = alpha;
  if (performanceMode) {
    const darkness = Math.max(4, Math.round(8 - massGlow * 5));
    ctx.fillStyle = `rgb(3, ${darkness}, ${Math.round(18 - massGlow * 8)})`;
  } else {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#030712");
    gradient.addColorStop(0.5, "#06091d");
    gradient.addColorStop(1, "#020b12");
    ctx.fillStyle = gradient;
  }
  ctx.fillRect(0, 0, width, height);

  if (!performanceMode) {
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "rgba(125, 249, 255, 0.06)";
    ctx.lineWidth = 1;
    const grid = 82;
    const offset = (time * (7 + massGlow * 12)) % grid;
    for (let x = -grid + offset; x < width + grid; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = -grid + offset; y < height + grid; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = alpha;
  const glow = ctx.createRadialGradient(
    blackHole.x,
    blackHole.y,
    blackHole.radius,
    blackHole.x,
    blackHole.y,
    Math.min(width, height) * (0.42 + massGlow * 0.16),
  );
  glow.addColorStop(0, `rgba(125, 249, 255, ${0.12 + massGlow * 0.16})`);
  glow.addColorStop(0.28, `rgba(96, 165, 250, ${0.07 + massGlow * 0.09})`);
  glow.addColorStop(0.62, `rgba(168, 85, 247, ${0.035 + massGlow * 0.06})`);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = `rgba(0, 0, 0, ${darkening * alpha})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
};

const drawBlackHole = (
  ctx: CanvasRenderingContext2D,
  blackHole: BlackHole,
  time: number,
  cycle: CycleState,
) => {
  const massRatio = Math.min(1, (blackHole.mass - 1) / BALL_COUNT);
  const pulse = Math.sin(time * (2.1 + massRatio)) * 0.5 + 0.5;
  const explosionAge = time - cycle.shockwaveAt;
  const explosionPulse =
    explosionAge >= 0 ? Math.max(0, 1 - explosionAge / 0.5) : 0;
  const coreRadius = blackHole.radius;
  const ringRadius = coreRadius * (2.05 + pulse * 0.08);
  const collapseBoost =
    (cycle.phase === "collapse" ? 1.35 : 1) + explosionPulse * 1.25;

  ctx.save();
  ctx.translate(blackHole.x, blackHole.y);
  ctx.globalCompositeOperation = "lighter";

  const halo = ctx.createRadialGradient(
    0,
    0,
    coreRadius,
    0,
    0,
    coreRadius * (8 + explosionPulse * 5),
  );
  halo.addColorStop(
    0,
    `rgba(255, 255, 255, ${0.14 + massRatio * 0.08 + explosionPulse * 0.18})`,
  );
  halo.addColorStop(
    0.1,
    `rgba(125, 249, 255, ${0.2 + massRatio * 0.18 + explosionPulse * 0.24})`,
  );
  halo.addColorStop(
    0.36,
    `rgba(96, 165, 250, ${0.08 + massRatio * 0.12 + explosionPulse * 0.14})`,
  );
  halo.addColorStop(
    0.66,
    `rgba(168, 85, 247, ${0.04 + massRatio * 0.08 + explosionPulse * 0.1})`,
  );
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(-coreRadius * 8, -coreRadius * 8, coreRadius * 16, coreRadius * 16);

  ctx.save();
  ctx.rotate(time * (0.42 + massRatio * 0.24));
  const accretion = ctx.createRadialGradient(0, 0, coreRadius, 0, 0, ringRadius * 1.55);
  accretion.addColorStop(0, "rgba(0, 0, 0, 0)");
  accretion.addColorStop(0.34, `rgba(255, 255, 255, ${0.22 * collapseBoost})`);
  accretion.addColorStop(0.43, `rgba(125, 249, 255, ${0.28 * collapseBoost})`);
  accretion.addColorStop(0.54, `rgba(167, 139, 250, ${0.16 * collapseBoost})`);
  accretion.addColorStop(0.72, "rgba(0, 0, 0, 0)");
  ctx.scale(1.45, 0.38);
  ctx.fillStyle = accretion;
  ctx.beginPath();
  ctx.arc(0, 0, ringRadius * 1.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const distortion = ctx.createRadialGradient(0, 0, coreRadius * 0.9, 0, 0, coreRadius * 4.2);
  distortion.addColorStop(0, "rgba(0, 0, 0, 0)");
  distortion.addColorStop(0.46, `rgba(255, 255, 255, ${0.09 + massRatio * 0.08})`);
  distortion.addColorStop(0.52, `rgba(125, 249, 255, ${0.04 + massRatio * 0.06})`);
  distortion.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = distortion;
  ctx.beginPath();
  ctx.arc(0, 0, coreRadius * 4.2, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 28; i++) {
    const lane = i % 5;
    const angle = -time * (1.2 + lane * 0.18 + massRatio * 0.7) + i * 0.84;
    const radius = coreRadius * (1.55 + lane * 0.38) + Math.sin(time * 2 + i) * 5;
    const size = 0.9 + lane * 0.22;
    const alpha = 0.22 + massRatio * 0.2 + (4 - lane) * 0.025;
    ctx.fillStyle =
      i % 2 === 0
        ? `rgba(125, 249, 255, ${alpha})`
        : `rgba(167, 139, 250, ${alpha * 0.8})`;
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * radius, Math.sin(angle) * radius, size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = "source-over";
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, coreRadius * 1.45);
  core.addColorStop(0, "rgba(0, 0, 0, 1)");
  core.addColorStop(0.62, "rgba(0, 0, 0, 0.98)");
  core.addColorStop(0.74, `rgba(6, 182, 212, ${0.24 + massRatio * 0.18})`);
  core.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, coreRadius * 1.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const drawExplosion = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  cycle: CycleState,
  particles: ExplosionParticle[],
  shockwaves: ShockwaveRing[],
  time: number,
  dt: number,
) => {
  if (cycle.shockwaveAt <= 0) return;
  const age = time - cycle.shockwaveAt;
  if (age < 0) return;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (let i = 0; i < shockwaves.length; i++) {
    const ring = shockwaves[i];
    if (!ring.active) continue;

    ring.age += dt;
    if (ring.age < 0) continue;
    if (ring.age >= ring.duration) {
      ring.active = false;
      continue;
    }

    const progress = ring.age / ring.duration;
    const alpha = (1 - progress) * ring.alpha;
    if (alpha > 0) {
      ctx.strokeStyle = `rgba(125, 249, 255, ${alpha})`;
      ctx.lineWidth = 1 + ring.width * (1 - progress);
      ctx.beginPath();
      ctx.arc(
        arena.width / 2,
        arena.height / 2,
        ring.maxRadius * progress,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
  }

  if (age <= EXPLOSION_TIME) {
    if (age < FLASH_DURATION) {
      const flashAlpha = 0.25 * (1 - age / FLASH_DURATION);
      ctx.fillStyle = `rgba(220, 252, 255, ${flashAlpha})`;
      ctx.fillRect(0, 0, arena.width, arena.height);
    }
  }

  for (let i = 0; i < particles.length; i++) {
    const particle = particles[i];
    if (!particle.active) continue;

    particle.life -= dt;
    if (particle.life <= 0) {
      particle.active = false;
      continue;
    }

    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= 0.992;
    particle.vy *= 0.992;

    const alpha = particle.life / particle.maxLife;
    const tailX = particle.x - particle.vx * 0.018;
    const tailY = particle.y - particle.vy * 0.018;
    ctx.strokeStyle = particle.color.replace("ALPHA", `${0.48 * alpha}`);
    ctx.lineWidth = particle.radius;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(particle.x, particle.y);
    ctx.stroke();

    ctx.fillStyle = particle.color.replace("ALPHA", `${0.72 * alpha}`);
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
};

const drawBall = (ctx: CanvasRenderingContext2D, ball: GravityBall) => {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  if (!performanceMode || ball.radius > 14) {
    ctx.shadowColor = ball.glow;
    ctx.shadowBlur = ball.radius * (performanceMode ? 1.1 : 2.2);
  }

  if (performanceMode && ball.radius <= 14) {
    ctx.fillStyle = ball.color;
  } else {
    const body = ctx.createRadialGradient(
      ball.x - ball.radius * 0.34,
      ball.y - ball.radius * 0.42,
      ball.radius * 0.1,
      ball.x,
      ball.y,
      ball.radius,
    );
    body.addColorStop(0, "rgba(255, 255, 255, 0.95)");
    body.addColorStop(0.22, ball.color);
    body.addColorStop(1, "rgba(2, 6, 23, 0.85)");
    ctx.fillStyle = body;
  }

  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = !performanceMode || ball.radius > 14 ? ball.radius * 0.6 : 0;
  ctx.strokeStyle = ball.glow;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
};

const drawTrails = (
  ctx: CanvasRenderingContext2D,
  trails: TrailParticle[],
  dt: number,
) => {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (let i = 0; i < trails.length; i++) {
    const trail = trails[i];
    if (!trail.active) continue;

    trail.life -= dt;
    if (trail.life <= 0) {
      trail.active = false;
      continue;
    }

    const alpha = trail.life / trail.maxLife;
    ctx.fillStyle = trail.color.replace("ALPHA", `${0.2 * alpha}`);
    ctx.beginPath();
    ctx.arc(trail.x, trail.y, trail.radius * (0.8 + alpha), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
};

const Circle = () => {
  const [hudStats, setHudStats] = useState<HudStats>({
    mass: 1,
    stability: 100,
    charge: 0,
    stage: "Dormant",
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ballsRef = useRef<GravityBall[]>(
    Array.from({ length: MAX_BALLS }, createBlankBall),
  );
  const explosionParticlesRef = useRef<ExplosionParticle[]>(
    Array.from({ length: MAX_EXPLOSION_PARTICLES }, createBlankExplosionParticle),
  );
  const trailParticlesRef = useRef<TrailParticle[]>(
    Array.from({ length: MAX_TRAIL_PARTICLES }, createBlankTrailParticle),
  );
  const shockwavesRef = useRef<ShockwaveRing[]>(
    Array.from({ length: MAX_SHOCKWAVES }, createBlankShockwave),
  );
  const blackHoleRef = useRef<BlackHole | null>(null);
  const arenaRef = useRef<Arena>({ width: 0, height: 0, dpr: 1 });
  const cycleRef = useRef<CycleState>({
    phase: "running",
    phaseStartedAt: 0,
    shockwaveAt: -Infinity,
  });
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const lastHudUpdateRef = useRef<number>(0);
  const pausedRef = useRef<boolean>(false);
  const trailCursorRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const spawnOrbitBalls = () => {
      const balls = ballsRef.current;
      const scale = getPhysicsScale(arenaRef.current);
      for (let i = 0; i < balls.length; i++) {
        if (i < BALL_COUNT) {
          resetOrbitBall(balls[i], arenaRef.current, i, scale.speedScale);
        } else {
          balls[i].active = false;
        }
      }
    };

    const emitExplosionParticles = () => {
      const arena = arenaRef.current;
      const particles = explosionParticlesRef.current;

      for (let i = 0; i < particles.length; i++) {
        const particle = particles[i];
        if (i >= EXPLOSION_PARTICLE_COUNT) {
          particle.active = false;
          continue;
        }

        const angle =
          (i / EXPLOSION_PARTICLE_COUNT) * Math.PI * 2 +
          randomBetween(-0.12, 0.12);
        const speed = randomBetween(520, 980);
        const life = randomBetween(0.5, 0.9);
        particle.active = true;
        particle.x = arena.width / 2;
        particle.y = arena.height / 2;
        particle.vx = Math.cos(angle) * speed;
        particle.vy = Math.sin(angle) * speed;
        particle.life = life;
        particle.maxLife = life;
        particle.radius = randomBetween(1.2, 2.4);
        particle.color =
          i % 3 === 0
            ? "rgba(255, 255, 255, ALPHA)"
            : i % 3 === 1
              ? "rgba(125, 249, 255, ALPHA)"
              : "rgba(167, 139, 250, ALPHA)";
      }
    };

    const emitShockwaves = () => {
      const shockwaves = shockwavesRef.current;
      const maxDimension = Math.max(arenaRef.current.width, arenaRef.current.height);
      for (let i = 0; i < shockwaves.length; i++) {
        const ring = shockwaves[i];
        if (i > (performanceMode ? 1 : 2)) {
          ring.active = false;
          continue;
        }

        ring.active = true;
        ring.age = -i * 0.08;
        ring.duration = 0.68 + i * 0.08;
        ring.maxRadius = maxDimension * (0.62 + i * 0.18);
        ring.width = 11 - i * 2;
        ring.alpha = i === 0 ? 0.72 : 0.42;
      }
    };

    const respawnFromExplosion = (time: number) => {
      const balls = ballsRef.current;
      const scale = getPhysicsScale(arenaRef.current);
      for (let i = 0; i < balls.length; i++) {
        if (i < BALL_COUNT) {
          resetExplosionBall(balls[i], arenaRef.current, i, scale.speedScale);
        } else {
          balls[i].active = false;
        }
      }
      blackHoleRef.current = createBlackHole(arenaRef.current);
      emitExplosionParticles();
      emitShockwaves();
      cycleRef.current = {
        phase: "explosion",
        phaseStartedAt: time,
        shockwaveAt: time,
      };
    };

    const resetArena = () => {
      arenaRef.current = resizeCanvas(canvas);
      blackHoleRef.current = createBlackHole(arenaRef.current);
      for (let i = 0; i < explosionParticlesRef.current.length; i++) {
        explosionParticlesRef.current[i].active = false;
      }
      for (let i = 0; i < trailParticlesRef.current.length; i++) {
        trailParticlesRef.current[i].active = false;
      }
      for (let i = 0; i < shockwavesRef.current.length; i++) {
        shockwavesRef.current[i].active = false;
      }
      spawnOrbitBalls();
      cycleRef.current = {
        phase: "running",
        phaseStartedAt: performance.now() / 1000,
        shockwaveAt: -Infinity,
      };
    };

    const absorbBall = (blackHole: BlackHole, ball: GravityBall) => {
      const scale = getPhysicsScale(arenaRef.current);
      ball.active = false;
      blackHole.mass += 1;
      blackHole.targetRadius +=
        Math.max(2.2, ball.radius * 0.24) * scale.growthScale;
      blackHole.strength += (19000 + ball.mass * 14) * scale.growthScale;
    };

    const emitTrail = (ball: GravityBall) => {
      if (performanceMode && Math.random() < 0.45) return;

      const trails = trailParticlesRef.current;
      const trail = trails[trailCursorRef.current];
      trailCursorRef.current = (trailCursorRef.current + 1) % trails.length;

      trail.active = true;
      trail.x = ball.x;
      trail.y = ball.y;
      trail.life = performanceMode ? 0.28 : 0.42;
      trail.maxLife = trail.life;
      trail.radius = Math.max(2, ball.radius * 0.42);
      trail.color = ball.glow.replace(/[\d.]+\)$/, "ALPHA)");
    };

    const emitEscapeStreak = (ball: GravityBall, intensity: number) => {
      const trails = trailParticlesRef.current;
      const trail = trails[trailCursorRef.current];
      trailCursorRef.current = (trailCursorRef.current + 1) % trails.length;

      trail.active = true;
      trail.x = ball.x - ball.vx * 0.018;
      trail.y = ball.y - ball.vy * 0.018;
      trail.life = 0.34;
      trail.maxLife = 0.34;
      trail.radius = Math.max(3, ball.radius * (0.7 + intensity * 0.35));
      trail.color = "rgba(220, 252, 255, ALPHA)";
    };

    const stepPhysics = (dt: number, time: number) => {
      const arena = arenaRef.current;
      const blackHole = blackHoleRef.current;
      const cycle = cycleRef.current;
      if (!blackHole) return;
      const scale = getPhysicsScale(arena);

      blackHole.x = arena.width / 2;
      blackHole.y = arena.height / 2;
      blackHole.radius += (blackHole.targetRadius - blackHole.radius) * 0.055;

      if (cycle.phase === "collapse") {
        const collapseAge = time - cycle.phaseStartedAt;
        const contractionProgress = Math.min(1, collapseAge / CONTRACTION_PAUSE);
        blackHole.targetRadius -= dt * 18 * (1 - contractionProgress);
        blackHole.targetRadius = Math.max(
          BASE_HOLE_RADIUS * 0.7,
          blackHole.targetRadius,
        );
        if (collapseAge > CONTRACTION_PAUSE) {
          blackHole.targetRadius += dt * 8 * scale.growthScale;
          blackHole.strength += dt * 78000 * scale.gravityScale;
        }
        if (time - cycle.phaseStartedAt > COLLAPSE_PAUSE) {
          respawnFromExplosion(time);
          return;
        }
      } else if (cycle.phase === "explosion") {
        if (time - cycle.phaseStartedAt > EXPLOSION_TIME) {
          cycleRef.current = {
            phase: "running",
            phaseStartedAt: time,
            shockwaveAt: cycle.shockwaveAt,
          };
        }
      } else {
        const cycleAge = time - cycle.phaseStartedAt;
        const earlyCycleDamping =
          cycleAge < scale.minCycleTime
            ? 0.55 + 0.45 * (cycleAge / scale.minCycleTime)
            : 1;
        blackHole.strength +=
          dt *
          (2500 + blackHole.mass * 260) *
          scale.gravityScale *
          earlyCycleDamping;
      }

      let activeCount = 0;
      const balls = ballsRef.current;
      for (let i = 0; i < balls.length; i++) {
        const ball = balls[i];
        if (!ball.active) continue;

        const dx = blackHole.x - ball.x;
        const dy = blackHole.y - ball.y;
        const actualDistance = Math.hypot(dx, dy) || 1;
        const nx = dx / actualDistance;
        const ny = dy / actualDistance;
        const influenceRadius = blackHole.radius * 7 * scale.gravityScale;
        const absorbRadius = blackHole.radius + ball.radius * 0.6;

        if (
          cycle.phase === "running" &&
          actualDistance < absorbRadius
        ) {
          absorbBall(blackHole, ball);
          continue;
        }

        if (actualDistance < influenceRadius) {
          const cycleAge = time - cycle.phaseStartedAt;
          const earlyCycleDamping =
            cycle.phase === "running" && cycleAge < scale.minCycleTime
              ? 0.55 + 0.45 * (cycleAge / scale.minCycleTime)
              : 1;
          const distanceFactor = 1 - actualDistance / influenceRadius;
          const gravityStrength =
            blackHole.strength *
            (blackHole.radius / BASE_HOLE_RADIUS) *
            scale.gravityScale *
            earlyCycleDamping;
          const force = gravityStrength * distanceFactor * dt * 0.012;
          const tangent =
            (58 + blackHole.mass * 3.4) *
            (blackHole.radius / BASE_HOLE_RADIUS) *
            scale.gravityScale *
            distanceFactor;

          ball.vx += nx * force + -ny * tangent * dt;
          ball.vy += ny * force + nx * tangent * dt;

          const radialVelocity = ball.vx * nx + ball.vy * ny;
          if (
            radialVelocity < -80 &&
            actualDistance < absorbRadius * 2.9 &&
            actualDistance > absorbRadius * 1.12
          ) {
            emitEscapeStreak(
              ball,
              Math.min(1, Math.abs(radialVelocity) / Math.max(1, MAX_SPEED)),
            );
          }
        }

        ball.vx *= 0.999;
        ball.vy *= 0.999;
        clampSpeed(ball);

        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
        resolveWallCollision(ball, arena);

        if (cycle.phase === "running") {
          const postMoveDistance = Math.hypot(
            ball.x - blackHole.x,
            ball.y - blackHole.y,
          );
          if (postMoveDistance < absorbRadius) {
            absorbBall(blackHole, ball);
            continue;
          }
        }

        enforceMinimumSpeed(ball, blackHole, dt);
        clampSpeed(ball);

        if (
          cycle.phase === "running" &&
          Math.hypot(ball.x - blackHole.x, ball.y - blackHole.y) <
            absorbRadius
        ) {
          absorbBall(blackHole, ball);
          continue;
        }

        emitTrail(ball);
        activeCount += 1;
      }

      for (let i = 0; i < balls.length; i++) {
        if (!balls[i].active) continue;
        for (let j = i + 1; j < balls.length; j++) {
          if (!balls[j].active) continue;
          resolveBallCollision(balls[i], balls[j]);
        }
      }

      for (let i = 0; i < balls.length; i++) {
        const ball = balls[i];
        if (!ball.active) continue;
        enforceMinimumSpeed(ball, blackHole, dt);
        clampSpeed(ball);
      }

      if (
        cycle.phase === "running" &&
        activeCount === 0 &&
        time - cycle.phaseStartedAt >= scale.minCycleTime
      ) {
        cycleRef.current = {
          phase: "collapse",
          phaseStartedAt: time,
          shockwaveAt: cycle.shockwaveAt,
        };
      }
    };

    const updateHud = (time: number) => {
      const blackHole = blackHoleRef.current;
      const cycle = cycleRef.current;
      if (!blackHole || time - lastHudUpdateRef.current < HUD_UPDATE_INTERVAL) {
        return;
      }

      lastHudUpdateRef.current = time;
      const absorbedCount = Math.max(0, Math.round(blackHole.mass - 1));
      const stability =
        cycle.phase === "collapse"
          ? Math.max(0, Math.round(100 * (1 - (time - cycle.phaseStartedAt) / COLLAPSE_PAUSE)))
          : Math.max(0, Math.round(100 - (absorbedCount / BALL_COUNT) * 86));
      const charge =
        cycle.phase === "collapse"
          ? Math.min(100, Math.round(((time - cycle.phaseStartedAt) / COLLAPSE_PAUSE) * 100))
          : Math.min(100, Math.round((absorbedCount / BALL_COUNT) * 100));

      setHudStats({
        mass: absorbedCount,
        stability,
        charge,
        stage: getHungerStage(absorbedCount),
      });
    };

    const animate = (timeMs: number) => {
      if (pausedRef.current) return;
      if (
        lastFrameRef.current > 0 &&
        timeMs - lastFrameRef.current < FRAME_INTERVAL_MS
      ) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }
      lastFrameRef.current = timeMs;

      const arena = arenaRef.current;
      const blackHole = blackHoleRef.current;
      const cycle = cycleRef.current;
      if (!blackHole) return;

      const time = timeMs / 1000;
      const previous = lastTimeRef.current || timeMs;
      const dt = Math.min((timeMs - previous) / 1000, 0.032);
      lastTimeRef.current = timeMs;

      const collapseAge =
        cycle.phase === "collapse" ? time - cycle.phaseStartedAt : 0;
      const explosionAge = time - cycle.shockwaveAt;
      const shake =
        Math.max(0, 1 - collapseAge / COLLAPSE_PAUSE) *
          (cycle.phase === "collapse" ? 5 : 0) +
        Math.max(0, 1 - explosionAge / SHAKE_DURATION) * 7;
      const shakeX = shake ? randomBetween(-shake, shake) : 0;
      const shakeY = shake ? randomBetween(-shake, shake) : 0;

      ctx.setTransform(arena.dpr, 0, 0, arena.dpr, shakeX, shakeY);
      ctx.fillStyle = "rgba(3, 7, 18, 0.18)";
      ctx.fillRect(-shakeX, -shakeY, arena.width + 24, arena.height + 24);
      drawBackground(ctx, arena, time, blackHole, 0.24);

      stepPhysics(dt, time);
      updateHud(time);
      drawBlackHole(ctx, blackHole, time, cycleRef.current);
      drawTrails(ctx, trailParticlesRef.current, dt);
      for (let i = 0; i < ballsRef.current.length; i++) {
        const ball = ballsRef.current[i];
        if (ball.active) drawBall(ctx, ball);
      }
      drawExplosion(
        ctx,
        arena,
        cycleRef.current,
        explosionParticlesRef.current,
        shockwavesRef.current,
        time,
        dt,
      );

      animationRef.current = requestAnimationFrame(animate);
    };

    resetArena();
    const handleVisibilityChange = () => {
      if (document.hidden) {
        pausedRef.current = true;
        if (animationRef.current !== null) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = null;
        }
        return;
      }

      pausedRef.current = false;
      lastTimeRef.current = 0;
      lastFrameRef.current = 0;
      animationRef.current = requestAnimationFrame(animate);
    };

    window.addEventListener("resize", resetArena);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      window.removeEventListener("resize", resetArena);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return (
    <div className="gravity-well">
      <canvas ref={canvasRef} className="gravity-canvas" />
      <div className="gravity-stats" aria-label="Black hole status">
        <div>
          <span>Mass</span>
          <strong>{hudStats.mass.toString().padStart(2, "0")}</strong>
        </div>
        <div>
          <span>Stability</span>
          <strong>{hudStats.stability}%</strong>
        </div>
        <div>
          <span>Supernova</span>
          <strong>{hudStats.charge}%</strong>
        </div>
        <p>{hudStats.stage}</p>
      </div>
      <style jsx>{`
        .gravity-well {
          position: fixed;
          inset: 0;
          min-height: 100vh;
          overflow: hidden;
          background: #030712;
        }

        .gravity-canvas {
          display: block;
          width: 100%;
          height: 100%;
        }

        .gravity-stats {
          position: fixed;
          left: 18px;
          bottom: 18px;
          z-index: 5;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          min-width: min(460px, calc(100vw - 36px));
          padding: 12px 14px;
          border: 1px solid rgba(125, 249, 255, 0.14);
          border-radius: 16px;
          background: rgba(3, 7, 18, 0.46);
          color: rgba(226, 246, 255, 0.72);
          font-family: var(--font-geist-mono), monospace;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          backdrop-filter: blur(8px);
        }

        .gravity-stats div {
          display: grid;
          gap: 4px;
        }

        .gravity-stats span {
          font-size: 0.62rem;
        }

        .gravity-stats strong {
          color: #e0faff;
          font-size: 0.92rem;
        }

        .gravity-stats p {
          grid-column: 1 / -1;
          margin: 0;
          color: #67e8f9;
          font-size: 0.68rem;
        }

        @media (max-width: 640px) {
          .gravity-stats {
            left: 12px;
            right: 12px;
            bottom: 12px;
            min-width: 0;
            gap: 8px;
            padding: 10px 12px;
          }

          .gravity-stats strong {
            font-size: 0.8rem;
          }
        }
      `}</style>
    </div>
  );
};

export default Circle;
