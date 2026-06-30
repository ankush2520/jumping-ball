"use client";

import React, { useEffect, useRef } from "react";
import { drawCanvasWatermark } from "@/app/lib/watermark";

const CIRCLE_RADIUS = 260;
const BALL_SPEED = 0.35; // oscillations per second
const LINE_INTERVAL = 3; // seconds between each new line
const BALL_R = 6;
const N = 32;

// Phase delay = 1 full period / N  →  balls are evenly spread across 2π
// Math proof: with 16 spokes at 360°/16 and this delay,
// all balls always lie on a rotating circle of radius CIRCLE_RADIUS/2
const PHASE_DELAY = 1 / (N * BALL_SPEED);

// 16 spokes covering full 360° — this is the key to the rotating circle
const LINE_ANGLES_DEG = Array.from({ length: N }, (_, i) => i * (360 / N));

// Rainbow hue per spoke
const SPOKE_COLORS = Array.from(
  { length: N },
  (_, i) => `hsl(${Math.round((i * 360) / N)}, 90%, 62%)`,
);

// // 32 piano notes — two ascending octaves (N_BALLS = 32) gemini
// const BALL_NOTES = [
//   // Low foundation (Tonic chord)
//   196.0, 293.7, 392.0, 587.3,
//   // Rising tension
//   329.6, 440.0, 659.3, 880.0,
//   // Harmonic shift (Dominant)
//   261.6, 349.2, 523.3, 698.5,
//   // Resolution/Climax
//   196.0, 392.0, 784.0, 1568.0,
//   // Echo/Descending tail
//   1318.5, 1174.7, 1046.5, 987.8, 880.0, 784.0, 698.5, 659.3, 587.3, 523.3,
//   493.9, 440.0, 392.0, 293.7, 246.9, 196.0,
// ];

//chatgpt
const BALL_NOTES = [
  261.6, 329.6, 392.0, 523.3, 392.0, 329.6, 293.7, 261.6, 329.6, 440.0, 523.3,
  659.3, 523.3, 440.0, 392.0, 329.6, 392.0, 523.3, 659.3, 880.0, 659.3, 523.3,
  440.0, 392.0, 329.6, 293.7, 261.6, 392.0, 523.3, 392.0, 329.6, 261.6,
];

// const BALL_NOTES = [
//   261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3, 659.3, 784.0, 880.0, 1046.5,
//   1174.7, 880.0, 784.0, 659.3, 587.3, 523.3, 440.0, 392.0, 329.6, 440.0, 523.3,
//   659.3, 784.0, 587.3, 440.0, 329.6, 261.6, 392.0, 523.3, 784.0, 1046.5,
// ];

function playPianoNote(ac: AudioContext, freq: number) {
  if (!Number.isFinite(freq) || freq <= 0) return;
  const osc = ac.createOscillator();
  const osc2 = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  osc2.connect(gain);
  gain.connect(ac.destination);
  osc.type = "sine";
  osc2.type = "sine";
  osc.frequency.value = freq;
  osc2.frequency.value = freq * 2;
  const t = ac.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.12, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.004, t + 0.55);
  gain.gain.linearRampToValueAtTime(0, t + 0.6);
  osc.start(t);
  osc.stop(t + 0.65);
  osc2.start(t);
  osc2.stop(t + 0.4);
}

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

  return {
    width,
    height,
    centerX: width / 2,
    centerY: height / 2,
    circleRadius,
  };
};

const BallInPendulumMotion = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<Arena | null>(null);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const prevTRef = useRef<Float32Array>(new Float32Array(N));
  const lastNoteAtRef = useRef<Float32Array>(new Float32Array(N).fill(-99));

  const unlockAudio = () => {
    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new AudioContext();
      } catch {
        return;
      }
    }
    if (audioCtxRef.current.state !== "running") {
      void audioCtxRef.current.resume();
    }
  };

  // Document-level unlock so any interaction enables sound
  useEffect(() => {
    try {
      audioCtxRef.current = new AudioContext();
    } catch {
      /* needs gesture */
    }

    document.addEventListener("click", unlockAudio);
    document.addEventListener("touchstart", unlockAudio, { passive: true });
    document.addEventListener("keydown", unlockAudio);

    return () => {
      document.removeEventListener("click", unlockAudio);
      document.removeEventListener("touchstart", unlockAudio);
      document.removeEventListener("keydown", unlockAudio);
      void audioCtxRef.current?.close();
      audioCtxRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const init = () => {
      arenaRef.current = resizeCanvas(canvas);
    };
    init();
    startTimeRef.current = performance.now();

    const handleResize = () => init();
    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);

    const EDGE = 0.96;

    const draw = (now: number) => {
      const ctx = canvas.getContext("2d");
      const arena = arenaRef.current;
      if (!ctx || !arena) {
        animationRef.current = requestAnimationFrame(draw);
        return;
      }

      const elapsed = (now - startTimeRef.current) / 1000;
      const { width, height, centerX, centerY, circleRadius } = arena;

      // Background
      ctx.clearRect(0, 0, width, height);
      const bg = ctx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        Math.max(width, height) * 0.68,
      );
      bg.addColorStop(0, "#0f1a30");
      bg.addColorStop(0.46, "#080e1f");
      bg.addColorStop(1, "#020617");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      drawCanvasWatermark(ctx, width, height);

      // Outer circle + concentric rings
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.strokeStyle = "rgba(200, 210, 255, 0.30)";
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(160, 180, 255, 0.4)";
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(0, 0, circleRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(248, 250, 252, 0.05)";
      ctx.lineWidth = 1;
      for (
        let r = circleRadius * 0.25;
        r < circleRadius;
        r += circleRadius * 0.25
      ) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // Headings — two lines each, fits any screen size
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
      ctx.font = "900 24px Arial, Helvetica, sans-serif";
      ctx.fillText("Wait for balls", centerX, centerY - circleRadius - 88);
      ctx.fillText("to form a Circle", centerX, centerY - circleRadius - 61);
      ctx.fillStyle = "rgba(248, 250, 252, 0.72)";
      ctx.font = "700 12px Arial, Helvetica, sans-serif";
      ctx.fillText(
        "Balls moving back and forth",
        centerX,
        centerY - circleRadius - 38,
      );
      ctx.fillText(
        "and play piano notes when they touch the edge",
        centerX,
        centerY - circleRadius - 24,
      );

      const numLines = Math.min(N, Math.floor(elapsed / LINE_INTERVAL) + 1);

      for (let i = 0; i < numLines; i++) {
        const angleRad = (LINE_ANGLES_DEG[i] * Math.PI) / 180;
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);
        const color = SPOKE_COLORS[i];

        const lineStartTime = i * LINE_INTERVAL;
        const lineAge = elapsed - lineStartTime;
        const lineAlpha = Math.min(1, lineAge / 0.5);

        const ballVisible = elapsed >= lineStartTime + (i === 0 ? 0 : 0.1);

        // t_i = sin(ωt − i·2π/N) — evenly spread phases produce a rotating circle
        const t = Math.sin(
          (elapsed - i * PHASE_DELAY) * BALL_SPEED * Math.PI * 2,
        );

        // Draw spoke (full diameter through center)
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.beginPath();
        ctx.moveTo(-circleRadius * cosA, -circleRadius * sinA);
        ctx.lineTo(circleRadius * cosA, circleRadius * sinA);
        // Parse hsl to inject alpha
        ctx.strokeStyle = color
          .replace("hsl(", "hsla(")
          .replace(")", `, ${0.5 * lineAlpha})`);
        ctx.lineWidth = 1.5;
        ctx.shadowColor = color;
        ctx.shadowBlur = 6 * lineAlpha;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();

        if (!ballVisible) {
          prevTRef.current[i] = t;
          continue;
        }

        // Sound on circumference touch
        const prevT = prevTRef.current[i];
        const ac = audioCtxRef.current;
        if (
          ac?.state === "running" &&
          Math.abs(t) >= EDGE &&
          Math.abs(prevT) < EDGE &&
          ac.currentTime - lastNoteAtRef.current[i] > 0.22
        ) {
          playPianoNote(ac, BALL_NOTES[i]);
          lastNoteAtRef.current[i] = ac.currentTime;
        }
        prevTRef.current[i] = t;

        const ballX = centerX + t * circleRadius * cosA;
        const ballY = centerY + t * circleRadius * sinA;

        // Outer glow
        const glow = ctx.createRadialGradient(
          ballX,
          ballY,
          0,
          ballX,
          ballY,
          BALL_R * 3.5,
        );
        glow.addColorStop(
          0,
          color.replace("hsl(", "hsla(").replace(")", ", 0.6)"),
        );
        glow.addColorStop(
          1,
          color.replace("hsl(", "hsla(").replace(")", ", 0)"),
        );
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(ballX, ballY, BALL_R * 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Core ball
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(ballX, ballY, BALL_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    animationRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationRef.current !== null)
        cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <div className="pendulum-root">
      <canvas
        ref={canvasRef}
        className="pendulum-canvas"
        aria-label="Ball in Pendulum Motion"
        onClick={unlockAudio}
        onTouchStart={unlockAudio}
      />
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
