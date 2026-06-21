"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { drawCanvasWatermark } from "@/app/lib/watermark";

// ─── Types ────────────────────────────────────────────────────────────────────

type ShapeType = "square" | "circle" | "triangle";
type Phase    = "editor" | "simulation" | "done";
type Arena    = { x: number; y: number; size: number; cx: number; cy: number };

type Cell = {
  id: number;
  gridRow: number; gridCol: number;
  targetX: number; targetY: number; // centroid in assembled shape (world)
  localX: number;  localY: number;  // centroid offset from owning body's (x, y)
  verts: [number, number][];        // polygon vertices relative to centroid
  tileSize: number;                 // nominal grid step (used for merge threshold)
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

// ─── Constants ────────────────────────────────────────────────────────────────

const PIECE_SPEED      = 136;  // px/s — constant for every body
const MERGE_DELAY      = 5.0;  // seconds before merging is enabled
const ATTACH_THRESHOLD = 0.80; // fraction of tileSize: proximity for merge-snap
const ARENA_PAD        = 14;
const GRID_JITTER      = 0.42; // fraction of tileSize to jitter interior corners
const VERT_INSET       = 0.87; // scale polygon inward (visual gap between pieces)

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

// ─── Shape filter ─────────────────────────────────────────────────────────────

function isInShape(
  shape: ShapeType, px: number, py: number,
  aCx: number, aCy: number, r: number,
  triTop: number, triBot: number, triLeft: number, triRight: number,
): boolean {
  if (shape === "square") return true;
  if (shape === "circle") return Math.hypot(px - aCx, py - aCy) <= r * 0.92;
  const h = triBot - triTop;
  const t = (py - triTop) / h;
  if (t < 0 || t > 1) return false;
  const hw = (triRight - triLeft) / 2 * t;
  return px >= aCx - hw && px <= aCx + hw;
}

// ─── Piece generation (jittered grid → irregular polygons) ────────────────────

function generateBodies(shape: ShapeType, arena: Arena): Body[] {
  const N         = 5;
  const ASSEMBLED = arena.size * 0.29;  // assembled shape size (half of arena)
  const tileSize  = ASSEMBLED / N;
  const ox        = arena.cx - ASSEMBLED / 2;
  const oy        = arena.cy - ASSEMBLED / 2;
  const color     = COLORS[shape];
  const r         = ASSEMBLED / 2;

  const triTop   = arena.cy - ASSEMBLED * 0.58;
  const triBot   = arena.cy + ASSEMBLED * 0.42;
  const triLeft  = arena.cx - ASSEMBLED / 2;
  const triRight = arena.cx + ASSEMBLED / 2;

  // Build (N+1)×(N+1) grid of control points with random jitter on interior nodes
  const jitter = tileSize * GRID_JITTER;
  const pts: [number, number][][] = [];
  for (let row = 0; row <= N; row++) {
    pts[row] = [];
    for (let col = 0; col <= N; col++) {
      const bx = ox + col * tileSize;
      const by = oy + row * tileSize;
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
      // Four corners of this jittered cell (clockwise)
      const corners: [number, number][] = [
        pts[row][col],
        pts[row][col + 1],
        pts[row + 1][col + 1],
        pts[row + 1][col],
      ];

      // Centroid of the quadrilateral
      const cx = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4;
      const cy = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4;

      // Shape inclusion check on centroid
      if (!isInShape(shape, cx, cy, arena.cx, arena.cy, r, triTop, triBot, triLeft, triRight)) continue;

      // Vertex offsets from centroid, scaled inward for a visual gap
      const verts: [number, number][] = corners.map(([vx, vy]) => [
        (vx - cx) * VERT_INSET,
        (vy - cy) * VERT_INSET,
      ]);

      // Random scatter position inside arena
      const inner = arena.size - ARENA_PAD * 2 - tileSize;
      const sx    = arena.x + ARENA_PAD + tileSize / 2 + Math.random() * inner;
      const sy    = arena.y + ARENA_PAD + tileSize / 2 + Math.random() * inner;

      // Random direction (avoid perfectly axis-aligned)
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

// ─── Physics ──────────────────────────────────────────────────────────────────

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
    b.vx = Math.cos(a) * PIECE_SPEED;
    b.vy = Math.sin(a) * PIECE_SPEED;
  } else {
    b.vx = (b.vx / spd) * PIECE_SPEED;
    b.vy = (b.vy / spd) * PIECE_SPEED;
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

// ─── Merge ────────────────────────────────────────────────────────────────────

type MergeCandidate = { canMerge: false } | { canMerge: true; c1: Cell; c2: Cell };

function checkCanMerge(b1: Body, b2: Body): MergeCandidate {
  const tileSize  = b1.cells[0]?.tileSize ?? 1;
  const threshold = tileSize * ATTACH_THRESHOLD;

  for (const c1 of b1.cells) {
    const w1x = b1.x + c1.localX;
    const w1y = b1.y + c1.localY;
    for (const c2 of b2.cells) {
      if (Math.abs(c1.gridRow - c2.gridRow) + Math.abs(c1.gridCol - c2.gridCol) !== 1) continue;
      const w2x = b2.x + c2.localX;
      const w2y = b2.y + c2.localY;
      const expDX = c2.targetX - c1.targetX;
      const expDY = c2.targetY - c1.targetY;
      if (Math.hypot((w2x - w1x) - expDX, (w2y - w1y) - expDY) < threshold) {
        return { canMerge: true, c1, c2 };
      }
    }
  }
  return { canMerge: false };
}

function mergeBodies(bodies: Body[], iIdx: number, jIdx: number, mc1: Cell, mc2: Cell) {
  const b1 = bodies[iIdx];
  const b2 = bodies[jIdx];
  const m1 = b1.cells.length;
  const m2 = b2.cells.length;

  // Snap b2 so mc2's centroid is exactly at the correct position relative to mc1
  b2.x = b1.x + mc1.localX + (mc2.targetX - mc1.targetX) - mc2.localX;
  b2.y = b1.y + mc1.localY + (mc2.targetY - mc1.targetY) - mc2.localY;

  for (const c of b2.cells) {
    b1.cells.push({ ...c, localX: b2.x + c.localX - b1.x, localY: b2.y + c.localY - b1.y });
  }

  b1.vx = (b1.vx * m1 + b2.vx * m2) / (m1 + m2);
  b1.vy = (b1.vy * m1 + b2.vy * m2) / (m1 + m2);
  setSpeed(b1);

  b1.glowColor = "green";
  b1.glowTimer = 0.55;
  bodies.splice(jIdx, 1);
}

// ─── Merge scan (no collision response — pieces pass through each other) ──────

function scanMerges(bodies: Body[], mergingEnabled: boolean): boolean {
  if (!mergingEnabled) return false;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const result = checkCanMerge(bodies[i], bodies[j]);
      if (result.canMerge) {
        mergeBodies(bodies, i, j, result.c1, result.c2);
        return true; // restart after splice
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
  ctx.shadowColor = "rgba(148,163,184,0.45)";
  ctx.shadowBlur  = 14;
  ctx.strokeStyle = "rgba(148,163,184,0.75)";
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(arena.x, arena.y, arena.size, arena.size);
  ctx.shadowBlur  = 0;
  ctx.strokeStyle = "rgba(226,232,240,0.07)";
  ctx.lineWidth   = 1;
  ctx.strokeRect(arena.x + 5, arena.y + 5, arena.size - 10, arena.size - 10);
  ctx.restore();
}

function drawBody(ctx: CanvasRenderingContext2D, body: Body) {
  const isGreen = body.glowColor === "green";
  const isRed   = body.glowColor === "red";
  const glowCol = isGreen ? "rgba(74,222,128,0.7)" : isRed ? "rgba(248,113,113,0.55)" : null;

  ctx.save();
  if (glowCol) { ctx.shadowColor = glowCol; ctx.shadowBlur = 14; }

  for (const c of body.cells) {
    const px = body.x + c.localX;
    const py = body.y + c.localY;

    ctx.beginPath();
    ctx.moveTo(px + c.verts[0][0], py + c.verts[0][1]);
    for (let i = 1; i < c.verts.length; i++) {
      ctx.lineTo(px + c.verts[i][0], py + c.verts[i][1]);
    }
    ctx.closePath();

    ctx.fillStyle   = body.color;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth   = 1;
    ctx.stroke();
  }
  ctx.restore();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MergingPerfectShape() {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const bodiesRef  = useRef<Body[]>([]);
  const arenaRef   = useRef<Arena>({ x: 0, y: 0, size: 0, cx: 0, cy: 0 });
  const phaseRef   = useRef<Phase>("editor");
  const elapsedRef = useRef(0);
  const lastTRef   = useRef(0);
  const rafRef     = useRef<number | null>(null);
  const dimRef     = useRef({ W: 0, H: 0 });
  const shapeRef   = useRef<ShapeType>("square");
  const frameRef   = useRef(0);
  const totalRef   = useRef(0);

  const [phase,     setPhase]     = useState<Phase>("editor");
  const [shape,     setShape]     = useState<ShapeType>("square");
  const [timerMs,   setTimerMs]   = useState(0);
  const [doneMs,    setDoneMs]    = useState(0);
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
    const ctx = canvas.getContext("2d")!;

    const tick = (t: number) => {
      const rawDt = (t - lastTRef.current) / 1000;
      const dt    = Math.min(rawDt > 0 ? rawDt : 1 / 60, 1 / 30);
      lastTRef.current = t;

      const { W, H } = dimRef.current;
      const arena     = arenaRef.current;

      if (phaseRef.current === "simulation") {
        elapsedRef.current += dt;
        const bodies = bodiesRef.current;

        for (const b of bodies) {
          b.x += b.vx * dt;
          b.y += b.vy * dt;
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

        if (bodies.length === 1 && totalRef.current > 1 && phaseRef.current === "simulation") {
          phaseRef.current = "done";
          setDoneMs(elapsedRef.current * 1000);
          setPhase("done");
        }
      }

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#020617";
      ctx.fillRect(0, 0, W, H);
      drawCanvasWatermark(ctx, W, H);
      drawArena(ctx, arena);
      for (const b of bodiesRef.current) drawBody(ctx, b);

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

      {/* Heading — bottom sits 15 px above arena top */}
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
      </div>

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

      {phase === "done" && (
        <div style={{
          position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)",
          zIndex: 8, display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
          padding: "22px 32px", borderRadius: 14,
          border: "1px solid rgba(34,197,94,0.3)",
          background: "rgba(2,6,23,0.92)", backdropFilter: "blur(14px)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)", fontFamily: "Arial, Helvetica, sans-serif",
        }}>
          <p style={{ margin: 0, color: "#4ade80", fontWeight: 900, fontSize: "1.15rem" }}>
            ✓ Assembled in {fmtTime(doneMs)}!
          </p>
          <button onClick={handleReset} style={{
            minWidth: 150, minHeight: 44, borderRadius: 8, cursor: "pointer",
            border: "1.5px solid rgba(34,197,94,0.5)", background: "rgba(22,163,74,0.18)",
            color: "#bbf7d0", fontWeight: 900, fontSize: 14, letterSpacing: "0.08em",
          }}>
            Play Again
          </button>
        </div>
      )}
    </div>
  );
}
