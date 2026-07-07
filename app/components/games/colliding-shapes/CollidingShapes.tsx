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
const BALL_RESTITUTION = 0.82;
const PEG_RESTITUTION = 0.78;
const ANTI_STALL_SECS = 1.3; // tolerant enough to let a ball wait stuck

const GATE_MOVEMENT_SPEED = 1.15; // rad/s — oscillation frequency of a gate's gap
const GATE_GAP_BALL_FACTOR = 3.4 * 2; // gap width, in ball-diameters — generous for touch/tilt latency
const GATE_BAR_THICKNESS_FACTOR = 0.9; // bar thickness, in ball-radii
const GATE_WALL_MARGIN_FACTOR = 0.6; // min ball-radii of clearance kept at the wall when the gap swings to an extreme
const GATE_SPACING_BALL_FACTOR = 7; // vertical spacing between gates, in ball-diameters — gives reaction time
const GATE_MIN_COUNT = 6; // always at least this many gates, spacing stays fixed — the level lengthens instead of compressing

// Level 3, part A — "Spinner": a small rotating cross the ball dodges
// around. Its arms are short relative to the corridor, so there's always
// clear space to route around it — it narrows the path, it never seals it.
// Laid out in rows across the corridor, alternating row sizes.
const SPINNER_ROTATE_SPEED = 2.2; // rad/s — how fast a spinner's cross spins
const SPINNER_ARM_LEN_FACTOR = 0.11; // each arm's reach from center, as a fraction of corridor width
const SPINNER_THICKNESS_FACTOR = 0.8; // arm thickness, in ball-radii
const SPINNER_SPACING_BALL_FACTOR = 6; // vertical spacing between spinner rows, in ball-diameters
const SPINNER_ROW_PATTERN = [3, 2]; // spinners per row, in order down the level

// Level 3, part B — "Vortex": a large rotating ring with a single wide
// opening (a "C", not a closed loop) — just the ring, nothing attached to
// it, so there's no piece that could ever close into a pocket.
const VORTEX_ROTATE_SPEED = 0.7; // rad/s — how fast a vortex ring spins
const VORTEX_RADIUS_FACTOR = 0.26 * 1.5 * 1.25; // outer ring radius, as a fraction of corridor width — spans nearly the full corridor, so the gap is the only way through
const VORTEX_WALL_THICKNESS_FACTOR = 0.8; // ring wall thickness, in ball-radii
const VORTEX_GAP_BALL_FACTOR = 4.5 * 3; // the single opening's arc width, in ball-diameters — generous, since there's no second gap to fall back on
const VORTEX_SPACING_BALL_FACTOR = 4; // extra reaction-room buffer added on top of the ring's own diameter, in ball-diameters
const VORTEX_COUNT = 3;
const VORTEX_RING_STEPS = 48; // straight segments approximating the ring
const BALL_TRAIL_LIFE = 0.22; // seconds a speed-trail particle lives

const TRACK_Y_MOBILE = 84;
const TRACK_Y_DESKTOP = 100;

const RACE_END_GRACE_MS = 6000;
const COUNTDOWN_MS = 3000;
const START_SCREEN_FRACTION = 0.2; // where the start platform sits on screen (0 = top)
const PLATFORM_OPEN_MS = 450;

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

type Peg = {
  id: number;
  x: number;
  y: number;
  r: number;
};

// A horizontal gate: two solid bars with a gap between them. The gap slides
// left/right along a sine wave, so the ball must time its pass through it.
type Gate = {
  id: number;
  trackY: number;
  baseX: number; // resting (mid-swing) x of the gap center
  amplitude: number; // movementDistance — how far the gap swings from baseX
  frequency: number; // movementSpeed — angular speed of the oscillation (rad/s)
  phaseOffset: number; // staggers gates into an alternating slalom
  gapW: number;
  barH: number;
  left: number;
  right: number;
};

// A small rotating cross (two perpendicular bars sharing a pivot) — the
// "Spinner" obstacle. Arms are short relative to the corridor, so a ball
// always has room to route around it.
type Spinner = {
  id: number;
  cx: number;
  cy: number;
  armLen: number; // reach from center to a tip
  thickness: number;
  angle0: number;
  rotationSpeed: number; // rad/s, sign is spin direction
};

// One wall segment of a vortex ring's geometry, in the ring's own local
// (unrotated) coordinates — pre-built once and rotated per-frame rather
// than regenerated, since the shape itself never changes, only its angle.
type MazeSegment = { ax: number; ay: number; bx: number; by: number };

// A large rotating ring with a single wide opening — the "Vortex"
// obstacle. `localSegments` is shared by every ring of the same size,
// since the geometry is identical; only cx/cy/angle differ per instance.
type VortexRing = {
  id: number;
  cx: number;
  cy: number;
  outerR: number;
  wallThickness: number;
  angle0: number;
  rotationSpeed: number; // rad/s, sign is spin direction
  localSegments: MazeSegment[];
};

type PlatformHalf = { x: number; y: number; w: number; h: number };
type StartPlatform = { left: PlatformHalf; right: PlatformHalf };

type Course = {
  platform: StartPlatform;
  pegs: Peg[];
  gates: Gate[];
  spinners: Spinner[];
  vortexRings: VortexRing[];
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
// No obstacles yet — just the start platform and an empty corridor down to
// the finish line. Obstacles are being redesigned from scratch.

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

// Wraps an angle difference into [-π, π] — used to test whether an angle
// falls within a gap centered elsewhere on the circle.
function normalizeAngleDiff(a: number): number {
  let d = ((a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Builds a vortex ring's wall geometry once, in local (unrotated)
// coordinates centered on the ring's pivot: just the ring itself, broken
// by a single wide opening (a "C", not a closed loop) — nothing else
// attached, so there's no piece that could ever close into a pocket.
function buildVortexSegments(
  outerR: number,
  gapAngle: number,
): MazeSegment[] {
  const segments: MazeSegment[] = [];
  const gapCenter = -Math.PI / 2;

  for (let i = 0; i < VORTEX_RING_STEPS; i++) {
    const a0 = (i / VORTEX_RING_STEPS) * Math.PI * 2 - Math.PI;
    const a1 = ((i + 1) / VORTEX_RING_STEPS) * Math.PI * 2 - Math.PI;
    const mid = (a0 + a1) / 2;
    if (Math.abs(normalizeAngleDiff(mid - gapCenter)) < gapAngle) continue;
    segments.push({
      ax: Math.cos(a0) * outerR,
      ay: Math.sin(a0) * outerR,
      bx: Math.cos(a1) * outerR,
      by: Math.sin(a1) * outerR,
    });
  }

  return segments;
}

function generateCourse(arena: Arena, ballR: number): Course {
  const width = arena.width;
  const left = arena.x;
  const levelH = arena.height;

  const platform = buildStartPlatform(arena, ballR);
  const level1Y0 = platform.left.y + platform.left.h + ballR * 3;

  const pegs: Peg[] = [];
  let pgid = 0;

  // A hex/brick peg pattern — full rows of pegs alternating with rows
  // offset by half a spacing (one peg shorter), nested in the gaps above
  // and below. Spacing between neighbors, row-to-row or peg-to-peg within
  // a row, is 2x a ball's diameter.
  //   *  *  *  *  *  *
  //     *  *  *  *  *
  //   *  *  *  *  *  *
  //     *  *  *  *  *
  const addPegField = (topY: number, span: number) => {
    const ballSize = ballR * 2;
    const spacing = ballSize * 2;
    const pegR = ballR * 0.55 * 0.85;
    const usable = width - ballR * 2;
    const cols = Math.max(2, Math.floor(usable / spacing) + 1);
    const gridW = (cols - 1) * spacing;
    const baseX = left + (width - gridW) / 2;
    const rows = Math.max(2, Math.round(span / spacing) + 1);
    for (let row = 0; row < rows; row++) {
      const y = topY + row * spacing;
      const offsetRow = row % 2 === 1;
      const rowCols = offsetRow ? cols - 1 : cols;
      const startX = offsetRow ? baseX + spacing / 2 : baseX;
      for (let c = 0; c < rowCols; c++) {
        const x = startX + c * spacing;
        pegs.push({ id: pgid++, x, y, r: pegR });
      }
    }
  };

  // Level 1 — pure Plinko pegs, edge-to-edge.
  addPegField(level1Y0, levelH * 0.96);
  const level1EndY = pegs.reduce((maxY, p) => Math.max(maxY, p.y), level1Y0);

  // Level 2 — "The Rhythmic Pulse": a sequence of gates whose gap swings
  // left/right on a sine wave. Consecutive gates alternate phaseOffset
  // (0, PI), so timing that clears one gate's gap runs out of sync for the
  // next, forcing a slalom rhythm rather than a straight run down the middle.
  const gates: Gate[] = [];
  let gateId = 0;
  const addGate = (
    trackY: number,
    phaseOffset: number,
    frequency: number,
    amplitude: number,
    gapW: number,
    barH: number,
  ) => {
    gates.push({
      id: gateId++,
      trackY,
      baseX: left + width / 2,
      amplitude,
      frequency,
      phaseOffset,
      gapW,
      barH,
      left,
      right: left + width,
    });
  };

  // Dynamic bounds: gap width, bar thickness, swing amplitude and row
  // spacing are all derived from the corridor width and ball size (never a
  // hardcoded pixel value), so the pattern scales cleanly across mobile
  // aspect ratios and never lets a bar clip past the walls.
  const gateGapW = ballR * 2 * GATE_GAP_BALL_FACTOR;
  const gateBarH = ballR * GATE_BAR_THICKNESS_FACTOR;
  const gateAmplitude = Math.max(
    0,
    width / 2 - gateGapW / 2 - ballR * GATE_WALL_MARGIN_FACTOR,
  );

  // Gates keep a fixed spacing and never drop below GATE_MIN_COUNT — on
  // short screens the level lengthens (rather than the gates compressing
  // together) to fit them all in.
  const gateSpacing = ballR * 2 * GATE_SPACING_BALL_FACTOR;
  const gateSpanFit = levelH * 0.9;
  const gateCount = Math.max(
    GATE_MIN_COUNT,
    Math.round(gateSpanFit / gateSpacing) + 1,
  );
  const gateSpan = (gateCount - 1) * gateSpacing;

  // At least 4 ball-diameters of clear corridor between the last Level 1
  // peg row and the first Level 2 bar, so they never visually/physically
  // run into each other.
  const level2Y0 = level1EndY + ballR * 8;
  const gateTopY = level2Y0 + Math.max(0, levelH - gateSpan) / 2;
  for (let i = 0; i < gateCount; i++) {
    addGate(
      gateTopY + i * gateSpacing,
      i % 2 === 0 ? 0 : Math.PI,
      GATE_MOVEMENT_SPEED,
      gateAmplitude,
      gateGapW,
      gateBarH,
    );
  }

  const level3Y0 = gateTopY + gateSpan + ballR * 6;

  // Level 3, part A — Spinners: rows across the corridor, alternating row
  // size per SPINNER_ROW_PATTERN (3 across, then 2 across).
  const spinnerArmLen = width * SPINNER_ARM_LEN_FACTOR;
  const spinnerThickness = ballR * SPINNER_THICKNESS_FACTOR;
  const spinnerSpacing = ballR * 2 * SPINNER_SPACING_BALL_FACTOR;
  const spinnerTopY = level3Y0 + spinnerSpacing / 2;

  const spinners: Spinner[] = [];
  let spinnerId = 0;
  let spinnerRowY = spinnerTopY;
  // Keep the outermost spinner's reach at least this far from a wall, so
  // widening a row's gap can never push an arm past the physics walls.
  const spinnerRowWallMargin = spinnerArmLen + ballR * 1.5;
  for (const rowCount of SPINNER_ROW_PATTERN) {
    const baseGap = width / (rowCount + 1);
    // The row of 3 gets a 2x gap per the level design; other row sizes
    // keep their original spacing.
    const desiredGap = rowCount === 3 ? baseGap * 2 : baseGap;
    const maxSpan = Math.max(0, width - spinnerRowWallMargin * 2);
    const gap =
      rowCount > 1
        ? Math.min(desiredGap, maxSpan / (rowCount - 1))
        : desiredGap;
    const totalSpan = gap * (rowCount - 1);
    const startX = left + width / 2 - totalSpan / 2;
    for (let i = 0; i < rowCount; i++) {
      spinners.push({
        id: spinnerId,
        cx: startX + i * gap,
        cy: spinnerRowY,
        armLen: spinnerArmLen,
        thickness: spinnerThickness,
        angle0: Math.random() * Math.PI * 2,
        rotationSpeed: (spinnerId % 2 === 0 ? 1 : -1) * SPINNER_ROTATE_SPEED,
      });
      spinnerId++;
    }
    spinnerRowY += spinnerSpacing;
  }
  const spinnersEndY = spinnerRowY - spinnerSpacing;

  // Level 3, part B — Vortex rings. A ring's own diameter dwarfs the
  // ball, so spacing has to clear that diameter first and only then add
  // reaction room — a ball-diameter multiple alone (as gates use) would
  // let consecutive rings overlap.
  const vortexR = width * VORTEX_RADIUS_FACTOR;
  const vortexGapW = ballR * 2 * VORTEX_GAP_BALL_FACTOR;
  const vortexGapAngle = vortexGapW / (2 * vortexR);
  const vortexWallH = ballR * VORTEX_WALL_THICKNESS_FACTOR;
  // Every ring this level is the same size, so they all share one
  // precomputed geometry — only cx/cy/angle differ per instance.
  const vortexLocalSegments = buildVortexSegments(vortexR, vortexGapAngle);
  const vortexSpacing = vortexR * 2 + ballR * 2 * VORTEX_SPACING_BALL_FACTOR;
  const vortexTopY = spinnersEndY + spinnerSpacing * 1.5 + vortexR;

  const vortexRings: VortexRing[] = [];
  for (let i = 0; i < VORTEX_COUNT; i++) {
    vortexRings.push({
      id: i,
      cx: left + width / 2,
      cy: vortexTopY + i * vortexSpacing,
      outerR: vortexR,
      wallThickness: vortexWallH,
      angle0: Math.random() * Math.PI * 2,
      rotationSpeed: (i % 2 === 0 ? 1 : -1) * VORTEX_ROTATE_SPEED,
      localSegments: vortexLocalSegments,
    });
  }
  const vortexEndY = vortexTopY + (VORTEX_COUNT - 1) * vortexSpacing;

  const finishY = vortexEndY + vortexR + levelH * 0.6 + ballR * 12;

  return { platform, pegs, gates, spinners, vortexRings, finishY };
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

// Gap center follows a sine wave driven by absolute elapsed time (not a
// per-frame accumulator), so its position is exact regardless of frame
// drops — no dt-accumulation drift to compensate for.
function gateGapCenterX(gate: Gate, elapsed: number): number {
  return (
    gate.baseX +
    gate.amplitude * Math.sin(gate.frequency * elapsed + gate.phaseOffset)
  );
}

function resolveGate(
  ball: Ball,
  gate: Gate,
  elapsed: number,
  audio: RaceAudio,
) {
  const gapCenter = gateGapCenterX(gate, elapsed);
  const gapHalf = gate.gapW / 2;
  const gapLeftX = gapCenter - gapHalf;
  const gapRightX = gapCenter + gapHalf;
  if (gapLeftX > gate.left) {
    resolveSegment(
      ball,
      gate.left,
      gate.trackY,
      gapLeftX,
      gate.trackY,
      gate.barH,
      audio,
    );
  }
  if (gapRightX < gate.right) {
    resolveSegment(
      ball,
      gapRightX,
      gate.trackY,
      gate.right,
      gate.trackY,
      gate.barH,
      audio,
    );
  }
}

// Circle-to-Rotated-Line collision: rotate a bar's two endpoints by its
// current angle (two cos/sin calls) and hand off to the same
// closest-point segment test every other obstacle in this file uses.
function resolveRotatedBar(
  ball: Ball,
  cx: number,
  cy: number,
  angle: number,
  length: number,
  thickness: number,
  audio: RaceAudio,
) {
  const halfLen = length / 2;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const x1 = cx - cosA * halfLen;
  const y1 = cy - sinA * halfLen;
  const x2 = cx + cosA * halfLen;
  const y2 = cy + sinA * halfLen;
  resolveSegment(ball, x1, y1, x2, y2, thickness, audio);
}

// A Spinner is a cross: two perpendicular bars sharing a pivot. angle is
// driven by absolute elapsed time, so — like the Level 2 gates — it can't
// drift under frame-rate variance.
function resolveSpinner(
  ball: Ball,
  spinner: Spinner,
  elapsed: number,
  audio: RaceAudio,
) {
  const angle = spinner.angle0 + spinner.rotationSpeed * elapsed;
  const fullLen = spinner.armLen * 2;
  resolveRotatedBar(
    ball,
    spinner.cx,
    spinner.cy,
    angle,
    fullLen,
    spinner.thickness,
    audio,
  );
  resolveRotatedBar(
    ball,
    spinner.cx,
    spinner.cy,
    angle + Math.PI / 2,
    fullLen,
    spinner.thickness,
    audio,
  );
}

// The vortex ring's wall geometry is precomputed once in local
// coordinates (buildVortexSegments); each frame we just rotate that fixed
// shape by its current angle — one cos/sin pair for the whole ring,
// reused for every segment — and hand each rotated segment to the same
// closest-point-on-segment test used everywhere else in this file.
function resolveVortexRing(
  ball: Ball,
  ring: VortexRing,
  elapsed: number,
  audio: RaceAudio,
) {
  if (Math.abs(ball.y - ring.cy) > ring.outerR + ball.r) return;

  const angle = ring.angle0 + ring.rotationSpeed * elapsed;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  for (const seg of ring.localSegments) {
    const ax = ring.cx + seg.ax * cosA - seg.ay * sinA;
    const ay = ring.cy + seg.ax * sinA + seg.ay * cosA;
    const bx = ring.cx + seg.bx * cosA - seg.by * sinA;
    const by = ring.cy + seg.bx * sinA + seg.by * cosA;
    resolveSegment(ball, ax, ay, bx, by, ring.wallThickness, audio);
  }
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

// Player ball glowing speed trail: one faint, short-lived particle spawned
// per ball per frame while racing.
function spawnTrail(particles: Particle[], ball: Ball) {
  particles.push({
    x: ball.x,
    y: ball.y,
    vx: -ball.vx * 0.08 + (Math.random() - 0.5) * ball.r * 0.4,
    vy: -ball.vy * 0.08,
    life: BALL_TRAIL_LIFE,
    maxLife: BALL_TRAIL_LIFE,
    hue: ball.hue,
  });
  if (particles.length > 220) particles.splice(0, particles.length - 220);
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
    ctx.fillStyle = "#38bdf8";
    ctx.shadowColor = "rgba(56, 189, 248, 0.8)";
    ctx.shadowBlur = 10;
    ctx.fill();
  }
  ctx.restore();
}

function drawGates(
  ctx: CanvasRenderingContext2D,
  gates: Gate[],
  camY: number,
  arenaY: number,
  viewH: number,
  elapsed: number,
) {
  const top = camY - 80;
  const bottom = camY + viewH + 80;

  ctx.save();
  ctx.fillStyle = "#38bdf8";
  ctx.shadowColor = "rgba(56, 189, 248, 0.8)";
  ctx.shadowBlur = 10;
  for (const g of gates) {
    if (g.trackY < top || g.trackY > bottom) continue;
    const sy = g.trackY - camY + arenaY;
    const gapCenter = gateGapCenterX(g, elapsed);
    const gapHalf = g.gapW / 2;
    const gapLeftX = gapCenter - gapHalf;
    const gapRightX = gapCenter + gapHalf;
    const halfH = g.barH / 2;
    if (gapLeftX > g.left) {
      ctx.fillRect(g.left, sy - halfH, gapLeftX - g.left, g.barH);
    }
    if (gapRightX < g.right) {
      ctx.fillRect(gapRightX, sy - halfH, g.right - gapRightX, g.barH);
    }
  }
  ctx.restore();
}

// Spinners — a rotating "+" cross. Matches the dark theme's peg/gate blue.
function drawSpinners(
  ctx: CanvasRenderingContext2D,
  spinners: Spinner[],
  camY: number,
  arenaY: number,
  viewH: number,
  elapsed: number,
) {
  const top = camY - 60;
  const bottom = camY + viewH + 60;

  ctx.save();
  ctx.strokeStyle = "#38bdf8";
  ctx.fillStyle = "#38bdf8";
  ctx.shadowColor = "rgba(56, 189, 248, 0.8)";
  ctx.shadowBlur = 10;
  ctx.lineCap = "round";
  for (const s of spinners) {
    if (s.cy < top || s.cy > bottom) continue;
    const sy = s.cy - camY + arenaY;
    const angle = s.angle0 + s.rotationSpeed * elapsed;

    ctx.save();
    ctx.translate(s.cx, sy);
    ctx.rotate(angle);
    ctx.lineWidth = s.thickness;
    ctx.beginPath();
    ctx.moveTo(-s.armLen, 0);
    ctx.lineTo(s.armLen, 0);
    ctx.moveTo(0, -s.armLen);
    ctx.lineTo(0, s.armLen);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, s.thickness * 0.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
  ctx.restore();
}

// Vortex rings — drawn by rotating the same local-space geometry used for
// collision (as a bundle of short lines rather than arcs, so the visible
// boundary can never drift out of sync with the physics boundary).
function drawVortexRings(
  ctx: CanvasRenderingContext2D,
  rings: VortexRing[],
  camY: number,
  arenaY: number,
  viewH: number,
  elapsed: number,
) {
  const top = camY - 120;
  const bottom = camY + viewH + 120;

  ctx.save();
  ctx.strokeStyle = "#38bdf8";
  ctx.fillStyle = "#38bdf8";
  ctx.shadowColor = "rgba(56, 189, 248, 0.8)";
  ctx.shadowBlur = 10;
  ctx.lineCap = "round";
  for (const r of rings) {
    if (r.cy < top || r.cy > bottom) continue;
    const sy = r.cy - camY + arenaY;
    const angle = r.angle0 + r.rotationSpeed * elapsed;

    ctx.save();
    ctx.translate(r.cx, sy);
    ctx.rotate(angle);
    ctx.lineWidth = r.wallThickness;
    ctx.beginPath();
    for (const seg of r.localSegments) {
      ctx.moveTo(seg.ax, seg.ay);
      ctx.lineTo(seg.bx, seg.by);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, r.wallThickness * 0.7, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
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
    const trackY = mobile ? TRACK_Y_MOBILE : TRACK_Y_DESKTOP;
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

        for (let s = 0; s < SUBSTEPS; s++) {
          for (const ball of balls) {
            if (ball.finished) continue;
            ball.vy = Math.min(ball.vy + gravity * subDt, maxFall);
            ball.x += ball.vx * subDt;
            ball.y += ball.vy * subDt;
            if (ball.glow > 0) ball.glow -= subDt;
            resolveWalls(ball, left, right, audio);
            for (const peg of course.pegs) resolvePeg(ball, peg, audio);
            for (const gate of course.gates) {
              resolveGate(ball, gate, now / 1000, audio);
            }
            for (const spinner of course.spinners) {
              resolveSpinner(ball, spinner, now / 1000, audio);
            }
            for (const ring of course.vortexRings) {
              resolveVortexRing(ball, ring, now / 1000, audio);
            }
          }
          for (let i = 0; i < balls.length; i++) {
            for (let j = i + 1; j < balls.length; j++) {
              if (balls[i].finished || balls[j].finished) continue;
              bounceBalls(balls[i], balls[j], audio);
            }
          }
        }

        for (const ball of balls) {
          if (ball.finished) continue;
          applyAntiStall(ball, dt);
          spawnTrail(particlesRef.current, ball);
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
        drawPegs(ctx, course.pegs, camY, arena.y, arena.height);
        drawGates(ctx, course.gates, camY, arena.y, arena.height, now / 1000);
        drawSpinners(
          ctx,
          course.spinners,
          camY,
          arena.y,
          arena.height,
          now / 1000,
        );
        drawVortexRings(
          ctx,
          course.vortexRings,
          camY,
          arena.y,
          arena.height,
          now / 1000,
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

      const clipToArena = phaseNow === "racing" || phaseNow === "finished";
      if (clipToArena) {
        const trackY = mobile ? TRACK_Y_MOBILE : TRACK_Y_DESKTOP;
        ctx.save();
        ctx.beginPath();
        ctx.rect(arena.x, trackY, arena.width, arena.H - trackY);
        ctx.clip();
      }

      drawBalls(ctx, balls, camY, arena.y, leader ? leader.id : null, bob);

      if (phaseNow === "racing" || phaseNow === "finished") {
        drawParticles(ctx, particlesRef.current, camY, arena.y);
      }

      if (clipToArena) {
        ctx.restore();
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
