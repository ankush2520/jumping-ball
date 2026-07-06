"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { drawCanvasWatermark } from "@/app/lib/watermark";

// ─── Constants ────────────────────────────────────────────────────────────────

const HUD_DESKTOP = 150;
const HUD_MOBILE = 168;
const MAX_DT = 1 / 30;
const SUBSTEPS = 5;
const SOUND_GAP_MS = 55;

const GRAVITY_K = 0.45; // px/s² per px of corridor width
const MAX_FALL_K = 1.85; // px/s cap per px of corridor width
const WALL_RESTITUTION = 0.92;
const OBSTACLE_RESTITUTION = 0.7;
const BALL_RESTITUTION = 0.82;
const ANTI_STALL_SECS = 1.3; // tolerant enough to let a ball wait out a closed gate

const RACE_END_GRACE_MS = 6000;
const COUNTDOWN_MS = 3000;
const START_SCREEN_FRACTION = 0.2; // where the start platform sits on screen (0 = top)

const GATE_PERIOD_SEC = 1; // closed 1s / open 1s, repeating
const PADDLE_KICK_K = 1.05; // × arena.width upward kick on paddle contact
const ROTATOR_SPEED = 1.9; // rad/s
const ROTATOR_FLING_K = 0.55; // fraction of the spinning bar's tip speed added to the ball
const PLATFORM_OPEN_MS = 450;

const PEG_RESTITUTION = 0.78;
const BUMPER_RESTITUTION = 1.02; // >1 so bumpers ADD energy, pinball style
const BUMPER_KICK_K = 0.55; // × arena.width impulse on bumper hit
const CONVEYOR_PUSH_K = 0.9; // × arena.width sideways shove along a conveyor

const BALL_DEFS = [
  { name: "Red", hue: 0 },
  { name: "Yellow", hue: 60 },
  { name: "Green", hue: 120 },
  { name: "Cyan", hue: 180 },
  { name: "Blue", hue: 240 },
  { name: "Pink", hue: 300 },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "menu" | "countdown" | "racing" | "finished";

type Ball = {
  id: number;
  name: string;
  hue: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  glow: number;
  finished: boolean;
  rank: number | null;
  stuckTimer: number;
  maxY: number;
};

type Slat = {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
};

type Paddle = {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
};

type Rotator = {
  id: number;
  cx: number;
  cy: number;
  length: number;
  thickness: number;
  speed: number;
  angle0: number;
};

type Gate = {
  id: number;
  shape: "bowl" | "flat";
  segments: Slat[];
};

type TrapCup = {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  sendToY: number;
};

type Peg = {
  id: number;
  x: number;
  y: number;
  r: number;
};

type Bumper = {
  id: number;
  x: number;
  y: number;
  r: number;
  flash: number; // 0..1 visual pulse, decays after a hit
};

type Conveyor = {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
  dir: 1 | -1; // push direction along the segment (tail→head or head→tail)
};

type PlatformHalf = { x: number; y: number; w: number; h: number };
type StartPlatform = { left: PlatformHalf; right: PlatformHalf };

type Course = {
  slats: Slat[];
  paddles: Paddle[];
  rotators: Rotator[];
  gates: Gate[];
  traps: TrapCup[];
  pegs: Peg[];
  bumpers: Bumper[];
  conveyors: Conveyor[];
  platform: StartPlatform;
  finishY: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  hue: number;
};

type Arena = {
  x: number;
  y: number;
  width: number;
  height: number;
  W: number;
  H: number;
};

type RaceAudio = {
  unlock: () => void;
  hit: (hue: number) => void;
  penalty: () => void;
  win: () => void;
  dispose: () => void;
};

// ─── Canvas / Arena ───────────────────────────────────────────────────────────

function resizeCanvas(canvas: HTMLCanvasElement): {
  arena: Arena;
  dpr: number;
} {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(window.visualViewport?.width ?? window.innerWidth);
  const H = Math.round(window.visualViewport?.height ?? window.innerHeight);
  const mobile = W < 600;
  const hudH = mobile ? HUD_MOBILE : HUD_DESKTOP;
  const pad = mobile ? 0 : 24;
  const maxWidth = mobile ? Infinity : 520;
  const width = Math.min(W - pad * 2, maxWidth);
  const height = Math.max(240, H - hudH - (mobile ? 0 : pad));
  const x = Math.round((W - width) / 2);
  const y = hudH;

  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);

  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }

  return { arena: { x, y, width, height, W, H }, dpr };
}

// ─── Course generation ────────────────────────────────────────────────────────
//
// Fixed 3-level layout (each level is one screen-height tall):
//   start platform (opens at GO)
//   level 1 — "Pin Storm": funnels + staggered peg fields + a peg arc
//   level 2 — "The Machine": timed bowl gate, bumper cluster, conveyor
//     ramps, a rotator pair
//   level 3 — "The Gauntlet": send-back trap, peg field, a rotator, a
//     timed flat gate, a peg arc, bumper cluster into the finish
//

function buildStartPlatform(arena: Arena, ballR: number): StartPlatform {
  const width = arena.width;
  const left = arena.x;
  const y = ballR * 7.4;
  const h = ballR * 1.6;
  const gap = width * 0.14;
  const halfW = (width - gap) / 2;
  return {
    left: { x: left, y, w: halfW, h },
    right: { x: left + halfW + gap, y, w: halfW, h },
  };
}

function generateCourse(arena: Arena, ballR: number): Course {
  const width = arena.width;
  const left = arena.x;
  const right = arena.x + width;
  const thickness = ballR * 0.62;
  const levelH = arena.height;

  const platform = buildStartPlatform(arena, ballR);
  const level1Y0 = platform.left.y + platform.left.h + ballR * 3;
  const level2Y0 = level1Y0 + levelH;
  const level3Y0 = level2Y0 + levelH;
  const level3End = level3Y0 + levelH;
  const finishY = level3End + ballR * 12;

  const slats: Slat[] = [];
  const paddles: Paddle[] = [];
  const rotators: Rotator[] = [];
  const gates: Gate[] = [];
  const traps: TrapCup[] = [];
  const pegs: Peg[] = [];
  const bumpers: Bumper[] = [];
  const conveyors: Conveyor[] = [];
  let sid = 0;
  let rid = 0;
  let gid = 0;
  let tid = 0;
  let pgid = 0;
  let bid = 0;
  let cid = 0;

  // A staggered peg field — the classic Plinko scatter. Rows alternate offset
  // so a ball can never fall straight through; every row nudges it sideways.
  // `span` is the absolute world-unit height the field should occupy, so it
  // always fills the zone it's given regardless of ball size or screen height.
  const addPegField = (topY: number, rows: number, span: number) => {
    const cols = 5;
    const usable = width - ballR * 4;
    const colGap = (usable / cols) * 1.25;
    const rowGap = rows > 1 ? span / (rows - 1) : 0;
    const pegR = ballR * 0.55 * 0.85;
    for (let row = 0; row < rows; row++) {
      const offset = row % 2 === 0 ? 0 : colGap / 2;
      const y = topY + row * rowGap;
      for (let c = 0; c <= cols; c++) {
        const x = left + ballR * 2 + c * colGap + offset;
        if (x < left + pegR + 2 || x > right - pegR - 2) continue;
        pegs.push({ id: pgid++, x, y, r: pegR });
      }
    }
  };

  // A ring/arc of pegs forming a soft curved deflector.
  const addPegArc = (cx: number, cy: number, radius: number, count: number) => {
    const pegR = ballR * 0.55 * 0.85;
    for (let i = 0; i < count; i++) {
      const t = Math.PI * (0.15 + (0.7 * i) / (count - 1));
      pegs.push({
        id: pgid++,
        x: cx - Math.cos(t) * radius,
        y: cy + Math.sin(t) * radius * 0.5,
        r: pegR,
      });
    }
  };

  const addBumper = (x: number, y: number, r: number) => {
    bumpers.push({ id: bid++, x, y, r, flash: 0 });
  };

  // Three bumpers in a triangle — a little pinball pocket.
  const addBumperCluster = (cy: number) => {
    const r = ballR * 1.15;
    addBumper(left + width * 0.5, cy, r);
    addBumper(left + width * 0.26, cy + r * 2.2, r);
    addBumper(left + width * 0.74, cy + r * 2.2, r);
  };

  // Angled conveyor: a wall that shoves the ball along its length as it rolls.
  const addConveyor = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    dir: 1 | -1,
  ) => {
    conveyors.push({
      id: cid++,
      x1,
      y1,
      x2,
      y2,
      thickness: thickness * 1.4,
      dir,
    });
  };

  const addFunnel = (topY: number, rowH: number) => {
    const gap = ballR * (5.6 + Math.random() * 1.2);
    const centerX = left + width * (0.38 + Math.random() * 0.24);
    const midY = topY + rowH * 0.6;
    slats.push({
      id: sid++,
      x1: left + width * 0.05,
      y1: topY,
      x2: centerX - gap / 2,
      y2: midY,
      thickness,
    });
    slats.push({
      id: sid++,
      x1: right - width * 0.05,
      y1: topY,
      x2: centerX + gap / 2,
      y2: midY,
      thickness,
    });
  };

  const addBowlGate = (cy: number) => {
    const cx = left + width / 2;
    const radius = width / 2 - ballR * 0.3;
    const segCount = 28;
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= segCount; i++) {
      const t = (i / segCount) * Math.PI;
      points.push({
        x: cx - Math.cos(t) * radius,
        y: cy + Math.sin(t) * radius * 0.4,
      });
    }
    const segments: Slat[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      segments.push({
        id: i,
        x1: points[i].x,
        y1: points[i].y,
        x2: points[i + 1].x,
        y2: points[i + 1].y,
        thickness,
      });
    }
    gates.push({ id: gid++, shape: "bowl", segments });
  };

  const addFlatGate = (cy: number) => {
    gates.push({
      id: gid++,
      shape: "flat",
      segments: [
        { id: 0, x1: left + 4, y1: cy, x2: right - 4, y2: cy, thickness },
      ],
    });
  };

  const addRotatorPair = (cy: number) => {
    const length = width * 0.24;
    rotators.push({
      id: rid++,
      cx: left + width * 0.3,
      cy,
      length,
      thickness: thickness * 1.4,
      speed: ROTATOR_SPEED,
      angle0: 0,
    });
    rotators.push({
      id: rid++,
      cx: left + width * 0.7,
      cy,
      length,
      thickness: thickness * 1.4,
      speed: -ROTATOR_SPEED,
      angle0: Math.PI / 2,
    });
  };

  const addRotatorSingle = (cy: number) => {
    rotators.push({
      id: rid++,
      cx: left + width * 0.5,
      cy,
      length: width * 0.34,
      thickness: thickness * 1.4,
      speed: ROTATOR_SPEED * 0.9,
      angle0: 0,
    });
  };

  const addTrap = (cy: number) => {
    traps.push({
      id: tid++,
      x: left + width * 0.08,
      y: cy,
      w: width * 0.22,
      h: ballR * 3,
      sendToY: level2Y0 + ballR * 6,
    });
  };

  // Level 1 — "Pin Storm": alternating funnels and peg fields, edge-to-edge
  // with no dead space between features.
  addFunnel(level1Y0 + levelH * 0.0, levelH * 0.12);
  addPegField(level1Y0 + levelH * 0.14, 5, levelH * 0.2);
  addPegArc(left + width * 0.5, level1Y0 + levelH * 0.37, width * 0.42, 7);
  addFunnel(level1Y0 + levelH * 0.42, levelH * 0.12);
  addPegField(level1Y0 + levelH * 0.56, 5, levelH * 0.2);
  addPegArc(left + width * 0.5, level1Y0 + levelH * 0.79, width * 0.42, 7);
  addFunnel(level1Y0 + levelH * 0.86, levelH * 0.12);

  // Level 2 — "The Machine": bumpers, peg fields, conveyor ramps and
  // rotators packed back-to-back down the whole level.
  addBowlGate(level2Y0 + levelH * 0.05);
  addBumperCluster(level2Y0 + levelH * 0.11);
  addPegField(level2Y0 + levelH * 0.19, 4, levelH * 0.16);
  addConveyor(
    left + width * 0.1,
    level2Y0 + levelH * 0.38,
    left + width * 0.6,
    level2Y0 + levelH * 0.44,
    1,
  );
  addRotatorSingle(level2Y0 + levelH * 0.5);
  addPegArc(left + width * 0.5, level2Y0 + levelH * 0.57, width * 0.4, 6);
  addConveyor(
    right - width * 0.1,
    level2Y0 + levelH * 0.64,
    left + width * 0.4,
    level2Y0 + levelH * 0.7,
    -1,
  );
  addBumperCluster(level2Y0 + levelH * 0.78);
  addRotatorPair(level2Y0 + levelH * 0.88);

  // Level 3 — "The Gauntlet": send-back trap, peg fields, rotators, and a
  // timed flat gate, packed all the way to the finish.
  addTrap(level3Y0 + levelH * 0.04);
  addPegField(level3Y0 + levelH * 0.12, 4, levelH * 0.16);
  addRotatorSingle(level3Y0 + levelH * 0.32);
  addPegArc(left + width * 0.5, level3Y0 + levelH * 0.39, width * 0.4, 6);
  addFlatGate(level3Y0 + levelH * 0.46);
  addPegField(level3Y0 + levelH * 0.52, 4, levelH * 0.16);
  addRotatorSingle(level3Y0 + levelH * 0.72);
  addPegArc(left + width * 0.5, level3Y0 + levelH * 0.79, width * 0.4, 6);
  addBumperCluster(level3Y0 + levelH * 0.86);
  addFunnel(level3Y0 + levelH * 0.94, levelH * 0.06);

  return {
    slats,
    paddles,
    rotators,
    gates,
    traps,
    pegs,
    bumpers,
    conveyors,
    platform,
    finishY,
  };
}

function spawnBalls(platform: StartPlatform, ballR: number): Ball[] {
  const leftXs = [0.22, 0.5, 0.78].map(
    (f) => platform.left.x + platform.left.w * f,
  );
  const rightXs = [0.22, 0.5, 0.78].map(
    (f) => platform.right.x + platform.right.w * f,
  );
  const xs = [...leftXs, ...rightXs];
  const y = platform.left.y - ballR * 1.3;
  return BALL_DEFS.map((def, i) => ({
    id: i,
    name: def.name,
    hue: def.hue,
    x: xs[i],
    y,
    vx: 0,
    vy: 0,
    r: ballR,
    glow: 0,
    finished: false,
    rank: null,
    stuckTimer: 0,
    maxY: y,
  }));
}

function gateIsClosed(elapsed: number): boolean {
  const cycle = elapsed % (GATE_PERIOD_SEC * 2);
  return cycle < GATE_PERIOD_SEC;
}

// ─── Collision helpers ────────────────────────────────────────────────────────

function resolveWalls(
  ball: Ball,
  left: number,
  right: number,
  audio: RaceAudio,
) {
  if (ball.x - ball.r < left) {
    ball.x = left + ball.r;
    ball.vx = Math.abs(ball.vx) * WALL_RESTITUTION;
    audio.hit(ball.hue);
  }
  if (ball.x + ball.r > right) {
    ball.x = right - ball.r;
    ball.vx = -Math.abs(ball.vx) * WALL_RESTITUTION;
    audio.hit(ball.hue);
  }
}

function resolveSlat(ball: Ball, slat: Slat, audio: RaceAudio) {
  const { x1, y1, x2, y2, thickness } = slat;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy || 1;
  let t = ((ball.x - x1) * dx + (ball.y - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  const ddx = ball.x - px;
  const ddy = ball.y - py;
  const dist = Math.hypot(ddx, ddy);
  const min = ball.r + thickness / 2;
  if (dist >= min || dist === 0) return;
  const nx = ddx / dist;
  const ny = ddy / dist;
  ball.x += nx * (min - dist);
  ball.y += ny * (min - dist);
  const vn = ball.vx * nx + ball.vy * ny;
  if (vn < 0) {
    ball.vx -= (1 + OBSTACLE_RESTITUTION) * vn * nx;
    ball.vy -= (1 + OBSTACLE_RESTITUTION) * vn * ny;
    ball.vx *= 0.99;
    ball.vy *= 0.99;
  }
  ball.glow = 0.3;
  audio.hit(ball.hue);
}

function resolvePaddle(
  ball: Ball,
  paddle: Paddle,
  kick: number,
  audio: RaceAudio,
) {
  const { x1, y1, x2, y2, thickness } = paddle;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy || 1;
  let t = ((ball.x - x1) * dx + (ball.y - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  const ddx = ball.x - px;
  const ddy = ball.y - py;
  const dist = Math.hypot(ddx, ddy);
  const min = ball.r + thickness / 2;
  if (dist >= min || dist === 0) return;
  const nx = ddx / dist;
  const ny = ddy / dist;
  ball.x += nx * (min - dist);
  ball.y += ny * (min - dist);
  const vn = ball.vx * nx + ball.vy * ny;
  if (vn < 0) {
    ball.vx -= (1 + OBSTACLE_RESTITUTION) * vn * nx;
    ball.vy -= (1 + OBSTACLE_RESTITUTION) * vn * ny;
  }
  ball.vy -= kick;
  ball.glow = 0.4;
  audio.hit(ball.hue);
}

function resolveRotator(
  ball: Ball,
  rotator: Rotator,
  elapsed: number,
  audio: RaceAudio,
) {
  const angle = rotator.angle0 + rotator.speed * elapsed;
  const hx = Math.cos(angle) * (rotator.length / 2);
  const hy = Math.sin(angle) * (rotator.length / 2);
  const x1 = rotator.cx - hx;
  const y1 = rotator.cy - hy;
  const x2 = rotator.cx + hx;
  const y2 = rotator.cy + hy;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy || 1;
  let t = ((ball.x - x1) * dx + (ball.y - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  const ddx = ball.x - px;
  const ddy = ball.y - py;
  const dist = Math.hypot(ddx, ddy);
  const min = ball.r + rotator.thickness / 2;
  if (dist >= min || dist === 0) return;
  const nx = ddx / dist;
  const ny = ddy / dist;
  ball.x += nx * (min - dist);
  ball.y += ny * (min - dist);
  const vn = ball.vx * nx + ball.vy * ny;
  if (vn < 0) {
    ball.vx -= (1 + OBSTACLE_RESTITUTION) * vn * nx;
    ball.vy -= (1 + OBSTACLE_RESTITUTION) * vn * ny;
  }
  const s = (t - 0.5) * rotator.length;
  const pointVx = -Math.sin(angle) * rotator.speed * s;
  const pointVy = Math.cos(angle) * rotator.speed * s;
  ball.vx += pointVx * ROTATOR_FLING_K;
  ball.vy += pointVy * ROTATOR_FLING_K;
  ball.glow = 0.4;
  audio.hit(ball.hue);
}

function resolvePeg(ball: Ball, peg: Peg, audio: RaceAudio) {
  const ddx = ball.x - peg.x;
  const ddy = ball.y - peg.y;
  const dist = Math.hypot(ddx, ddy);
  const min = ball.r + peg.r;
  if (dist >= min || dist === 0) return;
  const nx = ddx / dist;
  const ny = ddy / dist;
  ball.x += nx * (min - dist);
  ball.y += ny * (min - dist);
  const vn = ball.vx * nx + ball.vy * ny;
  if (vn < 0) {
    ball.vx -= (1 + PEG_RESTITUTION) * vn * nx;
    ball.vy -= (1 + PEG_RESTITUTION) * vn * ny;
    ball.vx += (Math.random() - 0.5) * ball.r * 4;
  }
  ball.glow = 0.3;
  audio.hit(ball.hue);
}

function resolveBumper(
  ball: Ball,
  bumper: Bumper,
  kick: number,
  audio: RaceAudio,
) {
  const ddx = ball.x - bumper.x;
  const ddy = ball.y - bumper.y;
  const dist = Math.hypot(ddx, ddy);
  const min = ball.r + bumper.r;
  if (dist >= min || dist === 0) return;
  const nx = ddx / dist;
  const ny = ddy / dist;
  ball.x += nx * (min - dist);
  ball.y += ny * (min - dist);
  const vn = ball.vx * nx + ball.vy * ny;
  if (vn < 0) {
    ball.vx -= (1 + BUMPER_RESTITUTION) * vn * nx;
    ball.vy -= (1 + BUMPER_RESTITUTION) * vn * ny;
  }
  ball.vx += nx * kick;
  ball.vy += ny * kick;
  bumper.flash = 1;
  ball.glow = 0.5;
  audio.hit(ball.hue);
}

function resolveConveyor(ball: Ball, c: Conveyor, audio: RaceAudio) {
  const dx = c.x2 - c.x1;
  const dy = c.y2 - c.y1;
  const lenSq = dx * dx + dy * dy || 1;
  let t = ((ball.x - c.x1) * dx + (ball.y - c.y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = c.x1 + t * dx;
  const py = c.y1 + t * dy;
  const ddx = ball.x - px;
  const ddy = ball.y - py;
  const dist = Math.hypot(ddx, ddy);
  const min = ball.r + c.thickness / 2;
  if (dist >= min || dist === 0) return;
  const nx = ddx / dist;
  const ny = ddy / dist;
  ball.x += nx * (min - dist);
  ball.y += ny * (min - dist);
  const vn = ball.vx * nx + ball.vy * ny;
  if (vn < 0) {
    ball.vx -= (1 + OBSTACLE_RESTITUTION) * vn * nx;
    ball.vy -= (1 + OBSTACLE_RESTITUTION) * vn * ny;
  }
  const len = Math.sqrt(lenSq);
  const tx = (dx / len) * c.dir;
  const ty = (dy / len) * c.dir;
  ball.vx += tx * CONVEYOR_PUSH_K * ball.r * 3;
  ball.vy += ty * CONVEYOR_PUSH_K * ball.r * 3;
  ball.glow = 0.3;
}

function bounceBalls(a: Ball, b: Ball, audio: RaceAudio) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const min = a.r + b.r;
  if (dist >= min || dist === 0) return;
  const overlap = (min - dist) / 2;
  const nx = dx / dist;
  const ny = dy / dist;
  a.x -= nx * overlap;
  a.y -= ny * overlap;
  b.x += nx * overlap;
  b.y += ny * overlap;
  const dvx = b.vx - a.vx;
  const dvy = b.vy - a.vy;
  const vn = dvx * nx + dvy * ny;
  if (vn > 0) return;
  const imp = (-(1 + BALL_RESTITUTION) * vn) / 2;
  a.vx -= imp * nx;
  a.vy -= imp * ny;
  b.vx += imp * nx;
  b.vy += imp * ny;
  a.glow = 0.35;
  b.glow = 0.35;
  audio.hit((a.hue + b.hue) / 2);
}

function applyAntiStall(ball: Ball, dt: number) {
  if (ball.y > ball.maxY + ball.r * 0.15) {
    ball.maxY = ball.y;
    ball.stuckTimer = 0;
    return;
  }
  ball.stuckTimer += dt;
  if (ball.stuckTimer > ANTI_STALL_SECS) {
    ball.vx += (Math.random() - 0.5) * ball.r * 16;
    ball.vy = Math.max(ball.vy, 0) + ball.r * 10;
    ball.stuckTimer = 0;
    ball.maxY = ball.y;
  }
}

// ─── Particles ────────────────────────────────────────────────────────────────

function spawnBurst(
  particles: Particle[],
  x: number,
  y: number,
  hue: number,
  count: number,
) {
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 40 + Math.random() * 90;
    particles.push({
      x,
      y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 40,
      life: 0.5 + Math.random() * 0.4,
      maxLife: 0.9,
      hue,
    });
  }
  if (particles.length > 180) particles.splice(0, particles.length - 180);
}

function updateParticles(particles: Particle[], dt: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.vy += 260 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  camY: number,
  arenaY: number,
) {
  for (const p of particles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y - camY + arenaY, 3, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${p.hue}, 90%, 62%)`;
    ctx.fill();
    ctx.restore();
  }
}

// ─── Audio ────────────────────────────────────────────────────────────────────

function createAudio(): RaceAudio {
  let ac: AudioContext | null = null;
  let lastAt = 0;
  const timeouts: number[] = [];

  const ensure = () => {
    if (!ac) {
      const w = window as typeof globalThis & {
        webkitAudioContext?: typeof AudioContext;
      };
      const AC = w.AudioContext || w.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
    }
    if (ac.state === "suspended") void ac.resume();
    return ac;
  };

  const ping = (freq: number, vol = 0.1, throttle = true) => {
    const now = Date.now();
    if (throttle && now - lastAt < SOUND_GAP_MS) return;
    lastAt = now;
    const ctx = ensure();
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.42, t + 0.2);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.25);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  };

  const sweep = (from: number, to: number, dur: number, vol: number) => {
    const ctx = ensure();
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.03);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  };

  return {
    unlock: () => {
      ensure();
    },
    hit: (hue: number) => ping(220 + hue * 0.5, 0.075),
    penalty: () => sweep(520, 160, 0.24, 0.18),
    win: () => {
      sweep(440, 880, 0.18, 0.18);
      timeouts.push(window.setTimeout(() => ping(660, 0.16, false), 120));
      timeouts.push(window.setTimeout(() => ping(880, 0.18, false), 260));
    },
    dispose: () => {
      timeouts.forEach((id) => window.clearTimeout(id));
      timeouts.length = 0;
      void ac?.close();
      ac = null;
    },
  };
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.clearRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#020617");
  grad.addColorStop(1, "#050b1f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

function drawCorridor(
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  camY: number,
) {
  const { x, y, width, height } = arena;

  ctx.save();
  ctx.strokeStyle = "rgba(226, 232, 240, 0.05)";
  ctx.lineWidth = 1;
  const spacing = 90;
  const firstGuide = Math.floor(camY / spacing) * spacing;
  for (let wy = firstGuide; wy < camY + height + spacing; wy += spacing) {
    const sy = wy - camY + y;
    if (sy < y || sy > y + height) continue;
    ctx.beginPath();
    ctx.moveTo(x + 6, sy);
    ctx.lineTo(x + width - 6, sy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawObstacles(
  ctx: CanvasRenderingContext2D,
  course: Course,
  camY: number,
  arenaY: number,
  viewH: number,
  elapsed: number,
) {
  const top = camY - 80;
  const bottom = camY + viewH + 80;

  ctx.save();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.85)";
  ctx.shadowColor = "rgba(148, 163, 184, 0.4)";
  ctx.shadowBlur = 8;
  ctx.lineCap = "round";
  for (const s of course.slats) {
    if (s.y1 < top && s.y2 < top) continue;
    if (s.y1 > bottom && s.y2 > bottom) continue;
    ctx.lineWidth = s.thickness;
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1 - camY + arenaY);
    ctx.lineTo(s.x2, s.y2 - camY + arenaY);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#34d399";
  ctx.shadowColor = "rgba(52, 211, 153, 0.75)";
  ctx.shadowBlur = 14;
  ctx.lineCap = "round";
  for (const p of course.paddles) {
    if (p.y1 < top && p.y2 < top) continue;
    if (p.y1 > bottom && p.y2 > bottom) continue;
    ctx.lineWidth = p.thickness;
    ctx.beginPath();
    ctx.moveTo(p.x1, p.y1 - camY + arenaY);
    ctx.lineTo(p.x2, p.y2 - camY + arenaY);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#fb7185";
  ctx.shadowColor = "rgba(251, 113, 133, 0.8)";
  ctx.shadowBlur = 14;
  ctx.lineCap = "round";
  for (const r of course.rotators) {
    if (r.cy < top || r.cy > bottom) continue;
    const angle = r.angle0 + r.speed * elapsed;
    const hx = Math.cos(angle) * (r.length / 2);
    const hy = Math.sin(angle) * (r.length / 2);
    const scy = r.cy - camY + arenaY;
    ctx.lineWidth = r.thickness;
    ctx.beginPath();
    ctx.moveTo(r.cx - hx, scy - hy);
    ctx.lineTo(r.cx + hx, scy + hy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(r.cx, scy, r.thickness * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = "#fb7185";
    ctx.fill();
  }
  ctx.restore();

  const closed = gateIsClosed(elapsed);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const g of course.gates) {
    const segTop = Math.min(...g.segments.map((s) => Math.min(s.y1, s.y2)));
    const segBottom = Math.max(...g.segments.map((s) => Math.max(s.y1, s.y2)));
    if (segBottom < top || segTop > bottom) continue;
    ctx.strokeStyle = closed ? "#fbbf24" : "rgba(251, 191, 36, 0.22)";
    ctx.shadowColor = closed
      ? "rgba(251, 191, 36, 0.75)"
      : "rgba(251, 191, 36, 0.15)";
    ctx.shadowBlur = closed ? 14 : 4;
    ctx.lineWidth = g.segments[0].thickness;
    ctx.beginPath();
    const first = g.segments[0];
    ctx.moveTo(first.x1, first.y1 - camY + arenaY);
    for (const seg of g.segments) {
      ctx.lineTo(seg.x2, seg.y2 - camY + arenaY);
    }
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#f87171";
  ctx.shadowColor = "rgba(248, 113, 113, 0.6)";
  ctx.shadowBlur = 10;
  ctx.lineWidth = 2;
  for (const tr of course.traps) {
    if (tr.y < top || tr.y > bottom) continue;
    const sy = tr.y - camY + arenaY;
    ctx.beginPath();
    ctx.moveTo(tr.x, sy);
    ctx.quadraticCurveTo(tr.x + tr.w / 2, sy + tr.h * 1.3, tr.x + tr.w, sy);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  for (const p of course.pegs) {
    if (p.y < top || p.y > bottom) continue;
    const sy = p.y - camY + arenaY;
    ctx.beginPath();
    ctx.arc(p.x, sy, p.r, 0, Math.PI * 2);
    ctx.fillStyle = "#38bdf8";
    ctx.shadowColor = "rgba(56, 189, 248, 0.8)";
    ctx.shadowBlur = 10;
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  for (const b of course.bumpers) {
    if (b.y < top || b.y > bottom) continue;
    const sy = b.y - camY + arenaY;
    const flash = Math.max(0, b.flash);
    const rOuter = b.r * (1 + flash * 0.25);
    ctx.beginPath();
    ctx.arc(b.x, sy, rOuter, 0, Math.PI * 2);
    ctx.fillStyle = flash > 0.1 ? "#fde68a" : "#f59e0b";
    ctx.shadowColor = "rgba(245, 158, 11, 0.9)";
    ctx.shadowBlur = 16 + flash * 20;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(b.x, sy, b.r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.shadowBlur = 0;
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.lineCap = "round";
  for (const c of course.conveyors) {
    if (Math.min(c.y1, c.y2) > bottom || Math.max(c.y1, c.y2) < top) continue;
    ctx.strokeStyle = "#a78bfa";
    ctx.shadowColor = "rgba(167, 139, 250, 0.7)";
    ctx.shadowBlur = 12;
    ctx.lineWidth = c.thickness;
    ctx.beginPath();
    ctx.moveTo(c.x1, c.y1 - camY + arenaY);
    ctx.lineTo(c.x2, c.y2 - camY + arenaY);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStartPlatform(
  ctx: CanvasRenderingContext2D,
  platform: StartPlatform,
  camY: number,
  arenaY: number,
  t: number,
) {
  const halves: { half: PlatformHalf; dir: -1 | 1 }[] = [
    { half: platform.left, dir: -1 },
    { half: platform.right, dir: 1 },
  ];
  ctx.save();
  ctx.fillStyle = "#334155";
  ctx.strokeStyle = "rgba(148, 163, 184, 0.8)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(100, 160, 255, 0.3)";
  ctx.shadowBlur = 10;
  for (const { half, dir } of halves) {
    const slideX = dir * t * half.w * 0.9;
    const dropY = t * half.h * 6;
    const sy = half.y - camY + arenaY + dropY;
    ctx.globalAlpha = Math.max(0, 1 - t * 1.2);
    ctx.beginPath();
    ctx.rect(half.x + slideX, sy, half.w, half.h);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawFinishLine(
  ctx: CanvasRenderingContext2D,
  course: Course,
  arena: Arena,
  camY: number,
) {
  const sy = course.finishY - camY + arena.y;
  if (sy < -60 || sy > arena.y + arena.height + 60) return;
  const tile = 14;
  ctx.save();
  for (let i = 0; i * tile < arena.width; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#e2e8f0" : "#0f172a";
    ctx.fillRect(arena.x + i * tile, sy, tile, tile * 0.7);
  }
  ctx.font = "900 14px Arial, Helvetica, sans-serif";
  ctx.fillStyle = "#f8fafc";
  ctx.textAlign = "center";
  ctx.fillText("FINISH", arena.x + arena.width / 2, sy - 8);
  ctx.restore();
}

function drawBalls(
  ctx: CanvasRenderingContext2D,
  balls: Ball[],
  camY: number,
  arenaY: number,
  leaderId: number | null,
  bob: (index: number) => number,
) {
  balls.forEach((b, i) => {
    const sy = b.y + bob(i) - camY + arenaY;
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, sy, b.r, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${b.hue}, 88%, 58%)`;
    ctx.shadowColor = `hsl(${b.hue}, 100%, 68%)`;
    ctx.shadowBlur = b.glow > 0 ? b.r * 2.6 : b.r * 1.2;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(b.x - b.r * 0.28, sy - b.r * 0.3, b.r * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.24)";
    ctx.shadowBlur = 0;
    ctx.fill();
    ctx.restore();

    if (leaderId === b.id && !b.finished) {
      ctx.save();
      ctx.font = `${Math.round(b.r * 1.8)}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("👑", b.x, sy - b.r * 1.15);
      ctx.restore();
    }
  });
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  mobile: boolean,
  phase: Phase,
  balls: Ball[],
  finishY: number,
  leaderName: string,
) {
  const { x, width } = arena;
  const cx = x + width / 2;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(241, 245, 249, 0.96)";
  ctx.shadowColor = "rgba(96, 165, 250, 0.35)";
  ctx.shadowBlur = 16;
  ctx.font = `900 ${mobile ? 26 : 38}px Arial, Helvetica, sans-serif`;
  ctx.fillText("BALL RACE", cx, mobile ? 44 : 56);

  ctx.font = `700 ${mobile ? 12 : 14}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = "rgba(248, 250, 252, 0.7)";
  ctx.shadowBlur = 0;
  const subtitle =
    phase === "racing"
      ? `${leaderName} is leading!`
      : phase === "countdown"
        ? "Get ready…"
        : phase === "finished"
          ? "Race complete!"
          : "6 balls enter. Only 1 wins the maze.";
  ctx.fillText(subtitle, cx, mobile ? 66 : 80);
  ctx.restore();

  if (phase === "racing" || phase === "finished") {
    const trackY = mobile ? 84 : 100;
    const trackW = width - (mobile ? 24 : 12);
    const trackX = cx - trackW / 2;
    ctx.save();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(trackX, trackY);
    ctx.lineTo(trackX + trackW, trackY);
    ctx.stroke();

    for (const b of balls) {
      const frac = Math.max(0, Math.min(1, b.y / finishY));
      const px = trackX + frac * trackW;
      ctx.beginPath();
      ctx.arc(px, trackY, mobile ? 4 : 5, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(${b.hue}, 88%, 58%)`;
      ctx.shadowColor = `hsl(${b.hue}, 100%, 68%)`;
      ctx.shadowBlur = 6;
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawCountdown(
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  mobile: boolean,
  remainingMs: number,
) {
  const cx = arena.x + arena.width / 2;
  const cy = arena.y + arena.height * 0.35;
  const label =
    remainingMs > 700 ? String(Math.ceil(remainingMs / 1000)) : "GO!";
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(241, 245, 249, 0.96)";
  ctx.shadowColor = "rgba(96, 165, 250, 0.55)";
  ctx.shadowBlur = 26;
  ctx.font = `900 ${mobile ? 64 : 88}px Arial, Helvetica, sans-serif`;
  ctx.fillText(label, cx, cy);
  ctx.restore();
}

// ─── Component ────────────────────────────────────────────────────────────────

const CollidingShapes = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<Arena | null>(null);
  const courseRef = useRef<Course | null>(null);
  const ballsRef = useRef<Ball[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTRef = useRef<number>(0);
  const audioRef = useRef(createAudio());
  const phaseRef = useRef<Phase>("menu");
  const cameraRef = useRef(0);
  const countdownEndAtRef = useRef<number | null>(null);
  const raceStartAtRef = useRef<number | null>(null);
  const raceEndAtRef = useRef<number | null>(null);
  const finishOrderRef = useRef<Ball[]>([]);
  const gateWasClosedRef = useRef(true);

  const [phase, setPhase] = useState<Phase>("menu");
  const [standings, setStandings] = useState<Ball[]>([]);

  const buildRace = useCallback((arena: Arena) => {
    const ballR = arena.width * 0.048 * 0.7 * 0.8;
    const course = generateCourse(arena, ballR);
    courseRef.current = course;
    ballsRef.current = spawnBalls(course.platform, ballR);
    particlesRef.current = [];
    // Put the start platform at START_SCREEN_FRACTION of the way down the
    // full screen (HUD included) instead of wherever camera = 0 lands it.
    const platformY = course.platform.left.y;
    const targetScreenY = arena.H * START_SCREEN_FRACTION;
    cameraRef.current = platformY + arena.y - targetScreenY;
    finishOrderRef.current = [];
    raceEndAtRef.current = null;
    raceStartAtRef.current = null;
    gateWasClosedRef.current = true;
  }, []);

  const resizeOnly = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { arena } = resizeCanvas(canvas);
    arenaRef.current = arena;
    buildRace(arena);
  }, [buildRace]);

  const handleResize = useCallback(() => {
    resizeOnly();
    if (phaseRef.current !== "menu") {
      phaseRef.current = "countdown";
      countdownEndAtRef.current = performance.now() + COUNTDOWN_MS;
      setPhase("countdown");
    }
  }, [resizeOnly]);

  const startRace = useCallback(() => {
    audioRef.current.unlock();
    const arena = arenaRef.current;
    if (!arena) return;
    buildRace(arena);
    phaseRef.current = "countdown";
    countdownEndAtRef.current = performance.now() + COUNTDOWN_MS;
    setPhase("countdown");
  }, [buildRace]);

  useEffect(() => {
    resizeOnly();
    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, [resizeOnly, handleResize]);

  useEffect(() => {
    const audio = audioRef.current;

    const tick = (now: number) => {
      const dt = Math.min((now - lastTRef.current) / 1000, MAX_DT);
      lastTRef.current = now;

      const canvas = canvasRef.current;
      const arena = arenaRef.current;
      const ctx = canvas?.getContext("2d");
      if (!ctx || !arena) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const { W, H } = arena;
      const mobile = W < 600;
      const phaseNow = phaseRef.current;
      const course = courseRef.current;
      const balls = ballsRef.current;
      const raceStartAt = raceStartAtRef.current;
      const elapsedRaceSec =
        raceStartAt !== null ? (now - raceStartAt) / 1000 : 0;

      drawBackground(ctx, W, H);
      drawCanvasWatermark(ctx, W, H);

      if (!course || balls.length === 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (phaseNow === "racing") {
        const left = arena.x;
        const right = arena.x + arena.width;
        const gravity = arena.width * GRAVITY_K;
        const maxFall = arena.width * MAX_FALL_K;
        const paddleKick = arena.width * PADDLE_KICK_K;
        const subDt = dt / SUBSTEPS;

        for (let s = 0; s < SUBSTEPS; s++) {
          const subElapsed = elapsedRaceSec + s * subDt;
          const closed = gateIsClosed(subElapsed);

          for (const ball of balls) {
            if (ball.finished) continue;
            ball.vy = Math.min(ball.vy + gravity * subDt, maxFall);
            ball.x += ball.vx * subDt;
            ball.y += ball.vy * subDt;
            if (ball.glow > 0) ball.glow -= subDt;
            resolveWalls(ball, left, right, audio);
            for (const slat of course.slats) resolveSlat(ball, slat, audio);
            for (const paddle of course.paddles) {
              resolvePaddle(ball, paddle, paddleKick, audio);
            }
            for (const rotator of course.rotators) {
              resolveRotator(ball, rotator, subElapsed, audio);
            }
            for (const peg of course.pegs) resolvePeg(ball, peg, audio);
            for (const bumper of course.bumpers) {
              resolveBumper(ball, bumper, arena.width * BUMPER_KICK_K, audio);
            }
            for (const conv of course.conveyors) {
              resolveConveyor(ball, conv, audio);
            }
            if (closed) {
              for (const gate of course.gates) {
                for (const seg of gate.segments) {
                  resolveSlat(ball, seg, audio);
                }
              }
            }
          }
          for (let i = 0; i < balls.length; i++) {
            for (let j = i + 1; j < balls.length; j++) {
              if (balls[i].finished || balls[j].finished) continue;
              bounceBalls(balls[i], balls[j], audio);
            }
          }
        }

        for (const bumper of course.bumpers) {
          if (bumper.flash > 0) bumper.flash -= dt * 3;
        }

        const gateClosedNow = gateIsClosed(elapsedRaceSec);
        if (gateWasClosedRef.current && !gateClosedNow) {
          // Gate just opened — give anything resting near it a shove so a
          // pile-up of balls can never get permanently wedged in a bowl.
          for (const ball of balls) {
            if (ball.finished) continue;
            for (const gate of course.gates) {
              const gateTop = Math.min(
                ...gate.segments.map((s) => Math.min(s.y1, s.y2)),
              );
              const gateBottom = Math.max(
                ...gate.segments.map((s) => Math.max(s.y1, s.y2)),
              );
              if (
                ball.y > gateTop - ball.r * 3 &&
                ball.y < gateBottom + ball.r * 3
              ) {
                ball.vy += arena.width * 0.9;
              }
            }
          }
        }
        gateWasClosedRef.current = gateClosedNow;

        for (const ball of balls) {
          if (ball.finished) continue;
          for (const trap of course.traps) {
            if (
              ball.x > trap.x &&
              ball.x < trap.x + trap.w &&
              ball.y > trap.y &&
              ball.y < trap.y + trap.h
            ) {
              ball.y = trap.sendToY;
              ball.vy = 0;
              ball.vx = (Math.random() - 0.5) * arena.width * 0.15;
              ball.maxY = ball.y;
              spawnBurst(particlesRef.current, ball.x, trap.y + trap.h / 2, 0, 16);
              audio.penalty();
            }
          }
          applyAntiStall(ball, dt);
        }

        for (const ball of balls) {
          if (!ball.finished && ball.y - ball.r >= course.finishY) {
            ball.finished = true;
            ball.rank = finishOrderRef.current.length + 1;
            finishOrderRef.current.push(ball);
            spawnBurst(particlesRef.current, ball.x, ball.y, ball.hue, 26);
            audio.win();
            if (raceEndAtRef.current === null) {
              raceEndAtRef.current = now + RACE_END_GRACE_MS;
            }
          }
        }

        const leaderY = Math.max(
          ...balls.map((b) => Math.min(b.y, course.finishY)),
        );
        const anchor = arena.height * 0.34;
        const target = leaderY - anchor;
        const desired = Math.max(cameraRef.current, target);
        cameraRef.current +=
          (desired - cameraRef.current) * Math.min(1, dt * 6);

        const allDone = finishOrderRef.current.length === balls.length;
        if (
          raceEndAtRef.current !== null &&
          (now >= raceEndAtRef.current || allDone)
        ) {
          const remaining = balls
            .filter((b) => !b.finished)
            .sort((a, b) => b.y - a.y);
          for (const b of remaining) {
            b.finished = true;
            b.rank = finishOrderRef.current.length + 1;
            finishOrderRef.current.push(b);
          }
          phaseRef.current = "finished";
          setStandings(finishOrderRef.current.slice());
          setPhase("finished");
        }
      }

      if (phaseNow === "racing" || phaseNow === "finished") {
        updateParticles(particlesRef.current, dt);
      }

      const camY = cameraRef.current;

      drawCorridor(ctx, arena, camY);

      if (phaseNow !== "menu") {
        drawObstacles(
          ctx,
          course,
          camY,
          arena.y,
          arena.height,
          elapsedRaceSec,
        );
        drawFinishLine(ctx, course, arena, camY);
      }

      if (phaseNow === "countdown") {
        drawStartPlatform(ctx, course.platform, camY, arena.y, 0);
      } else if (phaseNow === "racing" && raceStartAt !== null) {
        const openT = Math.min(1, (now - raceStartAt) / PLATFORM_OPEN_MS);
        if (openT < 1) {
          drawStartPlatform(ctx, course.platform, camY, arena.y, openT);
        }
      }

      const leader =
        phaseNow === "racing" || phaseNow === "finished"
          ? balls.reduce((best, b) => (b.y > best.y ? b : best), balls[0])
          : null;

      const bob =
        phaseNow === "menu" || phaseNow === "countdown"
          ? (i: number) => Math.sin(now / 650 + i * 1.3) * balls[i].r * 0.5
          : () => 0;

      drawBalls(ctx, balls, camY, arena.y, leader ? leader.id : null, bob);

      if (phaseNow === "racing" || phaseNow === "finished") {
        drawParticles(ctx, particlesRef.current, camY, arena.y);
      }

      drawHud(
        ctx,
        arena,
        mobile,
        phaseNow,
        balls,
        course.finishY,
        leader ? leader.name : "",
      );

      if (phaseNow === "countdown") {
        const remaining = (countdownEndAtRef.current ?? now) - now;
        if (remaining <= 0) {
          phaseRef.current = "racing";
          setPhase("racing");
          raceStartAtRef.current = now;
          for (const ball of balls) {
            ball.vx = (Math.random() - 0.5) * arena.width * 0.22;
          }
        } else {
          drawCountdown(ctx, arena, mobile, remaining);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    lastTRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      audio.dispose();
    };
  }, []);

  return (
    <div className="cr-root">
      <canvas ref={canvasRef} className="cr-canvas" />

      {phase === "menu" && (
        <div className="cr-menu">
          <button type="button" className="cr-play-btn" onClick={startRace}>
            ▶ PLAY
          </button>
        </div>
      )}

      {phase === "finished" && (
        <div className="cr-finished">
          <div className="cr-panel">
            <h2 className="cr-panel-title">🏁 Race Complete!</h2>
            <div className="cr-standings">
              {standings.map((b, i) => (
                <div className="cr-standing-row" key={b.id}>
                  <span className="cr-standing-medal">
                    {i === 0
                      ? "🥇"
                      : i === 1
                        ? "🥈"
                        : i === 2
                          ? "🥉"
                          : `${i + 1}.`}
                  </span>
                  <span
                    className="cr-standing-dot"
                    style={{ background: `hsl(${b.hue}, 88%, 58%)` }}
                  />
                  <span className="cr-standing-name">{b.name}</span>
                </div>
              ))}
            </div>
            <button type="button" className="cr-play-btn" onClick={startRace}>
              RACE AGAIN
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        .cr-root {
          position: relative;
          width: 100%;
          height: 100dvh;
          min-height: 100dvh;
          overflow: hidden;
          background: #020617;
          color: #f8fafc;
        }

        .cr-canvas {
          position: absolute;
          inset: 0;
          width: 100% !important;
          height: 100dvh !important;
          min-height: 100dvh !important;
        }

        .cr-menu {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          padding: 0 24px;
        }

        .cr-play-btn {
          pointer-events: all;
          padding: 13px 52px;
          border: 1px solid rgba(100, 180, 255, 0.52);
          border-radius: 12px;
          background: rgba(14, 50, 110, 0.52);
          color: #dbeafe;
          font-family: Arial, Helvetica, sans-serif;
          font-size: clamp(0.95rem, 2.5vw, 1.1rem);
          font-weight: 900;
          letter-spacing: 0.18em;
          cursor: pointer;
          backdrop-filter: blur(10px);
          box-shadow: 0 0 28px rgba(60, 130, 255, 0.18);
          transition:
            transform 0.2s,
            box-shadow 0.2s,
            background 0.2s;
        }

        .cr-play-btn:hover {
          background: rgba(22, 78, 160, 0.68);
          box-shadow: 0 0 40px rgba(60, 130, 255, 0.36);
          transform: scale(1.05);
        }

        .cr-play-btn:active {
          transform: scale(0.97);
        }

        .cr-finished {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(2, 6, 23, 0.55);
          pointer-events: none;
          padding: 0 20px;
        }

        .cr-panel {
          pointer-events: all;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 18px;
          padding: clamp(20px, 4vw, 32px);
          width: min(92vw, 380px);
          border: 1px solid rgba(100, 180, 255, 0.4);
          border-radius: 18px;
          background: rgba(8, 20, 45, 0.82);
          backdrop-filter: blur(12px);
          box-shadow: 0 0 44px rgba(60, 130, 255, 0.22);
        }

        .cr-panel-title {
          margin: 0;
          font-family: Arial, Helvetica, sans-serif;
          font-size: clamp(1.25rem, 5vw, 1.7rem);
          font-weight: 900;
          text-align: center;
          color: #f8fafc;
        }

        .cr-standings {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .cr-standing-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 14px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.05);
        }

        .cr-standing-medal {
          width: 28px;
          font-size: clamp(0.95rem, 3vw, 1.15rem);
          font-weight: 900;
          text-align: center;
        }

        .cr-standing-dot {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          box-shadow: 0 0 10px currentColor;
          flex-shrink: 0;
        }

        .cr-standing-name {
          font-family: Arial, Helvetica, sans-serif;
          font-size: clamp(0.9rem, 3vw, 1.05rem);
          font-weight: 700;
          color: #f1f5f9;
        }
      `}</style>
    </div>
  );
};

export default CollidingShapes;
