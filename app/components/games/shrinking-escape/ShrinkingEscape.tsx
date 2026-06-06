"use client";

import React, { useEffect, useRef, useState } from "react";

type Arena = {
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
  openingCenterY: number;
  openingSize: number;
};

type Square = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  startSize: number;
};

type Hud = {
  bounces: number;
  sizePercent: number;
  escaped: boolean;
  elapsed: number;
};

type BounceAudio = {
  unlock: () => Promise<void>;
  playBounce: () => void;
  dispose: () => void;
};

const SHRINK_FACTOR = 0.985;
const HUD_UPDATE_INTERVAL = 0.08;
const ESCAPE_COAST_DURATION_MS = 1700;

let sharedAudioContext: AudioContext | null = null;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const createBounceAudio = (): BounceAudio => {
  let audio: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let lastBounceAt = 0;
  const noteFrequencies = [261.63, 293.66, 329.63, 392, 440];

  const ensureAudio = () => {
    if (audio) return audio;

    const audioWindow = window as Window &
      typeof globalThis & {
        webkitAudioContext?: typeof AudioContext;
      };
    const AudioContextClass =
      audioWindow.AudioContext || audioWindow.webkitAudioContext;
    if (!AudioContextClass) return null;

    sharedAudioContext = sharedAudioContext || new AudioContextClass();
    audio = sharedAudioContext;
    masterGain = audio.createGain();
    masterGain.gain.value = 0.42;
    masterGain.connect(audio.destination);
    return audio;
  };

  return {
    unlock: async () => {
      const context = ensureAudio();
      if (!context) return;
      if (context.state === "suspended") {
        await context.resume();
      }
    },
    playBounce: () => {
      const context = ensureAudio();
      if (!context || context.state !== "running" || !masterGain) return;

      const now = context.currentTime;
      if (now - lastBounceAt < 0.035) return;
      lastBounceAt = now;

      const root =
        noteFrequencies[Math.floor(Math.random() * noteFrequencies.length)] *
        (1 + (Math.random() - 0.5) * 0.035);
      const outputGain = context.createGain();
      const filter = context.createBiquadFilter();
      const harmonics = [
        { ratio: 1, gain: 0.16 },
        { ratio: 2, gain: 0.055 },
        { ratio: 3, gain: 0.022 },
      ];

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(2600, now);
      filter.frequency.exponentialRampToValueAtTime(900, now + 0.34);
      outputGain.gain.setValueAtTime(0.0001, now);
      outputGain.gain.linearRampToValueAtTime(0.18, now + 0.012);
      outputGain.gain.exponentialRampToValueAtTime(0.045, now + 0.12);
      outputGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
      outputGain.connect(filter);
      filter.connect(masterGain);

      harmonics.forEach((harmonic, index) => {
        const osc = context.createOscillator();
        const gain = context.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(root * harmonic.ratio, now);
        osc.detune.setValueAtTime((Math.random() - 0.5) * 5, now);
        gain.gain.setValueAtTime(harmonic.gain, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38 + index * 0.03);
        osc.connect(gain);
        gain.connect(outputGain);
        osc.start(now);
        osc.stop(now + 0.46);
        osc.onended = () => {
          osc.disconnect();
          gain.disconnect();
        };
      });

      window.setTimeout(() => {
        filter.disconnect();
        outputGain.disconnect();
      }, 520);
    },
    dispose: () => {
      masterGain?.disconnect();
      masterGain = null;
      audio = null;
    },
  };
};

const resizeCanvas = (canvas: HTMLCanvasElement): Arena => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  const ctx = canvas.getContext("2d");
  const boundarySize = clamp(Math.min(width - 28, height - 120, 920), 280, 920);
  const openingSize = boundarySize * 0.4;
  const x = (width - boundarySize) / 2;
  const y = (height - boundarySize) / 2;

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  if (ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
  }

  return {
    x,
    y,
    width: boundarySize,
    height: boundarySize,
    dpr,
    openingCenterY: y + boundarySize * 0.5,
    openingSize,
  };
};

const resetSquare = (arena: Arena): Square => {
  const size = arena.width * 0.8;
  const speed = clamp(arena.width * 0.4, 250, 420);
  let angle = Math.random() * Math.PI * 2;

  if (Math.abs(Math.cos(angle)) < 0.32) {
    angle += 0.55;
  }

  return {
    x: arena.x + arena.width * 0.5,
    y: arena.y + arena.height * 0.5,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    size,
    startSize: size,
  };
};

const getSquareColor = (ratio: number) => {
  if (ratio > 0.72) return "#f97316";
  if (ratio > 0.48) return "#facc15";
  return "#22c55e";
};

const drawArena = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  square: Square,
) => {
  const right = arena.x + arena.width;
  const bottom = arena.y + arena.height;
  const gapTop = arena.openingCenterY - arena.openingSize / 2;
  const gapBottom = arena.openingCenterY + arena.openingSize / 2;

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  const bg = ctx.createRadialGradient(
    arena.x + arena.width * 0.62,
    arena.y + arena.height * 0.5,
    20,
    arena.x + arena.width * 0.5,
    arena.y + arena.height * 0.5,
    arena.width * 0.72,
  );
  bg.addColorStop(0, "rgba(34, 197, 94, 0.08)");
  bg.addColorStop(0.48, "rgba(14, 165, 233, 0.06)");
  bg.addColorStop(1, "rgba(2, 6, 23, 0)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  ctx.save();
  ctx.shadowColor = "rgba(34, 211, 238, 0.65)";
  ctx.shadowBlur = 18;
  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(arena.x, arena.y);
  ctx.lineTo(right, arena.y);
  ctx.moveTo(arena.x, bottom);
  ctx.lineTo(right, bottom);
  ctx.moveTo(arena.x, arena.y);
  ctx.lineTo(arena.x, bottom);
  ctx.moveTo(right, arena.y);
  ctx.lineTo(right, gapTop);
  ctx.moveTo(right, gapBottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "rgba(34, 197, 94, 0.9)";
  ctx.shadowBlur = 20;
  ctx.fillStyle = "rgba(34, 197, 94, 0.16)";
  ctx.fillRect(right + 2, gapTop, 34, arena.openingSize);
  ctx.strokeStyle = "#22c55e";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(right + 2, gapTop);
  ctx.lineTo(right + 32, gapTop);
  ctx.moveTo(right + 2, gapBottom);
  ctx.lineTo(right + 32, gapBottom);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(187, 247, 208, 0.26)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(right - 86, arena.openingCenterY);
  ctx.lineTo(right - 28, arena.openingCenterY);
  ctx.moveTo(right - 39, arena.openingCenterY - 10);
  ctx.lineTo(right - 26, arena.openingCenterY);
  ctx.lineTo(right - 39, arena.openingCenterY + 10);
  ctx.stroke();
  ctx.restore();

  const ratio = square.size / square.startSize;
  const color = getSquareColor(ratio);
  const half = square.size / 2;

  ctx.save();
  ctx.translate(square.x, square.y);
  ctx.shadowColor =
    ratio > 0.48 ? "rgba(251, 146, 60, 0.7)" : "rgba(34, 197, 94, 0.7)";
  ctx.shadowBlur = 24;
  ctx.fillStyle = color;
  ctx.fillRect(-half, -half, square.size, square.size);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-half + 1, -half + 1, square.size - 2, square.size - 2);
  ctx.restore();
};

const ShrinkingEscape = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<BounceAudio | null>(null);
  const arenaRef = useRef<Arena | null>(null);
  const squareRef = useRef<Square | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const startedAtRef = useRef(0);
  const lastHudUpdateRef = useRef(0);
  const bouncesRef = useRef(0);
  const escapingRef = useRef(false);
  const fullyExitedAtRef = useRef<number | null>(null);
  const escapedRef = useRef(false);
  const [hud, setHud] = useState<Hud>({
    bounces: 0,
    sizePercent: 100,
    escaped: false,
    elapsed: 0,
  });

  if (audioRef.current === null) {
    audioRef.current = createBounceAudio();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const syncHud = (time: number) => {
      const square = squareRef.current;
      if (!square) return;

      setHud({
        bounces: bouncesRef.current,
        sizePercent: Math.round((square.size / square.startSize) * 100),
        escaped: escapedRef.current,
        elapsed: (time - startedAtRef.current) / 1000,
      });
    };

    const initialize = () => {
      const arena = resizeCanvas(canvas);
      arenaRef.current = arena;
      squareRef.current = resetSquare(arena);
      bouncesRef.current = 0;
      escapingRef.current = false;
      fullyExitedAtRef.current = null;
      escapedRef.current = false;
      startedAtRef.current = performance.now();
      lastTimeRef.current = startedAtRef.current;
      lastHudUpdateRef.current = 0;
      syncHud(startedAtRef.current);
    };

    const registerBounce = () => {
      const square = squareRef.current;
      if (!square) return;

      bouncesRef.current += 1;
      square.size = Math.max(square.size * SHRINK_FACTOR, 10);
      audioRef.current?.playBounce();
    };

    const step = (time: number) => {
      const arena = arenaRef.current;
      const square = squareRef.current;
      if (!arena || !square) return;

      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.033);
      lastTimeRef.current = time;

      if (!escapedRef.current) {
        square.x += square.vx * dt;
        square.y += square.vy * dt;

        const half = square.size / 2;
        const left = arena.x;
        const right = arena.x + arena.width;
        const top = arena.y;
        const bottom = arena.y + arena.height;
        const gapTop = arena.openingCenterY - arena.openingSize / 2;
        const gapBottom = arena.openingCenterY + arena.openingSize / 2;
        const fitsOpening = square.size <= arena.openingSize;
        const alignedWithOpening =
          square.y - half >= gapTop && square.y + half <= gapBottom;

        if (escapingRef.current) {
          if (square.x - half > right && fullyExitedAtRef.current === null) {
            fullyExitedAtRef.current = time;
          }

          if (
            fullyExitedAtRef.current !== null &&
            time - fullyExitedAtRef.current >= ESCAPE_COAST_DURATION_MS
          ) {
            escapedRef.current = true;
            syncHud(time);
          }
        } else {
          if (square.x - half <= left) {
            square.x = left + half;
            square.vx = Math.abs(square.vx);
            registerBounce();
          }

          if (square.y - half <= top) {
            square.y = top + half;
            square.vy = Math.abs(square.vy);
            registerBounce();
          }

          if (square.y + half >= bottom) {
            square.y = bottom - half;
            square.vy = -Math.abs(square.vy);
            registerBounce();
          }

          if (square.x + half >= right) {
            if (fitsOpening && alignedWithOpening) {
              escapingRef.current = true;
              square.vx = Math.abs(square.vx);
            } else {
              square.x = right - half;
              square.vx = -Math.abs(square.vx);
              registerBounce();
            }
          }
        }
      }

      drawArena(ctx, arena, square);

      if (time - lastHudUpdateRef.current > HUD_UPDATE_INTERVAL * 1000) {
        lastHudUpdateRef.current = time;
        syncHud(time);
      }

      if (!escapedRef.current) {
        animationRef.current = requestAnimationFrame(step);
      }
    };

    const handleResize = () => {
      const previousSquare = squareRef.current;
      const arena = resizeCanvas(canvas);
      arenaRef.current = arena;

      if (previousSquare && !escapingRef.current && !escapedRef.current) {
        const half = previousSquare.size / 2;
        previousSquare.x = clamp(
          previousSquare.x,
          arena.x + half,
          arena.x + arena.width - half,
        );
        previousSquare.y = clamp(
          previousSquare.y,
          arena.y + half,
          arena.y + arena.height - half,
        );
      } else {
        squareRef.current = resetSquare(arena);
      }

      const square = squareRef.current;
      if (square) {
        drawArena(ctx, arena, square);
      }
    };

    const unlockSound = () => {
      void audioRef.current?.unlock();
    };

    initialize();
    animationRef.current = requestAnimationFrame(step);
    window.addEventListener("resize", handleResize);
    window.addEventListener("pointerdown", unlockSound, { passive: true });
    window.addEventListener("keydown", unlockSound);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("pointerdown", unlockSound);
      window.removeEventListener("keydown", unlockSound);
      audioRef.current?.dispose();
    };
  }, []);

  return (
    <div className="escape-root">
      <canvas ref={canvasRef} className="escape-canvas" />
      <div className="escape-hud" aria-live="polite">
        <div>BOUNCES: {hud.bounces}</div>
        <div>SIZE: {hud.sizePercent}%</div>
      </div>
      {hud.escaped ? (
        <div className="escape-end" role="status" aria-live="assertive">
          <strong>ESCAPED</strong>
          <span>BOUNCES: {hud.bounces}</span>
          <span>SIZE: {hud.sizePercent}%</span>
          <span>TIME: {hud.elapsed.toFixed(1)}s</span>
        </div>
      ) : null}
      <style jsx>{`
        .escape-root {
          position: relative;
          width: 100%;
          min-height: 100vh;
          overflow: hidden;
          background: #020617;
          color: #f8fafc;
        }

        .escape-canvas {
          width: 100%;
          height: 100vh;
          min-height: 100vh;
        }

        .escape-hud {
          position: fixed;
          top: 18px;
          left: 50%;
          z-index: 3;
          transform: translateX(-50%);
          display: grid;
          gap: 5px;
          min-width: 160px;
          color: #ecfeff;
          font-family:
            "Geist Mono", "SFMono-Regular", "Roboto Mono", monospace;
          font-size: clamp(0.78rem, 2.5vw, 1rem);
          font-weight: 900;
          letter-spacing: 0.08em;
          line-height: 1.25;
          text-align: center;
          text-shadow:
            0 0 12px rgba(34, 211, 238, 0.38),
            0 6px 22px rgba(2, 6, 23, 0.8);
          pointer-events: none;
        }

        .escape-end {
          position: fixed;
          inset: 0;
          z-index: 4;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 24px;
          background: rgba(2, 6, 23, 0.52);
          color: #dcfce7;
          font-family:
            "Geist Mono", "SFMono-Regular", "Roboto Mono", monospace;
          text-align: center;
          text-shadow:
            0 0 18px rgba(34, 197, 94, 0.46),
            0 10px 28px rgba(2, 6, 23, 0.88);
          animation: escapeEndFade 0.7s ease-out both;
        }

        .escape-end strong {
          display: block;
          color: #86efac;
          font-size: clamp(3.2rem, 12vw, 7.6rem);
          font-weight: 950;
          letter-spacing: 0;
          line-height: 0.9;
        }

        .escape-end span {
          font-size: clamp(1rem, 3vw, 1.35rem);
          font-weight: 900;
          letter-spacing: 0.08em;
        }

        @keyframes escapeEndFade {
          from {
            opacity: 0;
          }

          to {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
};

export default ShrinkingEscape;
