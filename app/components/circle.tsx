"use client";

import React, { useEffect, useRef } from "react";

type GravityBall = {
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

type CycleState = {
  phase: "running" | "collapse" | "explosion";
  phaseStartedAt: number;
  shockwaveAt: number;
};

const BALL_COUNT = 26;
const BALL_SPEED_SCALE = 1.2;
const MIN_RADIUS = 7;
const MAX_RADIUS = 19;
const BASE_HOLE_RADIUS = 18;
const BASE_GRAVITY = 52000;
const WALL_RESTITUTION = 0.94;
const BALL_RESTITUTION = 0.9;
const MAX_SPEED = 880;
const MIN_SPEED = 140;
const COLLAPSE_PAUSE = 0.9;
const EXPLOSION_TIME = 1.25;

const palette = [
  { color: "#67e8f9", glow: "rgba(103, 232, 249, 0.62)" },
  { color: "#60a5fa", glow: "rgba(96, 165, 250, 0.58)" },
  { color: "#a78bfa", glow: "rgba(167, 139, 250, 0.58)" },
  { color: "#22d3ee", glow: "rgba(34, 211, 238, 0.56)" },
  { color: "#f0abfc", glow: "rgba(240, 171, 252, 0.5)" },
];

const randomBetween = (min: number, max: number) =>
  min + Math.random() * (max - min);

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

const createOrbitBall = (arena: Arena, index: number): GravityBall => {
  const radius = randomBetween(MIN_RADIUS, MAX_RADIUS);
  const angle = randomBetween(0, Math.PI * 2);
  const orbitRadius = randomBetween(
    Math.min(arena.width, arena.height) * 0.22,
    Math.min(arena.width, arena.height) * 0.45,
  );
  const speed = randomBetween(120, 285);
  const tone = palette[index % palette.length];

  return {
    x: arena.width / 2 + Math.cos(angle) * orbitRadius,
    y: arena.height / 2 + Math.sin(angle) * orbitRadius,
    vx:
      (Math.cos(angle + Math.PI / 2) * speed + randomBetween(-90, 90)) *
      BALL_SPEED_SCALE,
    vy:
      (Math.sin(angle + Math.PI / 2) * speed + randomBetween(-90, 90)) *
      BALL_SPEED_SCALE,
    radius,
    mass: radius * radius,
    color: tone.color,
    glow: tone.glow,
    slowTime: 0,
  };
};

const createExplosionBall = (arena: Arena, index: number): GravityBall => {
  const radius = randomBetween(MIN_RADIUS, MAX_RADIUS);
  const angle = (index / BALL_COUNT) * Math.PI * 2 + randomBetween(-0.16, 0.16);
  const speed = randomBetween(430, 760);
  const tone = palette[index % palette.length];

  return {
    x: arena.width / 2 + Math.cos(angle) * (BASE_HOLE_RADIUS + radius + 4),
    y: arena.height / 2 + Math.sin(angle) * (BASE_HOLE_RADIUS + radius + 4),
    vx: (Math.cos(angle) * speed + randomBetween(-70, 70)) * BALL_SPEED_SCALE,
    vy: (Math.sin(angle) * speed + randomBetween(-70, 70)) * BALL_SPEED_SCALE,
    radius,
    mass: radius * radius,
    color: tone.color,
    glow: tone.glow,
    slowTime: 0,
  };
};

const resizeCanvas = (canvas: HTMLCanvasElement): Arena => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  return { width, height, dpr };
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

  ctx.save();
  ctx.globalAlpha = alpha;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#030712");
  gradient.addColorStop(0.5, "#06091d");
  gradient.addColorStop(1, "#020b12");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

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
  const coreRadius = blackHole.radius;
  const ringRadius = coreRadius * (2.05 + pulse * 0.08);
  const collapseBoost = cycle.phase === "collapse" ? 1.35 : 1;

  ctx.save();
  ctx.translate(blackHole.x, blackHole.y);
  ctx.globalCompositeOperation = "lighter";

  const halo = ctx.createRadialGradient(0, 0, coreRadius, 0, 0, coreRadius * 8);
  halo.addColorStop(0, `rgba(255, 255, 255, ${0.14 + massRatio * 0.08})`);
  halo.addColorStop(0.1, `rgba(125, 249, 255, ${0.2 + massRatio * 0.18})`);
  halo.addColorStop(0.36, `rgba(96, 165, 250, ${0.08 + massRatio * 0.12})`);
  halo.addColorStop(0.66, `rgba(168, 85, 247, ${0.04 + massRatio * 0.08})`);
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
  time: number,
) => {
  if (cycle.shockwaveAt <= 0) return;
  const age = time - cycle.shockwaveAt;
  if (age < 0 || age > EXPLOSION_TIME) return;

  const progress = age / EXPLOSION_TIME;
  const radius = Math.max(arena.width, arena.height) * progress;
  const alpha = 1 - progress;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = `rgba(125, 249, 255, ${0.55 * alpha})`;
  ctx.lineWidth = 2 + 12 * alpha;
  ctx.beginPath();
  ctx.arc(arena.width / 2, arena.height / 2, radius, 0, Math.PI * 2);
  ctx.stroke();

  const flash = ctx.createRadialGradient(
    arena.width / 2,
    arena.height / 2,
    0,
    arena.width / 2,
    arena.height / 2,
    Math.min(arena.width, arena.height) * (0.18 + progress * 0.52),
  );
  flash.addColorStop(0, `rgba(255, 255, 255, ${0.34 * alpha})`);
  flash.addColorStop(0.18, `rgba(125, 249, 255, ${0.28 * alpha})`);
  flash.addColorStop(0.48, `rgba(167, 139, 250, ${0.16 * alpha})`);
  flash.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = flash;
  ctx.fillRect(0, 0, arena.width, arena.height);
  ctx.restore();
};

const drawBall = (ctx: CanvasRenderingContext2D, ball: GravityBall) => {
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

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.shadowColor = ball.glow;
  ctx.shadowBlur = ball.radius * 2.2;
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = ball.radius;
  ctx.strokeStyle = ball.glow;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
};

const Circle = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ballsRef = useRef<GravityBall[]>([]);
  const blackHoleRef = useRef<BlackHole | null>(null);
  const arenaRef = useRef<Arena>({ width: 0, height: 0, dpr: 1 });
  const cycleRef = useRef<CycleState>({
    phase: "running",
    phaseStartedAt: 0,
    shockwaveAt: -Infinity,
  });
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const spawnOrbitBalls = () => {
      ballsRef.current = Array.from({ length: BALL_COUNT }, (_, index) =>
        createOrbitBall(arenaRef.current, index),
      );
    };

    const respawnFromExplosion = (time: number) => {
      ballsRef.current = Array.from({ length: BALL_COUNT }, (_, index) =>
        createExplosionBall(arenaRef.current, index),
      );
      blackHoleRef.current = createBlackHole(arenaRef.current);
      cycleRef.current = {
        phase: "explosion",
        phaseStartedAt: time,
        shockwaveAt: time,
      };
    };

    const resetArena = () => {
      arenaRef.current = resizeCanvas(canvas);
      blackHoleRef.current = createBlackHole(arenaRef.current);
      spawnOrbitBalls();
      cycleRef.current = {
        phase: "running",
        phaseStartedAt: performance.now() / 1000,
        shockwaveAt: -Infinity,
      };
    };

    const absorbBall = (blackHole: BlackHole, ball: GravityBall) => {
      blackHole.mass += 1;
      blackHole.targetRadius += Math.max(2.2, ball.radius * 0.24);
      blackHole.strength += 19000 + ball.mass * 14;
    };

    const stepPhysics = (dt: number, time: number) => {
      const arena = arenaRef.current;
      const blackHole = blackHoleRef.current;
      const cycle = cycleRef.current;
      if (!blackHole) return;

      blackHole.x = arena.width / 2;
      blackHole.y = arena.height / 2;
      blackHole.radius += (blackHole.targetRadius - blackHole.radius) * 0.055;

      if (cycle.phase === "collapse") {
        blackHole.targetRadius += dt * 7;
        blackHole.strength += dt * 78000;
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
        blackHole.strength += dt * (2500 + blackHole.mass * 260);
      }

      const survivors: GravityBall[] = [];
      ballsRef.current.forEach((ball) => {
        const dx = blackHole.x - ball.x;
        const dy = blackHole.y - ball.y;
        const actualDistance = Math.hypot(dx, dy) || 1;
        const nx = dx / actualDistance;
        const ny = dy / actualDistance;
        const influenceRadius = blackHole.radius * 7;

        if (
          cycle.phase === "running" &&
          actualDistance < blackHole.radius + ball.radius
        ) {
          absorbBall(blackHole, ball);
          return;
        }

        if (actualDistance < influenceRadius) {
          const distanceFactor = 1 - actualDistance / influenceRadius;
          const gravityStrength =
            blackHole.strength * (blackHole.radius / BASE_HOLE_RADIUS);
          const force = gravityStrength * distanceFactor * dt * 0.012;
          const tangent =
            (58 + blackHole.mass * 3.4) *
            (blackHole.radius / BASE_HOLE_RADIUS) *
            distanceFactor;

          ball.vx += nx * force + -ny * tangent * dt;
          ball.vy += ny * force + nx * tangent * dt;
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
          if (postMoveDistance < blackHole.radius + ball.radius) {
            absorbBall(blackHole, ball);
            return;
          }
        }

        enforceMinimumSpeed(ball, blackHole, dt);
        clampSpeed(ball);

        if (
          cycle.phase === "running" &&
          Math.hypot(ball.x - blackHole.x, ball.y - blackHole.y) <
            blackHole.radius + ball.radius
        ) {
          absorbBall(blackHole, ball);
          return;
        }

        survivors.push(ball);
      });

      ballsRef.current = survivors;

      for (let i = 0; i < ballsRef.current.length; i++) {
        for (let j = i + 1; j < ballsRef.current.length; j++) {
          resolveBallCollision(ballsRef.current[i], ballsRef.current[j]);
        }
      }

      ballsRef.current.forEach((ball) => {
        enforceMinimumSpeed(ball, blackHole, dt);
        clampSpeed(ball);
      });

      if (cycle.phase === "running" && ballsRef.current.length === 0) {
        cycleRef.current = {
          phase: "collapse",
          phaseStartedAt: time,
          shockwaveAt: cycle.shockwaveAt,
        };
      }
    };

    const animate = (timeMs: number) => {
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
        Math.max(0, 1 - explosionAge / 0.42) * 12;
      const shakeX = shake ? randomBetween(-shake, shake) : 0;
      const shakeY = shake ? randomBetween(-shake, shake) : 0;

      ctx.setTransform(arena.dpr, 0, 0, arena.dpr, shakeX, shakeY);
      ctx.fillStyle = "rgba(3, 7, 18, 0.18)";
      ctx.fillRect(-shakeX, -shakeY, arena.width + 24, arena.height + 24);
      drawBackground(ctx, arena, time, blackHole, 0.24);

      stepPhysics(dt, time);
      drawBlackHole(ctx, blackHole, time, cycleRef.current);
      ballsRef.current.forEach((ball) => drawBall(ctx, ball));
      drawExplosion(ctx, arena, cycleRef.current, time);

      animationRef.current = requestAnimationFrame(animate);
    };

    resetArena();
    window.addEventListener("resize", resetArena);
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      window.removeEventListener("resize", resetArena);
    };
  }, []);

  return (
    <div className="gravity-well">
      <canvas ref={canvasRef} className="gravity-canvas" />
      <div className="gravity-hud" aria-hidden="true">
        <span>Gravity Well</span>
        <strong>Absorb. Collapse. Reignite.</strong>
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

        .gravity-hud {
          position: fixed;
          right: 22px;
          bottom: 22px;
          z-index: 5;
          display: grid;
          gap: 4px;
          padding: 12px 14px;
          border: 1px solid rgba(125, 249, 255, 0.18);
          border-radius: 14px;
          background: rgba(3, 7, 18, 0.48);
          color: rgba(226, 246, 255, 0.72);
          font-family: var(--font-geist-mono), monospace;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          backdrop-filter: blur(10px);
        }

        .gravity-hud span {
          font-size: 0.68rem;
        }

        .gravity-hud strong {
          color: #e0faff;
          font-size: 0.78rem;
        }

        @media (max-width: 640px) {
          .gravity-hud {
            right: 14px;
            bottom: 14px;
            padding: 10px 12px;
          }
        }
      `}</style>
    </div>
  );
};

export default Circle;
