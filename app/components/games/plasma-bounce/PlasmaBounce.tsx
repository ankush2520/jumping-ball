"use client";

import React, { useCallback, useEffect, useRef } from "react";
import {
  BALL_RADIUS,
  BALL_SPEED,
  BOUNCE_JITTER,
  BOUNCE_SPEED,
  CIRCLE_RADIUS,
  COOLDOWN_MS,
  DRAG,
  MAX_BALLS,
  MAX_SPEED,
  RESTITUTION,
  TANGENTIAL_IMPULSE,
} from "./config";
import {
  applyDrag,
  clampSpeed,
  collideBalls,
  createBall,
  reflectBoundary,
  updatePosition,
  type Ball,
} from "./physics/ball";
import { playCollisionSound, prepareCollisionSound } from "./sound/sound";

type Arena = {
  width: number;
  height: number;
  dpr: number;
  centerX: number;
  centerY: number;
  circleRadius: number;
};

const resizeCanvas = (canvas: HTMLCanvasElement): Arena => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = window.visualViewport;
  const width = Math.round(viewport?.width ?? window.innerWidth);
  const height = Math.round(viewport?.height ?? window.innerHeight);
  const circleRadius = Math.min(CIRCLE_RADIUS, width * 0.42, height * 0.38);
  const ctx = canvas.getContext("2d");

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  if (ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }

  return {
    width,
    height,
    dpr,
    centerX: width / 2,
    centerY: height / 2,
    circleRadius,
  };
};

const createInitialBalls = (arena: Arena): Ball[] => [
  createBall(
    arena.centerX - arena.circleRadius * 0.28,
    arena.centerY,
    BALL_SPEED,
    BALL_SPEED * 0.18,
    BALL_RADIUS,
    "#67e8f9",
  ),
  createBall(
    arena.centerX + arena.circleRadius * 0.28,
    arena.centerY,
    -BALL_SPEED,
    -BALL_SPEED * 0.22,
    BALL_RADIUS,
    "#f9a8d4",
  ),
];

const drawScene = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  balls: Ball[],
) => {
  ctx.clearRect(0, 0, arena.width, arena.height);

  const background = ctx.createRadialGradient(
    arena.centerX,
    arena.centerY,
    0,
    arena.centerX,
    arena.centerY,
    Math.max(arena.width, arena.height) * 0.68,
  );
  background.addColorStop(0, "#182554");
  background.addColorStop(0.46, "#0f172a");
  background.addColorStop(1, "#020617");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, arena.width, arena.height);

  ctx.save();
  ctx.translate(arena.centerX, arena.centerY);
  ctx.strokeStyle = "rgba(125, 211, 252, 0.32)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(34, 211, 238, 0.42)";
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(0, 0, arena.circleRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(248, 250, 252, 0.08)";
  for (
    let radius = arena.circleRadius * 0.25;
    radius < arena.circleRadius;
    radius += arena.circleRadius * 0.25
  ) {
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = "rgba(248, 250, 252, 0.82)";
  ctx.font = "700 18px Arial, Helvetica, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    "Collision of 2 balls gives birth to new ball",
    arena.centerX,
    arena.centerY - arena.circleRadius - 32,
  );

  balls.forEach((ball) => {
    const glow = ctx.createRadialGradient(
      ball.x - ball.radius * 0.35,
      ball.y - ball.radius * 0.35,
      ball.radius * 0.2,
      ball.x,
      ball.y,
      ball.radius * 2.8,
    );
    glow.addColorStop(0, "#ffffff");
    glow.addColorStop(0.28, ball.color);
    glow.addColorStop(1, "rgba(15, 23, 42, 0)");

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius * 2.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = ball.color;
    ctx.shadowColor = ball.color;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  });
};

const PlasmaBounce = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const arenaRef = useRef<Arena | null>(null);
  const ballsRef = useRef<Ball[]>([]);
  const runningRef = useRef(true);

  const resetSimulation = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const arena = resizeCanvas(canvas);
    const ctx = canvas.getContext("2d");
    arenaRef.current = arena;
    ballsRef.current = createInitialBalls(arena);
    runningRef.current = true;

    if (ctx) drawScene(ctx, arena, ballsRef.current);
  }, []);

  useEffect(() => {
    prepareCollisionSound();
    resetSimulation();

    const handleResize = () => {
      resetSimulation();
    };

    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, [resetSimulation]);

  useEffect(() => {
    const tick = () => {
      const canvas = canvasRef.current;
      const arena = arenaRef.current;
      const ctx = canvas?.getContext("2d");

      if (ctx && arena) {
        const balls = ballsRef.current;

        if (runningRef.current) {
          const now = Date.now();
          let wallCollisionCount = 0;

          balls.forEach((ball) => {
            updatePosition(ball);
            applyDrag(ball, DRAG);
            clampSpeed(ball, MAX_SPEED);

            const distanceFromCenter = Math.hypot(
              ball.x - arena.centerX,
              ball.y - arena.centerY,
            );
            if (distanceFromCenter >= arena.circleRadius - ball.radius) {
              wallCollisionCount += 1;
            }

            reflectBoundary(ball, {
              centerX: arena.centerX,
              centerY: arena.centerY,
              circleRadius: arena.circleRadius,
              bounceSpeed: BOUNCE_SPEED,
              bounceJitter: BOUNCE_JITTER,
              tangentialImpulse: TANGENTIAL_IMPULSE,
              restitution: RESTITUTION,
              maxSpeed: MAX_SPEED,
              drag: DRAG,
            });
          });

          let collisionCount = 0;
          for (let i = 0; i < balls.length; i += 1) {
            for (let j = i + 1; j < balls.length; j += 1) {
              const result = collideBalls(
                balls[i],
                balls[j],
                BOUNCE_SPEED,
                BOUNCE_JITTER,
                TANGENTIAL_IMPULSE,
                RESTITUTION,
                MAX_SPEED,
                COOLDOWN_MS,
                now,
                balls,
                MAX_BALLS,
                BALL_RADIUS,
              );

              if (result?.collided) {
                collisionCount += 1;
                if (result.newBall) balls.push(result.newBall);
              }
            }
          }

          const totalSoundCollisions = collisionCount + wallCollisionCount;
          if (totalSoundCollisions > 0) {
            try {
              playCollisionSound(
                Math.min(1, 0.28 + totalSoundCollisions * 0.06),
              );
            } catch {
              // Sound is optional; the simulation should keep running without it.
            }
          }
        }

        drawScene(ctx, arena, balls);
      }

      animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  return (
    <div className="plasma-bounce-root">
      <canvas
        ref={canvasRef}
        className="plasma-bounce-canvas"
        aria-label="Plasma Bounce simulation"
      />
      <style jsx>{`
        .plasma-bounce-root {
          position: fixed;
          inset: 0;
          width: 100%;
          height: 100dvh;
          overflow: hidden;
          background: #020617;
        }

        .plasma-bounce-canvas {
          position: fixed;
          inset: 0;
          width: 100dvw !important;
          height: 100dvh !important;
          min-height: 100dvh !important;
        }
      `}</style>
    </div>
  );
};

export default PlasmaBounce;
