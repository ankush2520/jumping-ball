"use client";

import React, { useEffect, useRef } from "react";
import { drawCanvasWatermark } from "@/app/lib/watermark";

const CIRCLE_RADIUS = 260;
const BALL_SPEED = 1.4 / 2.5;   // oscillations per second
const LINE_INTERVAL = 2;          // seconds between each new line appearing
const BALL_R = Math.round(8 / 1.5); // ≈ 5

// Order: vertical → horizontal → diagonals → fill in progressively
const LINE_ANGLES_DEG = [
   90,    0,
   45,  135,
   22.5, 67.5, 112.5, 157.5,
   11.25, 33.75, 56.25,  78.75,
  101.25, 123.75, 146.25, 168.75,
];

type Arena = {
  width: number;
  height: number;
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

  return { width, height, centerX: width / 2, centerY: height / 2, circleRadius };
};

const BallInPendulumMotion = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<Arena | null>(null);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const init = () => { arenaRef.current = resizeCanvas(canvas); };
    init();
    startTimeRef.current = performance.now();

    const handleResize = () => init();
    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);

    const draw = (now: number) => {
      const ctx = canvas.getContext("2d");
      const arena = arenaRef.current;
      if (!ctx || !arena) { animationRef.current = requestAnimationFrame(draw); return; }

      const elapsed = (now - startTimeRef.current) / 1000;
      const { width, height, centerX, centerY, circleRadius } = arena;

      // Background
      ctx.clearRect(0, 0, width, height);
      const bg = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(width, height) * 0.68);
      bg.addColorStop(0,    "#182554");
      bg.addColorStop(0.46, "#0f172a");
      bg.addColorStop(1,    "#020617");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      drawCanvasWatermark(ctx, width, height);

      // Circle ring + concentric rings
      ctx.save();
      ctx.translate(centerX, centerY);

      ctx.strokeStyle = "rgba(96, 165, 250, 0.38)";
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(96, 165, 250, 0.5)";
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(0, 0, circleRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(248, 250, 252, 0.07)";
      ctx.lineWidth = 1;
      for (let r = circleRadius * 0.25; r < circleRadius; r += circleRadius * 0.25) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // Headings
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
      ctx.font = "900 28px Arial, Helvetica, sans-serif";
      ctx.fillText("Ball in Pendulum Motion", centerX, centerY - circleRadius - 52);
      ctx.fillStyle = "rgba(248, 250, 252, 0.72)";
      ctx.font = "700 15px Arial, Helvetica, sans-serif";
      ctx.fillText("Simple Harmonic Motion", centerX, centerY - circleRadius - 26);

      // How many lines are currently visible
      const numLines = Math.min(LINE_ANGLES_DEG.length, Math.floor(elapsed / LINE_INTERVAL) + 1);

      // Synchronized ball position parameter [-1 … 1] — same for every ball
      const t = Math.sin(elapsed * BALL_SPEED * Math.PI * 2);

      for (let i = 0; i < numLines; i++) {
        const angleRad = (LINE_ANGLES_DEG[i] * Math.PI) / 180;
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);

        // Fade-in when this line first appears (over 0.4 s)
        const lineAge = elapsed - i * LINE_INTERVAL;
        const alpha = Math.min(1, lineAge / 0.4);

        // Diameter line
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.beginPath();
        ctx.moveTo(-circleRadius * cosA, -circleRadius * sinA);
        ctx.lineTo( circleRadius * cosA,  circleRadius * sinA);
        ctx.strokeStyle = `rgba(96,165,250,${0.45 * alpha})`;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = "rgba(96,165,250,0.4)";
        ctx.shadowBlur = 8 * alpha;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();

        // Ball along this diameter
        const ballX = centerX + t * circleRadius * cosA;
        const ballY = centerY + t * circleRadius * sinA;

        // Outer glow
        const glow = ctx.createRadialGradient(ballX, ballY, 0, ballX, ballY, BALL_R * 3.5);
        glow.addColorStop(0, `rgba(96,165,250,${0.55 * alpha})`);
        glow.addColorStop(1, "rgba(96,165,250,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(ballX, ballY, BALL_R * 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Core
        ctx.fillStyle = `rgba(96,165,250,${alpha})`;
        ctx.shadowColor = "#60a5fa";
        ctx.shadowBlur = 14 * alpha;
        ctx.beginPath();
        ctx.arc(ballX, ballY, BALL_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    animationRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <div className="pendulum-root">
      <canvas ref={canvasRef} className="pendulum-canvas" aria-label="Ball in Pendulum Motion" />
      <style jsx>{`
        .pendulum-root {
          position: fixed;
          inset: 0;
          width: 100%;
          height: 100dvh;
          overflow: hidden;
          background: #020617;
        }
        .pendulum-canvas {
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

export default BallInPendulumMotion;
