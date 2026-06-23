"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { drawCanvasWatermark } from "@/app/lib/watermark";

// ─── Types ────────────────────────────────────────────────────────────────────

type ShapeType = "square" | "circle" | "triangle";
// assembled  = all pieces merged, cracked shape held still for ASSEMBLED_PAUSE seconds
// transition = cracked fades out, solid shape fades in with blur (TRANSITION_DUR seconds)
// bouncing   = plain solid shape bounces forever
type Phase = "editor" | "simulation" | "assembled" | "transition" | "bouncing" | "race";
type Arena = { x: number; y: number; size: number; cx: number; cy: number };

type Cell = {
  id: number;
  gridRow: number; gridCol: number;
  targetX: number; targetY: number;
  localX: number;  localY: number;
  verts: [number, number][];
  tileSize: number;
};

type Body = {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  cells: Cell[];
  glowColor: "none" | "green" | "red";
  glowTimer: number;
  color: string;
  shape: ShapeType;
};

type RaceSubPhase = "racing" | "assembled" | "transition" | "bouncing";
type RaceEntry = {
  shape: ShapeType;
  total: number;
  place: number | null;
  finishTime: number;
  subPhase: RaceSubPhase;
  assembledTimer: number;
  transP: number;
  solid: Solid;
  solidSize: number;
  completionGlow: number; // 1→0 over ASSEMBLED_PAUSE when shape finishes
};

type Solid = { x: number; y: number; vx: number; vy: number };

// ─── Constants ────────────────────────────────────────────────────────────────

const PIECE_SPEED        = 136;
const MERGE_DELAY        = 5.0;
const ATTACH_THRESHOLD   = 0.80;
const ARENA_PAD          = 14;
const GRID_JITTER        = 0.42;
const VERT_INSET         = 0.87;
const ASSEMBLED_RATIO    = 0.29;
const ASSEMBLED_PAUSE    = 0.75; // seconds the cracked shape freezes after full merge
const TRANSITION_DUR     = 0.55; // seconds for cracked → solid dissolve

const COLORS: Record<ShapeType, string> = {
  square:   "#f97316",
  circle:   "#06b6d4",
  triangle: "#22c55e",
};

const RACE_OPTIONS: { label: string; shapes: ShapeType[] }[] = [
  { label: "Square vs Circle",             shapes: ["square", "circle"] },
  { label: "Circle vs Triangle",           shapes: ["circle", "triangle"] },
  { label: "Triangle vs Square",           shapes: ["triangle", "square"] },
  { label: "All Three",                    shapes: ["square", "circle", "triangle"] },
];

const PLACE_LABELS = ["🥇 1st", "🥈 2nd", "🥉 3rd"];
const SHAPE_EMOJI: Record<ShapeType, string> = { square: "🟧", circle: "🔵", triangle: "🔺" };

let _bodyId = 0;

// ─── Arena ────────────────────────────────────────────────────────────────────

function computeArena(W: number, H: number): Arena {
  const size = Math.min(W * 0.86, H * 0.72);
  const cx = W / 2, cy = H / 2;
  return { x: cx - size / 2, y: cy - size / 2, size, cx, cy };
}

// ─── Polygon clip utilities (Sutherland-Hodgman) ─────────────────────────────

function _clipInside(p: [number, number], a: [number, number], b: [number, number]): boolean {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
}

function _clipIntersect(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): [number, number] {
  const rx = b[0] - a[0], ry = b[1] - a[1];
  const sx = d[0] - c[0], sy = d[1] - c[1];
  const t  = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / (rx * sy - ry * sx);
  return [a[0] + t * rx, a[1] + t * ry];
}

function clipToConvex(subject: [number, number][], clipper: [number, number][]): [number, number][] {
  let out = [...subject];
  for (let i = 0; i < clipper.length; i++) {
    if (out.length === 0) return [];
    const inp = out;
    out = [];
    const ca = clipper[i], cb = clipper[(i + 1) % clipper.length];
    for (let j = 0; j < inp.length; j++) {
      const cur  = inp[j];
      const prev = inp[(j + inp.length - 1) % inp.length];
      const cIn  = _clipInside(cur, ca, cb);
      const pIn  = _clipInside(prev, ca, cb);
      if (cIn) {
        if (!pIn) out.push(_clipIntersect(prev, cur, ca, cb));
        out.push(cur);
      } else if (pIn) {
        out.push(_clipIntersect(prev, cur, ca, cb));
      }
    }
  }
  return out;
}

function polygonArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(a) * 0.5;
}

function polygonCentroid(pts: [number, number][]): [number, number] {
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const j   = (i + 1) % pts.length;
    const crs = pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
    area += crs; cx += (pts[i][0] + pts[j][0]) * crs; cy += (pts[i][1] + pts[j][1]) * crs;
  }
  area /= 2;
  if (Math.abs(area) < 1e-9) {
    let x = 0, y = 0;
    for (const [px, py] of pts) { x += px; y += py; }
    return [x / pts.length, y / pts.length];
  }
  return [cx / (6 * area), cy / (6 * area)];
}

// ─── Piece generation ─────────────────────────────────────────────────────────

function generateBodies(shape: ShapeType, arena: Arena): Body[] {
  const N         = 5;
  const ASSEMBLED = arena.size * ASSEMBLED_RATIO;
  const tileSize  = ASSEMBLED / N;
  const ox        = arena.cx - ASSEMBLED / 2;
  const oy        = arena.cy - ASSEMBLED / 2;
  const color     = COLORS[shape];

  // Build the clipper polygon that defines the target shape boundary.
  // Circle uses a 64-gon approximation; triangle uses exact vertices.
  // Both are wound clockwise in screen-space (Y-down) so _clipInside works correctly.
  let clipper: [number, number][] | null = null;
  if (shape === "circle") {
    const r = ASSEMBLED * 0.46; // matches applyShapeClip and drawSolid
    clipper = Array.from({ length: 64 }, (_, i) => {
      const a = (i / 64) * Math.PI * 2;
      return [arena.cx + Math.cos(a) * r, arena.cy + Math.sin(a) * r] as [number, number];
    });
  } else if (shape === "triangle") {
    const hw = ASSEMBLED / 2; // matches applyShapeClip and drawSolid
    // top → bottom-right → bottom-left (CW in screen space)
    clipper = [
      [arena.cx,       arena.cy - hw],
      [arena.cx + hw,  arena.cy + hw],
      [arena.cx - hw,  arena.cy + hw],
    ];
  }

  const jitter = tileSize * GRID_JITTER;
  const pts: [number, number][][] = [];
  for (let row = 0; row <= N; row++) {
    pts[row] = [];
    for (let col = 0; col <= N; col++) {
      const bx     = ox + col * tileSize;
      const by     = oy + row * tileSize;
      const isEdge = row === 0 || row === N || col === 0 || col === N;
      pts[row][col] = isEdge
        ? [bx, by]
        : [bx + (Math.random() - 0.5) * 2 * jitter,
           by + (Math.random() - 0.5) * 2 * jitter];
    }
  }

  const bodies: Body[] = [];
  let cellId = 0;

  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const corners: [number, number][] = [
        pts[row][col],
        pts[row][col + 1],
        pts[row + 1][col + 1],
        pts[row + 1][col],
      ];

      let poly: [number, number][] = corners;
      let cx: number, cy: number;

      if (clipper !== null) {
        // Clip the grid quad to the actual shape boundary
        const origArea = polygonArea(corners);
        poly = clipToConvex(corners, clipper);
        // Discard cells fully outside or tiny slivers (< 4 % of original cell)
        if (poly.length < 3 || polygonArea(poly) < origArea * 0.04) continue;
        [cx, cy] = polygonCentroid(poly);
      } else {
        // Square: keep original vertex-average centroid (no clipping)
        cx = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4;
        cy = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4;
      }

      const verts: [number, number][] = poly.map(([vx, vy]) => [
        (vx - cx) * VERT_INSET,
        (vy - cy) * VERT_INSET,
      ]);

      const inner = arena.size - ARENA_PAD * 2 - tileSize;
      const sx    = arena.x + ARENA_PAD + tileSize / 2 + Math.random() * inner;
      const sy    = arena.y + ARENA_PAD + tileSize / 2 + Math.random() * inner;

      let angle = Math.random() * Math.PI * 2;
      const AVOID = Math.PI / 36;
      if (Math.abs(Math.sin(angle)) < AVOID) angle += AVOID;
      if (Math.abs(Math.cos(angle)) < AVOID) angle += AVOID;

      bodies.push({
        id: _bodyId++,
        x: sx, y: sy,
        vx: Math.cos(angle) * PIECE_SPEED,
        vy: Math.sin(angle) * PIECE_SPEED,
        cells: [{
          id: cellId++,
          gridRow: row, gridCol: col,
          targetX: cx, targetY: cy,
          localX: 0, localY: 0,
          verts,
          tileSize,
        }],
        glowColor: "none",
        glowTimer: 0,
        color,
        shape,
      });
    }
  }
  return bodies;
}

// ─── Piece physics ────────────────────────────────────────────────────────────

function getBodyBounds(b: Body) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of b.cells) {
    const px = b.x + c.localX;
    const py = b.y + c.localY;
    for (const [dx, dy] of c.verts) {
      minX = Math.min(minX, px + dx);
      maxX = Math.max(maxX, px + dx);
      minY = Math.min(minY, py + dy);
      maxY = Math.max(maxY, py + dy);
    }
  }
  return { minX, maxX, minY, maxY };
}

function setSpeed(b: Body) {
  const spd = Math.hypot(b.vx, b.vy);
  if (spd < 0.001) {
    const a = Math.random() * Math.PI * 2;
    b.vx = Math.cos(a) * PIECE_SPEED; b.vy = Math.sin(a) * PIECE_SPEED;
  } else {
    b.vx = (b.vx / spd) * PIECE_SPEED; b.vy = (b.vy / spd) * PIECE_SPEED;
  }
}

function bounceWall(b: Body, arena: Arena, onBounce?: (shape: ShapeType) => void) {
  const { minX, maxX, minY, maxY } = getBodyBounds(b);
  const L = arena.x, R = arena.x + arena.size;
  const T = arena.y, Bo = arena.y + arena.size;
  let hit = false;
  if (minX < L)  { b.x += L  - minX; b.vx =  Math.abs(b.vx); hit = true; }
  if (maxX > R)  { b.x -= maxX - R;  b.vx = -Math.abs(b.vx); hit = true; }
  if (minY < T)  { b.y += T  - minY; b.vy =  Math.abs(b.vy); hit = true; }
  if (maxY > Bo) { b.y -= maxY - Bo; b.vy = -Math.abs(b.vy); hit = true; }
  if (hit) { setSpeed(b); b.glowColor = "red"; b.glowTimer = 0.14; onBounce?.(b.shape); }
}

// ─── Solid shape bounce ───────────────────────────────────────────────────────

function getSolidBounds(s: Solid, shape: ShapeType, S: number) {
  const hw = S / 2;
  if (shape === "circle") { const r = S * 0.46; return { minX: s.x - r, maxX: s.x + r, minY: s.y - r, maxY: s.y + r }; }
  return { minX: s.x - hw, maxX: s.x + hw, minY: s.y - hw, maxY: s.y + hw };
}

function bounceSolid(s: Solid, arena: Arena, shape: ShapeType, S: number, onBounce?: (sh: ShapeType) => void) {
  const { minX, maxX, minY, maxY } = getSolidBounds(s, shape, S);
  const L = arena.x, R = arena.x + arena.size;
  const T = arena.y, Bo = arena.y + arena.size;
  let hit = false;
  if (minX < L)  { s.x += L  - minX; s.vx =  Math.abs(s.vx); hit = true; }
  if (maxX > R)  { s.x -= maxX - R;  s.vx = -Math.abs(s.vx); hit = true; }
  if (minY < T)  { s.y += T  - minY; s.vy =  Math.abs(s.vy); hit = true; }
  if (maxY > Bo) { s.y -= maxY - Bo; s.vy = -Math.abs(s.vy); hit = true; }
  const spd = Math.hypot(s.vx, s.vy);
  if (spd > 0.001) { s.vx = (s.vx / spd) * PIECE_SPEED; s.vy = (s.vy / spd) * PIECE_SPEED; }
  if (hit) onBounce?.(shape);
}

// ─── Merge ────────────────────────────────────────────────────────────────────

type MergeCandidate = { canMerge: false } | { canMerge: true; c1: Cell; c2: Cell };

function checkCanMerge(b1: Body, b2: Body): MergeCandidate {
  if (b1.shape !== b2.shape) return { canMerge: false };
  const tileSize  = b1.cells[0]?.tileSize ?? 1;
  const threshold = tileSize * ATTACH_THRESHOLD;
  for (const c1 of b1.cells) {
    const w1x = b1.x + c1.localX, w1y = b1.y + c1.localY;
    for (const c2 of b2.cells) {
      if (Math.abs(c1.gridRow - c2.gridRow) + Math.abs(c1.gridCol - c2.gridCol) !== 1) continue;
      const expDX = c2.targetX - c1.targetX, expDY = c2.targetY - c1.targetY;
      if (Math.hypot((b2.x + c2.localX - w1x) - expDX, (b2.y + c2.localY - w1y) - expDY) < threshold) {
        return { canMerge: true, c1, c2 };
      }
    }
  }
  return { canMerge: false };
}

function mergeBodies(bodies: Body[], iIdx: number, jIdx: number, mc1: Cell, mc2: Cell) {
  const b1 = bodies[iIdx], b2 = bodies[jIdx];
  const m1 = b1.cells.length, m2 = b2.cells.length;
  b2.x = b1.x + mc1.localX + (mc2.targetX - mc1.targetX) - mc2.localX;
  b2.y = b1.y + mc1.localY + (mc2.targetY - mc1.targetY) - mc2.localY;
  for (const c of b2.cells) {
    b1.cells.push({ ...c, localX: b2.x + c.localX - b1.x, localY: b2.y + c.localY - b1.y });
  }
  b1.vx = (b1.vx * m1 + b2.vx * m2) / (m1 + m2);
  b1.vy = (b1.vy * m1 + b2.vy * m2) / (m1 + m2);
  setSpeed(b1);
  b1.glowColor = "green"; b1.glowTimer = 0.55;
  bodies.splice(jIdx, 1);
}

function scanMerges(
  bodies: Body[],
  mergingEnabled: boolean,
  onMerge?: (shape: ShapeType) => void,
): boolean {
  if (!mergingEnabled) return false;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const r = checkCanMerge(bodies[i], bodies[j]);
      if (r.canMerge) {
        const sh = bodies[i].shape;
        mergeBodies(bodies, i, j, r.c1, r.c2);
        onMerge?.(sh);
        return true;
      }
    }
  }
  return false;
}

// ─── Draw ─────────────────────────────────────────────────────────────────────

function drawArena(ctx: CanvasRenderingContext2D, arena: Arena) {
  ctx.save();
  ctx.fillStyle = "rgba(2,6,23,0.55)";
  ctx.fillRect(arena.x, arena.y, arena.size, arena.size);
  ctx.shadowColor = "rgba(148,163,184,0.45)"; ctx.shadowBlur = 14;
  ctx.strokeStyle = "rgba(148,163,184,0.75)"; ctx.lineWidth = 1.5;
  ctx.strokeRect(arena.x, arena.y, arena.size, arena.size);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(226,232,240,0.07)"; ctx.lineWidth = 1;
  ctx.strokeRect(arena.x + 5, arena.y + 5, arena.size - 10, arena.size - 10);
  ctx.restore();
}

type ClipInfo = { shape: ShapeType; cx: number; cy: number; S: number };

// When all pieces are assembled clip drawing to the exact shape boundary
function applyShapeClip(ctx: CanvasRenderingContext2D, { shape, cx, cy, S }: ClipInfo) {
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(cx, cy, S * 0.46, 0, Math.PI * 2);
  } else if (shape === "triangle") {
    ctx.moveTo(cx,         cy - S * 0.5);
    ctx.lineTo(cx - S * 0.5, cy + S * 0.5);
    ctx.lineTo(cx + S * 0.5, cy + S * 0.5);
    ctx.closePath();
  } else {
    ctx.rect(cx - S * 0.5, cy - S * 0.5, S, S);
  }
  ctx.clip();
}

function drawBodies(ctx: CanvasRenderingContext2D, bodies: Body[], alpha: number, clip?: ClipInfo) {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (clip) applyShapeClip(ctx, clip);
  for (const body of bodies) {
    const isGreen = body.glowColor === "green";
    const isRed   = body.glowColor === "red";
    if (isGreen) { ctx.shadowColor = "rgba(74,222,128,0.7)";  ctx.shadowBlur = 14; }
    else if (isRed) { ctx.shadowColor = "rgba(248,113,113,0.55)"; ctx.shadowBlur = 14; }
    else { ctx.shadowBlur = 0; }
    for (const c of body.cells) {
      const px = body.x + c.localX, py = body.y + c.localY;
      ctx.beginPath();
      ctx.moveTo(px + c.verts[0][0], py + c.verts[0][1]);
      for (let i = 1; i < c.verts.length; i++) ctx.lineTo(px + c.verts[i][0], py + c.verts[i][1]);
      ctx.closePath();
      ctx.fillStyle   = body.color; ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.28)"; ctx.lineWidth = 1; ctx.stroke();
    }
  }
  ctx.restore();
}

function drawSolid(
  ctx: CanvasRenderingContext2D,
  shape: ShapeType, s: Solid, S: number,
  color: string, alpha: number, blurPx: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (blurPx > 0.5) ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
  ctx.fillStyle   = color;
  ctx.shadowColor = color;
  ctx.shadowBlur  = 20;
  ctx.beginPath();
  if (shape === "square") {
    ctx.rect(s.x - S / 2, s.y - S / 2, S, S);
  } else if (shape === "circle") {
    ctx.arc(s.x, s.y, S * 0.46, 0, Math.PI * 2);
  } else {
    // equilateral-style triangle pointing up, bounding box S×S centered at (s.x, s.y)
    const hw = S / 2;
    ctx.moveTo(s.x,      s.y - hw);
    ctx.lineTo(s.x - hw, s.y + hw);
    ctx.lineTo(s.x + hw, s.y + hw);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

// ─── Audio (piano-style Web Audio) ───────────────────────────────────────────

// Sine partial with piano envelope: fast attack → quick decay → long release
function _partial(ctx: AudioContext, freq: number, vol: number, t: number, dur: number) {
  const osc = ctx.createOscillator();
  const g   = ctx.createGain();
  osc.connect(g); g.connect(ctx.destination);
  osc.type = "sine"; osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol,        t + 0.004);  // fast attack
  g.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.06); // hammer decay
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.start(t); osc.stop(t + dur + 0.05);
}

// Piano note = fundamental + harmonics
function _pianoNote(ctx: AudioContext, freq: number, vol: number, t: number, dur: number) {
  _partial(ctx, freq,      vol,        t, dur);
  _partial(ctx, freq * 2,  vol * 0.30, t, dur * 0.65);
  _partial(ctx, freq * 3,  vol * 0.12, t, dur * 0.45);
  _partial(ctx, freq * 4,  vol * 0.05, t, dur * 0.30);
}

// ── Per-event sounds ──────────────────────────────────────────────────────────

function playMergeSound(ctx: AudioContext, shape: ShapeType) {
  const t = ctx.currentTime;
  if      (shape === "square")   _pianoNote(ctx, 130.8, 0.22, t, 0.32); // C3 – deep
  else if (shape === "circle")   _pianoNote(ctx, 329.6, 0.18, t, 0.26); // E4 – mid
  else                           _pianoNote(ctx, 783.9, 0.15, t, 0.18); // G5 – bright
}

function playCollisionSound(ctx: AudioContext, shape: ShapeType) {
  const t = ctx.currentTime;
  if      (shape === "square")   _pianoNote(ctx,  98.0, 0.10, t, 0.14); // G2 – thud
  else if (shape === "circle")   _pianoNote(ctx, 246.9, 0.08, t, 0.11); // B3 – tap
  else                           _pianoNote(ctx, 659.3, 0.07, t, 0.09); // E5 – ping
}

function playCompleteSound(ctx: AudioContext, shape: ShapeType) {
  const t = ctx.currentTime;
  if (shape === "square") {
    // C3–E3–G3–C4 ascending, deep piano chord
    [130.8, 164.8, 196.0, 261.6].forEach((f, i) =>
      _pianoNote(ctx, f, 0.20, t + i * 0.08, 0.55));
  } else if (shape === "circle") {
    // C4+E4+G4 together then C5 — bright mid chord
    [261.6, 329.6, 392.0].forEach(f => _pianoNote(ctx, f, 0.17, t,        0.55));
    _pianoNote(ctx, 523.3, 0.12, t + 0.08, 0.45);
  } else {
    // G4–B4–D5–G5 quick arpeggio — sharp, high
    [392.0, 493.9, 587.3, 783.9].forEach((f, i) =>
      _pianoNote(ctx, f, 0.17, t + i * 0.06, 0.38));
  }
}

// ─── Completion glow draw ─────────────────────────────────────────────────────

function drawCompletionGlow(
  ctx: CanvasRenderingContext2D,
  { shape, cx, cy, S }: ClipInfo,
  intensity: number,
  color: string,
) {
  if (intensity <= 0) return;
  ctx.save();
  ctx.globalAlpha  = intensity * 0.80;
  ctx.shadowColor  = color;
  ctx.shadowBlur   = 50 * intensity;
  ctx.strokeStyle  = color;
  ctx.lineWidth    = 5;
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(cx, cy, S * 0.46, 0, Math.PI * 2);
  } else if (shape === "triangle") {
    ctx.moveTo(cx,           cy - S * 0.5);
    ctx.lineTo(cx - S * 0.5, cy + S * 0.5);
    ctx.lineTo(cx + S * 0.5, cy + S * 0.5);
    ctx.closePath();
  } else {
    ctx.rect(cx - S * 0.5, cy - S * 0.5, S, S);
  }
  ctx.stroke();
  ctx.restore();
}

// ─── Race clip helper ─────────────────────────────────────────────────────────

function getRaceClip(arena: Arena, shape: ShapeType, shapeBodies: Body[]): ClipInfo | undefined {
  if (shapeBodies.length !== 1 || shapeBodies[0].cells.length === 0) return undefined;
  const b   = shapeBodies[0];
  const ref = b.cells[0];
  const ox  = (b.x + ref.localX) - ref.targetX;
  const oy  = (b.y + ref.localY) - ref.targetY;
  return { shape, cx: arena.cx + ox, cy: arena.cy + oy, S: arena.size * ASSEMBLED_RATIO };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MergingPerfectShape() {
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const bodiesRef        = useRef<Body[]>([]);
  const arenaRef         = useRef<Arena>({ x: 0, y: 0, size: 0, cx: 0, cy: 0 });
  const phaseRef         = useRef<Phase>("editor");
  const elapsedRef       = useRef(0);
  const lastTRef         = useRef(0);
  const rafRef           = useRef<number | null>(null);
  const dimRef           = useRef({ W: 0, H: 0 });
  const shapeRef         = useRef<ShapeType>("square");
  const frameRef         = useRef(0);
  const totalRef         = useRef(0);
  const solidRef         = useRef<Solid>({ x: 0, y: 0, vx: 0, vy: 0 });
  const solidSizeRef     = useRef(0);
  const assembledTimeRef = useRef(0);
  const transPRef        = useRef(0);
  // Race refs
  const raceShapesRef  = useRef<ShapeType[]>(["square", "circle"]);
  const raceEntriesRef = useRef<Partial<Record<ShapeType, RaceEntry>>>({});
  const racePlaceRef   = useRef(0);
  // Audio refs
  const audioCtxRef         = useRef<AudioContext | null>(null);
  const soloGlowRef         = useRef(0); // 1→0 highlight intensity during solo assembled phase
  const lastBounceSoundRef  = useRef<Partial<Record<ShapeType, number>>>({});

  const [phase,     setPhase]     = useState<Phase>("editor");
  const [shape,     setShape]     = useState<ShapeType>("square");
  const [timerMs,   setTimerMs]   = useState(0);
  const [arenaY,    setArenaY]    = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [merging,   setMerging]   = useState(false);
  // Race state
  const [gameMode,   setGameMode]   = useState<"solo" | "race">("solo");
  const [raceConfig, setRaceConfig] = useState<ShapeType[]>(["square", "circle"]);
  const [rankings,   setRankings]   = useState<{ shape: ShapeType; place: number; time: number }[]>([]);
  const [raceDone,   setRaceDone]   = useState(false);

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth, H = window.innerHeight;
    canvas.style.width  = `${W}px`;
    canvas.style.height = `${H}px`;
    canvas.width  = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    const ctx = canvas.getContext("2d");
    if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(dpr, dpr); }
    dimRef.current   = { W, H };
    const arena = computeArena(W, H);
    arenaRef.current = arena;
    setArenaY(arena.y);
  }, []);

  useEffect(() => {
    setupCanvas();
    const canvas = canvasRef.current!;
    const ctx    = canvas.getContext("2d")!;

    const tick = (t: number) => {
      const rawDt = (t - lastTRef.current) / 1000;
      const dt    = Math.min(rawDt > 0 ? rawDt : 1 / 60, 1 / 30);
      lastTRef.current = t;

      const { W, H } = dimRef.current;
      const arena     = arenaRef.current;
      const curPhase  = phaseRef.current;

      // ── Update ─────────────────────────────────────────────────────────────

      if (curPhase === "simulation") {
        elapsedRef.current += dt;
        const bodies = bodiesRef.current;

        // Decay glow timers once per frame
        for (const b of bodies) {
          if (b.glowTimer > 0) { b.glowTimer -= dt; if (b.glowTimer <= 0) b.glowColor = "none"; }
        }
        const soloBounceCb = (sh: ShapeType) => {
          const ac = audioCtxRef.current; if (!ac) return;
          ac.resume();
          const now = ac.currentTime;
          if ((now - (lastBounceSoundRef.current[sh] ?? 0)) < 0.12) return;
          lastBounceSoundRef.current[sh] = now;
          playCollisionSound(ac, sh);
        };
        // Sub-step: 3 physics steps per rendered frame to prevent wall tunneling
        const SUB = 3, subDt = dt / SUB;
        for (let s = 0; s < SUB; s++) {
          for (const b of bodies) { b.x += b.vx * subDt; b.y += b.vy * subDt; }
          for (const b of bodies) bounceWall(b, arena, soloBounceCb);
        }

        const mergingEnabled = elapsedRef.current >= MERGE_DELAY;
        const soloMergeCb = (sh: ShapeType) => {
          const ac = audioCtxRef.current; if (ac) playMergeSound(ac, sh);
        };
        let mergeHappened = true;
        while (mergeHappened) mergeHappened = scanMerges(bodies, mergingEnabled, soloMergeCb);

        frameRef.current++;
        if (frameRef.current % 6 === 0) {
          setTimerMs(elapsedRef.current * 1000);
          setRemaining(bodies.length);
          setMerging(mergingEnabled);
        }

        // All merged → freeze cracked shape for a moment
        if (bodies.length === 1 && totalRef.current > 1) {
          phaseRef.current         = "assembled";
          assembledTimeRef.current = ASSEMBLED_PAUSE;
          soloGlowRef.current      = 1.0;
          setPhase("assembled");
        }

      } else if (curPhase === "assembled") {
        soloGlowRef.current = Math.max(0, soloGlowRef.current - dt / ASSEMBLED_PAUSE);
        assembledTimeRef.current -= dt;
        if (assembledTimeRef.current <= 0) {
          // Hand off to solid shape — place it at the exact assembled position
          const b   = bodiesRef.current[0];
          const ref = b.cells[0];
          solidRef.current = {
            x:  arena.cx + (b.x + ref.localX - ref.targetX),
            y:  arena.cy + (b.y + ref.localY - ref.targetY),
            vx: b.vx, vy: b.vy,
          };
          solidSizeRef.current = arena.size * ASSEMBLED_RATIO;
          transPRef.current    = 0;
          phaseRef.current     = "transition";
          setPhase("transition");
        }

      } else if (curPhase === "transition") {
        transPRef.current += dt / TRANSITION_DUR;
        if (transPRef.current >= 1) {
          transPRef.current = 1;
          phaseRef.current  = "bouncing";
          bodiesRef.current = []; // solid takes over; body no longer needed
          const ac = audioCtxRef.current; if (ac) playCompleteSound(ac, shapeRef.current);
          setPhase("bouncing");
        }
        // Solid stays in place during the dissolve; only moves once fully bouncing

      } else if (curPhase === "bouncing") {
        const s = solidRef.current;
        s.x += s.vx * dt; s.y += s.vy * dt;
        const solidBounceCb = (sh: ShapeType) => {
          const ac = audioCtxRef.current; if (!ac) return;
          ac.resume();
          const now = ac.currentTime;
          if ((now - (lastBounceSoundRef.current[sh] ?? 0)) < 0.12) return;
          lastBounceSoundRef.current[sh] = now;
          playCollisionSound(ac, sh);
        };
        bounceSolid(s, arena, shapeRef.current, solidSizeRef.current, solidBounceCb);

      } else if (curPhase === "race") {
        elapsedRef.current += dt;
        const bodies  = bodiesRef.current;
        const entries = raceEntriesRef.current;

        // Decay glow timers once per frame
        for (const b of bodies) {
          if (b.glowTimer > 0) { b.glowTimer -= dt; if (b.glowTimer <= 0) b.glowColor = "none"; }
        }
        const raceBounceCb = (sh: ShapeType) => {
          const ac = audioCtxRef.current; if (!ac) return;
          ac.resume();
          const now = ac.currentTime;
          if ((now - (lastBounceSoundRef.current[sh] ?? 0)) < 0.12) return;
          lastBounceSoundRef.current[sh] = now;
          playCollisionSound(ac, sh);
        };
        // Sub-step physics to prevent wall tunneling
        const rSUB = 3, rSubDt = dt / rSUB;
        for (let s = 0; s < rSUB; s++) {
          for (const b of bodies) {
            if (entries[b.shape]?.subPhase === "racing") { b.x += b.vx * rSubDt; b.y += b.vy * rSubDt; }
          }
          for (const b of bodies) {
            if (entries[b.shape]?.subPhase === "racing") bounceWall(b, arena, raceBounceCb);
          }
        }
        // Merge — same-shape only (enforced by checkCanMerge), immediate (no delay)
        const raceMergeCb = (sh: ShapeType) => {
          const ac = audioCtxRef.current; if (ac) playMergeSound(ac, sh);
        };
        let mergeHappened = true;
        while (mergeHappened) mergeHappened = scanMerges(bodies, true, raceMergeCb);

        // Per-shape sub-state transitions
        let stateChanged = false;
        for (const sh of raceShapesRef.current) {
          const entry = entries[sh];
          if (!entry) continue;

          if (entry.subPhase === "racing") {
            const cnt = bodies.reduce((n, b) => n + (b.shape === sh ? 1 : 0), 0);
            if (cnt === 1 && entry.total > 1) {
              entry.subPhase       = "assembled";
              entry.assembledTimer = ASSEMBLED_PAUSE;
              entry.completionGlow = 1.0;
              entry.place          = ++racePlaceRef.current;
              entry.finishTime     = elapsedRef.current;
              stateChanged         = true;
            }
          } else if (entry.subPhase === "assembled") {
            entry.completionGlow = Math.max(0, entry.completionGlow - dt / ASSEMBLED_PAUSE);
            entry.assembledTimer -= dt;
            if (entry.assembledTimer <= 0) {
              const sb = bodies.filter(b => b.shape === sh);
              if (sb.length === 1) {
                const b0  = sb[0];
                const ref = b0.cells[0];
                entry.solid     = {
                  x: arena.cx + (b0.x + ref.localX - ref.targetX),
                  y: arena.cy + (b0.y + ref.localY - ref.targetY),
                  vx: b0.vx, vy: b0.vy,
                };
                entry.solidSize = arena.size * ASSEMBLED_RATIO;
                entry.transP    = 0;
                entry.subPhase  = "transition";
                stateChanged    = true;
              }
            }
          } else if (entry.subPhase === "transition") {
            entry.transP += dt / TRANSITION_DUR;
            if (entry.transP >= 1) {
              entry.transP = 1;
              entry.subPhase = "bouncing";
              bodiesRef.current = bodiesRef.current.filter(b => b.shape !== sh);
              const ac = audioCtxRef.current; if (ac) playCompleteSound(ac, sh);
              stateChanged = true;
            }
            // Solid stays in place during the dissolve
          } else if (entry.subPhase === "bouncing") {
            entry.solid.x += entry.solid.vx * dt; entry.solid.y += entry.solid.vy * dt;
            bounceSolid(entry.solid, arena, sh, entry.solidSize, raceBounceCb);
          }
        }

        frameRef.current++;
        if (stateChanged || frameRef.current % 6 === 0) {
          setTimerMs(elapsedRef.current * 1000);
          const newRankings = raceShapesRef.current
            .filter(s => entries[s]?.place != null)
            .sort((a, b) => (entries[a]?.place ?? 99) - (entries[b]?.place ?? 99))
            .map(s => ({ shape: s, place: entries[s]!.place!, time: entries[s]!.finishTime }));
          setRankings(newRankings);
          if (raceShapesRef.current.every(s => entries[s]?.subPhase === "bouncing")) setRaceDone(true);
        }
      }

      // ── Render ─────────────────────────────────────────────────────────────

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#020617";
      ctx.fillRect(0, 0, W, H);
      drawCanvasWatermark(ctx, W, H);
      drawArena(ctx, arena);

      // Compute clip for the assembled shape in world space.
      // When pieces snap together, their relative positions match the targets;
      // the world offset from target space is constant across all cells.
      const getAssembledClip = (): ClipInfo | undefined => {
        const bodies = bodiesRef.current;
        if (bodies.length !== 1 || bodies[0].cells.length === 0) return undefined;
        const b   = bodies[0];
        const ref = b.cells[0];
        const ox  = (b.x + ref.localX) - ref.targetX;
        const oy  = (b.y + ref.localY) - ref.targetY;
        return { shape: shapeRef.current, cx: arena.cx + ox, cy: arena.cy + oy, S: arena.size * ASSEMBLED_RATIO };
      };

      if (curPhase === "simulation" || curPhase === "assembled") {
        const clip = getAssembledClip();
        drawBodies(ctx, bodiesRef.current, 1, clip);
        if (clip && soloGlowRef.current > 0)
          drawCompletionGlow(ctx, clip, soloGlowRef.current, COLORS[shapeRef.current]);
      }

      if (curPhase === "transition") {
        const tp   = transPRef.current;
        const clip = getAssembledClip();
        // Cracked shape fades out (stationary), still clipped to shape
        drawBodies(ctx, bodiesRef.current, 1 - tp, clip);
        // Solid shape fades in with dissolving blur
        drawSolid(ctx, shapeRef.current, solidRef.current, solidSizeRef.current,
                  COLORS[shapeRef.current], tp, (1 - tp) * 22);
      }

      if (curPhase === "bouncing") {
        drawSolid(ctx, shapeRef.current, solidRef.current, solidSizeRef.current,
                  COLORS[shapeRef.current], 1, 0);
      }

      if (curPhase === "race") {
        const entries   = raceEntriesRef.current;
        const allBodies = bodiesRef.current;

        // Draw all pieces still racing (no clip needed yet)
        const racingBodies = allBodies.filter(b => entries[b.shape]?.subPhase === "racing");
        if (racingBodies.length > 0) drawBodies(ctx, racingBodies, 1);

        // Per-shape assembled / transition / bouncing
        for (const sh of raceShapesRef.current) {
          const entry = entries[sh];
          if (!entry || entry.subPhase === "racing") continue;
          const shapeBodies = allBodies.filter(b => b.shape === sh);
          const clip = getRaceClip(arena, sh, shapeBodies);
          if (entry.subPhase === "assembled") {
            drawBodies(ctx, shapeBodies, 1, clip);
            if (clip && entry.completionGlow > 0)
              drawCompletionGlow(ctx, clip, entry.completionGlow, COLORS[sh]);
          } else if (entry.subPhase === "transition") {
            drawBodies(ctx, shapeBodies, 1 - entry.transP, clip);
            drawSolid(ctx, sh, entry.solid, entry.solidSize, COLORS[sh], entry.transP, (1 - entry.transP) * 22);
          } else if (entry.subPhase === "bouncing") {
            drawSolid(ctx, sh, entry.solid, entry.solidSize, COLORS[sh], 1, 0);
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    lastTRef.current = performance.now();
    rafRef.current   = requestAnimationFrame(tick);
    window.addEventListener("resize", setupCanvas);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", setupCanvas);
    };
  }, [setupCanvas]);

  const handleSoloPlay = () => {
    if (!audioCtxRef.current) {
      try { audioCtxRef.current = new AudioContext(); } catch { /* ignore */ }
    }
    audioCtxRef.current?.resume();
    const bodies = generateBodies(shapeRef.current, arenaRef.current);
    bodiesRef.current  = bodies;
    totalRef.current   = bodies.length;
    elapsedRef.current = 0;
    frameRef.current   = 0;
    phaseRef.current   = "simulation";
    lastTRef.current   = performance.now();
    setTimerMs(0);
    setRemaining(bodies.length);
    setMerging(false);
    setPhase("simulation");
  };

  const handleRacePlay = () => {
    if (!audioCtxRef.current) {
      try { audioCtxRef.current = new AudioContext(); } catch { /* ignore */ }
    }
    audioCtxRef.current?.resume();
    const shapes = raceConfig;
    raceShapesRef.current = shapes;
    const arena    = arenaRef.current;
    const allBodies: Body[] = [];
    const entries: Partial<Record<ShapeType, RaceEntry>> = {};
    for (const sh of shapes) {
      const bs = generateBodies(sh, arena);
      allBodies.push(...bs);
      entries[sh] = {
        shape: sh, total: bs.length, place: null, finishTime: 0,
        subPhase: "racing", assembledTimer: 0, transP: 0,
        completionGlow: 0,
        solid: { x: arena.cx, y: arena.cy, vx: PIECE_SPEED * 0.7, vy: PIECE_SPEED * 0.7 },
        solidSize: arena.size * ASSEMBLED_RATIO,
      };
    }
    bodiesRef.current      = allBodies;
    raceEntriesRef.current = entries;
    racePlaceRef.current   = 0;
    elapsedRef.current     = 0;
    frameRef.current       = 0;
    phaseRef.current       = "race";
    lastTRef.current       = performance.now();
    setTimerMs(0);
    setRankings([]);
    setRaceDone(false);
    setPhase("race");
  };

  const handleReset = () => {
    bodiesRef.current      = [];
    phaseRef.current       = "editor";
    raceEntriesRef.current = {};
    racePlaceRef.current   = 0;
    setPhase("editor");
    setTimerMs(0);
    setMerging(false);
    setRankings([]);
    setRaceDone(false);
  };

  const fmtTime = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

  return (
    <div style={{ position: "relative", width: "100%", height: "100dvh", overflow: "hidden", background: "#020617" }}>
      <canvas ref={canvasRef} style={{ display: "block" }} />

      {/* Heading */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0,
        height: arenaY > 0 ? arenaY - 15 : undefined,
        zIndex: 6, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "flex-end",
        pointerEvents: "none",
      }}>
        <h1 style={{
          margin: 0, fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: "clamp(1.0rem, 3.5vw, 1.6rem)", fontWeight: 900,
          color: "#fff", textShadow: "0 4px 20px rgba(0,0,0,0.7)",
          letterSpacing: "-0.01em", textAlign: "center",
        }}>
          {gameMode === "race"
            ? raceConfig.length === 3
              ? "Square, Circle, or Triangle: Which Will Assemble First?"
              : `${raceConfig[0].charAt(0).toUpperCase() + raceConfig[0].slice(1)} or ${raceConfig[1].charAt(0).toUpperCase() + raceConfig[1].slice(1)}: Which Will Assemble First?`
            : `How Long Will It Take to Assemble a Plain ${shape.charAt(0).toUpperCase() + shape.slice(1)}?`
          }
        </h1>

        {/* Solo status */}
        {phase === "simulation" && (
          <p style={{
            margin: "4px 0 0", fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: "0.9rem", fontWeight: 700,
            color: merging ? "#4ade80" : "rgba(248,250,252,0.7)",
          }}>
            {merging
              ? `✦ MERGING  ⏱ ${fmtTime(timerMs)}  ·  ${remaining} left`
              : `Merging in ${Math.max(0, MERGE_DELAY - timerMs / 1000).toFixed(1)}s  ·  ⏱ ${fmtTime(timerMs)}`}
          </p>
        )}
        {(phase === "assembled" || phase === "transition") && (
          <p style={{ margin: "4px 0 0", fontFamily: "Arial, Helvetica, sans-serif", fontSize: "0.9rem", fontWeight: 700, color: "#4ade80" }}>
            ✦ COMPLETE  ⏱ {fmtTime(timerMs)}
          </p>
        )}

        {/* Race status */}
        {phase === "race" && rankings.length === 0 && (
          <p style={{ margin: "4px 0 0", fontFamily: "Arial, Helvetica, sans-serif", fontSize: "0.85rem", fontWeight: 700, color: "rgba(248,250,252,0.5)" }}>
            ⏱ {fmtTime(timerMs)} · Racing…
          </p>
        )}
        {phase === "race" && rankings.length > 0 && (
          <div style={{ margin: "6px 0 0", display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", fontFamily: "Arial, Helvetica, sans-serif" }}>
            {rankings.map(r => (
              <span key={r.shape} style={{
                padding: "3px 10px", borderRadius: 6,
                background: COLORS[r.shape] + "28", border: `1px solid ${COLORS[r.shape]}66`,
                color: COLORS[r.shape], fontSize: "0.82rem", fontWeight: 800,
              }}>
                {PLACE_LABELS[r.place - 1]} {SHAPE_EMOJI[r.shape]} {r.shape.charAt(0).toUpperCase() + r.shape.slice(1)} · {fmtTime(r.time * 1000)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Editor panel */}
      {phase === "editor" && (
        <div style={{
          position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)",
          zIndex: 8, display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
          padding: "20px 28px", borderRadius: 14, minWidth: 280,
          border: "1px solid rgba(148,163,184,0.18)",
          background: "rgba(2,6,23,0.9)", backdropFilter: "blur(14px)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)", fontFamily: "Arial, Helvetica, sans-serif",
        }}>
          {/* Mode toggle */}
          <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid rgba(148,163,184,0.22)", width: "100%" }}>
            {(["solo", "race"] as const).map(m => (
              <button key={m} onClick={() => setGameMode(m)} style={{
                flex: 1, minHeight: 36, cursor: "pointer", border: "none",
                background: gameMode === m ? "rgba(148,163,184,0.22)" : "transparent",
                color: gameMode === m ? "#f8fafc" : "rgba(248,250,252,0.4)",
                fontWeight: 800, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase",
              }}>
                {m === "solo" ? "Solo" : "Race"}
              </button>
            ))}
          </div>

          {/* Solo controls */}
          {gameMode === "solo" && (<>
            <p style={{ margin: 0, color: "rgba(248,250,252,0.55)", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em" }}>
              SELECT SHAPE
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              {(["square", "circle", "triangle"] as ShapeType[]).map(s => (
                <button key={s} onClick={() => { shapeRef.current = s; setShape(s); }} style={{
                  minWidth: 90, minHeight: 44, padding: "0 16px", borderRadius: 8, cursor: "pointer",
                  border: `2px solid ${shape === s ? COLORS[s] : "rgba(148,163,184,0.22)"}`,
                  background: shape === s ? COLORS[s] + "28" : "rgba(15,23,42,0.7)",
                  color: shape === s ? COLORS[s] : "rgba(248,250,252,0.5)",
                  fontWeight: 800, fontSize: 13, letterSpacing: "0.05em", textTransform: "capitalize",
                }}>
                  {s}
                </button>
              ))}
            </div>
            <button onClick={handleSoloPlay} style={{
              minWidth: 170, minHeight: 46, borderRadius: 8, cursor: "pointer",
              border: "1.5px solid rgba(34,197,94,0.5)", background: "rgba(22,163,74,0.18)",
              color: "#bbf7d0", fontWeight: 900, fontSize: 14, letterSpacing: "0.08em",
            }}>
              ▶ Start Simulation
            </button>
          </>)}

          {/* Race controls */}
          {gameMode === "race" && (<>
            <p style={{ margin: 0, color: "rgba(248,250,252,0.55)", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em" }}>
              SELECT RACE
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
              {RACE_OPTIONS.map(opt => {
                const sel = raceConfig.join(",") === opt.shapes.join(",");
                return (
                  <button key={opt.label} onClick={() => { setRaceConfig(opt.shapes); raceShapesRef.current = opt.shapes; }} style={{
                    minHeight: 40, padding: "0 14px", borderRadius: 8, cursor: "pointer",
                    border: `2px solid ${sel ? "rgba(99,179,237,0.7)" : "rgba(148,163,184,0.22)"}`,
                    background: sel ? "rgba(99,179,237,0.12)" : "rgba(15,23,42,0.7)",
                    color: sel ? "#93c5fd" : "rgba(248,250,252,0.5)",
                    fontWeight: 700, fontSize: 12, letterSpacing: "0.04em", textAlign: "left",
                  }}>
                    {opt.shapes.map(s => SHAPE_EMOJI[s]).join(" vs ")}{"  "}{opt.label}
                  </button>
                );
              })}
            </div>
            <button onClick={handleRacePlay} style={{
              minWidth: 170, minHeight: 46, borderRadius: 8, cursor: "pointer",
              border: "1.5px solid rgba(99,179,237,0.5)", background: "rgba(37,99,235,0.18)",
              color: "#bfdbfe", fontWeight: 900, fontSize: 14, letterSpacing: "0.08em",
            }}>
              ▶ Start Race
            </button>
          </>)}
        </div>
      )}

      {/* Play Again */}
      {(phase === "bouncing" || (phase === "race" && raceDone)) && (
        <div style={{ position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)", zIndex: 8 }}>
          <button onClick={handleReset} style={{
            minWidth: 150, minHeight: 44, borderRadius: 8, cursor: "pointer",
            border: "1.5px solid rgba(34,197,94,0.5)", background: "rgba(22,163,74,0.18)",
            color: "#bbf7d0", fontWeight: 900, fontSize: 14, letterSpacing: "0.08em",
            fontFamily: "Arial, Helvetica, sans-serif",
          }}>
            Play Again
          </button>
        </div>
      )}
    </div>
  );
}
