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

type DynamicExit = {
  wall: ExitWall;
  center: number;
  size: number;
  startedAt: number;
  endsAt: number;
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
  exiting: boolean;
  escaped: boolean;
  elapsed: number;
  exitRemaining: number;
};

type SimulationSettings = {
  squareSpeed: number;
  exitDuration: number;
  initialSquareSize: number;
  minExitSize: number;
  maxExitSize: number;
  shrinkRate: number;
};

type SimulationState = "running" | "escaped";

type BounceAudio = {
  unlock: () => Promise<void>;
  playBounce: () => void;
  dispose: () => void;
};

const HUD_UPDATE_INTERVAL = 0.08;
const EXIT_FADE_MS = 180;
const HUD_RESERVED_HEIGHT_DESKTOP = 142;
const HUD_RESERVED_HEIGHT_MOBILE = 158;
const ARENA_SAFE_SPACING = 24;
const MOBILE_BOTTOM_SAFE_SPACING = 28;
const SPEED_PER_BOUNDARY_AT_1X = 0.2;
const DEBUG_SETTINGS_LOGS = true;

const defaultSettings: SimulationSettings = {
  squareSpeed: 2,
  exitDuration: 2.25,
  initialSquareSize: 80,
  minExitSize: 20,
  maxExitSize: 85,
  shrinkRate: 1,
};

const settingLimits = {
  squareSpeed: { min: 1, max: 10, step: 0.1 },
  exitDuration: { min: 0.5, max: 10, step: 0.05 },
  initialSquareSize: { min: 10, max: 95, step: 1 },
  minExitSize: { min: 5, max: 95, step: 1 },
  maxExitSize: { min: 5, max: 95, step: 1 },
  shrinkRate: { min: 0.1, max: 10, step: 0.1 },
};

let sharedAudioContext: AudioContext | null = null;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const randomBetween = (min: number, max: number) =>
  min + Math.random() * (max - min);

const logConfigValue = (label: string, value: unknown) => {
  if (!DEBUG_SETTINGS_LOGS) return;
  console.info(`[Shrinking Escape settings] ${label}:`, value);
};

const validateSettings = (settings: SimulationSettings): SimulationSettings => {
  const initialSquareSize = clamp(
    settings.initialSquareSize,
    settingLimits.initialSquareSize.min,
    settingLimits.initialSquareSize.max,
  );
  const minExitSize = clamp(
    settings.minExitSize,
    settingLimits.minExitSize.min,
    settingLimits.minExitSize.max,
  );
  const maxExitSize = Math.max(
    minExitSize,
    clamp(
      settings.maxExitSize,
      settingLimits.maxExitSize.min,
      settingLimits.maxExitSize.max,
    ),
  );

  return {
    squareSpeed: clamp(
      settings.squareSpeed,
      settingLimits.squareSpeed.min,
      settingLimits.squareSpeed.max,
    ),
    exitDuration: clamp(
      settings.exitDuration,
      settingLimits.exitDuration.min,
      settingLimits.exitDuration.max,
    ),
    initialSquareSize,
    minExitSize,
    maxExitSize,
    shrinkRate: clamp(
      settings.shrinkRate,
      settingLimits.shrinkRate.min,
      settingLimits.shrinkRate.max,
    ),
  };
};

const getRandomSettings = (): SimulationSettings => {
  const minExitSize = Math.round(
    randomBetween(settingLimits.minExitSize.min, settingLimits.minExitSize.max),
  );

  return validateSettings({
    squareSpeed: Number(randomBetween(1, 10).toFixed(1)),
    exitDuration: Number(randomBetween(0.5, 10).toFixed(2)),
    initialSquareSize: Math.round(randomBetween(10, 95)),
    minExitSize,
    maxExitSize: Math.round(randomBetween(minExitSize, 95)),
    shrinkRate: Number(randomBetween(0.1, 10).toFixed(1)),
  });
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
  const isMobile = width < 600;
  const hudReservedHeight = isMobile
    ? HUD_RESERVED_HEIGHT_MOBILE
    : HUD_RESERVED_HEIGHT_DESKTOP;
  const availableHeight = Math.max(
    260,
    height - hudReservedHeight - MOBILE_BOTTOM_SAFE_SPACING,
  );
  const mobileBoundarySize = Math.min(width * 0.88, availableHeight * 0.62);
  const desktopBoundarySize = Math.min(
    width - 28,
    height - hudReservedHeight - ARENA_SAFE_SPACING,
    920,
  );
  const boundarySize = clamp(
    isMobile ? mobileBoundarySize : desktopBoundarySize,
    240,
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

const getExitStart = (exit: DynamicExit) => exit.center - exit.size / 2;

const getExitEnd = (exit: DynamicExit) => exit.center + exit.size / 2;

const createExit = (
  arena: Arena,
  time: number,
  previousExit: DynamicExit | null,
  wallStreak: { wall: ExitWall | null; count: number },
  settings: SimulationSettings,
): DynamicExit => {
  const walls: ExitWall[] = ["top", "right", "bottom", "left"];
  const possibleWalls = walls.filter((wall) => {
    if (wallStreak.wall === wall && wallStreak.count >= 3) return false;
    return true;
  });
  const wall =
    possibleWalls[Math.floor(Math.random() * possibleWalls.length)] ?? "right";
  const size =
    arena.width *
    randomBetween(settings.minExitSize / 100, settings.maxExitSize / 100);
  const center = randomBetween(size / 2, arena.width - size / 2);
  let exit: DynamicExit = {
    wall,
    center,
    size,
    startedAt: time,
    endsAt: time + settings.exitDuration * 1000,
  };

  if (
    previousExit &&
    previousExit.wall === exit.wall &&
    Math.abs(previousExit.center - exit.center) < (previousExit.size + exit.size) * 0.35
  ) {
    const shiftedCenter =
      previousExit.center < arena.width / 2
        ? arena.width - size / 2
        : size / 2;
    exit = { ...exit, center: shiftedCenter };
  }

  return exit;
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
  };
};

const getSquareColor = (ratio: number) => {
  if (ratio > 0.72) return "#f97316";
  if (ratio > 0.48) return "#facc15";
  return "#22c55e";
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

const drawExitGlow = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  exit: DynamicExit,
  alpha: number,
) => {
  const right = arena.x + arena.width;
  const bottom = arena.y + arena.height;
  const start = getExitStart(exit);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(34, 197, 94, 0.08)";

  if (exit.wall === "right") {
    ctx.fillRect(right + 2, arena.y + start, 34, exit.size);
  } else if (exit.wall === "left") {
    ctx.fillRect(arena.x - 36, arena.y + start, 34, exit.size);
  } else if (exit.wall === "top") {
    ctx.fillRect(arena.x + start, arena.y - 36, exit.size, 34);
  } else {
    ctx.fillRect(arena.x + start, bottom + 2, exit.size, 34);
  }

  ctx.restore();
};

const drawArena = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  square: Square,
  exit: DynamicExit,
  previousExit: DynamicExit | null,
  previousExitClosedAt: number | null,
  time: number,
) => {
  const exitStart = getExitStart(exit);
  const exitEnd = getExitEnd(exit);
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
    if (wall === exit.wall) {
      drawWallSegment(ctx, arena, wall, 0, exitStart);
      drawWallSegment(ctx, arena, wall, exitEnd, arena.width);
    } else {
      drawWallSegment(ctx, arena, wall, 0, arena.width);
    }
  });
  ctx.stroke();
  ctx.restore();

  if (previousExit && previousExitClosedAt !== null) {
    const fadeOut = 1 - clamp((time - previousExitClosedAt) / EXIT_FADE_MS, 0, 1);
    if (fadeOut > 0) {
      drawExitGlow(ctx, arena, previousExit, fadeOut * 0.72);
    }
  }

  const fadeIn = clamp((time - exit.startedAt) / EXIT_FADE_MS, 0, 1);
  drawExitGlow(ctx, arena, exit, fadeIn);

  const ratio = square.size / square.startSize;
  const color = getSquareColor(ratio);
  const half = square.size / 2;

  ctx.save();
  ctx.translate(square.x, square.y);
  ctx.shadowColor =
    ratio > 0.48 ? "rgba(251, 146, 60, 0.55)" : "rgba(34, 197, 94, 0.56)";
  ctx.shadowBlur = squareGlow;
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
  const settingsRef = useRef<SimulationSettings>(defaultSettings);
  const arenaRef = useRef<Arena | null>(null);
  const squareRef = useRef<Square | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const startedAtRef = useRef(0);
  const lastHudUpdateRef = useRef(0);
  const bouncesRef = useRef(0);
  const currentExitRef = useRef<DynamicExit | null>(null);
  const previousExitRef = useRef<DynamicExit | null>(null);
  const previousExitClosedAtRef = useRef<number | null>(null);
  const wallStreakRef = useRef<{ wall: ExitWall | null; count: number }>({
    wall: null,
    count: 0,
  });
  const escapingRef = useRef(false);
  const escapingWallRef = useRef<ExitWall | null>(null);
  const fullyExitedAtRef = useRef<number | null>(null);
  const escapedRef = useRef(false);
  const simulationStateRef = useRef<SimulationState>("escaped");
  const [settings, setSettings] =
    useState<SimulationSettings>(defaultSettings);
  const [hasStarted, setHasStarted] = useState(false);
  const [runId, setRunId] = useState(0);
  const [hud, setHud] = useState<Hud>({
    bounces: 0,
    sizePercent: 100,
    exiting: false,
    escaped: false,
    elapsed: 0,
    exitRemaining: defaultSettings.exitDuration,
  });

  if (audioRef.current === null) {
    audioRef.current = createBounceAudio();
  }

  const applySettingsUpdate = (
    key: keyof SimulationSettings,
    value: number,
  ) => {
    setSettings((current) => validateSettings({ ...current, [key]: value }));
  };

  const startSimulation = () => {
    const validSettings = validateSettings(settings);
    settingsRef.current = validSettings;
    simulationStateRef.current = "running";
    setSettings(validSettings);
    setHud({
      bounces: 0,
      sizePercent: validSettings.initialSquareSize,
      exiting: false,
      escaped: false,
      elapsed: 0,
      exitRemaining: validSettings.exitDuration,
    });
    setHasStarted(true);
    setRunId((current) => current + 1);
  };

  const playAgain = () => {
    simulationStateRef.current = "running";
    setHud({
      bounces: 0,
      sizePercent: settingsRef.current.initialSquareSize,
      exiting: false,
      escaped: false,
      elapsed: 0,
      exitRemaining: settingsRef.current.exitDuration,
    });
    setHasStarted(true);
    setRunId((current) => current + 1);
  };

  const resetSettings = () => {
    settingsRef.current = defaultSettings;
    simulationStateRef.current = "escaped";
    setSettings(defaultSettings);
    setHasStarted(false);
    setHud({
      bounces: 0,
      sizePercent: defaultSettings.initialSquareSize,
      exiting: false,
      escaped: false,
      elapsed: 0,
      exitRemaining: defaultSettings.exitDuration,
    });
  };

  const randomizeSettings = () => {
    setSettings(getRandomSettings());
  };

  const settingControls: Array<{
    key: keyof SimulationSettings;
    label: string;
    value: string;
    suffix?: string;
  }> = [
    {
      key: "squareSpeed",
      label: "Square Speed",
      value: `${settings.squareSpeed.toFixed(1)}x`,
    },
    {
      key: "exitDuration",
      label: "Exit Duration",
      value: `${settings.exitDuration.toFixed(2)}s`,
    },
    {
      key: "initialSquareSize",
      label: "Initial Square Size (% of boundary)",
      value: `${Math.round(settings.initialSquareSize)}%`,
    },
    {
      key: "minExitSize",
      label: "Minimum Exit Size (% of wall)",
      value: `${Math.round(settings.minExitSize)}%`,
    },
    {
      key: "maxExitSize",
      label: "Maximum Exit Size (% of wall)",
      value: `${Math.round(settings.maxExitSize)}%`,
    },
    {
      key: "shrinkRate",
      label: "Size Lost Per Bounce",
      value: `${settings.shrinkRate.toFixed(1)}%`,
    },
  ];

  useEffect(() => {
    if (!hasStarted) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const activeSettings = settingsRef.current;

    const syncHud = (time: number) => {
      const square = squareRef.current;
      const exit = currentExitRef.current;
      if (!square) return;

      setHud({
        bounces: bouncesRef.current,
        sizePercent: Math.round((square.size / square.startSize) * 100),
        exiting: escapingRef.current,
        escaped: escapedRef.current,
        elapsed: (time - startedAtRef.current) / 1000,
        exitRemaining: exit
          ? Math.max(0, (exit.endsAt - time) / 1000)
          : activeSettings.exitDuration,
      });
    };

    const rotateExit = (arena: Arena, time: number) => {
      const previousExit = currentExitRef.current;
      previousExitRef.current = previousExit;
      previousExitClosedAtRef.current = previousExit ? time : null;

      const nextExit = createExit(
        arena,
        time,
        previousExit,
        wallStreakRef.current,
        activeSettings,
      );
      currentExitRef.current = nextExit;
      wallStreakRef.current =
        wallStreakRef.current.wall === nextExit.wall
          ? { wall: nextExit.wall, count: wallStreakRef.current.count + 1 }
          : { wall: nextExit.wall, count: 1 };

      logConfigValue("actual exit duration seconds", activeSettings.exitDuration);
      logConfigValue("actual generated exit size percent", {
        wall: nextExit.wall,
        percentOfWall: Number(((nextExit.size / arena.width) * 100).toFixed(2)),
        minPercent: activeSettings.minExitSize,
        maxPercent: activeSettings.maxExitSize,
      });
    };

    const initialize = () => {
      const arena = resizeCanvas(canvas);
      const startedAt = performance.now();
      arenaRef.current = arena;
      squareRef.current = resetSquare(arena, activeSettings);
      const square = squareRef.current;
      bouncesRef.current = 0;
      currentExitRef.current = null;
      previousExitRef.current = null;
      previousExitClosedAtRef.current = null;
      wallStreakRef.current = { wall: null, count: 0 };
      escapingRef.current = false;
      escapingWallRef.current = null;
      fullyExitedAtRef.current = null;
      escapedRef.current = false;
      simulationStateRef.current = "running";
      startedAtRef.current = startedAt;
      rotateExit(arena, startedAt);
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
      audioRef.current?.playBounce();
    };

    const fitsAndAlignsWithExit = (
      square: Square,
      exit: DynamicExit,
      half: number,
    ) => {
      const arena = arenaRef.current;
      if (!arena) return false;
      if (square.size > exit.size) return false;
      if (exit.wall === "top" || exit.wall === "bottom") {
        return (
          square.x - half >= arena.x + getExitStart(exit) &&
          square.x + half <= arena.x + getExitEnd(exit)
        );
      }

      return (
        square.y - half >= arena.y + getExitStart(exit) &&
        square.y + half <= arena.y + getExitEnd(exit)
      );
    };

    const getFullyOutsideWall = (
      square: Square,
      arena: Arena,
      half: number,
    ): ExitWall | null => {
      if (square.x - half > arena.x + arena.width) return "right";
      if (square.x + half < arena.x) return "left";
      if (square.y + half < arena.y) return "top";
      if (square.y - half > arena.y + arena.height) return "bottom";
      return null;
    };

    const finishEscape = (time: number, wall: ExitWall) => {
      fullyExitedAtRef.current = time;
      escapingWallRef.current = wall;
      escapingRef.current = false;
      simulationStateRef.current = "escaped";
      escapedRef.current = true;
      syncHud(time);
      animationRef.current = null;
    };

    const step = (time: number) => {
      if (simulationStateRef.current !== "running") return;

      const arena = arenaRef.current;
      const square = squareRef.current;
      const currentExit = currentExitRef.current;
      if (!arena || !square || !currentExit) return;

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
        let exit = currentExitRef.current;
        const fullyOutsideWall = getFullyOutsideWall(square, arena, half);

        if (fullyOutsideWall) {
          finishEscape(time, fullyOutsideWall);
          return;
        }

        if (escapingRef.current) {
          // Keep normal bounce physics while the committed exit wall stays open.
          if (escapingWallRef.current !== "left" && square.x - half <= left) {
            square.x = left + half;
            square.vx = Math.abs(square.vx);
            registerBounce();
          }

          if (escapingWallRef.current !== "top" && square.y - half <= top) {
            square.y = top + half;
            square.vy = Math.abs(square.vy);
            registerBounce();
          }

          if (escapingWallRef.current !== "bottom" && square.y + half >= bottom) {
            square.y = bottom - half;
            square.vy = -Math.abs(square.vy);
            registerBounce();
          }

          if (escapingWallRef.current !== "right" && square.x + half >= right) {
            square.x = right - half;
            square.vx = -Math.abs(square.vx);
            registerBounce();
          }
        } else {
          if (time >= currentExit.endsAt) {
            rotateExit(arena, time);
            exit = currentExitRef.current;
          }

          if (square.x - half <= left) {
            if (exit?.wall === "left" && fitsAndAlignsWithExit(square, exit, half)) {
              escapingRef.current = true;
              escapingWallRef.current = "left";
              square.vx = -Math.abs(square.vx);
              syncHud(time);
            } else {
              square.x = left + half;
              square.vx = Math.abs(square.vx);
              registerBounce();
            }
          }

          if (square.y - half <= top) {
            if (exit?.wall === "top" && fitsAndAlignsWithExit(square, exit, half)) {
              escapingRef.current = true;
              escapingWallRef.current = "top";
              square.vy = -Math.abs(square.vy);
              syncHud(time);
            } else {
              square.y = top + half;
              square.vy = Math.abs(square.vy);
              registerBounce();
            }
          }

          if (square.y + half >= bottom) {
            if (
              exit?.wall === "bottom" &&
              fitsAndAlignsWithExit(square, exit, half)
            ) {
              escapingRef.current = true;
              escapingWallRef.current = "bottom";
              square.vy = Math.abs(square.vy);
              syncHud(time);
            } else {
              square.y = bottom - half;
              square.vy = -Math.abs(square.vy);
              registerBounce();
            }
          }

          if (square.x + half >= right) {
            if (
              exit?.wall === "right" &&
              fitsAndAlignsWithExit(square, exit, half)
            ) {
              escapingRef.current = true;
              escapingWallRef.current = "right";
              square.vx = Math.abs(square.vx);
              syncHud(time);
            } else {
              square.x = right - half;
              square.vx = -Math.abs(square.vx);
              registerBounce();
            }
          }
        }
      }

      const exit = currentExitRef.current;
      if (exit) {
        drawArena(
          ctx,
          arena,
          square,
          exit,
          previousExitRef.current,
          previousExitClosedAtRef.current,
          time,
        );
      }

      if (time - lastHudUpdateRef.current > HUD_UPDATE_INTERVAL * 1000) {
        lastHudUpdateRef.current = time;
        syncHud(time);
      }

      if (!escapedRef.current) {
        animationRef.current = requestAnimationFrame(step);
      }
    };

    const handleResize = () => {
      if (simulationStateRef.current !== "running") return;

      const previousSquare = squareRef.current;
      const arena = resizeCanvas(canvas);
      arenaRef.current = arena;
      rotateExit(arena, performance.now());

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
      } else if (previousSquare && escapingRef.current) {
        squareRef.current = previousSquare;
      } else {
        squareRef.current = resetSquare(arena, activeSettings);
      }

      const square = squareRef.current;
      const exit = currentExitRef.current;
      if (square && exit) {
        drawArena(
          ctx,
          arena,
          square,
          exit,
          previousExitRef.current,
          previousExitClosedAtRef.current,
          performance.now(),
        );
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
  }, [hasStarted, runId]);

  return (
    <div className="escape-root">
      {hasStarted ? <canvas ref={canvasRef} className="escape-canvas" /> : null}
      {!hasStarted ? (
        <div className="settings-layer">
          <section className="settings-panel" aria-label="Shrinking Escape settings">
            <div className="settings-heading">
              <span>Simulation Settings</span>
              <strong>Shrinking Escape</strong>
            </div>
            <div className="settings-controls">
              {settingControls.map((control) => {
                const limits = settingLimits[control.key];

                return (
                  <label key={control.key} className="setting-row">
                    <span className="setting-label">
                      {control.label}
                      <strong>{control.value}</strong>
                    </span>
                    <input
                      type="range"
                      min={limits.min}
                      max={limits.max}
                      step={limits.step}
                      value={settings[control.key]}
                      onChange={(event) =>
                        applySettingsUpdate(
                          control.key,
                          Number(event.currentTarget.value),
                        )
                      }
                    />
                  </label>
                );
              })}
            </div>
            <div className="settings-actions">
              <button type="button" className="primary-action" onClick={startSimulation}>
                Start
              </button>
              <button type="button" onClick={randomizeSettings}>
                Randomize All
              </button>
              <button type="button" onClick={resetSettings}>
                Reset Settings
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {hasStarted && !hud.exiting && !hud.escaped ? (
        <div className="escape-hud" aria-live="polite">
          <div className="hud-stat">
            <span>BOUNCES</span>
            <strong>{hud.bounces}</strong>
          </div>
          <div className="hud-stat">
            <span>SIZE</span>
            <strong>{hud.sizePercent}%</strong>
          </div>
          <div className="hud-stat">
            <span>EXIT</span>
            <strong>{hud.exitRemaining.toFixed(1)}s</strong>
          </div>
        </div>
      ) : null}
      {hud.escaped ? (
        <div className="escape-end" role="status" aria-live="assertive">
          <strong>ESCAPED</strong>
          <span>BOUNCES: {hud.bounces}</span>
          <span>SIZE: {hud.sizePercent}%</span>
          <span>TIME: {hud.elapsed.toFixed(1)}s</span>
          <div className="result-actions">
            <button type="button" onClick={playAgain}>
              PLAY AGAIN
            </button>
            <button type="button" onClick={resetSettings}>
              RESET SETTINGS
            </button>
          </div>
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

        .settings-layer {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background:
            radial-gradient(
              circle at 50% 32%,
              rgba(34, 197, 94, 0.11),
              transparent 30%
            ),
            radial-gradient(
              circle at 20% 18%,
              rgba(34, 211, 238, 0.11),
              transparent 26%
            ),
            #020617;
        }

        .settings-panel {
          width: min(560px, 100%);
          padding: 24px;
          border: 1px solid rgba(34, 211, 238, 0.24);
          border-radius: 18px;
          background: rgba(2, 6, 23, 0.86);
          box-shadow:
            0 24px 70px rgba(0, 0, 0, 0.42),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(14px);
        }

        .settings-heading {
          display: grid;
          gap: 8px;
          margin-bottom: 22px;
          font-family:
            "Geist Mono", "SFMono-Regular", "Roboto Mono", monospace;
          text-align: center;
        }

        .settings-heading span {
          color: #67e8f9;
          font-size: 0.72rem;
          font-weight: 900;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .settings-heading strong {
          color: #f8fafc;
          font-size: clamp(1.6rem, 5vw, 2.35rem);
          line-height: 1;
        }

        .settings-controls {
          display: grid;
          gap: 17px;
        }

        .setting-row {
          display: grid;
          gap: 10px;
        }

        .setting-label {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 14px;
          color: rgba(226, 246, 255, 0.82);
          font-size: 0.88rem;
          font-weight: 700;
        }

        .setting-label strong {
          flex: 0 0 auto;
          color: #bbf7d0;
          font-family:
            "Geist Mono", "SFMono-Regular", "Roboto Mono", monospace;
          font-size: 0.86rem;
        }

        .setting-row input {
          width: 100%;
          accent-color: #22c55e;
        }

        .settings-actions,
        .result-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 10px;
          margin-top: 22px;
        }

        .settings-actions button,
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

        .settings-actions button:hover,
        .result-actions button:hover {
          transform: translateY(-1px);
          border-color: rgba(34, 197, 94, 0.64);
          background: rgba(22, 101, 52, 0.28);
        }

        .settings-actions .primary-action {
          border-color: rgba(34, 197, 94, 0.58);
          background: rgba(34, 197, 94, 0.22);
          color: #dcfce7;
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
          .settings-layer {
            align-items: flex-start;
            padding: 18px 12px;
          }

          .settings-panel {
            width: 100%;
            padding: 20px 16px;
            border-radius: 16px;
          }

          .setting-label {
            align-items: flex-start;
            flex-direction: column;
            gap: 4px;
          }

          .settings-actions button,
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
