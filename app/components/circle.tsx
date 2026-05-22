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
};

type GravityWell = {
  x: number;
  y: number;
  strength: number;
  radius: number;
  createdAt: number;
};

type Arena = {
  width: number;
  height: number;
  dpr: number;
};

const BALL_COUNT = 18;
const MIN_RADIUS = 8;
const MAX_RADIUS = 24;
const WALL_RESTITUTION = 0.94;
const BALL_RESTITUTION = 0.92;
const MAX_SPEED = 620;
const WELL_STRENGTH = 82000;
const WELL_SOFTENING = 5200;
const SWIRL_FORCE = 34;
const MAX_WELLS = 5;

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

const createBall = (arena: Arena, index: number): GravityBall => {
  const radius = randomBetween(MIN_RADIUS, MAX_RADIUS);
  const angle = randomBetween(0, Math.PI * 2);
  const orbitRadius = randomBetween(
    Math.min(arena.width, arena.height) * 0.14,
    Math.min(arena.width, arena.height) * 0.38,
  );
  const speed = randomBetween(90, 260);
  const tone = palette[index % palette.length];

  return {
    x: arena.width / 2 + Math.cos(angle) * orbitRadius,
    y: arena.height / 2 + Math.sin(angle) * orbitRadius,
    vx: Math.cos(angle + Math.PI / 2) * speed + randomBetween(-70, 70),
    vy: Math.sin(angle + Math.PI / 2) * speed + randomBetween(-70, 70),
    radius,
    mass: radius * radius,
    color: tone.color,
    glow: tone.glow,
  };
};

const createWell = (x: number, y: number, createdAt: number): GravityWell => ({
  x,
  y,
  strength: WELL_STRENGTH,
  radius: 150,
  createdAt,
});

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
  const impulseX = impulse * nx;
  const impulseY = impulse * ny;

  ballA.vx -= impulseX / ballA.mass;
  ballA.vy -= impulseY / ballA.mass;
  ballB.vx += impulseX / ballB.mass;
  ballB.vy += impulseY / ballB.mass;

  clampSpeed(ballA);
  clampSpeed(ballB);
};

const drawBackground = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  time: number,
  alpha = 1,
) => {
  const { width, height } = arena;
  ctx.save();
  ctx.globalAlpha = alpha;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#050814");
  gradient.addColorStop(0.48, "#070b1f");
  gradient.addColorStop(1, "#03131d");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = "rgba(125, 249, 255, 0.08)";
  ctx.lineWidth = 1;
  const grid = 72;
  const offset = (time * 10) % grid;
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
  ctx.restore();

  const wellGlow = ctx.createRadialGradient(
    width / 2,
    height / 2,
    20,
    width / 2,
    height / 2,
    Math.min(width, height) * 0.46,
  );
  wellGlow.addColorStop(0, "rgba(125, 249, 255, 0.18)");
  wellGlow.addColorStop(0.26, "rgba(96, 165, 250, 0.08)");
  wellGlow.addColorStop(0.62, "rgba(168, 85, 247, 0.05)");
  wellGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = wellGlow;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
};

const drawWell = (
  ctx: CanvasRenderingContext2D,
  well: GravityWell,
  time: number,
) => {
  const age = Math.max(0, time - well.createdAt);
  const entrance = Math.min(1, age / 0.35);
  const pulse = Math.sin(time * 2.4 + well.x * 0.01) * 0.5 + 0.5;
  const rippleRadius = well.radius * (0.38 + pulse * 0.18);
  const coreRadius = 18 + pulse * 3;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.translate(well.x, well.y);
  ctx.scale(entrance, entrance);

  const light = ctx.createRadialGradient(0, 0, 0, 0, 0, well.radius * 1.45);
  light.addColorStop(0, `rgba(255, 255, 255, ${0.16 + pulse * 0.05})`);
  light.addColorStop(0.12, "rgba(125, 249, 255, 0.2)");
  light.addColorStop(0.32, "rgba(96, 165, 250, 0.08)");
  light.addColorStop(0.58, "rgba(88, 28, 135, 0.055)");
  light.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = light;
  ctx.fillRect(
    -well.radius * 1.5,
    -well.radius * 1.5,
    well.radius * 3,
    well.radius * 3,
  );

  const distortion = ctx.createRadialGradient(0, 0, coreRadius, 0, 0, well.radius);
  distortion.addColorStop(0, "rgba(0, 0, 0, 0)");
  distortion.addColorStop(0.36, "rgba(125, 249, 255, 0.035)");
  distortion.addColorStop(0.44, "rgba(255, 255, 255, 0.12)");
  distortion.addColorStop(0.5, "rgba(125, 249, 255, 0.035)");
  distortion.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = distortion;
  ctx.fillRect(-well.radius, -well.radius, well.radius * 2, well.radius * 2);

  ctx.strokeStyle = `rgba(125, 249, 255, ${0.08 + pulse * 0.04})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, rippleRadius, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < 16; i++) {
    const lane = i % 4;
    const angle = -time * (1.1 + lane * 0.16) + i * ((Math.PI * 2) / 16);
    const radius =
      well.radius * (0.18 + lane * 0.07) +
      Math.sin(time * 2 + i) * 4;
    const size = 1 + lane * 0.35;
    const alpha = 0.34 + (3 - lane) * 0.08;
    ctx.fillStyle =
      i % 2 === 0
        ? `rgba(125, 249, 255, ${alpha})`
        : `rgba(167, 139, 250, ${alpha * 0.8})`;
    ctx.beginPath();
    ctx.arc(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      size,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  const accretion = ctx.createRadialGradient(0, 0, coreRadius, 0, 0, 62);
  accretion.addColorStop(0, "rgba(0, 0, 0, 0)");
  accretion.addColorStop(0.24, "rgba(255, 255, 255, 0.3)");
  accretion.addColorStop(0.38, "rgba(125, 249, 255, 0.22)");
  accretion.addColorStop(0.62, "rgba(96, 165, 250, 0.08)");
  accretion.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = accretion;
  ctx.beginPath();
  ctx.arc(0, 0, 64, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalCompositeOperation = "source-over";
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, coreRadius * 1.6);
  core.addColorStop(0, "rgba(0, 0, 0, 1)");
  core.addColorStop(0.52, "rgba(1, 4, 12, 0.98)");
  core.addColorStop(0.7, "rgba(6, 182, 212, 0.22)");
  core.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, coreRadius * 1.7, 0, Math.PI * 2);
  ctx.fill();
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
  const wellsRef = useRef<GravityWell[]>([]);
  const arenaRef = useRef<Arena>({ width: 0, height: 0, dpr: 1 });
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const resetArena = () => {
      arenaRef.current = resizeCanvas(canvas);
      if (ballsRef.current.length === 0) {
        ballsRef.current = Array.from({ length: BALL_COUNT }, (_, index) =>
          createBall(arenaRef.current, index),
        );
        wellsRef.current = [
          createWell(
            arenaRef.current.width / 2,
            arenaRef.current.height / 2,
            performance.now() / 1000,
          ),
        ];
      } else {
        ballsRef.current.forEach((ball) => {
          ball.x = Math.min(
            Math.max(ball.x, ball.radius),
            arenaRef.current.width - ball.radius,
          );
          ball.y = Math.min(
            Math.max(ball.y, ball.radius),
            arenaRef.current.height - ball.radius,
          );
        });
        wellsRef.current.forEach((well) => {
          well.x = Math.min(Math.max(well.x, 0), arenaRef.current.width);
          well.y = Math.min(Math.max(well.y, 0), arenaRef.current.height);
        });
      }
    };

    const addWell = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      wellsRef.current = [
        ...wellsRef.current.slice(-(MAX_WELLS - 1)),
        createWell(x, y, performance.now() / 1000),
      ];
    };

    const stepPhysics = (dt: number) => {
      const arena = arenaRef.current;

      ballsRef.current.forEach((ball) => {
        wellsRef.current.forEach((well) => {
          const dx = well.x - ball.x;
          const dy = well.y - ball.y;
          const distanceSq = dx * dx + dy * dy + WELL_SOFTENING;
          const distance = Math.sqrt(distanceSq);
          const influence = Math.min(1, (well.radius * well.radius * 4) / distanceSq);
          const gravity = (well.strength * influence) / distanceSq;
          const nx = dx / distance;
          const ny = dy / distance;
          const swirl = SWIRL_FORCE * influence;

          ball.vx += (nx * gravity + -ny * swirl) * dt;
          ball.vy += (ny * gravity + nx * swirl) * dt;
        });
        ball.vx *= 0.999;
        ball.vy *= 0.999;
        clampSpeed(ball);

        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
        resolveWallCollision(ball, arena);
      });

      for (let i = 0; i < ballsRef.current.length; i++) {
        for (let j = i + 1; j < ballsRef.current.length; j++) {
          resolveBallCollision(ballsRef.current[i], ballsRef.current[j]);
        }
      }
    };

    const animate = (timeMs: number) => {
      const arena = arenaRef.current;
      const time = timeMs / 1000;
      const previous = lastTimeRef.current || timeMs;
      const dt = Math.min((timeMs - previous) / 1000, 0.032);
      lastTimeRef.current = timeMs;

      ctx.setTransform(arena.dpr, 0, 0, arena.dpr, 0, 0);

      ctx.fillStyle = "rgba(3, 7, 18, 0.2)";
      ctx.fillRect(0, 0, arena.width, arena.height);
      drawBackground(ctx, arena, time, 0.24);
      stepPhysics(dt);
      wellsRef.current.forEach((well) => drawWell(ctx, well, time));
      ballsRef.current.forEach((ball) => drawBall(ctx, ball));

      animationRef.current = requestAnimationFrame(animate);
    };

    resetArena();
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", addWell);
    window.addEventListener("resize", resetArena);
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      canvas.removeEventListener("pointerdown", addWell);
      window.removeEventListener("resize", resetArena);
    };
  }, []);

  return (
    <div className="gravity-well">
      <canvas ref={canvasRef} className="gravity-canvas" />
      <div className="gravity-hud" aria-hidden="true">
        <span>Gravity Well</span>
        <strong>Left click to create wells</strong>
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
