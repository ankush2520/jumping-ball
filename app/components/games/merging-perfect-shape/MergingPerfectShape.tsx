"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { drawCanvasWatermark } from "@/app/lib/watermark";

// ─── Types ────────────────────────────────────────────────────────────────────

type ShapeType = "square" | "circle" | "triangle";
type Phase = "editor" | "simulation" | "done";

type Piece = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  vAngle: number;
  targetX: number;
  targetY: number;
  targetAngle: number;
  assembled: boolean;
  verts: [number, number][]; // polygon vertices relative to piece centroid
  boundR: number;
  color: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_DT = 1 / 30;
const MERGE_DELAY = 2.0; // seconds of free bounce before pull starts
const SPRING_GROW = 3.5; // seconds to ramp spring to full strength
const SPRING_MAX = 0.09;
const DAMPING = 0.972;
const ANG_DAMPING = 0.88;
const SNAP_DIST = 2.5;
const SNAP_ANGLE = 0.06;
const PIECE_SPEED = 200;
const PADDING = 50;

const COLORS: Record<ShapeType, string> = {
  square: "#f97316",
  circle: "#06b6d4",
  triangle: "#22c55e",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randScatter(W: number, H: number) {
  return {
    x: PADDING + Math.random() * (W - PADDING * 2),
    y: PADDING + Math.random() * (H - PADDING * 2),
    vx: (Math.random() - 0.5) * PIECE_SPEED * 2,
    vy: (Math.random() - 0.5) * PIECE_SPEED * 2,
    angle: Math.random() * Math.PI * 2,
    vAngle: (Math.random() - 0.5) * 4,
  };
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// ─── Piece generators ─────────────────────────────────────────────────────────

function createSquarePieces(W: number, H: number): Piece[] {
  const S = Math.min(W, H) * 0.42;
  const n = 4;
  const ps = S / n;
  const ox = W / 2 - S / 2;
  const oy = H / 2 - S / 2;
  const color = COLORS.square;
  const pieces: Piece[] = [];
  let id = 0;

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const tx = ox + col * ps + ps / 2;
      const ty = oy + row * ps + ps / 2;
      const hw = ps / 2 - 1.5;
      pieces.push({
        id: id++,
        ...randScatter(W, H),
        targetX: tx,
        targetY: ty,
        targetAngle: 0,
        assembled: false,
        verts: [
          [-hw, -hw],
          [hw, -hw],
          [hw, hw],
          [-hw, hw],
        ],
        boundR: hw * Math.SQRT2,
        color,
      });
    }
  }
  return pieces;
}

function createCirclePieces(W: number, H: number): Piece[] {
  const R = Math.min(W, H) * 0.22;
  const N = 16;
  const da = (Math.PI * 2) / N;
  const ARC_PTS = 10;
  const color = COLORS.circle;
  const pieces: Piece[] = [];

  for (let i = 0; i < N; i++) {
    const a0 = i * da;
    const a1 = a0 + da;
    const aM = (a0 + a1) / 2;
    // centroid of sector from center: (2R/3)*sin(da/2)/(da/2)
    const dCent = ((2 / 3) * R * Math.sin(da / 2)) / (da / 2);
    const wCx = dCent * Math.cos(aM);
    const wCy = dCent * Math.sin(aM);

    // sector polygon in circle-local space
    const worldVerts: [number, number][] = [[0, 0]];
    for (let v = 0; v <= ARC_PTS; v++) {
      const a = a0 + (da * v) / ARC_PTS;
      worldVerts.push([R * Math.cos(a), R * Math.sin(a)]);
    }
    const localVerts: [number, number][] = worldVerts.map(([x, y]) => [
      x - wCx,
      y - wCy,
    ]);

    pieces.push({
      id: i,
      ...randScatter(W, H),
      targetX: W / 2 + wCx,
      targetY: H / 2 + wCy,
      targetAngle: 0,
      assembled: false,
      verts: localVerts,
      boundR: R * 0.65,
      color,
    });
  }
  return pieces;
}

function createTrianglePieces(W: number, H: number): Piece[] {
  const S = Math.min(W, H) * 0.48;
  const hh = (S * Math.sqrt(3)) / 2;
  const s = S / 4;
  const sh = hh / 4;
  // big triangle centroid at (W/2, H/2): centroid is 2/3 from top
  const tcx = W / 2;
  const topY = H / 2 - (2 * hh) / 3;
  const color = COLORS.triangle;
  const pieces: Piece[] = [];
  let id = 0;

  // Grid point (r, k): x = tcx - r*s/2 + k*s, y = topY + r*sh
  const P = (r: number, k: number): [number, number] => [
    tcx - (r * s) / 2 + k * s,
    topY + r * sh,
  ];

  for (let r = 0; r < 4; r++) {
    // upward-pointing triangles (r+1 per row)
    for (let k = 0; k <= r; k++) {
      const v0 = P(r, k);
      const v1 = P(r + 1, k);
      const v2 = P(r + 1, k + 1);
      const cx = (v0[0] + v1[0] + v2[0]) / 3;
      const cy = (v0[1] + v1[1] + v2[1]) / 3;
      pieces.push({
        id: id++,
        ...randScatter(W, H),
        targetX: cx,
        targetY: cy,
        targetAngle: 0,
        assembled: false,
        verts: [
          [v0[0] - cx, v0[1] - cy],
          [v1[0] - cx, v1[1] - cy],
          [v2[0] - cx, v2[1] - cy],
        ],
        boundR: s * 0.65,
        color,
      });
    }
    // downward-pointing triangles (r per row)
    for (let k = 0; k < r; k++) {
      const v0 = P(r, k);
      const v1 = P(r, k + 1);
      const v2 = P(r + 1, k + 1);
      const cx = (v0[0] + v1[0] + v2[0]) / 3;
      const cy = (v0[1] + v1[1] + v2[1]) / 3;
      pieces.push({
        id: id++,
        ...randScatter(W, H),
        targetX: cx,
        targetY: cy,
        targetAngle: 0,
        assembled: false,
        verts: [
          [v0[0] - cx, v0[1] - cy],
          [v1[0] - cx, v1[1] - cy],
          [v2[0] - cx, v2[1] - cy],
        ],
        boundR: s * 0.65,
        color,
      });
    }
  }
  return pieces;
}

// ─── Draw ─────────────────────────────────────────────────────────────────────

function drawPiece(ctx: CanvasRenderingContext2D, piece: Piece) {
  ctx.save();
  ctx.translate(piece.x, piece.y);
  ctx.rotate(piece.angle);
  ctx.beginPath();
  const [first, ...rest] = piece.verts;
  ctx.moveTo(first[0], first[1]);
  for (const [x, y] of rest) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fillStyle = piece.assembled
    ? piece.color
    : piece.color + "cc";
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawGhost(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  shape: ShapeType,
) {
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = COLORS[shape];
  ctx.lineWidth = 2.5;

  if (shape === "square") {
    const S = Math.min(W, H) * 0.42;
    ctx.strokeRect(W / 2 - S / 2, H / 2 - S / 2, S, S);
  } else if (shape === "circle") {
    const R = Math.min(W, H) * 0.22;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, R, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const S = Math.min(W, H) * 0.48;
    const hh = (S * Math.sqrt(3)) / 2;
    ctx.beginPath();
    ctx.moveTo(W / 2, H / 2 - (2 * hh) / 3);
    ctx.lineTo(W / 2 - S / 2, H / 2 + hh / 3);
    ctx.lineTo(W / 2 + S / 2, H / 2 + hh / 3);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  pieces: Piece[],
  phase: Phase,
  shape: ShapeType,
) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, W, H);
  drawCanvasWatermark(ctx, W, H);

  if (phase === "editor") {
    drawGhost(ctx, W, H, shape);
  }

  for (const p of pieces) drawPiece(ctx, p);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MergingPerfectShape() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const piecesRef = useRef<Piece[]>([]);
  const phaseRef = useRef<Phase>("editor");
  const elapsedRef = useRef(0);
  const lastTRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const dimRef = useRef({ W: 0, H: 0 });
  const shapeRef = useRef<ShapeType>("square");
  const frameRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("editor");
  const [shape, setShape] = useState<ShapeType>("square");
  const [timerMs, setTimerMs] = useState(0);
  const [doneMs, setDoneMs] = useState(0);

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }
    dimRef.current = { W, H };
  }, []);

  useEffect(() => {
    setupCanvas();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    const tick = (t: number) => {
      const rawDt = (t - lastTRef.current) / 1000;
      const dt = Math.min(rawDt > 0 ? rawDt : 1 / 60, MAX_DT);
      lastTRef.current = t;
      const { W, H } = dimRef.current;

      if (phaseRef.current === "simulation") {
        elapsedRef.current += dt;
        const elapsed = elapsedRef.current;
        const pieces = piecesRef.current;

        const springT = Math.max(0, elapsed - MERGE_DELAY);
        const springStrength = Math.min(
          SPRING_MAX,
          (springT / SPRING_GROW) * SPRING_MAX,
        );

        let assembledCount = 0;

        for (const p of pieces) {
          if (p.assembled) {
            assembledCount++;
            continue;
          }

          const dx = p.targetX - p.x;
          const dy = p.targetY - p.y;
          const angleDiff = wrapAngle(p.targetAngle - p.angle);
          const dist = Math.hypot(dx, dy);

          if (
            springStrength > 0.005 &&
            dist < SNAP_DIST &&
            Math.abs(angleDiff) < SNAP_ANGLE
          ) {
            p.assembled = true;
            p.x = p.targetX;
            p.y = p.targetY;
            p.angle = p.targetAngle;
            p.vx = p.vy = p.vAngle = 0;
            assembledCount++;
            continue;
          }

          if (springStrength > 0) {
            p.vx += dx * springStrength;
            p.vy += dy * springStrength;
            p.vAngle += angleDiff * springStrength * 0.4;
          }

          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.angle += p.vAngle * dt;

          p.vx *= DAMPING;
          p.vy *= DAMPING;
          p.vAngle *= ANG_DAMPING;

          // wall bounce
          const pad = p.boundR;
          if (p.x < pad) {
            p.x = pad;
            p.vx = Math.abs(p.vx);
          }
          if (p.x > W - pad) {
            p.x = W - pad;
            p.vx = -Math.abs(p.vx);
          }
          if (p.y < pad) {
            p.y = pad;
            p.vy = Math.abs(p.vy);
          }
          if (p.y > H - pad) {
            p.y = H - pad;
            p.vy = -Math.abs(p.vy);
          }
        }

        // update timer display at ~10fps
        frameRef.current++;
        if (frameRef.current % 6 === 0) {
          setTimerMs(elapsed * 1000);
        }

        if (
          pieces.length > 0 &&
          assembledCount === pieces.length &&
          phaseRef.current === "simulation"
        ) {
          phaseRef.current = "done";
          setDoneMs(elapsed * 1000);
          setPhase("done");
        }
      }

      drawScene(
        ctx,
        W,
        H,
        piecesRef.current,
        phaseRef.current,
        shapeRef.current,
      );
      rafRef.current = requestAnimationFrame(tick);
    };

    lastTRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);

    const onResize = () => setupCanvas();
    window.addEventListener("resize", onResize);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
    };
  }, [setupCanvas]);

  const handlePlay = () => {
    const { W, H } = dimRef.current;
    const s = shapeRef.current;
    let pieces: Piece[];
    if (s === "square") pieces = createSquarePieces(W, H);
    else if (s === "circle") pieces = createCirclePieces(W, H);
    else pieces = createTrianglePieces(W, H);

    piecesRef.current = pieces;
    elapsedRef.current = 0;
    frameRef.current = 0;
    phaseRef.current = "simulation";
    lastTRef.current = performance.now();
    setTimerMs(0);
    setPhase("simulation");
  };

  const handleReset = () => {
    piecesRef.current = [];
    phaseRef.current = "editor";
    setPhase("editor");
    setTimerMs(0);
  };

  const handleShapeChange = (s: ShapeType) => {
    shapeRef.current = s;
    setShape(s);
  };

  const fmtTime = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

  const countdownSecs = Math.max(
    0,
    MERGE_DELAY - timerMs / 1000,
  ).toFixed(1);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100dvh",
        overflow: "hidden",
        background: "#0f172a",
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />

      {/* Heading */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 6,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "18px 20px 0",
          pointerEvents: "none",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: "clamp(1.3rem, 4vw, 1.9rem)",
            fontWeight: 900,
            color: "#fff",
            textShadow: "0 4px 20px rgba(0,0,0,0.6)",
            letterSpacing: "-0.01em",
          }}
        >
          Merging Perfect Shape
        </h1>

        {phase === "simulation" && (
          <p
            style={{
              margin: "5px 0 0",
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: "1rem",
              fontWeight: 700,
              color: "rgba(248,250,252,0.75)",
            }}
          >
            {timerMs / 1000 < MERGE_DELAY
              ? `Assembling in ${countdownSecs}s…`
              : `⏱ ${fmtTime(timerMs)}`}
          </p>
        )}
      </div>

      {/* Editor panel */}
      {phase === "editor" && (
        <div
          style={{
            position: "fixed",
            bottom: 36,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 8,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
            padding: "20px 28px",
            borderRadius: 14,
            border: "1px solid rgba(148,163,184,0.18)",
            background: "rgba(15,23,42,0.88)",
            backdropFilter: "blur(14px)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          <p
            style={{
              margin: 0,
              color: "rgba(248,250,252,0.6)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
            }}
          >
            SELECT SHAPE
          </p>

          <div style={{ display: "flex", gap: 10 }}>
            {(["square", "circle", "triangle"] as ShapeType[]).map((s) => (
              <button
                key={s}
                onClick={() => handleShapeChange(s)}
                style={{
                  minWidth: 90,
                  minHeight: 44,
                  padding: "0 16px",
                  borderRadius: 8,
                  cursor: "pointer",
                  border: `2px solid ${shape === s ? COLORS[s] : "rgba(148,163,184,0.22)"}`,
                  background:
                    shape === s
                      ? COLORS[s] + "28"
                      : "rgba(30,41,59,0.6)",
                  color:
                    shape === s
                      ? COLORS[s]
                      : "rgba(248,250,252,0.55)",
                  fontWeight: 800,
                  fontSize: 13,
                  letterSpacing: "0.05em",
                  textTransform: "capitalize",
                  transition: "all 0.15s",
                }}
              >
                {s}
              </button>
            ))}
          </div>

          <button
            onClick={handlePlay}
            style={{
              minWidth: 170,
              minHeight: 46,
              borderRadius: 8,
              cursor: "pointer",
              border: "1.5px solid rgba(34,197,94,0.5)",
              background: "rgba(22,163,74,0.18)",
              color: "#bbf7d0",
              fontWeight: 900,
              fontSize: 14,
              letterSpacing: "0.08em",
            }}
          >
            ▶ Start Simulation
          </button>
        </div>
      )}

      {/* Done panel */}
      {phase === "done" && (
        <div
          style={{
            position: "fixed",
            bottom: 36,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 8,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
            padding: "22px 32px",
            borderRadius: 14,
            border: "1px solid rgba(34,197,94,0.3)",
            background: "rgba(15,23,42,0.9)",
            backdropFilter: "blur(14px)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          <p
            style={{
              margin: 0,
              color: "#4ade80",
              fontWeight: 900,
              fontSize: "1.15rem",
            }}
          >
            ✓ Assembled in {fmtTime(doneMs)}!
          </p>
          <button
            onClick={handleReset}
            style={{
              minWidth: 150,
              minHeight: 44,
              borderRadius: 8,
              cursor: "pointer",
              border: "1.5px solid rgba(34,197,94,0.5)",
              background: "rgba(22,163,74,0.18)",
              color: "#bbf7d0",
              fontWeight: 900,
              fontSize: 14,
              letterSpacing: "0.08em",
            }}
          >
            Play Again
          </button>
        </div>
      )}
    </div>
  );
}
