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
  laneIdx: number;
  imageEl: HTMLImageElement | null;
};

type RaceSubPhase = "racing" | "assembled" | "transition" | "bouncing";
type RaceEntry = {
  shape: ShapeType;
  laneIdx: number;
  total: number;
  place: number | null;
  finishTime: number;
  subPhase: RaceSubPhase;
  assembledTimer: number;
  transP: number;
  solid: Solid;
  solidSize: number;
  completionGlow: number;
  imageEl: HTMLImageElement | null;
  mergeAudioBuffer: AudioBuffer | null;
};

type Solid = { x: number; y: number; vx: number; vy: number };

type ShapeConfig = {
  shape: ShapeType;
  pieces: number;
  imageUrl: string | null;
  imageEl: HTMLImageElement | null;
  mergeAudioBuffer: AudioBuffer | null;
  mergeAudioName: string | null;
};

type AssembledArea = { cx: number; cy: number; S: number };

// ─── Constants ────────────────────────────────────────────────────────────────

const PIECE_SPEED        = 136;
const MERGE_DELAY        = 5.0;
const ATTACH_THRESHOLD   = 0.80;
const ARENA_PAD          = 14;
const GRID_JITTER        = 0.42;
const VERT_INSET         = 0.87;
const ASSEMBLED_RATIO    = 0.29; // base ratio (calibrated for 3 shapes)
const ASSEMBLED_PAUSE    = 0.75; // seconds the cracked shape freezes after full merge

function getAssembledRatio(numShapes: number): number {
  const scale = numShapes === 1 ? 1.5 : numShapes === 2 ? 1.25 : numShapes === 4 ? 0.8 : 1.0;
  return ASSEMBLED_RATIO * scale;
}
const TRANSITION_DUR     = 0.55; // seconds for cracked → solid dissolve

const COLORS: Record<ShapeType, string> = {
  square:   "#ef4444",
  circle:   "#3b82f6",
  triangle: "#22c55e",
};



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

function generateBodies(shape: ShapeType, arena: Arena, targetPieces = 6, imageEl: HTMLImageElement | null = null, laneIdx = 0, assembledRatio = ASSEMBLED_RATIO): Body[] {
  const N         = Math.max(4, Math.ceil(Math.sqrt(targetPieces * 2.5)));
  const ASSEMBLED = arena.size * assembledRatio;
  const tileSize  = ASSEMBLED / N;
  const ox        = arena.cx - ASSEMBLED / 2;
  const oy        = arena.cy - ASSEMBLED / 2;
  const color     = COLORS[shape];

  let clipper: [number, number][] | null = null;
  if (shape === "circle") {
    const r = ASSEMBLED * 0.46;
    clipper = Array.from({ length: 64 }, (_, i) => {
      const a = (i / 64) * Math.PI * 2;
      return [arena.cx + Math.cos(a) * r, arena.cy + Math.sin(a) * r] as [number, number];
    });
  } else if (shape === "triangle") {
    const hw = ASSEMBLED / 2;
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

  // Pass 1: collect all valid cells in row-major order
  type RawCell = { gridRow: number; gridCol: number; targetX: number; targetY: number; verts: [number, number][] };
  const rawCells: RawCell[] = [];
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const corners: [number, number][] = [
        pts[row][col], pts[row][col + 1], pts[row + 1][col + 1], pts[row + 1][col],
      ];
      let poly: [number, number][] = corners;
      let cx: number, cy: number;
      if (clipper !== null) {
        const origArea = polygonArea(corners);
        poly = clipToConvex(corners, clipper);
        if (poly.length < 3 || polygonArea(poly) < origArea * 0.04) continue;
        [cx, cy] = polygonCentroid(poly);
      } else {
        cx = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4;
        cy = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4;
      }
      rawCells.push({
        gridRow: row, gridCol: col, targetX: cx, targetY: cy,
        verts: poly.map(([vx, vy]) => [(vx - cx) * VERT_INSET, (vy - cy) * VERT_INSET]),
      });
    }
  }

  // Pass 2: equal-sized contiguous regions via round-robin BFS with per-group capacity caps.
  // Simple FIFO BFS lets centre seeds grab far more cells than edge seeds (70/30 split).
  // Round-robin gives every group exactly one expansion per round so they grow at the same
  // rate, and hard capacity caps (⌊total/pieces⌋ or ⌈total/pieces⌉) guarantee equal sizes.
  const groupCount  = Math.min(targetPieces, rawCells.length);
  const bodies: Body[] = [];
  const inner = arena.size - ARENA_PAD * 2 - tileSize;
  let cellId = 0;

  const totalCells = rawCells.length;
  const baseSize   = Math.floor(totalCells / groupCount);
  const extra      = totalCells % groupCount;
  // First `extra` groups get one extra cell so every cell is covered exactly
  const capacities = Array.from({ length: groupCount }, (_, g) => baseSize + (g < extra ? 1 : 0));
  const counts     = new Array<number>(groupCount).fill(0);

  // Fast lookup: "row,col" → index in rawCells
  const idxMap = new Map<string, number>();
  for (let i = 0; i < totalCells; i++) {
    idxMap.set(`${rawCells[i].gridRow},${rawCells[i].gridCol}`, i);
  }

  // Seeds evenly spaced through row-major order so they start spread across the shape
  const assignment = new Int32Array(totalCells).fill(-1);
  const queues: number[][] = Array.from({ length: groupCount }, () => []);
  for (let g = 0; g < groupCount; g++) {
    const seedIdx = Math.floor((g + 0.5) * totalCells / groupCount);
    assignment[seedIdx] = g;
    counts[g] = 1;
    queues[g].push(seedIdx);
  }

  // Round-robin: each group advances its own frontier by one cell per round.
  // A group is skipped once its count hits its capacity.
  const qHeads = new Array<number>(groupCount).fill(0);
  let anyActive = true;
  while (anyActive) {
    anyActive = false;
    for (let g = 0; g < groupCount; g++) {
      if (qHeads[g] >= queues[g].length || counts[g] >= capacities[g]) continue;
      anyActive = true;
      const idx = queues[g][qHeads[g]++];
      const { gridRow: r, gridCol: c } = rawCells[idx];
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as [number,number][]) {
        if (counts[g] >= capacities[g]) break;
        const nIdx = idxMap.get(`${r+dr},${c+dc}`);
        if (nIdx === undefined || assignment[nIdx] !== -1) continue;
        assignment[nIdx] = g;
        counts[g]++;
        queues[g].push(nIdx);
      }
    }
  }

  // Fallback: any cell left unassigned (rare, concave boundary edge-case) borrows from a neighbour
  for (let i = 0; i < totalCells; i++) {
    if (assignment[i] !== -1) continue;
    const { gridRow: r, gridCol: c } = rawCells[i];
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as [number,number][]) {
      const nIdx = idxMap.get(`${r+dr},${c+dc}`);
      if (nIdx !== undefined && assignment[nIdx] !== -1) { assignment[i] = assignment[nIdx]; break; }
    }
  }

  // Collect each group's cells
  const groups: RawCell[][] = Array.from({ length: groupCount }, () => []);
  for (let i = 0; i < totalCells; i++) {
    if (assignment[i] >= 0) groups[assignment[i]].push(rawCells[i]);
  }

  for (let g = 0; g < groupCount; g++) {
    const group = groups[g];
    if (group.length === 0) continue;

    const anchor = group[0];
    const cells: Cell[] = group.map((rc) => ({
      id: cellId++,
      gridRow: rc.gridRow, gridCol: rc.gridCol,
      targetX: rc.targetX, targetY: rc.targetY,
      localX: rc.targetX - anchor.targetX,
      localY: rc.targetY - anchor.targetY,
      verts: rc.verts as [number, number][],
      tileSize,
    }));

    const sx = arena.x + ARENA_PAD + tileSize / 2 + Math.random() * inner;
    const sy = arena.y + ARENA_PAD + tileSize / 2 + Math.random() * inner;
    let ang = Math.random() * Math.PI * 2;
    const AV = Math.PI / 36;
    if (Math.abs(Math.sin(ang)) < AV) ang += AV;
    if (Math.abs(Math.cos(ang)) < AV) ang += AV;

    bodies.push({
      id: _bodyId++,
      x: sx, y: sy,
      vx: Math.cos(ang) * PIECE_SPEED,
      vy: Math.sin(ang) * PIECE_SPEED,
      cells,
      glowColor: "none",
      glowTimer: 0,
      color,
      shape,
      laneIdx,
      imageEl,
    });
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

function bounceWall(b: Body, arena: Arena, onBounce?: (b: Body) => void) {
  const { minX, maxX, minY, maxY } = getBodyBounds(b);
  const L = arena.x, R = arena.x + arena.size;
  const T = arena.y, Bo = arena.y + arena.size;
  let hit = false;
  if (minX < L)  { b.x += L  - minX; b.vx =  Math.abs(b.vx); hit = true; }
  if (maxX > R)  { b.x -= maxX - R;  b.vx = -Math.abs(b.vx); hit = true; }
  if (minY < T)  { b.y += T  - minY; b.vy =  Math.abs(b.vy); hit = true; }
  if (maxY > Bo) { b.y -= maxY - Bo; b.vy = -Math.abs(b.vy); hit = true; }
  if (hit) { setSpeed(b); b.glowColor = "red"; b.glowTimer = 0.14; onBounce?.(b); }
}

// ─── Solid shape bounce ───────────────────────────────────────────────────────

function getSolidBounds(s: Solid, shape: ShapeType, S: number) {
  const hw = S / 2;
  if (shape === "circle") { const r = S * 0.46; return { minX: s.x - r, maxX: s.x + r, minY: s.y - r, maxY: s.y + r }; }
  return { minX: s.x - hw, maxX: s.x + hw, minY: s.y - hw, maxY: s.y + hw };
}

function bounceSolid(s: Solid, arena: Arena, shape: ShapeType, S: number, onBounce?: () => void) {
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
  if (hit) onBounce?.();
}

// ─── Merge ────────────────────────────────────────────────────────────────────

type MergeCandidate = { canMerge: false } | { canMerge: true; c1: Cell; c2: Cell };

function checkCanMerge(b1: Body, b2: Body): MergeCandidate {
  if (b1.laneIdx !== b2.laneIdx) return { canMerge: false };
  const tileSize  = b1.cells[0]?.tileSize ?? 1;
  const threshold = tileSize * ATTACH_THRESHOLD;

  // Broad-phase: bounding boxes must be physically touching (within one tile edge).
  // This prevents pieces from snapping together across a visible gap.
  const bb1 = getBodyBounds(b1), bb2 = getBodyBounds(b2);
  const touchDist = tileSize * 0.25;
  if (
    bb2.minX > bb1.maxX + touchDist || bb1.minX > bb2.maxX + touchDist ||
    bb2.minY > bb1.maxY + touchDist || bb1.minY > bb2.maxY + touchDist
  ) return { canMerge: false };

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
  onMerge?: (mergedBody: Body) => void,
): boolean {
  if (!mergingEnabled) return false;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const r = checkCanMerge(bodies[i], bodies[j]);
      if (r.canMerge) {
        mergeBodies(bodies, i, j, r.c1, r.c2);
        onMerge?.(bodies[i]);
        return true;
      }
    }
  }
  return false;
}

// ─── Draw ─────────────────────────────────────────────────────────────────────

function drawArena(ctx: CanvasRenderingContext2D, arena: Arena) {
  ctx.save();
  const arenaGrad = ctx.createLinearGradient(arena.x, arena.y, arena.x + arena.size, arena.y + arena.size);
  arenaGrad.addColorStop(0,    "rgba(100,160,220,0.42)");
  arenaGrad.addColorStop(0.5,  "rgba(110,185,150,0.36)");
  arenaGrad.addColorStop(1,    "rgba(175,155,215,0.42)");
  ctx.fillStyle = arenaGrad;
  ctx.fillRect(arena.x, arena.y, arena.size, arena.size);
  ctx.shadowColor = "rgba(122,180,240,0.45)"; ctx.shadowBlur = 14;
  ctx.strokeStyle = "rgba(122,180,240,0.65)"; ctx.lineWidth = 1.5;
  ctx.strokeRect(arena.x, arena.y, arena.size, arena.size);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(180,200,240,0.07)"; ctx.lineWidth = 1;
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

function drawBodies(
  ctx: CanvasRenderingContext2D,
  bodies: Body[],
  alpha: number,
  clip?: ClipInfo,
  assembledArea?: AssembledArea,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (clip) applyShapeClip(ctx, clip);

  // Expand verts beyond VERT_INSET so adjacent sub-cells fill their shared gap.
  // This makes each body render as one seamless solid piece.
  const INV = 1 / VERT_INSET;

  for (const body of bodies) {
    const anchor = body.cells[0];

    if (body.glowColor === "green") { ctx.shadowColor = "rgba(74,222,128,0.7)";  ctx.shadowBlur = 14; }
    else if (body.glowColor === "red") { ctx.shadowColor = "rgba(248,113,113,0.55)"; ctx.shadowBlur = 14; }
    else { ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; }

    // Build one composite path covering all sub-cells of this body
    const tracePath = () => {
      ctx.beginPath();
      for (const c of body.cells) {
        const px = body.x + c.localX, py = body.y + c.localY;
        ctx.moveTo(px + c.verts[0][0] * INV, py + c.verts[0][1] * INV);
        for (let i = 1; i < c.verts.length; i++) ctx.lineTo(px + c.verts[i][0] * INV, py + c.verts[i][1] * INV);
        ctx.closePath();
      }
    };

    tracePath();

    if (body.imageEl && assembledArea) {
      // All sub-cells share the same image offset because localX = targetX - anchor.targetX
      ctx.save();
      ctx.clip();
      const ox = body.x - anchor.targetX;
      const oy = body.y - anchor.targetY;
      ctx.drawImage(
        body.imageEl,
        assembledArea.cx - assembledArea.S / 2 + ox,
        assembledArea.cy - assembledArea.S / 2 + oy,
        assembledArea.S,
        assembledArea.S,
      );
      ctx.restore();
      tracePath(); // retrace after restore (ctx.save/restore does not preserve the path)
    } else {
      ctx.fillStyle = body.color;
      ctx.fill();
    }

    // Single outer stroke per body — no per-cell seam lines
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth   = 1;
    ctx.stroke();
  }

  ctx.restore();
}

function drawSolid(
  ctx: CanvasRenderingContext2D,
  shape: ShapeType, s: Solid, S: number,
  color: string, alpha: number, blurPx: number,
  imageEl?: HTMLImageElement | null,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (blurPx > 0.5) ctx.filter = `blur(${blurPx.toFixed(1)}px)`;

  ctx.beginPath();
  if (shape === "square") {
    ctx.rect(s.x - S / 2, s.y - S / 2, S, S);
  } else if (shape === "circle") {
    ctx.arc(s.x, s.y, S * 0.46, 0, Math.PI * 2);
  } else {
    const hw = S / 2;
    ctx.moveTo(s.x,      s.y - hw);
    ctx.lineTo(s.x - hw, s.y + hw);
    ctx.lineTo(s.x + hw, s.y + hw);
    ctx.closePath();
  }

  if (imageEl) {
    ctx.save();
    ctx.clip();
    ctx.drawImage(imageEl, s.x - S / 2, s.y - S / 2, S, S);
    ctx.restore();
  } else {
    ctx.fillStyle   = color;
    ctx.shadowColor = color;
    ctx.shadowBlur  = 20;
    ctx.fill();
  }

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

// One distinct piano note per lane (slot 0-3)
// Merge: deeper, longer notes
// Collision: same notes but shorter and slightly quieter
const LANE_FREQS = [196.0, 261.6, 329.6, 392.0]; // G3, C4, E4, G4

function playMergeSound(ctx: AudioContext, laneIdx: number) {
  const freq = LANE_FREQS[laneIdx] ?? LANE_FREQS[0];
  _pianoNote(ctx, freq, 0.22, ctx.currentTime, 0.30);
}

function playCollisionSound(ctx: AudioContext, laneIdx: number) {
  const freq = LANE_FREQS[laneIdx] ?? LANE_FREQS[0];
  _pianoNote(ctx, freq, 0.18, ctx.currentTime, 0.18);
}

// Play a user-uploaded AudioBuffer as a one-shot sound
function playCustomSound(ctx: AudioContext, buffer: AudioBuffer) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(ctx.currentTime);
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

// ─── Background / ambient music ───────────────────────────────────────────────

function startAmbientMusic(ctx: AudioContext, buffer: AudioBuffer | null): () => void {
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(0.0455, ctx.currentTime + 2.0); // gentle fade-in
  master.connect(ctx.destination);

  const stops: (() => void)[] = [() => {
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.8); // fade-out on stop
    setTimeout(() => { try { master.disconnect(); } catch {} }, 3000);
  }];

  if (buffer) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(master);
    src.start();
    stops.push(() => { try { src.stop(); } catch {} });
  } else {
    // Default generative calm: C2/G2/C3/G3 sine drones with slow LFO + pentatonic arpeggio
    const droneFreqs = [65.41, 98.00, 130.81, 196.00]; // C2, G2, C3, G3
    const droneOscs: OscillatorNode[] = [];
    droneFreqs.forEach((freq, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      gain.gain.value = 0.22 / (i + 1);
      lfo.type = "sine"; lfo.frequency.value = 0.07 + i * 0.02; // 0.07–0.13 Hz breathing
      lfoG.gain.value = 0.07;
      lfo.connect(lfoG); lfoG.connect(gain.gain);
      osc.connect(gain); gain.connect(master);
      osc.start(); lfo.start();
      droneOscs.push(osc, lfo);
    });
    stops.push(() => droneOscs.forEach(o => { try { o.stop(); } catch {} }));

    // Slow pentatonic melody — C3 octave, random spacing so it never sounds looped
    const scale = [130.81, 146.83, 164.81, 196.00, 220.00, 261.63]; // C3 D3 E3 G3 A3 C4
    let noteIdx = 0, nextNoteT = ctx.currentTime + 1.5, alive = true;
    const scheduleMelody = () => {
      if (!alive) return;
      while (nextNoteT < ctx.currentTime + 1.2) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine"; o.frequency.value = scale[noteIdx % scale.length];
        g.gain.setValueAtTime(0, nextNoteT);
        g.gain.linearRampToValueAtTime(0.055, nextNoteT + 0.10);
        g.gain.exponentialRampToValueAtTime(0.0001, nextNoteT + 2.2);
        o.connect(g); g.connect(master);
        o.start(nextNoteT); o.stop(nextNoteT + 2.3);
        nextNoteT += 1.6 + Math.random() * 1.4; // 1.6–3.0 s between notes
        noteIdx++;
        if (Math.random() < 0.3) noteIdx++; // occasionally skip a step for variety
      }
      if (alive) setTimeout(scheduleMelody, 250);
    };
    scheduleMelody();
    stops.push(() => { alive = false; });
  }

  return () => stops.forEach(fn => fn());
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

function getRaceClip(arena: Arena, shape: ShapeType, shapeBodies: Body[], assembledRatio: number): ClipInfo | undefined {
  if (shapeBodies.length !== 1 || shapeBodies[0].cells.length === 0) return undefined;
  const b   = shapeBodies[0];
  const ref = b.cells[0];
  const ox  = (b.x + ref.localX) - ref.targetX;
  const oy  = (b.y + ref.localY) - ref.targetY;
  return { shape, cx: arena.cx + ox, cy: arena.cy + oy, S: arena.size * assembledRatio };
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
  // Race refs (keyed by lane index, not shape type, to support duplicate shapes)
  const raceLanesRef   = useRef<number[]>([]);
  const raceEntriesRef = useRef<Record<number, RaceEntry>>({});
  const racePlaceRef   = useRef(0);
  // Solo multi-shape refs
  const soloConfigsRef    = useRef<ShapeConfig[]>([{ shape: "square", pieces: 6, imageUrl: null, imageEl: null, mergeAudioBuffer: null, mergeAudioName: null }]);
  const soloImageElRef    = useRef<HTMLImageElement | null>(null);
  // Audio refs
  const audioCtxRef         = useRef<AudioContext | null>(null);
  const soloGlowRef         = useRef(0); // 1→0 highlight intensity during solo assembled phase
  const lastBounceSoundRef  = useRef<Record<number, number>>({});
  const assembledRatioRef   = useRef(ASSEMBLED_RATIO);
  const bgMusicBufferRef    = useRef<AudioBuffer | null>(null);
  const bgMusicStopRef      = useRef<(() => void) | null>(null);

  const [phase,   setPhase]   = useState<Phase>("editor");
  const [timerMs, setTimerMs] = useState(0);
  const [arenaY,    setArenaY]    = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [merging,   setMerging]   = useState(false);
  const [raceDone, setRaceDone] = useState(false);
  const [customHeading,    setCustomHeading]    = useState("How Long Will It Take to Assemble a Plain Square?");
  const [customSubheading, setCustomSubheading] = useState("");
  const [soloConfigs,   setSoloConfigs]   = useState<ShapeConfig[]>([{ shape: "square", pieces: 6, imageUrl: null, imageEl: null, mergeAudioBuffer: null, mergeAudioName: null }]);
  const [bgMusicName,  setBgMusicName]  = useState<string | null>(null);

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
        const soloBounceCb = (b: Body) => {
          const ac = audioCtxRef.current; if (!ac) return;
          ac.resume();
          const now = ac.currentTime;
          const key = b.laneIdx;
          if ((now - (lastBounceSoundRef.current[key] ?? -Infinity)) < 0.10) return;
          lastBounceSoundRef.current[key] = now;
          playCollisionSound(ac, key);
        };
        // Sub-step: 3 physics steps per rendered frame to prevent wall tunneling
        const SUB = 3, subDt = dt / SUB;
        for (let s = 0; s < SUB; s++) {
          for (const b of bodies) { b.x += b.vx * subDt; b.y += b.vy * subDt; }
          for (const b of bodies) bounceWall(b, arena, soloBounceCb);
        }

        const mergingEnabled = elapsedRef.current >= MERGE_DELAY;
        const soloMergeCb = (b: Body) => {
          const ac = audioCtxRef.current; if (!ac) return;
          // Suppress the next wall-bounce sound for the merged body so the
          // merge sound isn't immediately followed by a bounce sound.
          lastBounceSoundRef.current[b.laneIdx] = ac.currentTime + 0.35;
          const buf = soloConfigsRef.current[0]?.mergeAudioBuffer;
          if (buf) playCustomSound(ac, buf); else playMergeSound(ac, b.laneIdx);
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
          solidSizeRef.current = arena.size * assembledRatioRef.current;
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
        bounceSolid(s, arena, shapeRef.current, solidSizeRef.current, () => {
          const ac = audioCtxRef.current; if (!ac) return;
          ac.resume();
          const now = ac.currentTime;
          const key = -1; // negative: solid lane 0, won't clash with lane indices (≥0)
          if ((now - (lastBounceSoundRef.current[key] ?? -Infinity)) < 0.10) return;
          lastBounceSoundRef.current[key] = now;
          playCollisionSound(ac, 0);
        });

      } else if (curPhase === "race") {
        elapsedRef.current += dt;
        const bodies  = bodiesRef.current;
        const entries = raceEntriesRef.current;

        // Decay glow timers once per frame
        for (const b of bodies) {
          if (b.glowTimer > 0) { b.glowTimer -= dt; if (b.glowTimer <= 0) b.glowColor = "none"; }
        }
        const raceBounceCb = (b: Body) => {
          const ac = audioCtxRef.current; if (!ac) return;
          ac.resume();
          const now = ac.currentTime;
          const key = b.laneIdx;
          if ((now - (lastBounceSoundRef.current[key] ?? -Infinity)) < 0.10) return;
          lastBounceSoundRef.current[key] = now;
          playCollisionSound(ac, key);
        };
        // Sub-step physics to prevent wall tunneling
        const rSUB = 3, rSubDt = dt / rSUB;
        for (let s = 0; s < rSUB; s++) {
          for (const b of bodies) {
            if (entries[b.laneIdx]?.subPhase === "racing") { b.x += b.vx * rSubDt; b.y += b.vy * rSubDt; }
          }
          for (const b of bodies) {
            if (entries[b.laneIdx]?.subPhase === "racing") bounceWall(b, arena, raceBounceCb);
          }
        }
        // Merge — same-lane only (enforced by checkCanMerge via laneIdx), immediate (no delay)
        const raceMergeCb = (b: Body) => {
          const ac = audioCtxRef.current; if (!ac) return;
          lastBounceSoundRef.current[b.laneIdx] = ac.currentTime + 0.35;
          const buf = raceEntriesRef.current[b.laneIdx]?.mergeAudioBuffer;
          if (buf) playCustomSound(ac, buf); else playMergeSound(ac, b.laneIdx);
        };
        let mergeHappened = true;
        while (mergeHappened) mergeHappened = scanMerges(bodies, true, raceMergeCb);

        // Per-lane sub-state transitions
        let stateChanged = false;
        for (const li of raceLanesRef.current) {
          const entry = entries[li];
          if (!entry) continue;

          if (entry.subPhase === "racing") {
            const cnt = bodies.reduce((n, b) => n + (b.laneIdx === li ? 1 : 0), 0);
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
              const sb = bodies.filter(b => b.laneIdx === li);
              if (sb.length === 1) {
                const b0  = sb[0];
                const ref = b0.cells[0];
                entry.solid     = {
                  x: arena.cx + (b0.x + ref.localX - ref.targetX),
                  y: arena.cy + (b0.y + ref.localY - ref.targetY),
                  vx: b0.vx, vy: b0.vy,
                };
                entry.solidSize = arena.size * assembledRatioRef.current;
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
              bodiesRef.current = bodiesRef.current.filter(b => b.laneIdx !== li);
              const ac = audioCtxRef.current; if (ac) playCompleteSound(ac, entry.shape);
              stateChanged = true;
            }
          } else if (entry.subPhase === "bouncing") {
            entry.solid.x += entry.solid.vx * dt; entry.solid.y += entry.solid.vy * dt;
            bounceSolid(entry.solid, arena, entry.shape, entry.solidSize, () => {
              const ac = audioCtxRef.current; if (!ac) return;
              const now = ac.currentTime;
              const key = -(li + 1); // negative: solid per lane, won't clash with lane indices (≥0)
              if ((now - (lastBounceSoundRef.current[key] ?? -Infinity)) < 0.10) return;
              lastBounceSoundRef.current[key] = now;
              playCollisionSound(ac, li);
            });
          }
        }

        frameRef.current++;
        if (stateChanged || frameRef.current % 6 === 0) {
          setTimerMs(elapsedRef.current * 1000);
          if (raceLanesRef.current.every(li => entries[li]?.subPhase === "bouncing")) setRaceDone(true);
        }
      }

      // ── Render ─────────────────────────────────────────────────────────────

      ctx.clearRect(0, 0, W, H);
      const bgGrad = ctx.createLinearGradient(0, 0, W, H);
      bgGrad.addColorStop(0,   "#0d1a2e");
      bgGrad.addColorStop(0.5, "#0f1828");
      bgGrad.addColorStop(1,   "#130f26");
      ctx.fillStyle = bgGrad;
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
        return { shape: shapeRef.current, cx: arena.cx + ox, cy: arena.cy + oy, S: arena.size * assembledRatioRef.current };
      };

      const assembledArea: AssembledArea = { cx: arena.cx, cy: arena.cy, S: arena.size * assembledRatioRef.current };

      if (curPhase === "simulation" || curPhase === "assembled") {
        const clip = getAssembledClip();
        drawBodies(ctx, bodiesRef.current, 1, clip, assembledArea);
        if (clip && soloGlowRef.current > 0)
          drawCompletionGlow(ctx, clip, soloGlowRef.current, COLORS[shapeRef.current]);
      }

      if (curPhase === "transition") {
        const tp   = transPRef.current;
        const clip = getAssembledClip();
        drawBodies(ctx, bodiesRef.current, 1 - tp, clip, assembledArea);
        drawSolid(ctx, shapeRef.current, solidRef.current, solidSizeRef.current,
                  COLORS[shapeRef.current], tp, (1 - tp) * 22, soloImageElRef.current);
      }

      if (curPhase === "bouncing") {
        drawSolid(ctx, shapeRef.current, solidRef.current, solidSizeRef.current,
                  COLORS[shapeRef.current], 1, 0, soloImageElRef.current);
      }

      if (curPhase === "race") {
        const entries   = raceEntriesRef.current;
        const allBodies = bodiesRef.current;

        const racingBodies = allBodies.filter(b => entries[b.laneIdx]?.subPhase === "racing");
        if (racingBodies.length > 0) drawBodies(ctx, racingBodies, 1, undefined, assembledArea);

        for (const li of raceLanesRef.current) {
          const entry = entries[li];
          if (!entry || entry.subPhase === "racing") continue;
          const shapeBodies = allBodies.filter(b => b.laneIdx === li);
          const clip = getRaceClip(arena, entry.shape, shapeBodies, assembledRatioRef.current);
          if (entry.subPhase === "assembled") {
            drawBodies(ctx, shapeBodies, 1, clip, assembledArea);
            if (clip && entry.completionGlow > 0)
              drawCompletionGlow(ctx, clip, entry.completionGlow, COLORS[entry.shape]);
          } else if (entry.subPhase === "transition") {
            drawBodies(ctx, shapeBodies, 1 - entry.transP, clip, assembledArea);
            drawSolid(ctx, entry.shape, entry.solid, entry.solidSize, COLORS[entry.shape], entry.transP, (1 - entry.transP) * 22, entry.imageEl);
          } else if (entry.subPhase === "bouncing") {
            drawSolid(ctx, entry.shape, entry.solid, entry.solidSize, COLORS[entry.shape], 1, 0, entry.imageEl);
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

  const handleImageUpload = (idx: number, file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        setSoloConfigs(prev => {
          const next = prev.map((c, i) => i === idx ? { ...c, imageUrl: url, imageEl: img } : c);
          soloConfigsRef.current = next;
          return next;
        });
      };
      img.src = url;
    };
    reader.readAsDataURL(file);
  };

  const handleAudioUpload = (idx: number, file: File) => {
    if (!audioCtxRef.current) {
      try { audioCtxRef.current = new AudioContext(); } catch { return; }
    }
    const ac = audioCtxRef.current;
    file.arrayBuffer()
      .then(buf => ac.decodeAudioData(buf))
      .then(decoded => {
        setSoloConfigs(prev => {
          const next = prev.map((c, i) => i === idx ? { ...c, mergeAudioBuffer: decoded, mergeAudioName: file.name } : c);
          soloConfigsRef.current = next;
          return next;
        });
      })
      .catch(() => { /* invalid audio — ignore */ });
  };

  const handleBgMusicUpload = (file: File) => {
    if (!audioCtxRef.current) {
      try { audioCtxRef.current = new AudioContext(); } catch { return; }
    }
    file.arrayBuffer()
      .then(buf => audioCtxRef.current!.decodeAudioData(buf))
      .then(decoded => { bgMusicBufferRef.current = decoded; setBgMusicName(file.name); })
      .catch(() => {});
  };

  const handleSoloPlay = () => {
    if (!audioCtxRef.current) {
      try { audioCtxRef.current = new AudioContext(); } catch { /* ignore */ }
    }
    audioCtxRef.current?.resume();
    // Stop any previous background music, then start fresh
    bgMusicStopRef.current?.();
    bgMusicStopRef.current = audioCtxRef.current
      ? startAmbientMusic(audioCtxRef.current, bgMusicBufferRef.current)
      : null;
    const configs = soloConfigsRef.current;
    const arena   = arenaRef.current;
    assembledRatioRef.current = getAssembledRatio(configs.length);

    if (configs.length === 1) {
      const cfg               = configs[0];
      shapeRef.current        = cfg.shape;
      soloImageElRef.current  = cfg.imageEl;
      const bodies            = generateBodies(cfg.shape, arena, cfg.pieces, cfg.imageEl, 0, assembledRatioRef.current);
      bodiesRef.current       = bodies;
      totalRef.current        = bodies.length;
      elapsedRef.current      = 0;
      frameRef.current        = 0;
      phaseRef.current        = "simulation";
      lastTRef.current        = performance.now();
      setTimerMs(0);
      setRemaining(bodies.length);
      setMerging(false);
      setPhase("simulation");
    } else {
      // Multi-shape: reuse race infrastructure, keyed by lane index (not shape type)
      const allBodies: Body[] = [];
      const entries: Record<number, RaceEntry> = {};
      for (let i = 0; i < configs.length; i++) {
        const cfg = configs[i];
        const bs  = generateBodies(cfg.shape, arena, cfg.pieces, cfg.imageEl, i, assembledRatioRef.current);
        allBodies.push(...bs);
        entries[i] = {
          shape: cfg.shape, laneIdx: i, total: bs.length, place: null, finishTime: 0,
          subPhase: "racing", assembledTimer: 0, transP: 0,
          completionGlow: 0,
          solid: { x: arena.cx, y: arena.cy, vx: PIECE_SPEED * 0.7, vy: PIECE_SPEED * 0.7 },
          solidSize: arena.size * assembledRatioRef.current,
          imageEl: cfg.imageEl,
          mergeAudioBuffer: cfg.mergeAudioBuffer,
        };
      }
      raceLanesRef.current   = configs.map((_, i) => i);
      bodiesRef.current      = allBodies;
      raceEntriesRef.current = entries;
      racePlaceRef.current   = 0;
      elapsedRef.current     = 0;
      frameRef.current       = 0;
      phaseRef.current       = "race";
      lastTRef.current       = performance.now();
      setTimerMs(0);

      setRaceDone(false);
      setPhase("race");
    }
  };


  const handleReset = () => {
    bgMusicStopRef.current?.();
    bgMusicStopRef.current  = null;
    bodiesRef.current      = [];
    phaseRef.current       = "editor";
    raceEntriesRef.current = {};
    racePlaceRef.current   = 0;
    setPhase("editor");
    setTimerMs(0);
    setMerging(false);
    setRaceDone(false);
  };

  const fmtTime = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

  return (
    <div style={{ position: "relative", width: "100%", height: "100dvh", overflow: "hidden", background: "linear-gradient(135deg, #0d1a2e 0%, #0f1828 50%, #130f26 100%)" }}>
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
          {customHeading}
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

        {/* Subheading */}
        {customSubheading ? (
          <p style={{
            margin: "4px 0 0", fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: "clamp(0.75rem, 2.5vw, 1.05rem)", fontWeight: 600,
            color: "rgba(248,250,252,0.7)", textAlign: "center",
            textShadow: "0 2px 10px rgba(0,0,0,0.6)",
          }}>
            {customSubheading}
          </p>
        ) : null}

        {/* Race status */}
        {phase === "race" && (
          <p style={{ margin: "4px 0 0", fontFamily: "Arial, Helvetica, sans-serif", fontSize: "0.85rem", fontWeight: 700, color: "rgba(248,250,252,0.5)" }}>
            ⏱ {fmtTime(timerMs)} · Racing…
          </p>
        )}
      </div>

      {/* Editor panel */}
      {phase === "editor" && (
        <div style={{
          position: "fixed", bottom: 12, left: "50%", transform: "translateX(-50%)",
          zIndex: 8,
          width: "min(360px, calc(100vw - 24px))",
          maxHeight: "calc(100dvh - 100px)",
          display: "flex", flexDirection: "column",
          borderRadius: 14, overflow: "hidden",
          border: "1px solid rgba(122,180,240,0.22)",
          background: "rgba(10,18,40,0.96)", backdropFilter: "blur(18px)",
          boxShadow: "0 20px 60px rgba(5,10,30,0.7), 0 0 0 1px rgba(180,200,255,0.04)", fontFamily: "Arial, Helvetica, sans-serif",
        }}>
          {/* Scrollable content area */}
          <div style={{
            overflowY: "auto", flex: 1,
            padding: "18px 18px 10px",
            display: "flex", flexDirection: "column", gap: 14,
            // Thin scrollbar on webkit
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(122,180,240,0.25) transparent",
          } as React.CSSProperties}>

            {/* Custom heading input */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ margin: 0, color: "rgba(248,250,252,0.55)", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em" }}>
                YOUR HEADING
              </label>
              <input
                type="text"
                value={customHeading}
                onChange={e => setCustomHeading(e.target.value)}
                placeholder="e.g. How fast can squares merge?"
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 8, boxSizing: "border-box",
                  border: "1px solid rgba(122,180,240,0.22)", background: "rgba(8,16,38,0.9)",
                  color: "#e8f0fc", fontSize: 13, fontFamily: "Arial, Helvetica, sans-serif", outline: "none",
                }}
              />
            </div>

            {/* Custom subheading input */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ margin: 0, color: "rgba(248,250,252,0.55)", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em" }}>
                YOUR SUBHEADING
              </label>
              <input
                type="text"
                value={customSubheading}
                onChange={e => setCustomSubheading(e.target.value)}
                placeholder="e.g. Watch the pieces come together!"
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 8, boxSizing: "border-box",
                  border: "1px solid rgba(122,180,240,0.22)", background: "rgba(8,16,38,0.9)",
                  color: "#e8f0fc", fontSize: 13, fontFamily: "Arial, Helvetica, sans-serif", outline: "none",
                }}
              />
            </div>

            {/* Background music */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ margin: 0, color: "rgba(248,250,252,0.55)", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em" }}>
                BACKGROUND MUSIC
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{
                  flex: 1, padding: "7px 10px", borderRadius: 6, cursor: "pointer",
                  border: "1.5px dashed rgba(122,180,240,0.28)", background: "rgba(122,180,240,0.06)",
                  fontSize: 11, color: bgMusicName ? "#93c5fd" : "rgba(248,250,252,0.45)",
                  display: "flex", alignItems: "center", gap: 6, minHeight: 38, overflow: "hidden",
                }}>
                  <span style={{ flexShrink: 0 }}>♫</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {bgMusicName ?? "Upload music (default: calm ambient)"}
                  </span>
                  <input type="file" accept="audio/*" style={{ display: "none" }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleBgMusicUpload(f); }} />
                </label>
                {bgMusicName && (
                  <button onClick={() => { bgMusicBufferRef.current = null; setBgMusicName(null); }} style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "rgba(248,113,113,0.75)", fontSize: 18, padding: "2px 6px", flexShrink: 0,
                  }}>×</button>
                )}
              </div>
            </div>

            {/* Number of shapes toggle */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ margin: 0, color: "rgba(248,250,252,0.55)", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em" }}>
                NUMBER OF SHAPES
              </p>
              <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid rgba(122,180,240,0.22)" }}>
                {[1, 2, 3, 4].map(n => (
                  <button key={n} onClick={() => {
                    setSoloConfigs(prev => {
                      const next = [...prev];
                      while (next.length < n) next.push({ shape: "square", pieces: 6, imageUrl: null, imageEl: null, mergeAudioBuffer: null, mergeAudioName: null });
                      // Slicing drops removed slots (and their image data) automatically
                      const trimmed = next.slice(0, n);
                      soloConfigsRef.current = trimmed;
                      if (n === 1) shapeRef.current = trimmed[0].shape;
                      return trimmed;
                    });
                  }} style={{
                    flex: 1, minHeight: 44, cursor: "pointer", border: "none",
                    background: soloConfigs.length === n ? "rgba(148,163,184,0.22)" : "transparent",
                    color: soloConfigs.length === n ? "#f8fafc" : "rgba(248,250,252,0.4)",
                    fontWeight: 800, fontSize: 15, letterSpacing: "0.04em",
                  }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Per-shape config blocks */}
            {soloConfigs.map((cfg, idx) => (
              <div key={idx} style={{
                display: "flex", flexDirection: "column", gap: 12,
                padding: "14px", borderRadius: 10,
                border: "1px solid rgba(122,180,240,0.15)",
                background: "rgba(10,20,48,0.5)",
              }}>
                {/* Block label */}
                <p style={{ margin: 0, color: "rgba(248,250,252,0.55)", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em" }}>
                  {soloConfigs.length === 1 ? "SHAPE CONFIG" : `SHAPE ${idx + 1}`}
                </p>

                {/* A) Pieces slider */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ color: "rgba(248,250,252,0.6)", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em" }}>
                    PIECES: {cfg.pieces}
                  </label>
                  <input
                    type="range" min={2} max={24} value={cfg.pieces}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setSoloConfigs(prev => {
                        const next = prev.map((c, i) => i === idx ? { ...c, pieces: v } : c);
                        soloConfigsRef.current = next;
                        return next;
                      });
                    }}
                    style={{ width: "100%", accentColor: COLORS[cfg.shape], cursor: "pointer", touchAction: "none" }}
                  />
                </div>

                {/* B) Shape type */}
                <div style={{ display: "flex", gap: 6 }}>
                  {(["square", "circle", "triangle"] as ShapeType[]).map(s => (
                    <button key={s} onClick={() => {
                      setSoloConfigs(prev => {
                        const next = prev.map((c, i) => i === idx ? { ...c, shape: s } : c);
                        soloConfigsRef.current = next;
                        if (idx === 0) shapeRef.current = s;
                        return next;
                      });
                    }} style={{
                      flex: 1, minHeight: 44, padding: "0 8px", borderRadius: 8, cursor: "pointer",
                      border: `2px solid ${cfg.shape === s ? COLORS[s] : "rgba(122,180,240,0.22)"}`,
                      background: cfg.shape === s ? COLORS[s] + "28" : "rgba(10,20,48,0.7)",
                      color: cfg.shape === s ? COLORS[s] : "rgba(248,250,252,0.5)",
                      fontWeight: 800, fontSize: 12, letterSpacing: "0.04em", textTransform: "capitalize",
                    }}>
                      {s}
                    </button>
                  ))}
                </div>

                {/* C) Image upload */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <label style={{
                    padding: "9px 14px", borderRadius: 8, cursor: "pointer",
                    border: "1px solid rgba(122,180,240,0.25)", background: "rgba(10,20,48,0.7)",
                    color: "rgba(200,220,255,0.7)", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
                    minHeight: 44, display: "flex", alignItems: "center",
                  }}>
                    Add Image (optional)
                    <input
                      type="file" accept="image/*"
                      style={{ display: "none" }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(idx, f); }}
                    />
                  </label>
                  {cfg.imageUrl && (
                    <img
                      src={cfg.imageUrl}
                      alt="preview"
                      style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(122,180,240,0.25)", flexShrink: 0 }}
                    />
                  )}
                </div>

                {/* Merge sound upload */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label style={{
                    flex: 1, padding: "7px 10px", borderRadius: 6, cursor: "pointer",
                    border: "1.5px dashed rgba(148,163,184,0.28)", background: "rgba(148,163,184,0.06)",
                    fontSize: 11, color: cfg.mergeAudioName ? "#93c5fd" : "rgba(248,250,252,0.45)",
                    display: "flex", alignItems: "center", gap: 6, minHeight: 38, overflow: "hidden",
                  }}>
                    <span style={{ flexShrink: 0 }}>♪</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {cfg.mergeAudioName ?? "Merge Sound (optional)"}
                    </span>
                    <input type="file" accept="audio/*" style={{ display: "none" }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleAudioUpload(idx, f); }} />
                  </label>
                  {cfg.mergeAudioName && (
                    <button onClick={() => setSoloConfigs(prev => {
                      const next = prev.map((c, i) => i === idx ? { ...c, mergeAudioBuffer: null, mergeAudioName: null } : c);
                      soloConfigsRef.current = next;
                      return next;
                    })} style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: "rgba(248,113,113,0.75)", fontSize: 18, padding: "2px 6px", flexShrink: 0,
                    }}>×</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Sticky Start button — always visible at the bottom */}
          <div style={{
            padding: "12px 18px 16px",
            borderTop: "1px solid rgba(122,180,240,0.12)",
            background: "rgba(10,18,40,0.99)",
            flexShrink: 0,
          }}>
            <button onClick={handleSoloPlay} style={{
              width: "100%", minHeight: 48, borderRadius: 8, cursor: "pointer",
              border: "1.5px solid rgba(100,190,140,0.55)", background: "rgba(80,160,115,0.2)",
              color: "#b8f0cc", fontWeight: 900, fontSize: 14, letterSpacing: "0.08em",
            }}>
              ▶ Start Simulation
            </button>
          </div>
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
