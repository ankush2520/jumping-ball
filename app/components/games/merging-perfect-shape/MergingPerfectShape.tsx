"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { drawCanvasWatermark } from "@/app/lib/watermark";

// ─── Types ────────────────────────────────────────────────────────────────────

type ShapeType = "square" | "circle" | "triangle";
// assembled  = all pieces merged, cracked shape held still for ASSEMBLED_PAUSE seconds
// transition = cracked fades out, solid shape fades in with blur (TRANSITION_DUR seconds)
// bouncing   = plain solid shape bounces forever
type Phase = "editor" | "simulation" | "assembled" | "transition" | "bouncing";
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

function bounceWall(b: Body, arena: Arena) {
  const { minX, maxX, minY, maxY } = getBodyBounds(b);
  const L = arena.x, R = arena.x + arena.size;
  const T = arena.y, Bo = arena.y + arena.size;
  let hit = false;
  if (minX < L)  { b.x += L  - minX; b.vx =  Math.abs(b.vx); hit = true; }
  if (maxX > R)  { b.x -= maxX - R;  b.vx = -Math.abs(b.vx); hit = true; }
  if (minY < T)  { b.y += T  - minY; b.vy =  Math.abs(b.vy); hit = true; }
  if (maxY > Bo) { b.y -= maxY - Bo; b.vy = -Math.abs(b.vy); hit = true; }
  if (hit) { setSpeed(b); b.glowColor = "red"; b.glowTimer = 0.14; }
}

// ─── Solid shape bounce ───────────────────────────────────────────────────────

function getSolidBounds(s: Solid, shape: ShapeType, S: number) {
  const hw = S / 2;
  if (shape === "circle") { const r = S * 0.46; return { minX: s.x - r, maxX: s.x + r, minY: s.y - r, maxY: s.y + r }; }
  return { minX: s.x - hw, maxX: s.x + hw, minY: s.y - hw, maxY: s.y + hw };
}

function bounceSolid(s: Solid, arena: Arena, shape: ShapeType, S: number) {
  const { minX, maxX, minY, maxY } = getSolidBounds(s, shape, S);
  const L = arena.x, R = arena.x + arena.size;
  const T = arena.y, Bo = arena.y + arena.size;
  if (minX < L)  { s.x += L  - minX; s.vx =  Math.abs(s.vx); }
  if (maxX > R)  { s.x -= maxX - R;  s.vx = -Math.abs(s.vx); }
  if (minY < T)  { s.y += T  - minY; s.vy =  Math.abs(s.vy); }
  if (maxY > Bo) { s.y -= maxY - Bo; s.vy = -Math.abs(s.vy); }
  const spd = Math.hypot(s.vx, s.vy);
  if (spd > 0.001) { s.vx = (s.vx / spd) * PIECE_SPEED; s.vy = (s.vy / spd) * PIECE_SPEED; }
}

// ─── Merge ────────────────────────────────────────────────────────────────────

type MergeCandidate = { canMerge: false } | { canMerge: true; c1: Cell; c2: Cell };

function checkCanMerge(b1: Body, b2: Body): MergeCandidate {
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

function scanMerges(bodies: Body[], mergingEnabled: boolean): boolean {
  if (!mergingEnabled) return false;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const r = checkCanMerge(bodies[i], bodies[j]);
      if (r.canMerge) { mergeBodies(bodies, i, j, r.c1, r.c2); return true; }
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
  const assembledTimeRef = useRef(0); // counts down from ASSEMBLED_PAUSE
  const transPRef        = useRef(0); // 0→1 over TRANSITION_DUR

  const [phase,     setPhase]     = useState<Phase>("editor");
  const [shape,     setShape]     = useState<ShapeType>("square");
  const [timerMs,   setTimerMs]   = useState(0);
  const [arenaY,    setArenaY]    = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [merging,   setMerging]   = useState(false);

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

        for (const b of bodies) {
          b.x += b.vx * dt; b.y += b.vy * dt;
          if (b.glowTimer > 0) { b.glowTimer -= dt; if (b.glowTimer <= 0) b.glowColor = "none"; }
        }
        for (const b of bodies) bounceWall(b, arena);

        const mergingEnabled = elapsedRef.current >= MERGE_DELAY;
        let mergeHappened = true;
        while (mergeHappened) mergeHappened = scanMerges(bodies, mergingEnabled);

        frameRef.current++;
        if (frameRef.current % 6 === 0) {
          setTimerMs(elapsedRef.current * 1000);
          setRemaining(bodies.length);
          setMerging(mergingEnabled);
        }

        // All merged → freeze cracked shape for a moment
        if (bodies.length === 1 && totalRef.current > 1) {
          phaseRef.current      = "assembled";
          assembledTimeRef.current = ASSEMBLED_PAUSE;
          setPhase("assembled");
        }

      } else if (curPhase === "assembled") {
        assembledTimeRef.current -= dt;
        if (assembledTimeRef.current <= 0) {
          // Hand off to solid shape
          const b      = bodiesRef.current[0];
          const bounds = getBodyBounds(b);
          solidRef.current = {
            x:  (bounds.minX + bounds.maxX) / 2,
            y:  (bounds.minY + bounds.maxY) / 2,
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
          setPhase("bouncing");
        }
        const s = solidRef.current;
        s.x += s.vx * dt; s.y += s.vy * dt;
        bounceSolid(s, arena, shapeRef.current, solidSizeRef.current);

      } else if (curPhase === "bouncing") {
        const s = solidRef.current;
        s.x += s.vx * dt; s.y += s.vy * dt;
        bounceSolid(s, arena, shapeRef.current, solidSizeRef.current);
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
        drawBodies(ctx, bodiesRef.current, 1, getAssembledClip());
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

  const handlePlay = () => {
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

  const handleReset = () => {
    bodiesRef.current = [];
    phaseRef.current  = "editor";
    setPhase("editor");
    setTimerMs(0);
    setMerging(false);
  };

  const fmtTime = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

  return (
    <div style={{ position: "relative", width: "100%", height: "100dvh", overflow: "hidden", background: "#020617" }}>
      <canvas ref={canvasRef} style={{ display: "block" }} />

      {/* Heading — bottom sits 15 px above arena */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0,
        height: arenaY > 0 ? arenaY - 15 : undefined,
        zIndex: 6, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "flex-end",
        pointerEvents: "none",
      }}>
        <h1 style={{
          margin: 0, fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: "clamp(1.2rem, 4vw, 1.8rem)", fontWeight: 900,
          color: "#fff", textShadow: "0 4px 20px rgba(0,0,0,0.7)",
          letterSpacing: "-0.01em",
        }}>
          Merging Perfect Shape
        </h1>
        {phase === "simulation" && (
          <p style={{
            margin: "4px 0 0", fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: "0.9rem", fontWeight: 700,
            color: merging ? "#4ade80" : "rgba(248,250,252,0.7)",
          }}>
            {merging
              ? `✦ MERGING  ⏱ ${fmtTime(timerMs)}  ·  ${remaining} left`
              : `Merging in ${Math.max(0, MERGE_DELAY - timerMs / 1000).toFixed(1)}s  ·  ⏱ ${fmtTime(timerMs)}`
            }
          </p>
        )}
        {(phase === "assembled" || phase === "transition") && (
          <p style={{
            margin: "4px 0 0", fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: "0.9rem", fontWeight: 700, color: "#4ade80",
          }}>
            ✦ COMPLETE  ⏱ {fmtTime(timerMs)}
          </p>
        )}
      </div>

      {/* Shape selector */}
      {phase === "editor" && (
        <div style={{
          position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)",
          zIndex: 8, display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
          padding: "20px 28px", borderRadius: 14,
          border: "1px solid rgba(148,163,184,0.18)",
          background: "rgba(2,6,23,0.9)", backdropFilter: "blur(14px)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)", fontFamily: "Arial, Helvetica, sans-serif",
        }}>
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
          <button onClick={handlePlay} style={{
            minWidth: 170, minHeight: 46, borderRadius: 8, cursor: "pointer",
            border: "1.5px solid rgba(34,197,94,0.5)", background: "rgba(22,163,74,0.18)",
            color: "#bbf7d0", fontWeight: 900, fontSize: 14, letterSpacing: "0.08em",
          }}>
            ▶ Start Simulation
          </button>
        </div>
      )}

      {/* Play Again — shown while solid shape bounces */}
      {phase === "bouncing" && (
        <div style={{
          position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)",
          zIndex: 8,
        }}>
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
