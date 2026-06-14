"use client";

import React, { useEffect, useRef } from "react";

type Arena = {
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
};

type ExitWall = "top" | "right" | "bottom" | "left";

type Cell = {
  x: number;
  y: number;
};

type Square = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  startSize: number;
  color: string;
  cells: Cell[];
};

type SimulationSettings = {
  squareSpeed: number;
  initialSquareSize: number;
};

type SimulationState = "running";

type BounceAudio = {
  unlock: () => Promise<void>;
  playBounce: () => void;
  dispose: () => void;
};

const HUD_RESERVED_HEIGHT_DESKTOP = 142;
const HUD_RESERVED_HEIGHT_MOBILE = 158;
const ARENA_SAFE_SPACING = 24;
const MOBILE_BOTTOM_SAFE_SPACING = 28;
const SPEED_PER_BOUNDARY_AT_1X = 0.2;
const DEBUG_SETTINGS_LOGS = true;
const defaultSettings: SimulationSettings = {
  squareSpeed: 6,
  initialSquareSize: 4,
};

let sharedAudioContext: AudioContext | null = null;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const logConfigValue = (label: string, value: unknown) => {
  if (!DEBUG_SETTINGS_LOGS) return;
  console.info(`[Merging Squares settings] ${label}:`, value);
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

const resetSquare = (
  arena: Arena,
  settings: SimulationSettings,
  index = 0,
  id = index,
): Square => {
  const size = arena.width * (settings.initialSquareSize / 100);
  const speed = getSquareSpeed(arena, settings);
  let angle = Math.random() * Math.PI * 2 + index * Math.PI;

  if (Math.abs(Math.cos(angle)) < 0.32) {
    angle += 0.55;
  }

  return {
    id,
    x: arena.x + arena.width * (index === 0 ? 0.42 : 0.58),
    y: arena.y + arena.height * (index === 0 ? 0.42 : 0.58),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    size,
    startSize: size,
    color: "#d77026",
    cells: [{ x: 0, y: 0 }],
  };
};

const getSquarePairKey = (first: Square, second: Square) =>
  first.id < second.id
    ? `${first.id}:${second.id}`
    : `${second.id}:${first.id}`;

const getBodyBounds = (square: Square) => {
  const half = square.size / 2;
  const xs = square.cells.map((cell) => square.x + cell.x * square.size);
  const ys = square.cells.map((cell) => square.y + cell.y * square.size);

  return {
    left: Math.min(...xs) - half,
    right: Math.max(...xs) + half,
    top: Math.min(...ys) - half,
    bottom: Math.max(...ys) + half,
  };
};

const doSquaresOverlap = (first: Square, second: Square) => {
  const firstBounds = getBodyBounds(first);
  const secondBounds = getBodyBounds(second);

  return (
    firstBounds.left < secondBounds.right &&
    firstBounds.right > secondBounds.left &&
    firstBounds.top < secondBounds.bottom &&
    firstBounds.bottom > secondBounds.top
  );
};

const getOverlappingSquarePairs = (squares: Square[]) => {
  const pairs = new Set<string>();

  for (let i = 0; i < squares.length; i += 1) {
    for (let j = i + 1; j < squares.length; j += 1) {
      if (doSquaresOverlap(squares[i], squares[j])) {
        pairs.add(getSquarePairKey(squares[i], squares[j]));
      }
    }
  }

  return pairs;
};

const getCellWorldPosition = (square: Square, cell: Cell) => ({
  x: square.x + cell.x * square.size,
  y: square.y + cell.y * square.size,
});

const isSingleSquarePositionEmpty = (
  x: number,
  y: number,
  size: number,
  squares: Square[],
) => {
  const half = size / 2;
  const candidate = {
    left: x - half,
    right: x + half,
    top: y - half,
    bottom: y + half,
  };

  return squares.every((square) => {
    const bounds = getBodyBounds(square);
    return (
      candidate.right <= bounds.left ||
      candidate.left >= bounds.right ||
      candidate.bottom <= bounds.top ||
      candidate.top >= bounds.bottom
    );
  });
};

const findRandomEmptySingleSquarePosition = (
  arena: Arena,
  size: number,
  squares: Square[],
) => {
  const half = size / 2;
  const minX = arena.x + half;
  const maxX = arena.x + arena.width - half;
  const minY = arena.y + half;
  const maxY = arena.y + arena.height - half;

  for (let attempt = 0; attempt < 240; attempt += 1) {
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);

    if (isSingleSquarePositionEmpty(x, y, size, squares)) {
      return { x, y };
    }
  }

  const columns = Math.floor(arena.width / size);
  const rows = Math.floor(arena.height / size);
  const totalCells = columns * rows;
  const startCell = Math.floor(Math.random() * Math.max(1, totalCells));

  for (let offset = 0; offset < totalCells; offset += 1) {
    const cell = (startCell + offset) % totalCells;
    const column = cell % columns;
    const row = Math.floor(cell / columns);
    const x = arena.x + half + column * size;
    const y = arena.y + half + row * size;

    if (isSingleSquarePositionEmpty(x, y, size, squares)) {
      return { x, y };
    }
  }

  return null;
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
  squares: Square[],
) => {
  const isMobile = window.innerWidth < 600;
  const boundaryLineWidth = isMobile ? 2.25 : 3;
  const boundaryGlow = isMobile ? 7 : 11;
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
  ctx.lineWidth = isMobile ? 9 : 12;
  ctx.strokeRect(arena.x + 6, arena.y + 6, arena.width - 12, arena.height - 12);
  ctx.strokeStyle = "rgba(124, 143, 163, 0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(arena.x + 10, arena.y + 10, arena.width - 20, arena.height - 20);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "rgba(124, 143, 163, 0.32)";
  ctx.shadowBlur = boundaryGlow;
  ctx.strokeStyle = "rgba(124, 143, 163, 0.82)";
  ctx.lineWidth = boundaryLineWidth;
  ctx.lineCap = "round";
  ctx.beginPath();
  (["top", "right", "bottom", "left"] as ExitWall[]).forEach((wall) => {
    drawWallSegment(ctx, arena, wall, 0, arena.width);
  });
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(226, 232, 240, 0.08)";
  ctx.lineWidth = 1;
  ctx.strokeRect(arena.x + 5, arena.y + 5, arena.width - 10, arena.height - 10);
  ctx.fillStyle = "rgba(241, 245, 249, 0.9)";
  ctx.shadowColor = "rgba(148, 163, 184, 0.32)";
  ctx.shadowBlur = isMobile ? 8 : 12;
  ctx.font = `800 ${isMobile ? 14 : 19}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const caption = isMobile
    ? ["WHAT WEIRD STRUCTURES", "WILL THESE BLOCKS CREATE?"]
    : ["WHAT WEIRD STRUCTURES WILL THESE COLLIDING BLOCKS CREATE?"];
  const lineHeight = isMobile ? 18 : 24;
  caption.forEach((line, index) => {
    ctx.fillText(
      line,
      arena.x + arena.width / 2,
      arena.y - 16 - (caption.length - index - 1) * lineHeight,
    );
  });
  ctx.restore();

  squares.forEach((square) => {
    const ratio = square.size / square.startSize;
    const half = square.size / 2;

    square.cells.forEach((cell) => {
      ctx.save();
      ctx.translate(square.x + cell.x * square.size, square.y + cell.y * square.size);
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
    });
  });
};

const ShrinkingEscape = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<BounceAudio | null>(null);
  const settingsRef = useRef<SimulationSettings>(defaultSettings);
  const arenaRef = useRef<Arena | null>(null);
  const squaresRef = useRef<Square[]>([]);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const mergesRef = useRef(0);
  const nextSquareIdRef = useRef(2);
  const activeSquareCollisionPairsRef = useRef<Set<string>>(new Set());
  const simulationStateRef = useRef<SimulationState>("running");

  if (audioRef.current === null) {
    audioRef.current = createBounceAudio();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const activeSettings = settingsRef.current;

    const initialize = () => {
      const arena = resizeCanvas(canvas);
      const startedAt = performance.now();
      arenaRef.current = arena;
      nextSquareIdRef.current = 2;
      activeSquareCollisionPairsRef.current = new Set();
      squaresRef.current = [
        resetSquare(arena, activeSettings, 0, 0),
        resetSquare(arena, activeSettings, 1, 1),
      ];
      const squares = squaresRef.current;
      mergesRef.current = 0;
      simulationStateRef.current = "running";
      lastTimeRef.current = startedAt;

      logConfigValue("actual square speed px/s", Math.hypot(squares[0].vx, squares[0].vy));
      logConfigValue("actual initial square size percent", {
        percentOfBoundary: Number(((squares[0].size / arena.width) * 100).toFixed(2)),
        squareSizePx: Number(squares[0].size.toFixed(2)),
        boundarySizePx: Number(arena.width.toFixed(2)),
      });
    };

    const playBounce = () => {
      if (simulationStateRef.current !== "running") return;
      audioRef.current?.playBounce();
    };

    const createRandomSingleSquare = (arena: Arena, source: Square) => {
      const spawnPosition = findRandomEmptySingleSquarePosition(
        arena,
        source.size,
        squaresRef.current,
      );
      if (!spawnPosition) return null;

      const speed = getSquareSpeed(arena, activeSettings);
      const angle = Math.random() * Math.PI * 2;
      const spawned: Square = {
        id: nextSquareIdRef.current,
        x: spawnPosition.x,
        y: spawnPosition.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: source.size,
        startSize: source.startSize,
        color: source.color,
        cells: [{ x: 0, y: 0 }],
      };

      nextSquareIdRef.current += 1;
      return spawned;
    };

    const getNearestMergeShift = (target: Square, source: Square) => {
      const candidates: Array<{ score: number; shift: Cell }> = [];

      for (const targetCell of target.cells) {
        for (const sourceCell of source.cells) {
          const targetWorld = getCellWorldPosition(target, targetCell);
          const sourceWorld = getCellWorldPosition(source, sourceCell);
          const targetBounds = {
            left: targetWorld.x - target.size / 2,
            right: targetWorld.x + target.size / 2,
            top: targetWorld.y - target.size / 2,
            bottom: targetWorld.y + target.size / 2,
          };
          const sourceBounds = {
            left: sourceWorld.x - source.size / 2,
            right: sourceWorld.x + source.size / 2,
            top: sourceWorld.y - source.size / 2,
            bottom: sourceWorld.y + source.size / 2,
          };

          candidates.push(
            {
              score:
                Math.abs(sourceBounds.left - targetBounds.right) +
                Math.abs(sourceWorld.y - targetWorld.y) * 1.4,
              shift: {
                x: targetCell.x + 1 - sourceCell.x,
                y: targetCell.y - sourceCell.y,
              },
            },
            {
              score:
                Math.abs(sourceBounds.right - targetBounds.left) +
                Math.abs(sourceWorld.y - targetWorld.y) * 1.4,
              shift: {
                x: targetCell.x - 1 - sourceCell.x,
                y: targetCell.y - sourceCell.y,
              },
            },
            {
              score:
                Math.abs(sourceBounds.top - targetBounds.bottom) +
                Math.abs(sourceWorld.x - targetWorld.x) * 1.4,
              shift: {
                x: targetCell.x - sourceCell.x,
                y: targetCell.y + 1 - sourceCell.y,
              },
            },
            {
              score:
                Math.abs(sourceBounds.bottom - targetBounds.top) +
                Math.abs(sourceWorld.x - targetWorld.x) * 1.4,
              shift: {
                x: targetCell.x - sourceCell.x,
                y: targetCell.y - 1 - sourceCell.y,
              },
            },
          );
        }
      }

      const occupied = new Set(target.cells.map((cell) => `${cell.x}:${cell.y}`));
      const orderedCandidates = candidates.sort((a, b) => a.score - b.score);

      for (const candidate of orderedCandidates) {
        const shiftedSourceCells = source.cells.map((cell) => ({
          x: cell.x + candidate.shift.x,
          y: cell.y + candidate.shift.y,
        }));
        const hasOverlap = shiftedSourceCells.some((cell) =>
          occupied.has(`${cell.x}:${cell.y}`),
        );
        if (hasOverlap) continue;

        const hasFullEdgeConnection = shiftedSourceCells.some((sourceCell) =>
          target.cells.some((targetCell) => {
            const dx = Math.abs(sourceCell.x - targetCell.x);
            const dy = Math.abs(sourceCell.y - targetCell.y);
            return dx + dy === 1;
          }),
        );

        if (hasFullEdgeConnection) {
          return candidate.shift;
        }
      }

      return null;
    };

    const mergeSquares = (
      target: Square,
      source: Square,
      shift: Cell,
      arena: Arena,
    ) => {
      const occupied = new Set(target.cells.map((cell) => `${cell.x}:${cell.y}`));
      source.cells.forEach((cell) => {
        const mergedCell = {
          x: cell.x + shift.x,
          y: cell.y + shift.y,
        };
        const key = `${mergedCell.x}:${mergedCell.y}`;
        if (!occupied.has(key)) {
          occupied.add(key);
          target.cells.push(mergedCell);
        }
      });

      const mergedVx = (target.vx + source.vx) / 2;
      const mergedVy = (target.vy + source.vy) / 2;
      const targetSpeed = getSquareSpeed(arena, activeSettings);
      const mergedSpeed = Math.hypot(mergedVx, mergedVy) || 1;
      target.vx = (mergedVx / mergedSpeed) * targetSpeed;
      target.vy = (mergedVy / mergedSpeed) * targetSpeed;

      const bounds = getBodyBounds(target);
      if (bounds.left < arena.x) target.x += arena.x - bounds.left;
      if (bounds.right > arena.x + arena.width) {
        target.x -= bounds.right - (arena.x + arena.width);
      }
      if (bounds.top < arena.y) target.y += arena.y - bounds.top;
      if (bounds.bottom > arena.y + arena.height) {
        target.y -= bounds.bottom - (arena.y + arena.height);
      }

      mergesRef.current += 1;
    };

    const resolveSquareCollisions = (arena: Arena) => {
      const squares = squaresRef.current;

      for (let i = 0; i < squares.length; i += 1) {
        for (let j = i + 1; j < squares.length; j += 1) {
          const first = squares[i];
          const second = squares[j];
          const firstBounds = getBodyBounds(first);
          const secondBounds = getBodyBounds(second);
          const halfOverlapX =
            Math.min(firstBounds.right, secondBounds.right) -
            Math.max(firstBounds.left, secondBounds.left);
          const halfOverlapY =
            Math.min(firstBounds.bottom, secondBounds.bottom) -
            Math.max(firstBounds.top, secondBounds.top);

          if (halfOverlapX <= 0 || halfOverlapY <= 0) continue;

          const separateOnX = halfOverlapX < halfOverlapY;
          const mergeShift = getNearestMergeShift(first, second);
          const direction = separateOnX
            ? first.x < second.x
              ? -1
              : 1
            : first.y < second.y
              ? -1
              : 1;

          if (separateOnX) {
            first.x += (halfOverlapX / 2) * direction;
            second.x -= (halfOverlapX / 2) * direction;
          } else {
            first.y += (halfOverlapY / 2) * direction;
            second.y -= (halfOverlapY / 2) * direction;
          }

          playBounce();
          if (!mergeShift) {
            if (separateOnX) {
              const firstVx = first.vx;
              first.vx = second.vx;
              second.vx = firstVx;
            } else {
              const firstVy = first.vy;
              first.vy = second.vy;
              second.vy = firstVy;
            }
            activeSquareCollisionPairsRef.current =
              getOverlappingSquarePairs(squares);
            return;
          }

          const newborn = createRandomSingleSquare(arena, first);
          mergeSquares(first, second, mergeShift, arena);
          squares.splice(j, 1);
          if (newborn) {
            squares.push(newborn);
          }
          activeSquareCollisionPairsRef.current = getOverlappingSquarePairs(squares);
          return;
        }
      }

      activeSquareCollisionPairsRef.current = getOverlappingSquarePairs(squares);
    };

    const step = (time: number) => {
      if (simulationStateRef.current !== "running") return;

      const arena = arenaRef.current;
      const squares = squaresRef.current;
      if (!arena || squares.length === 0) return;

      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.033);
      lastTimeRef.current = time;

      const left = arena.x;
      const right = arena.x + arena.width;
      const top = arena.y;
      const bottom = arena.y + arena.height;

      squares.forEach((square) => {
        square.x += square.vx * dt;
        square.y += square.vy * dt;

        const bounds = getBodyBounds(square);

        if (bounds.left <= left) {
          square.x += left - bounds.left;
          square.vx = Math.abs(square.vx);
          playBounce();
        }

        if (bounds.top <= top) {
          square.y += top - bounds.top;
          square.vy = Math.abs(square.vy);
          playBounce();
        }

        if (bounds.bottom >= bottom) {
          square.y -= bounds.bottom - bottom;
          square.vy = -Math.abs(square.vy);
          playBounce();
        }

        if (bounds.right >= right) {
          square.x -= bounds.right - right;
          square.vx = -Math.abs(square.vx);
          playBounce();
        }
      });

      resolveSquareCollisions(arena);
      drawArena(ctx, arena, squares);

      animationRef.current = requestAnimationFrame(step);
    };

    const handleResize = () => {
      if (simulationStateRef.current !== "running") return;

      const previousSquares = squaresRef.current;
      const arena = resizeCanvas(canvas);
      arenaRef.current = arena;

      if (previousSquares.length > 0) {
        previousSquares.forEach((square) => {
          const bounds = getBodyBounds(square);
          square.x = clamp(
            square.x,
            square.x + arena.x - bounds.left,
            square.x + arena.x + arena.width - bounds.right,
          );
          square.y = clamp(
            square.y,
            square.y + arena.y - bounds.top,
            square.y + arena.y + arena.height - bounds.bottom,
          );
        });
      } else {
        nextSquareIdRef.current = 2;
        activeSquareCollisionPairsRef.current = new Set();
        squaresRef.current = [
          resetSquare(arena, activeSettings, 0, 0),
          resetSquare(arena, activeSettings, 1, 1),
        ];
      }

      if (squaresRef.current.length > 0) {
        drawArena(ctx, arena, squaresRef.current);
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
      `}</style>
    </div>
  );
};

export default ShrinkingEscape;
