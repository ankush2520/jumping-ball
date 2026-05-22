"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Ball,
  createBall,
  updatePosition,
  reflectBoundary,
  clampSpeed,
  collideBalls,
} from "../scripts/ball";
import {
  CIRCLE_RADIUS,
  BALL_RADIUS,
  BOUNCE_SPEED,
  BALL_SPEED,
  BOUNCE_JITTER,
  TANGENTIAL_IMPULSE,
  DRAG,
  MAX_SPEED,
  COOLDOWN_MS,
  RESTITUTION,
  MAX_BALLS,
} from "../scripts/config";
import { playCollisionSound } from "../scripts/sound";
import StartButton from "./StartButton";
import ResetButton from "./ResetButton";

const Circle = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ballsRef = useRef<Ball[]>([]);
  const animationRef = useRef<number | null>(null);
  const [gameStarted, setGameStarted] = useState(false);

  const getCircleRadius = (width: number, height: number) =>
    Math.min(CIRCLE_RADIUS, Math.min(width, height) * 0.42);

  const makeInitialBalls = (
    width: number,
    height: number,
    circleRadius: number,
  ) => {
    const offsetX = Math.min(80, circleRadius * 0.4);
    const offsetY = Math.min(100, circleRadius * 0.55);
    return [
      createBall(
        width / 2 - offsetX,
        height / 2 - offsetY,
        BALL_SPEED,
        0,
        BALL_RADIUS,
      ),
      createBall(
        width / 2 + offsetX,
        height / 2 - offsetY * 0.8,
        -BALL_SPEED,
        0,
        BALL_RADIUS,
      ),
    ];
  };

  // constants are imported from ../scripts/config

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const physicsRef = {
      centerX: window.innerWidth / 2,
      centerY: window.innerHeight / 2,
      circleRadius: getCircleRadius(window.innerWidth, window.innerHeight),
      bounceSpeed: BOUNCE_SPEED,
      bounceJitter: BOUNCE_JITTER,
      tangentialImpulse: TANGENTIAL_IMPULSE,
      restitution: RESTITUTION,
      maxSpeed: MAX_SPEED,
      drag: DRAG,
    } as any;

    const setSize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      physicsRef.centerX = window.innerWidth / 2;
      physicsRef.centerY = window.innerHeight / 2;
      physicsRef.circleRadius = getCircleRadius(
        window.innerWidth,
        window.innerHeight,
      );
    };
    // touch-friendly behavior
    canvas.style.touchAction = "none";

    // Initialize size and balls
    setSize();
    ballsRef.current = makeInitialBalls(
      window.innerWidth,
      window.innerHeight,
      physicsRef.circleRadius,
    );

    const drawCircle = (ctx: CanvasRenderingContext2D) => {
      ctx.strokeStyle = "red";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(
        physicsRef.centerX,
        physicsRef.centerY,
        physicsRef.circleRadius,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    };

    const drawBall = (ctx: CanvasRenderingContext2D, ball: Ball) => {
      ctx.fillStyle = ball.color;
      ctx.shadowColor = ball.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    };
    const updateBalls = () => {
      // Track which collisions have spawned a ball this frame to avoid duplicates
      const spawnedPairs = new Set<string>();

      // per-ball updates
      ballsRef.current.forEach((ball) => {
        updatePosition(ball);
        reflectBoundary(ball, physicsRef);
        // ensure small speed clamp after drag
        clampSpeed(ball, MAX_SPEED);
      });

      // ball-to-ball collisions and spawning
      const now = Date.now();

      for (let i = 0; i < ballsRef.current.length; i++) {
        for (let j = i + 1; j < ballsRef.current.length; j++) {
          const ball1 = ballsRef.current[i];
          const ball2 = ballsRef.current[j];
          const pairKey = `${i}-${j}`;
          const relV = Math.sqrt(
            (ball1.vx - ball2.vx) * (ball1.vx - ball2.vx) +
              (ball1.vy - ball2.vy) * (ball1.vy - ball2.vy),
          );
          const intensity = Math.min(1, relV / MAX_SPEED);
          const result = collideBalls(
            ball1,
            ball2,
            BOUNCE_SPEED,
            BOUNCE_JITTER,
            TANGENTIAL_IMPULSE,
            RESTITUTION,
            MAX_SPEED,
            COOLDOWN_MS,
            now,
            ballsRef.current,
            MAX_BALLS,
            BALL_RADIUS,
          );
          if (result) {
            if (result.collided) {
              try {
                playCollisionSound(intensity);
              } catch (e) {
                /* ignore audio errors */
              }
            }
            // Only add if a NEW BALL was spawned
            if (result.newBall && !spawnedPairs.has(pairKey)) {
              spawnedPairs.add(pairKey);
              ballsRef.current.push(result.newBall);
            }
          }
        }
      }
    };

    const animate = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Clear canvas in CSS pixels
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);

      // Update and draw only if game has started
      if (gameStarted) {
        updateBalls();
      }
      drawCircle(ctx);
      ballsRef.current.forEach((ball) => drawBall(ctx, ball));

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    // handle resize
    const onResize = () => setSize();
    window.addEventListener("resize", onResize);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      window.removeEventListener("resize", onResize);
    };
  }, [gameStarted]);

  const handleStartClick = () => {
    setGameStarted(true);
  };

  const handleResetClick = () => {
    setGameStarted(false);
    // Recreate initial balls
    const canvas = canvasRef.current;
    if (canvas) {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const radius = getCircleRadius(width, height);
      ballsRef.current = makeInitialBalls(width, height, radius);
    }
  };

  return (
    <>
      <canvas ref={canvasRef} style={{ display: "block" }} />
      <StartButton onClick={handleStartClick} disabled={gameStarted} />
      <ResetButton onClick={handleResetClick} />
    </>
  );
};

export default Circle;
