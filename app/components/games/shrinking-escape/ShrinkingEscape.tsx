"use client";

import React, { useEffect, useRef, useState } from "react";

type Arena = {
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
};

type ExitWall = "top" | "right" | "bottom" | "left";

type Square = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  startSize: number;
  color: string;
};

type Hud = {
  bounces: number;
  sizePercent: number;
  elapsed: number;
};

type SimulationSettings = {
  squareSpeed: number;
  exitDuration: number;
  initialSquareSize: number;
  minExitSize: number;
  maxExitSize: number;
  shrinkRate: number;
};

type SimulationState = "running";

type BounceAudio = {
  unlock: () => Promise<void>;
  playBounce: () => void;
  dispose: () => void;
};

const HUD_UPDATE_INTERVAL = 0.08;
const HUD_RESERVED_HEIGHT_DESKTOP = 142;
const HUD_RESERVED_HEIGHT_MOBILE = 158;
const ARENA_SAFE_SPACING = 24;
const MOBILE_BOTTOM_SAFE_SPACING = 28;
const SPEED_PER_BOUNDARY_AT_1X = 0.2;
const DEBUG_SETTINGS_LOGS = true;
const squareCollisionColors = [
  "#f97316",
  "#facc15",
  "#ec4899",
  "#22d3ee",
  "#22c55e",
  "#a855f7",
  "#ef4444",
];

const defaultSettings: SimulationSettings = {
  squareSpeed: 2,
  exitDuration: 2.25,
  initialSquareSize: 80,
  minExitSize: 20,
  maxExitSize: 85,
  shrinkRate: 1,
};

let sharedAudioContext: AudioContext | null = null;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getRandomSquareColor = (currentColor?: string) => {
  const options = squareCollisionColors.filter((color) => color !== currentColor);
  return options[Math.floor(Math.random() * options.length)] ?? squareCollisionColors[0];
};

const logConfigValue = (label: string, value: unknown) => {
  if (!DEBUG_SETTINGS_LOGS) return;
  console.info(`[Shrinking Escape settings] ${label}:`, value);
};

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
    masterGain.gain.value = 0.92;
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
        { ratio: 1, gain: 0.34 },
        { ratio: 2, gain: 0.12 },
        { ratio: 3, gain: 0.055 },
      ];

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(2600, now);
      filter.frequency.exponentialRampToValueAtTime(900, now + 0.34);
      outputGain.gain.setValueAtTime(0.0001, now);
      outputGain.gain.linearRampToValueAtTime(0.44, now + 0.01);
      outputGain.gain.exponentialRampToValueAtTime(0.12, now + 0.14);
      outputGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
      outputGain.connect(filter);
      filter.connect(masterGain);

      harmonics.forEach((harmonic, index) => {
        const osc = context.createOscillator();
        const gain = context.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(root * harmonic.ratio, now);
        osc.detune.setValueAtTime((Math.random() - 0.5) * 5, now);
        gain.gain.setValueAtTime(harmonic.gain, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.44 + index * 0.03);
        osc.connect(gain);
        gain.connect(outputGain);
        osc.start(now);
        osc.stop(now + 0.54);
        osc.onended = () => {
          osc.disconnect();
          gain.disconnect();
        };
      });

      window.setTimeout(() => {
        filter.disconnect();
        outputGain.disconnect();
      }, 620);
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
  const isMobile = width < 600;
  const hudReservedHeight = isMobile
    ? HUD_RESERVED_HEIGHT_MOBILE
    : HUD_RESERVED_HEIGHT_DESKTOP;
  const horizontalPadding = isMobile ? width * 0.12 : 28;
  const bottomSpacing = isMobile ? MOBILE_BOTTOM_SAFE_SPACING : ARENA_SAFE_SPACING;
  const availableWidth = Math.max(220, width - horizontalPadding);
  const availableHeight = Math.max(220, height - hudReservedHeight - bottomSpacing);
  const availableSize = Math.min(availableWidth, availableHeight);
  const boundarySize = clamp(
    availableSize,
    220,
    920,
  );
  const x = (width - boundarySize) / 2;
  const y = hudReservedHeight;

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
  };
};

const getSquareSpeed = (arena: Arena, settings: SimulationSettings) =>
  arena.width * SPEED_PER_BOUNDARY_AT_1X * settings.squareSpeed;

const resetSquare = (arena: Arena, settings: SimulationSettings): Square => {
  const size = arena.width * (settings.initialSquareSize / 100);
  const speed = getSquareSpeed(arena, settings);
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
    color: "#d77026",
  };
};

const drawWallSegment = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  wall: ExitWall,
  start: number,
  end: number,
) => {
  const right = arena.x + arena.width;
  const bottom = arena.y + arena.height;

  if (wall === "top") {
    ctx.moveTo(arena.x + start, arena.y);
    ctx.lineTo(arena.x + end, arena.y);
  } else if (wall === "right") {
    ctx.moveTo(right, arena.y + start);
    ctx.lineTo(right, arena.y + end);
  } else if (wall === "bottom") {
    ctx.moveTo(arena.x + start, bottom);
    ctx.lineTo(arena.x + end, bottom);
  } else {
    ctx.moveTo(arena.x, arena.y + start);
    ctx.lineTo(arena.x, arena.y + end);
  }
};

const drawArena = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  square: Square,
) => {
  const isMobile = window.innerWidth < 600;
  const boundaryLineWidth = isMobile ? 3 : 4;
  const boundaryGlow = isMobile ? 12 : 18;
  const squareGlow = isMobile ? 16 : 24;

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
  ctx.strokeStyle = "rgba(2, 6, 23, 0.5)";
  ctx.lineWidth = isMobile ? 12 : 16;
  ctx.strokeRect(arena.x + 6, arena.y + 6, arena.width - 12, arena.height - 12);
  ctx.strokeStyle = "rgba(125, 249, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.strokeRect(arena.x + 10, arena.y + 10, arena.width - 20, arena.height - 20);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "rgba(34, 211, 238, 0.65)";
  ctx.shadowBlur = boundaryGlow;
  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = boundaryLineWidth;
  ctx.lineCap = "round";
  ctx.beginPath();
  (["top", "right", "bottom", "left"] as ExitWall[]).forEach((wall) => {
    drawWallSegment(ctx, arena, wall, 0, arena.width);
  });
  ctx.stroke();
  ctx.restore();

  const ratio = square.size / square.startSize;
  const half = square.size / 2;

  ctx.save();
  ctx.translate(square.x, square.y);
  ctx.shadowColor =
    ratio > 0.48 ? "rgba(251, 146, 60, 0.55)" : "rgba(34, 197, 94, 0.56)";
  ctx.shadowBlur = squareGlow;
  ctx.fillStyle = square.color;
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
  const settingsRef = useRef<SimulationSettings>(defaultSettings);
  const arenaRef = useRef<Arena | null>(null);
  const squareRef = useRef<Square | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const startedAtRef = useRef(0);
  const lastHudUpdateRef = useRef(0);
  const bouncesRef = useRef(0);
  const simulationStateRef = useRef<SimulationState>("running");
  const [hud, setHud] = useState<Hud>({
    bounces: 0,
    sizePercent: 100,
    elapsed: 0,
  });

  if (audioRef.current === null) {
    audioRef.current = createBounceAudio();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const activeSettings = settingsRef.current;

    const syncHud = (time: number) => {
      const square = squareRef.current;
      if (!square) return;

      setHud({
        bounces: bouncesRef.current,
        sizePercent: Math.round((square.size / square.startSize) * 100),
        elapsed: (time - startedAtRef.current) / 1000,
      });
    };

    const initialize = () => {
      const arena = resizeCanvas(canvas);
      const startedAt = performance.now();
      arenaRef.current = arena;
      squareRef.current = resetSquare(arena, activeSettings);
      const square = squareRef.current;
      bouncesRef.current = 0;
      simulationStateRef.current = "running";
      startedAtRef.current = startedAt;
      lastTimeRef.current = startedAtRef.current;
      lastHudUpdateRef.current = 0;
      syncHud(startedAtRef.current);

      logConfigValue("actual square speed px/s", Math.hypot(square.vx, square.vy));
      logConfigValue("actual initial square size percent", {
        percentOfBoundary: Number(((square.size / arena.width) * 100).toFixed(2)),
        squareSizePx: Number(square.size.toFixed(2)),
        boundarySizePx: Number(arena.width.toFixed(2)),
      });
      logConfigValue("actual shrink rate percent per bounce", activeSettings.shrinkRate);
    };

    const registerBounce = () => {
      const square = squareRef.current;
      if (!square || simulationStateRef.current !== "running") return;

      bouncesRef.current += 1;
      square.size = Math.max(square.size * (1 - activeSettings.shrinkRate / 100), 10);
      square.color = getRandomSquareColor(square.color);
      audioRef.current?.playBounce();
    };

    const step = (time: number) => {
      if (simulationStateRef.current !== "running") return;

      const arena = arenaRef.current;
      const square = squareRef.current;
      if (!arena || !square) return;

      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.033);
      lastTimeRef.current = time;

      square.x += square.vx * dt;
      square.y += square.vy * dt;

      const half = square.size / 2;
      const left = arena.x;
      const right = arena.x + arena.width;
      const top = arena.y;
      const bottom = arena.y + arena.height;

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
        square.x = right - half;
        square.vx = -Math.abs(square.vx);
        registerBounce();
      }

      drawArena(ctx, arena, square);

      if (time - lastHudUpdateRef.current > HUD_UPDATE_INTERVAL * 1000) {
        lastHudUpdateRef.current = time;
        syncHud(time);
      }

      animationRef.current = requestAnimationFrame(step);
    };

    const handleResize = () => {
      if (simulationStateRef.current !== "running") return;

      const previousSquare = squareRef.current;
      const arena = resizeCanvas(canvas);
      arenaRef.current = arena;

      if (previousSquare) {
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
        squareRef.current = resetSquare(arena, activeSettings);
      }

      const square = squareRef.current;
      if (square) drawArena(ctx, arena, square);
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
        <div className="hud-stat">
          <span>BOUNCES</span>
          <strong>{hud.bounces}</strong>
        </div>
        <div className="hud-stat">
          <span>SIZE</span>
          <strong>{hud.sizePercent}%</strong>
        </div>
      </div>
      <style jsx>{`
        .escape-root {
          position: relative;
          width: 100%;
          height: 100dvh;
          min-height: 100dvh;
          max-height: 100dvh;
          overflow: hidden;
          background: #020617;
          color: #f8fafc;
        }

        .escape-canvas {
          width: 100%;
          height: 100dvh;
          min-height: 100dvh;
          max-height: 100dvh;
        }

        .result-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 10px;
          margin-top: 22px;
        }

        .result-actions button {
          min-height: 42px;
          padding: 0 15px;
          border: 1px solid rgba(34, 211, 238, 0.28);
          border-radius: 12px;
          background: rgba(15, 23, 42, 0.78);
          color: #ecfeff;
          font-family:
            "Geist Mono", "SFMono-Regular", "Roboto Mono", monospace;
          font-size: 0.72rem;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          cursor: pointer;
          transition:
            transform 0.2s ease,
            border-color 0.2s ease,
            background 0.2s ease;
        }

        .result-actions button:hover {
          transform: translateY(-1px);
          border-color: rgba(34, 197, 94, 0.64);
          background: rgba(22, 101, 52, 0.28);
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

        .hud-stat {
          display: flex;
          align-items: baseline;
          justify-content: center;
          gap: 8px;
        }

        .hud-stat span,
        .hud-stat strong {
          font: inherit;
        }

        .hud-stat strong {
          color: #bbf7d0;
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

        .escape-end .result-actions {
          margin-top: 18px;
        }

        @media (max-width: 640px) {
          .result-actions button {
            width: 100%;
          }

          .escape-hud {
            top: calc(64px + env(safe-area-inset-top, 0px));
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0;
            width: max-content;
            max-width: 92vw;
            min-width: 0;
            min-height: 38px;
            padding: 7px 11px;
            border: 1px solid rgba(34, 211, 238, 0.34);
            border-radius: 999px;
            background: rgba(2, 6, 23, 0.68);
            box-shadow:
              0 0 18px rgba(34, 211, 238, 0.1),
              inset 0 1px 0 rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(10px);
            font-size: 12px;
            line-height: 1;
            letter-spacing: 0;
            text-shadow: 0 5px 14px rgba(2, 6, 23, 0.72);
            white-space: nowrap;
          }

          .hud-stat {
            gap: 4px;
          }

          .hud-stat:not(:last-child)::after {
            content: "";
            width: 1px;
            height: 16px;
            margin: 0 9px;
            background: rgba(125, 249, 255, 0.22);
          }

          .hud-stat span {
            color: rgba(226, 246, 255, 0.58);
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 0;
          }

          .hud-stat strong {
            color: #ecfeff;
            font-size: 15px;
            font-weight: 950;
            letter-spacing: 0;
          }
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
