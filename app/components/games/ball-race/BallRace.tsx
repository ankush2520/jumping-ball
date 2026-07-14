"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { drawCanvasWatermark } from "@/app/lib/watermark";

// ─── Constants ────────────────────────────────────────────────────────────────

const HUD_DESKTOP = 100;
const HUD_MOBILE = 84;
const MAX_DT = 1 / 30;
const SUBSTEPS = 5;
const SOUND_GAP_MS = 55;
const BG_MUSIC_VOLUME = 0.075;
const ARENA_PAD = 10; // clearance kept from every screen edge
// The HUD heading (title+subtitle, or just the racing status line) is
// bottom-anchored this far above the arena's top edge, growing upward —
// so it can never overlap the peg field regardless of how many lines it has.
const HUD_LINE_CLEARANCE = 14;

const GRAVITY_K = 0.45; // px/s² per px of corridor width
const MAX_FALL_K = 1.85; // px/s cap per px of corridor width
const WALL_RESTITUTION = 0.92;
const BALL_RESTITUTION = 0.82;
const PEG_RESTITUTION = 0.78;
const ANTI_STALL_SECS = 1.3; // tolerant enough to let a ball wait stuck

// The course is three stacked bands below the start platform:
//   1. a hex/brick peg field (plain pegs, open gaps)
//   2. a funnel narrowing the corridor into the cauldron's mouth
//   3. THE CAULDRON — a near-closed circular bowl with a big spinner
//      inside. The only way in is the mouth up top; the only way out is a
//      one-ball gap at the very bottom that the spinner's arms keep
//      sweeping across. Arm hits transfer the arm's real swing velocity,
//      so a ball caught by a rising arm gets flung — sideways, around the
//      bowl, or clean back up out of the mouth — purely on timing luck.
const OBSTACLE_SECTION_GAP_FACTOR = 3; // empty corridor kept between bands, in ball-radii
const PEG_SECTION_FRACTION = 0.34;
const FUNNEL_SECTION_FRACTION = 0.14; // the cauldron gets whatever height remains
const WALL_THICKNESS_FACTOR = 0.6; // funnel + cauldron wall thickness, in ball-radii

const CAULDRON_MOUTH_HALF_ANGLE = (30 * Math.PI) / 180; // top opening, either side of straight-up
const CAULDRON_EXIT_GAP_FACTOR = 5.4; // bottom exit chord, in ball-radii — ~2.7 ball widths, so escapes actually happen
const CAULDRON_ARC_STEP = (8 * Math.PI) / 180; // polyline resolution of the bowl wall used for collisions

const ROTOR_ARM_THICKNESS_FACTOR = 0.85; // spinner arm thickness, in ball-radii
const ROTOR_HUB_FACTOR = 0.9; // spinner center hub radius, in ball-radii
const ROTOR_ANGULAR_SPEED = 0.9; // rad/s — slow enough that balls get windows to settle toward the gap
// The arm tips run this close to the bowl wall — the leftover slot is
// narrower than a ball, so nothing can rest under a passing arm; every
// ball in the bowl gets swept, batted, or bulldozed toward the gap.
const ROTOR_TIP_CLEARANCE_FACTOR = 0.5; // in ball-radii
const ROTOR_FLING_MAX_K = 1.5; // post-hit ball speed cap, px/s per px of corridor width — enough to reach the pegs, not orbit
// Arm hits use a lower restitution than pegs/walls: the arm's surface
// velocity already injects plenty of energy, so a bouncier coefficient
// keeps balls airborne forever and the race never drains out the gap.
const ROTOR_RESTITUTION = 0.55;

// The start platform sits between the HUD heading and the peg field, inside
// a total heading-to-peg gap of exactly HEADING_TO_PEGS_DIAMETERS ball
// diameters (see generateCourse) — a small margin above the platform, the
// platform itself, then a small margin below it before the pegs start.
const HEADING_TO_PEGS_DIAMETERS = 3;
// Balls rest 1.3 ball-radii above the platform and bob up to another 0.5r
// during the pre-race idle (see spawnBalls / drawBalls). The ball's top is
// then platformY - 2.8r, so the platform has to sit at least ~2.8r below
// the arena's top clip edge or the idling balls get sliced off. 3.2 leaves
// ~0.4r of headroom past that floor.
const PLATFORM_TOP_GAP_FACTOR = 3.2; // margin above the platform, in ball-radii

const COUNTDOWN_MS = 3000;
const PLATFORM_OPEN_MS = 450;

// Four countries in two starting lanes: France + Spain drop through the
// LEFT peg field, Argentina + England through the RIGHT one — kept apart by
// a central divider wall until both lanes merge into the funnel (see
// generateCourse). hue drives only the glow/particle-trail/HUD-dot effects;
// it's spread around the wheel so those small flat-color contexts stay
// distinguishable. The ball itself renders as the country's actual flag
// (drawCountryFlag), which is the real identity signal.
const BALL_DEFS = [
  { name: "France", hue: 260, side: "left" },
  { name: "Spain", hue: 45, side: "left" },
  { name: "Argentina", hue: 195, side: "right" },
  { name: "England", hue: 350, side: "right" },
] as const;

type BallSide = (typeof BALL_DEFS)[number]["side"];

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
  dropDelay: number; // seconds after the start before gravity kicks in for this ball
};

type Peg = {
  id: number;
  x: number;
  y: number;
  r: number;
};

// A straight wall segment, solid to balls on both sides.
type Seg = { x1: number; y1: number; x2: number; y2: number };

// The funnel's two walls, each a single straight segment from a corridor
// edge down to an endpoint on the cauldron's rim, so funnel and bowl form
// one sealed hopper — the mouth is the only way in.
type Funnel = {
  left: Seg;
  right: Seg;
  thickness: number;
};

// The spinner: a plus sign of two perpendicular bars crossing at (cx, cy),
// spinning continuously. The current angle is derived from wall-clock time
// (angularSpeed * t + phase) rather than stored, so it's always in sync
// between the physics step and the draw call. angularSpeed is signed —
// direction is rolled per race.
type Rotor = {
  cx: number;
  cy: number;
  armLen: number;
  thickness: number;
  hubR: number;
  angularSpeed: number;
  phase: number;
};

// The cauldron: a circular bowl open at the top (the mouth, where the
// funnel feeds in) with a one-ball exit gap at the very bottom, and the
// spinner pivoting at its center. The wall is collided as a polyline of
// short segments but drawn as true arcs.
type Cauldron = {
  cx: number;
  cy: number;
  r: number;
  segs: Seg[];
  thickness: number;
  mouthHalf: number; // top-opening half-angle, either side of straight-up
  gapHalf: number; // bottom exit-gap half-angle, either side of straight-down
  rotor: Rotor;
};

type PlatformHalf = { x: number; y: number; w: number; h: number };
type StartPlatform = { left: PlatformHalf; right: PlatformHalf };

type Course = {
  platform: StartPlatform;
  pegs: Peg[];
  // Central wall separating the two peg lanes; ends at the funnel mouth
  // where the lanes merge. Its thickness matches the funnel/cauldron walls.
  divider: Seg;
  funnel: Funnel;
  cauldron: Cauldron;
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
  startMusic: (volume: number) => void;
  stopMusic: () => void;
  dispose: () => void;
};

// ─── Canvas / Arena ───────────────────────────────────────────────────────────

function resizeCanvas(canvas: HTMLCanvasElement): {
  arena: Arena;
  dpr: number;
} {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const W = Math.round(window.visualViewport?.width ?? window.innerWidth);
  const H = Math.round(window.visualViewport?.height ?? window.innerHeight);
  const mobile = W < 600;
  const hudH = mobile ? HUD_MOBILE : HUD_DESKTOP;
  const maxWidth = mobile ? Infinity : 520;
  const width = Math.min(W - ARENA_PAD * 2, maxWidth);
  const height = Math.max(240, H - hudH - ARENA_PAD);
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

function buildStartPlatform(arena: Arena, ballR: number, y: number): StartPlatform {
  const width = arena.width;
  const left = arena.x;
  const h = ballR * 1.6;
  const gap = width * 0.14;
  const halfW = (width - gap) / 2;
  return {
    left: { x: left, y, w: halfW, h },
    right: { x: left + halfW + gap, y, w: halfW, h },
  };
}

// A hex/brick peg lattice filling one horizontal lane [x0, x1]. Full rows
// alternate with rows offset by half a spacing (one peg shorter), nested in
// the gaps above/below. No connecting bars — every gap between neighbors
// stays open. Returns a running peg id so two lanes can share one id space.
//   *  *  *  *
//     *  *  *
//   *  *  *  *
function buildPegField(
  x0: number,
  x1: number,
  top: number,
  height: number,
  ballR: number,
  startId: number,
): { pegs: Peg[]; lastRowY: number } {
  const spacing = ballR * 4; // 2x ball diameter, row-to-row and within a row
  const pegR = ballR * 0.55 * 0.85;
  const usable = x1 - x0;
  const cols = Math.max(2, Math.floor(usable / spacing) + 1);
  const gridW = (cols - 1) * spacing;
  const baseX = x0 + (usable - gridW) / 2;
  const rows = Math.max(2, Math.round(height / spacing) + 1);

  const pegs: Peg[] = [];
  let id = startId;
  for (let row = 0; row < rows; row++) {
    const y = top + row * spacing;
    const offsetRow = row % 2 === 1;
    const rowCols = offsetRow ? cols - 1 : cols;
    const startX = offsetRow ? baseX + spacing / 2 : baseX;
    for (let c = 0; c < rowCols; c++) {
      pegs.push({ id: id++, x: startX + c * spacing, y, r: pegR });
    }
  }
  return { pegs, lastRowY: top + (rows - 1) * spacing };
}

// The whole course fits inside one static screen (arena.height) — no
// camera movement. Below the start platform, three bands stack top to
// bottom: two side-by-side peg fields split by a central divider, a funnel,
// and the cauldron — a near-closed bowl with a big spinner inside whose
// only exit is a one-ball gap at the very bottom.
function generateCourse(arena: Arena, ballR: number): Course {
  const width = arena.width;
  const left = arena.x;
  const right = arena.x + width;
  const cx = left + width / 2;
  const levelH = arena.height;

  const platformY = ballR * PLATFORM_TOP_GAP_FACTOR;
  const platformH = ballR * 1.6;
  const platform = buildStartPlatform(arena, ballR, platformY);
  // The heading (see drawHud) is bottom-anchored HUD_LINE_CLEARANCE above
  // the arena's top edge, so that anchor point plus this many ball-radii
  // gives the total heading-to-peg gap. Never let it collapse the platform.
  const topY0 = Math.max(
    platformY + platformH + ballR, // platform, plus a minimal margin before the pegs
    ballR * 2 * HEADING_TO_PEGS_DIAMETERS - HUD_LINE_CLEARANCE,
  );

  const bottomMargin = ballR * 6; // empty corridor kept above the finish line
  const sectionGap = ballR * OBSTACLE_SECTION_GAP_FACTOR;
  const obstacleBottom = levelH - bottomMargin;
  const obstacleSpan = Math.max(0, obstacleBottom - topY0 - sectionGap * 2);

  const pegH = obstacleSpan * PEG_SECTION_FRACTION;
  const funnelH = obstacleSpan * FUNNEL_SECTION_FRACTION;
  const wallT = ballR * WALL_THICKNESS_FACTOR;

  const pegTop = topY0;

  // 1. Top band — TWO peg fields side by side, split by a central divider
  // wall so the two starting groups (France+Spain left, Argentina+England
  // right) each run their own lane before both merge into the funnel below.
  // Each lane is inset by one ball-radius from the outer wall and the
  // divider so a ball never spawns jammed against either.
  const laneInset = ballR;
  const leftLane = buildPegField(
    left + laneInset,
    cx - wallT / 2 - laneInset,
    pegTop,
    pegH,
    ballR,
    0,
  );
  const rightLane = buildPegField(
    cx + wallT / 2 + laneInset,
    right - laneInset,
    pegTop,
    pegH,
    ballR,
    leftLane.pegs.length,
  );
  const pegs = [...leftLane.pegs, ...rightLane.pegs];
  const lastRowY = Math.max(leftLane.lastRowY, rightLane.lastRowY);

  // 2. Middle band — the funnel. Its walls run from the corridor edges
  // straight to the cauldron's rim endpoints, so funnel and bowl seal into
  // one hopper: the mouth is the only way in (and, for lucky flung balls,
  // back out).
  const mouthHalf = CAULDRON_MOUTH_HALF_ANGLE;
  const funnelTop = Math.max(pegTop + pegH, lastRowY) + sectionGap;
  const rimY = funnelTop + funnelH;

  // The central divider runs from just under the platform down to the
  // funnel mouth, where the two lanes finally merge.
  const divider: Seg = {
    x1: cx,
    y1: platformY + platformH,
    x2: cx,
    y2: funnelTop,
  };

  // 3. Bottom band — the cauldron bowl, as big as the leftover height (or
  // the corridor width) allows. Its rim-top sits at the funnel's bottom.
  const r = Math.max(
    ballR * 5, // floor for absurdly short screens — better to crowd the finish than degenerate
    Math.min(width * 0.47, (obstacleBottom - rimY) / (1 + Math.cos(mouthHalf))),
  );
  const ccy = rimY + r * Math.cos(mouthHalf);
  const mouthHalfW = r * Math.sin(mouthHalf);

  const funnel: Funnel = {
    left: { x1: left, y1: funnelTop, x2: cx - mouthHalfW, y2: rimY },
    right: { x1: right, y1: funnelTop, x2: cx + mouthHalfW, y2: rimY },
    thickness: wallT,
  };

  // The bowl wall, as a polyline. Angles are canvas-style (0 = right,
  // +π/2 = straight down); the mouth straddles -π/2 (up) and the exit gap
  // straddles +π/2 (down).
  const gapHalf = Math.asin((ballR * CAULDRON_EXIT_GAP_FACTOR) / 2 / r);
  const segs: Seg[] = [];
  const addArc = (from: number, to: number) => {
    const steps = Math.max(2, Math.ceil((to - from) / CAULDRON_ARC_STEP));
    for (let i = 0; i < steps; i++) {
      const a1 = from + ((to - from) * i) / steps;
      const a2 = from + ((to - from) * (i + 1)) / steps;
      segs.push({
        x1: cx + Math.cos(a1) * r,
        y1: ccy + Math.sin(a1) * r,
        x2: cx + Math.cos(a2) * r,
        y2: ccy + Math.sin(a2) * r,
      });
    }
  };
  // Right side: mouth's right edge, down past 3 o'clock, to the gap.
  addArc(-Math.PI / 2 + mouthHalf, Math.PI / 2 - gapHalf);
  // Left side: gap's left edge, up past 9 o'clock, to the mouth.
  addArc(Math.PI / 2 + gapHalf, (3 * Math.PI) / 2 - mouthHalf);

  const cauldron: Cauldron = {
    cx,
    cy: ccy,
    r,
    segs,
    thickness: wallT,
    mouthHalf,
    gapHalf,
    rotor: {
      cx,
      cy: ccy,
      // Tips sweep to within less than a ball of the wall (accounting for
      // both half-thicknesses), so no ball can rest under a passing arm.
      armLen: r - wallT / 2 - (ballR * ROTOR_ARM_THICKNESS_FACTOR) / 2 - ballR * ROTOR_TIP_CLEARANCE_FACTOR,
      thickness: ballR * ROTOR_ARM_THICKNESS_FACTOR,
      hubR: ballR * ROTOR_HUB_FACTOR,
      angularSpeed: ROTOR_ANGULAR_SPEED * (Math.random() < 0.5 ? 1 : -1),
      phase: Math.random() * Math.PI * 2,
    },
  };

  const finishY = levelH - ballR * 2;

  return { platform, pegs, divider, funnel, cauldron, finishY };
}

function spawnBalls(platform: StartPlatform, ballR: number): Ball[] {
  // Two balls per platform half, one per lane's country group. All released
  // on the same frame (dropDelay 0) — with only two balls per lane there's
  // room for them to fall without jamming, so no stagger is needed.
  const laneX: Record<BallSide, number[]> = {
    left: [0.3, 0.7].map((f) => platform.left.x + platform.left.w * f),
    right: [0.3, 0.7].map((f) => platform.right.x + platform.right.w * f),
  };
  const next: Record<BallSide, number> = { left: 0, right: 0 };
  const y = platform.left.y - ballR * 1.3;

  return BALL_DEFS.map((def, i) => ({
    id: i,
    name: def.name,
    hue: def.hue,
    x: laneX[def.side][next[def.side]++],
    y,
    vx: 0,
    vy: 0,
    r: ballR,
    glow: 0,
    finished: false,
    rank: null,
    stuckTimer: 0,
    maxY: y,
    dropDelay: 0,
  }));
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

// Circle-vs-circle collision against any peg-like point — reused for the
// rotor's center hub, which is exactly a peg sitting at its pivot.
function resolvePeg(
  ball: Ball,
  peg: { x: number; y: number; r: number },
  audio: RaceAudio,
) {
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

function resolveSegment(
  ball: Ball,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thickness: number,
  audio: RaceAudio,
) {
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
    ball.vx -= (1 + PEG_RESTITUTION) * vn * nx;
    ball.vy -= (1 + PEG_RESTITUTION) * vn * ny;
  }
  ball.glow = 0.35;
  audio.hit(ball.hue);
}

function resolveFunnel(ball: Ball, funnel: Funnel, audio: RaceAudio) {
  const { left, right, thickness } = funnel;
  resolveSegment(ball, left.x1, left.y1, left.x2, left.y2, thickness, audio);
  resolveSegment(ball, right.x1, right.y1, right.x2, right.y2, thickness, audio);
}

// Circle-vs-segment collision where the segment itself is a spinning bar.
// Same shape math as resolveSegment, but the bounce is computed relative
// to the bar surface's own velocity at the contact point (ω × r), so a
// rising arm genuinely flings the ball — the whole point of the cauldron:
// a ball caught at the wrong (or right) moment gets launched sideways or
// straight back up, purely on timing luck.
function resolveSpinningBar(
  ball: Ball,
  cx: number,
  cy: number,
  ux: number, // bar direction (unit vector)
  uy: number,
  halfLen: number,
  thickness: number,
  omega: number, // signed angular velocity, rad/s
  maxSpeed: number, // post-hit speed cap, keeps flings from going ballistic
  audio: RaceAudio,
) {
  let t = (ball.x - cx) * ux + (ball.y - cy) * uy;
  t = Math.max(-halfLen, Math.min(halfLen, t));
  const px = cx + ux * t;
  const py = cy + uy * t;
  const ddx = ball.x - px;
  const ddy = ball.y - py;
  const dist = Math.hypot(ddx, ddy);
  const min = ball.r + thickness / 2;
  if (dist >= min || dist === 0) return;
  const nx = ddx / dist;
  const ny = ddy / dist;
  ball.x += nx * (min - dist);
  ball.y += ny * (min - dist);
  // ω × r gives the arm surface's velocity at the contact point.
  const svx = -omega * (py - cy);
  const svy = omega * (px - cx);
  const vn = (ball.vx - svx) * nx + (ball.vy - svy) * ny;
  if (vn < 0) {
    ball.vx -= (1 + ROTOR_RESTITUTION) * vn * nx;
    ball.vy -= (1 + ROTOR_RESTITUTION) * vn * ny;
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > maxSpeed) {
      ball.vx *= maxSpeed / speed;
      ball.vy *= maxSpeed / speed;
    }
  }
  ball.glow = 0.35;
  audio.hit(ball.hue);
}

// The rotor's two bars are derived fresh from wall-clock angle every call
// rather than stored, so physics and drawing can never drift out of sync
// with each other.
function resolveRotor(
  ball: Ball,
  rotor: Rotor,
  angle: number,
  maxSpeed: number,
  audio: RaceAudio,
) {
  const { cx, cy, armLen, thickness, hubR, angularSpeed } = rotor;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  resolveSpinningBar(ball, cx, cy, c, s, armLen, thickness, angularSpeed, maxSpeed, audio);
  resolveSpinningBar(ball, cx, cy, -s, c, armLen, thickness, angularSpeed, maxSpeed, audio);
  resolvePeg(ball, { x: cx, y: cy, r: hubR }, audio);
}

function resolveCauldron(
  ball: Ball,
  cauldron: Cauldron,
  angle: number,
  maxSpeed: number,
  audio: RaceAudio,
) {
  for (const seg of cauldron.segs) {
    resolveSegment(ball, seg.x1, seg.y1, seg.x2, seg.y2, cauldron.thickness, audio);
  }
  resolveRotor(ball, cauldron.rotor, angle, maxSpeed, audio);
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

  // Struck-string timbre used by the background melody: a handful of
  // harmonics with a fast attack and an exponential decay, instead of a
  // single swept sine, so notes read as piano rather than a synth blip.
  // `decay` controls how long the note rings on after the attack.
  const struckTone = (
    ctx: AudioContext,
    dest: AudioNode,
    freq: number,
    t: number,
    decay: number,
    vol: number,
    partials: [number, number][],
  ) => {
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, t);
    master.gain.linearRampToValueAtTime(vol, t + 0.008);
    master.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    master.connect(dest);

    partials.forEach(([mult, amp]) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * mult, t);
      g.gain.value = amp;
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + decay + 0.05);
      osc.onended = () => {
        osc.disconnect();
        g.disconnect();
      };
    });
  };

  // Background music: the opening theme of Beethoven's "Für Elise", the
  // most widely recognized classical piano piece, sequenced as a melody
  // (right hand) plus a soft broken-chord bass (left hand). Public domain.
  const NOTE = {
    E2: 82.41,
    A2: 110.0,
    C3: 130.81,
    E3: 164.81,
    GS3: 207.65,
    B3: 246.94,
    C4: 261.63,
    E4: 329.63,
    GS4: 415.3,
    A4: 440.0,
    B4: 493.88,
    C5: 523.25,
    D5: 587.33,
    DS5: 622.25,
    E5: 659.25,
  };
  const EIGHTH = 0.34; // seconds per melody beat — a calm, unhurried tempo

  type MelodyNote = { freq: number; beats: number };
  const PHRASE: MelodyNote[] = [
    { freq: NOTE.E5, beats: 1 },
    { freq: NOTE.DS5, beats: 1 },
    { freq: NOTE.E5, beats: 1 },
    { freq: NOTE.DS5, beats: 1 },
    { freq: NOTE.E5, beats: 1 },
    { freq: NOTE.B4, beats: 1 },
    { freq: NOTE.D5, beats: 1 },
    { freq: NOTE.C5, beats: 1 },
    { freq: NOTE.A4, beats: 3 },
    { freq: NOTE.C4, beats: 1 },
    { freq: NOTE.E4, beats: 1 },
    { freq: NOTE.A4, beats: 1 },
    { freq: NOTE.B4, beats: 3 },
    { freq: NOTE.E4, beats: 1 },
    { freq: NOTE.GS4, beats: 1 },
    { freq: NOTE.B4, beats: 1 },
    { freq: NOTE.C5, beats: 3 },
    { freq: NOTE.E4, beats: 6 },
  ];
  const MELODY: MelodyNote[] = [...PHRASE, ...PHRASE];
  const PHRASE_BEATS = PHRASE.reduce((sum, n) => sum + n.beats, 0);

  type BassNote = { freq: number; startBeat: number; beats: number };
  const BASS_PHRASE: BassNote[] = [
    { freq: NOTE.A2, startBeat: 8, beats: 1 },
    { freq: NOTE.C3, startBeat: 9, beats: 1 },
    { freq: NOTE.E3, startBeat: 10, beats: 1 },
    { freq: NOTE.E3, startBeat: 14, beats: 1 },
    { freq: NOTE.GS3, startBeat: 15, beats: 1 },
    { freq: NOTE.B3, startBeat: 16, beats: 1 },
    { freq: NOTE.A2, startBeat: 20, beats: 1 },
    { freq: NOTE.C3, startBeat: 21, beats: 1 },
    { freq: NOTE.E3, startBeat: 22, beats: 1 },
    { freq: NOTE.E2, startBeat: 23, beats: 2 },
    { freq: NOTE.GS3, startBeat: 25, beats: 2 },
    { freq: NOTE.B3, startBeat: 27, beats: 2 },
  ];
  const BASS: BassNote[] = [
    ...BASS_PHRASE,
    ...BASS_PHRASE.map((n) => ({ ...n, startBeat: n.startBeat + PHRASE_BEATS })),
  ];

  const LOOP_LEN =
    MELODY.reduce((sum, n) => sum + n.beats, 0) * EIGHTH;

  const MELODY_PARTIALS: [number, number][] = [
    [1, 1],
    [2, 0.4],
    [3, 0.15],
  ];
  const BASS_PARTIALS: [number, number][] = [
    [1, 1],
    [2, 0.25],
  ];

  let musicGain: GainNode | null = null;
  let musicTimeoutId: number | null = null;
  let musicPlaying = false;

  const scheduleMelody = (startTime: number) => {
    const ctx = ensure();
    if (!ctx || !musicGain) return;
    const gain = musicGain;
    let cursor = 0;
    for (const note of MELODY) {
      const dur = note.beats * EIGHTH;
      struckTone(
        ctx,
        gain,
        note.freq,
        startTime + cursor,
        dur * 1.6 + 0.15,
        0.1,
        MELODY_PARTIALS,
      );
      cursor += dur;
    }
    for (const note of BASS) {
      struckTone(
        ctx,
        gain,
        note.freq,
        startTime + note.startBeat * EIGHTH,
        note.beats * EIGHTH * 1.6 + 0.15,
        0.055,
        BASS_PARTIALS,
      );
    }
  };

  const loopMusic = () => {
    const ctx = ensure();
    if (!ctx || !musicPlaying) return;
    scheduleMelody(ctx.currentTime + 0.05);
    musicTimeoutId = window.setTimeout(() => {
      if (musicPlaying) loopMusic();
    }, LOOP_LEN * 1000);
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
    startMusic: (volume: number) => {
      const ctx = ensure();
      if (!ctx || musicPlaying) return;
      musicPlaying = true;
      musicGain = ctx.createGain();
      musicGain.gain.value = volume;
      musicGain.connect(ctx.destination);
      loopMusic();
    },
    stopMusic: () => {
      musicPlaying = false;
      if (musicTimeoutId !== null) {
        window.clearTimeout(musicTimeoutId);
        musicTimeoutId = null;
      }
      if (musicGain && ac) {
        const g = musicGain;
        const t = ac.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0.0001, t + 0.3);
        window.setTimeout(() => g.disconnect(), 400);
      }
      musicGain = null;
    },
    dispose: () => {
      timeouts.forEach((id) => window.clearTimeout(id));
      timeouts.length = 0;
      musicPlaying = false;
      if (musicTimeoutId !== null) window.clearTimeout(musicTimeoutId);
      void ac?.close();
      ac = null;
    },
  };
}

// ─── Level color themes ─────────────────────────────────────────────────────
//
// Each level gets its own obstacle accent and background tint, escalating
// from cool blue (start) through hot pink (mid) to gold (final/reward) —
// the "blue = default, pink = rarity, gold = reward" convention used
// across premium game UIs.
const LEVEL_THEMES = [
  {
    obstacle: "#38bdf8",
    obstacleGlow: "rgba(56, 189, 248, 0.85)",
    bgTop: "#30334a",
    bgMid: "#31354f",
    bgBottom: "#282a34",
    ambient: "#38bdf8",
  },
  {
    obstacle: "#ec4899",
    obstacleGlow: "rgba(236, 72, 153, 0.85)",
    bgTop: "#403343",
    bgMid: "#4a3449",
    bgBottom: "#2f2a30",
    ambient: "#ec4899",
  },
  {
    obstacle: "#f7c948",
    obstacleGlow: "rgba(247, 201, 72, 0.85)",
    bgTop: "#3e362f",
    bgMid: "#453c31",
    bgBottom: "#2f2b29",
    ambient: "#f7c948",
  },
] as const;

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

// The whole course sits on one static screen, so the background is a fixed
// gradient blending the three bands' theme colors top to bottom instead of
// a camera-driven transition.
function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.clearRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, LEVEL_THEMES[0].bgTop);
  grad.addColorStop(0.5, LEVEL_THEMES[1].bgMid);
  grad.addColorStop(1, LEVEL_THEMES[2].bgBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(
    W / 2,
    H * 0.12,
    0,
    W / 2,
    H * 0.12,
    Math.max(W, H) * 0.65,
  );
  glow.addColorStop(0, withAlpha(LEVEL_THEMES[1].ambient, 0.07));
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

// A pure-black strip along all four screen edges so the ARENA_PAD margin
// kept around the race content is actually visible, instead of just
// blending into the background theme color.
function drawPaddingFrame(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.save();
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, ARENA_PAD);
  ctx.fillRect(0, H - ARENA_PAD, W, ARENA_PAD);
  ctx.fillRect(0, 0, ARENA_PAD, H);
  ctx.fillRect(W - ARENA_PAD, 0, ARENA_PAD, H);
  ctx.restore();
}

function drawCorridor(
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  camY: number,
) {
  const { x, y, width, height } = arena;

  ctx.save();
  ctx.strokeStyle = "rgba(180, 200, 255, 0.055)";
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

function drawPegs(
  ctx: CanvasRenderingContext2D,
  pegs: Peg[],
  camY: number,
  arenaY: number,
  viewH: number,
) {
  const top = camY - 80;
  const bottom = camY + viewH + 80;

  ctx.save();
  for (const p of pegs) {
    if (p.y < top || p.y > bottom) continue;
    const sy = p.y - camY + arenaY;
    ctx.beginPath();
    ctx.arc(p.x, sy, p.r, 0, Math.PI * 2);
    ctx.fillStyle = LEVEL_THEMES[0].obstacle;
    ctx.shadowColor = LEVEL_THEMES[0].obstacleGlow;
    ctx.shadowBlur = 10;
    ctx.fill();
  }
  ctx.restore();
}

// The funnel's two walls, in Level 2's pink accent.
function drawFunnel(
  ctx: CanvasRenderingContext2D,
  funnel: Funnel,
  camY: number,
  arenaY: number,
) {
  ctx.save();
  ctx.strokeStyle = LEVEL_THEMES[1].obstacle;
  ctx.shadowColor = LEVEL_THEMES[1].obstacleGlow;
  ctx.shadowBlur = 10;
  ctx.lineWidth = funnel.thickness;
  ctx.lineCap = "round";
  for (const wall of [funnel.left, funnel.right]) {
    ctx.beginPath();
    ctx.moveTo(wall.x1, wall.y1 - camY + arenaY);
    ctx.lineTo(wall.x2, wall.y2 - camY + arenaY);
    ctx.stroke();
  }
  ctx.restore();
}

// The central divider between the two peg lanes, in the pegs' blue accent
// so it reads as part of that section.
function drawDivider(
  ctx: CanvasRenderingContext2D,
  divider: Seg,
  thickness: number,
  camY: number,
  arenaY: number,
) {
  ctx.save();
  ctx.strokeStyle = LEVEL_THEMES[0].obstacle;
  ctx.shadowColor = LEVEL_THEMES[0].obstacleGlow;
  ctx.shadowBlur = 10;
  ctx.lineWidth = thickness;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(divider.x1, divider.y1 - camY + arenaY);
  ctx.lineTo(divider.x2, divider.y2 - camY + arenaY);
  ctx.stroke();
  ctx.restore();
}

// The cauldron bowl, in the same pink accent as the funnel it seals
// against — drawn as two true arcs (the collision polyline is an invisible
// physics detail), leaving the mouth open at the top and the exit gap at
// the bottom.
function drawCauldron(
  ctx: CanvasRenderingContext2D,
  cauldron: Cauldron,
  camY: number,
  arenaY: number,
) {
  const { cx, cy, r, thickness, mouthHalf, gapHalf } = cauldron;
  const sy = cy - camY + arenaY;
  ctx.save();
  ctx.strokeStyle = LEVEL_THEMES[1].obstacle;
  ctx.shadowColor = LEVEL_THEMES[1].obstacleGlow;
  ctx.shadowBlur = 10;
  ctx.lineWidth = thickness;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, sy, r, -Math.PI / 2 + mouthHalf, Math.PI / 2 - gapHalf);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, sy, r, Math.PI / 2 + gapHalf, (3 * Math.PI) / 2 - mouthHalf);
  ctx.stroke();
  ctx.restore();
}

// The spinner, in Level 3's gold accent — its two bars and hub are derived
// from the same wall-clock angle used by resolveRotor, so the drawing
// always matches where the ball actually collides.
function drawRotor(
  ctx: CanvasRenderingContext2D,
  rotor: Rotor,
  angle: number,
  camY: number,
  arenaY: number,
) {
  const { cx, cy, armLen, thickness, hubR } = rotor;
  const toScreenY = (y: number) => y - camY + arenaY;
  const ax = Math.cos(angle);
  const ay = Math.sin(angle);
  const bx = Math.cos(angle + Math.PI / 2);
  const by = Math.sin(angle + Math.PI / 2);

  ctx.save();
  ctx.strokeStyle = LEVEL_THEMES[2].obstacle;
  ctx.shadowColor = LEVEL_THEMES[2].obstacleGlow;
  ctx.shadowBlur = 12;
  ctx.lineWidth = thickness;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - ax * armLen, toScreenY(cy - ay * armLen));
  ctx.lineTo(cx + ax * armLen, toScreenY(cy + ay * armLen));
  ctx.moveTo(cx - bx * armLen, toScreenY(cy - by * armLen));
  ctx.lineTo(cx + bx * armLen, toScreenY(cy + by * armLen));
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, toScreenY(cy), hubR, 0, Math.PI * 2);
  ctx.fillStyle = LEVEL_THEMES[2].obstacle;
  ctx.shadowBlur = 8;
  ctx.fill();
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
  ctx.strokeStyle = "rgba(247, 201, 72, 0.55)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(247, 201, 72, 0.28)";
  ctx.shadowBlur = 10;
  for (const { half, dir } of halves) {
    const slideX = dir * t * half.w * 0.9;
    const dropY = t * half.h * 6;
    const sy = half.y - camY + arenaY + dropY;
    const grad = ctx.createLinearGradient(0, sy, 0, sy + half.h);
    grad.addColorStop(0, "#3a4362");
    grad.addColorStop(1, "#1c2237");
    ctx.fillStyle = grad;
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
  ctx.shadowColor = "rgba(247, 201, 72, 0.5)";
  ctx.shadowBlur = 6;
  for (let i = 0; i * tile < arena.width; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#f7c948" : "#161225";
    ctx.fillRect(arena.x + i * tile, sy, tile, tile * 0.7);
  }
  ctx.shadowBlur = 10;
  ctx.font = "900 14px Arial, Helvetica, sans-serif";
  ctx.fillStyle = "#fde9b8";
  ctx.textAlign = "center";
  ctx.fillText("FINISH", arena.x + arena.width / 2, sy - 8);
  ctx.restore();
}

// Draws a country's flag flattened over the ball's bounding box; the
// caller is expected to have already clipped to the ball's circle, so
// these rects/paths just need to cover [cx±r, cy±r] and the clip crops
// them to the roundel. Patterns are simplified (no coats of arms /
// suns / fine detail) since they render at ball-sized (tens of px).
function drawCountryFlag(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  country: string,
) {
  const x0 = cx - r;
  const y0 = cy - r;
  const w = r * 2;
  const h = r * 2;

  const hBands = (stops: [string, number][]) => {
    let y = y0;
    for (const [color, frac] of stops) {
      const bandH = h * frac;
      ctx.fillStyle = color;
      ctx.fillRect(x0, y, w, bandH + 0.5);
      y += bandH;
    }
  };

  const vBands = (colors: string[]) => {
    const bandW = w / colors.length;
    colors.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(x0 + i * bandW, y0, bandW + 0.5, h);
    });
  };

  switch (country) {
    case "Switzerland": {
      ctx.fillStyle = "#d52b1e";
      ctx.fillRect(x0, y0, w, h);
      ctx.fillStyle = "#ffffff";
      const armT = h * 0.2;
      const armLen = h * 0.56;
      ctx.fillRect(cx - armT / 2, cy - armLen / 2, armT, armLen);
      ctx.fillRect(cx - armLen / 2, cy - armT / 2, armLen, armT);
      break;
    }
    case "Argentina":
      hBands([
        ["#75aadb", 1 / 3],
        ["#f6f6f6", 1 / 3],
        ["#75aadb", 1 / 3],
      ]);
      break;
    case "England": {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x0, y0, w, h);
      ctx.fillStyle = "#ce1124";
      const barT = h * 0.32;
      ctx.fillRect(x0, cy - barT / 2, w, barT);
      ctx.fillRect(cx - barT / 2, y0, barT, h);
      break;
    }
    case "Norway": {
      ctx.fillStyle = "#ba0c2f";
      ctx.fillRect(x0, y0, w, h);
      const vx = x0 + w * 0.36; // Nordic cross sits toward the hoist side
      const whiteT = h * 0.42;
      const blueT = h * 0.2;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x0, cy - whiteT / 2, w, whiteT);
      ctx.fillRect(vx - whiteT / 2, y0, whiteT, h);
      ctx.fillStyle = "#00205b";
      ctx.fillRect(x0, cy - blueT / 2, w, blueT);
      ctx.fillRect(vx - blueT / 2, y0, blueT, h);
      break;
    }
    case "Spain":
      hBands([
        ["#aa151b", 0.25],
        ["#f1bf00", 0.5],
        ["#aa151b", 0.25],
      ]);
      break;
    case "Belgium":
      vBands(["#000000", "#fdda24", "#ef3340"]);
      break;
    case "France":
      vBands(["#0055a4", "#f5f5f5", "#ef4135"]);
      break;
    case "Morocco": {
      ctx.fillStyle = "#c1272d";
      ctx.fillRect(x0, y0, w, h);
      ctx.strokeStyle = "#006233";
      ctx.lineWidth = Math.max(1, r * 0.09);
      ctx.beginPath();
      const spikes = 5;
      const outerR = r * 0.62;
      const innerR = outerR * 0.5;
      for (let i = 0; i <= spikes * 2; i++) {
        const ang = (Math.PI / spikes) * i - Math.PI / 2;
        const rad = i % 2 === 0 ? outerR : innerR;
        const px = cx + Math.cos(ang) * rad;
        const py = cy + Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      break;
    }
    default:
      ctx.fillStyle = "#94a3b8";
      ctx.fillRect(x0, y0, w, h);
  }
}

function drawBalls(
  ctx: CanvasRenderingContext2D,
  balls: Ball[],
  camY: number,
  arenaY: number,
  bob: (index: number) => number,
) {
  balls.forEach((b, i) => {
    const sy = b.y + bob(i) - camY + arenaY;

    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, sy, b.r, 0, Math.PI * 2);
    // Fill once with the hue while the shadow is active to get the glow
    // halo, then turn the shadow off and clip before painting the flag so
    // the individual bands/cross bars don't each cast their own blur.
    ctx.fillStyle = `hsl(${b.hue}, 88%, 58%)`;
    ctx.shadowColor = `hsl(${b.hue}, 100%, 68%)`;
    ctx.shadowBlur = b.glow > 0 ? b.r * 2.6 : b.r * 1.2;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.clip();
    drawCountryFlag(ctx, b.x, sy, b.r, b.name);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, sy, b.r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(15, 23, 42, 0.45)";
    ctx.lineWidth = Math.max(1, b.r * 0.08);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x - b.r * 0.28, sy - b.r * 0.3, b.r * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.24)";
    ctx.fill();
    ctx.restore();
  });
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  mobile: boolean,
  phase: Phase,
  balls: Ball[],
  leaderName: string,
  finishedCount: number,
) {
  const { x, width } = arena;
  const cx = x + width / 2;

  // The big "COUNTRY BALL RACE" title only shows for the pre-race beat
  // (menu + countdown). Once racing starts it's replaced by just the
  // leading-country status line, promoted up into the title's slot —
  // no heading sitting at the top during the race itself.
  const showTitle = phase === "menu" || phase === "countdown";

  const racingSubtitle = () => {
    const remaining = balls.length - finishedCount;
    if (finishedCount === 0) return `${leaderName} is leading!`;
    if (remaining === 1) return `${leaderName} is last`;
    return `${leaderName} is ${ordinal(finishedCount + 1)}`;
  };
  const statusText = phase === "racing"
    ? racingSubtitle()
    : phase === "countdown"
      ? "Get ready…"
      : phase === "finished"
        ? "Race complete!"
        : "4 balls enter. Only 1 wins the maze.";

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // The fixed "back to menu" home button (app/page.tsx) sits at the
  // viewport's top-left corner — right edge ~56px on mobile, ~44px on
  // desktop — and this canvas shares the same pixel coordinate space as
  // the viewport. Shrink whatever text sits in the top slot (never below
  // a legible floor) so it always clears that button.
  const HOME_BTN_CLEARANCE = mobile ? 64 : 54;
  const maxTopW = (cx - HOME_BTN_CLEARANCE) * 2;

  // Whichever content occupies the top slot is bottom-anchored this far
  // above the arena's top edge and grows upward from there, so it can
  // never overlap the peg field below regardless of whether it's one line
  // (racing status) or two (title + subtitle).
  const headingBottomY = arena.y - HUD_LINE_CLEARANCE;

  if (showTitle) {
    const subtitleFontSize = mobile ? 12 : 14;
    const titleSubtitleGap = mobile ? 22 : 24;

    let titleFontSize = mobile ? 26 : 38;
    ctx.font = `900 ${titleFontSize}px Arial, Helvetica, sans-serif`;
    let titleW = ctx.measureText("COUNTRY BALL RACE").width;
    if (maxTopW > 0 && titleW > maxTopW) {
      titleFontSize = Math.max(18, titleFontSize * (maxTopW / titleW));
      ctx.font = `900 ${titleFontSize}px Arial, Helvetica, sans-serif`;
      titleW = ctx.measureText("COUNTRY BALL RACE").width;
    }
    const titleY = headingBottomY - titleSubtitleGap;

    const titleGrad = ctx.createLinearGradient(
      cx - titleW / 2,
      0,
      cx + titleW / 2,
      0,
    );
    titleGrad.addColorStop(0, "#fde9b8");
    titleGrad.addColorStop(0.5, "#f7c948");
    titleGrad.addColorStop(1, "#d4a017");
    ctx.fillStyle = titleGrad;
    ctx.shadowColor = "rgba(247, 201, 72, 0.5)";
    ctx.shadowBlur = 18;
    ctx.fillText("COUNTRY BALL RACE", cx, titleY);

    ctx.font = `700 ${subtitleFontSize}px Arial, Helvetica, sans-serif`;
    ctx.fillStyle = "rgba(254, 247, 233, 0.78)";
    ctx.shadowBlur = 0;
    ctx.fillText(statusText, cx, headingBottomY);
  } else {
    let fontSize = mobile ? 20 : 26;
    ctx.font = `800 ${fontSize}px Arial, Helvetica, sans-serif`;
    let textW = ctx.measureText(statusText).width;
    if (maxTopW > 0 && textW > maxTopW) {
      fontSize = Math.max(14, fontSize * (maxTopW / textW));
      ctx.font = `800 ${fontSize}px Arial, Helvetica, sans-serif`;
    }
    ctx.fillStyle = "#fde9b8";
    ctx.shadowColor = "rgba(247, 201, 72, 0.45)";
    ctx.shadowBlur = 12;
    ctx.fillText(statusText, cx, headingBottomY);
  }
  ctx.restore();
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
  ctx.font = `900 ${mobile ? 64 : 88}px Arial, Helvetica, sans-serif`;
  const labelW = ctx.measureText(label).width;
  const grad = ctx.createLinearGradient(cx - labelW / 2, 0, cx + labelW / 2, 0);
  grad.addColorStop(0, "#fde9b8");
  grad.addColorStop(0.5, "#f7c948");
  grad.addColorStop(1, "#d4a017");
  ctx.fillStyle = grad;
  ctx.shadowColor = "rgba(247, 201, 72, 0.6)";
  ctx.shadowBlur = 26;
  ctx.fillText(label, cx, cy);
  ctx.restore();
}

// ─── Component ────────────────────────────────────────────────────────────────

const BallRace = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<Arena | null>(null);
  const courseRef = useRef<Course | null>(null);
  const ballsRef = useRef<Ball[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTRef = useRef<number>(0);
  const audioRef = useRef(createAudio());
  const phaseRef = useRef<Phase>("menu");
  // The ball currently in the lead. Updated every frame to whichever ball
  // still racing is furthest along — used only for the HUD's "X is
  // leading!" text. A finished ball is dropped from consideration and the
  // next furthest-along ball becomes the new leader.
  const leadingBallRef = useRef<Ball | null>(null);
  const countdownEndAtRef = useRef<number | null>(null);
  const raceStartAtRef = useRef<number | null>(null);
  const finishOrderRef = useRef<Ball[]>([]);

  const [phase, setPhase] = useState<Phase>("menu");
  const [standings, setStandings] = useState<Ball[]>([]);
  const [musicPromptOpen, setMusicPromptOpen] = useState(true);

  const enableMusic = useCallback(() => {
    audioRef.current.unlock();
    audioRef.current.startMusic(BG_MUSIC_VOLUME);
    setMusicPromptOpen(false);
  }, []);

  const skipMusic = useCallback(() => {
    setMusicPromptOpen(false);
  }, []);

  const buildRace = useCallback((arena: Arena) => {
    const ballR = arena.width * 0.048 * 0.7 * 0.8 * 0.8;
    const course = generateCourse(arena, ballR);
    courseRef.current = course;
    ballsRef.current = spawnBalls(course.platform, ballR);
    particlesRef.current = [];
    leadingBallRef.current = null;
    finishOrderRef.current = [];
    raceStartAtRef.current = null;
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

      drawBackground(ctx, W, H);
      drawPaddingFrame(ctx, W, H);
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
        const subDt = dt / SUBSTEPS;
        const elapsedRace = raceStartAt !== null ? (now - raceStartAt) / 1000 : 0;
        // The rotor spins on wall-clock time (not race-elapsed), so it's
        // already moving during the countdown and stays in sync between
        // this physics step and the draw call below.
        const rotorAngle =
          (now / 1000) * course.cauldron.rotor.angularSpeed + course.cauldron.rotor.phase;
        const maxFling = arena.width * ROTOR_FLING_MAX_K;

        for (let s = 0; s < SUBSTEPS; s++) {
          for (const ball of balls) {
            if (ball.finished || elapsedRace < ball.dropDelay) continue;
            ball.vy = Math.min(ball.vy + gravity * subDt, maxFall);
            ball.x += ball.vx * subDt;
            ball.y += ball.vy * subDt;
            if (ball.glow > 0) ball.glow -= subDt;
            resolveWalls(ball, left, right, audio);
            for (const peg of course.pegs) resolvePeg(ball, peg, audio);
            const dv = course.divider;
            resolveSegment(ball, dv.x1, dv.y1, dv.x2, dv.y2, course.funnel.thickness, audio);
            resolveFunnel(ball, course.funnel, audio);
            resolveCauldron(ball, course.cauldron, rotorAngle, maxFling, audio);
          }
          for (let i = 0; i < balls.length; i++) {
            for (let j = i + 1; j < balls.length; j++) {
              if (
                balls[i].finished ||
                balls[j].finished ||
                elapsedRace < balls[i].dropDelay ||
                elapsedRace < balls[j].dropDelay
              ) {
                continue;
              }
              bounceBalls(balls[i], balls[j], audio);
            }
          }
        }

        for (const ball of balls) {
          if (ball.finished || elapsedRace < ball.dropDelay) continue;
          applyAntiStall(ball, dt);
        }

        for (const ball of balls) {
          if (!ball.finished && ball.y - ball.r >= course.finishY) {
            ball.finished = true;
            ball.rank = finishOrderRef.current.length + 1;
            finishOrderRef.current.push(ball);
            spawnBurst(particlesRef.current, ball.x, ball.y, ball.hue, 26);
            audio.win();
          }
        }

        // leadingBallRef always points at whichever ball still racing is
        // furthest along, recomputed fresh every frame. A finished ball is
        // excluded by the !b.finished check, so the instant the leader
        // crosses the line it drops out and the next furthest-along ball
        // takes over automatically.
        leadingBallRef.current = balls.reduce(
          (best: Ball | null, b) =>
            !b.finished && (!best || b.y > best.y) ? b : best,
          null,
        );

        // The race only ends once every ball has reached the finish line
        // on its own — no time-based cutoff.
        const allDone = finishOrderRef.current.length === balls.length;
        if (allDone) {
          phaseRef.current = "finished";
          setStandings(finishOrderRef.current.slice());
          setPhase("finished");
        }
      }

      if (phaseNow === "racing" || phaseNow === "finished") {
        updateParticles(particlesRef.current, dt);
      }

      // No camera movement — the whole course fits on one static screen,
      // so world Y coordinates map directly onto the arena.
      const camY = 0;

      // Everything below is actual race content (corridor, obstacles,
      // balls, particles). None of it should ever be able to paint above
      // the HUD text, regardless of phase, so it's all drawn inside a
      // single clip covering the arena box. Only the full-bleed
      // background/watermark above and the HUD/countdown overlay below
      // fall outside this clip.
      ctx.save();
      ctx.beginPath();
      ctx.rect(arena.x, arena.y, arena.width, arena.height);
      ctx.clip();

      drawCorridor(ctx, arena, camY);

      if (phaseNow !== "menu") {
        const rotorAngle =
          (now / 1000) * course.cauldron.rotor.angularSpeed + course.cauldron.rotor.phase;
        drawPegs(ctx, course.pegs, camY, arena.y, arena.height);
        drawDivider(ctx, course.divider, course.funnel.thickness, camY, arena.y);
        drawFunnel(ctx, course.funnel, camY, arena.y);
        drawCauldron(ctx, course.cauldron, camY, arena.y);
        drawRotor(ctx, course.cauldron.rotor, rotorAngle, camY, arena.y);
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

      const bob =
        phaseNow === "menu" || phaseNow === "countdown"
          ? (i: number) => Math.sin(now / 650 + i * 1.3) * balls[i].r * 0.5
          : () => 0;

      drawBalls(ctx, balls, camY, arena.y, bob);

      if (phaseNow === "racing" || phaseNow === "finished") {
        drawParticles(ctx, particlesRef.current, camY, arena.y);
      }

      ctx.restore();

      // Reuse leadingBallRef so the HUD's "X is leading!" text always
      // names the same ball the camera is following.
      const leader =
        phaseNow === "racing" || phaseNow === "finished"
          ? leadingBallRef.current
          : null;

      drawHud(
        ctx,
        arena,
        mobile,
        phaseNow,
        balls,
        leader ? leader.name : "",
        finishOrderRef.current.length,
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

      {musicPromptOpen && (
        <div className="cr-finished">
          <div className="cr-panel">
            <h2 className="cr-panel-title">🎵 Background Music</h2>
            <p className="cr-music-desc">
              Play music while you race? You can turn it off anytime.
            </p>
            <button type="button" className="cr-play-btn" onClick={enableMusic}>
              🎶 MUSIC ON
            </button>
            <button type="button" className="cr-skip-btn" onClick={skipMusic}>
              Skip
            </button>
          </div>
        </div>
      )}

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
          background: #30334a;
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
          border: 1px solid rgba(247, 201, 72, 0.55);
          border-radius: 12px;
          background: linear-gradient(
            160deg,
            rgba(58, 44, 12, 0.6),
            rgba(16, 20, 40, 0.62)
          );
          color: #fde9b8;
          font-family: Arial, Helvetica, sans-serif;
          font-size: clamp(0.95rem, 2.5vw, 1.1rem);
          font-weight: 900;
          letter-spacing: 0.18em;
          cursor: pointer;
          backdrop-filter: blur(10px);
          box-shadow: 0 0 28px rgba(247, 201, 72, 0.2);
          transition:
            transform 0.2s,
            box-shadow 0.2s,
            background 0.2s;
        }

        .cr-play-btn:hover {
          background: linear-gradient(
            160deg,
            rgba(80, 60, 14, 0.72),
            rgba(20, 26, 52, 0.72)
          );
          box-shadow: 0 0 40px rgba(247, 201, 72, 0.4);
          transform: scale(1.05);
        }

        .cr-play-btn:active {
          transform: scale(0.97);
        }

        .cr-finished {
          position: absolute;
          inset: 0;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(6, 5, 16, 0.6);
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
          border: 1px solid rgba(247, 201, 72, 0.38);
          border-radius: 18px;
          background: rgba(10, 12, 28, 0.86);
          backdrop-filter: blur(12px);
          box-shadow: 0 0 44px rgba(247, 201, 72, 0.16);
        }

        .cr-panel-title {
          margin: 0;
          font-family: Arial, Helvetica, sans-serif;
          font-size: clamp(1.25rem, 5vw, 1.7rem);
          font-weight: 900;
          text-align: center;
          color: #fde9b8;
        }

        .cr-music-desc {
          margin: 0;
          font-family: Arial, Helvetica, sans-serif;
          font-size: clamp(0.85rem, 3vw, 0.95rem);
          text-align: center;
          color: rgba(254, 247, 233, 0.78);
        }

        .cr-skip-btn {
          pointer-events: all;
          background: none;
          border: none;
          color: rgba(254, 247, 233, 0.6);
          font-family: Arial, Helvetica, sans-serif;
          font-size: clamp(0.8rem, 2.5vw, 0.9rem);
          font-weight: 700;
          letter-spacing: 0.08em;
          text-decoration: underline;
          cursor: pointer;
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
          background: rgba(247, 201, 72, 0.07);
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
          color: #f7f2e7;
        }
      `}</style>
    </div>
  );
};

export default BallRace;
