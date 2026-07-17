"use client";

import React, { useEffect, useRef } from "react";
import { drawCanvasWatermark } from "@/app/lib/watermark";

// ─── Layout fractions ─────────────────────────────────────────────────────────
// Plane cruises at 20% of the screen height from the top; the piece it tows
// hangs on a rope down to 30% from the top, so the rope itself is 10% of the
// screen tall. The ground (and the landing slot) sits near the bottom.
const PLANE_Y_FRAC = 0.2;
const PIECE_HANG_FRAC = 0.3;
const GROUND_FRAC = 0.86;

const SIDE_PAD = 44; // plane turnaround margin from either screen edge
const SWING_DAMPING = 0.32; // rad/s of angular velocity lost per second
const MAX_SWING_RATE = 3.5; // rad/s cap so turnaround whips stay controllable
const RESULT_HOLD_SUCCESS_S = 1.7;
const RESULT_HOLD_MISS_S = 1.2;
// How deep a correctly-placed piece sinks into its ground slot, as a
// fraction of the piece's size — the rest pokes out above the surface.
const SLOT_SINK_FRAC = 0.42;

type Phase = "swing" | "falling" | "result";

type Pt = { x: number; y: number };

// Each level's piece, as a polygon in a unit box (x,y ∈ [-1, 1], y down).
// The ground slot is the same silhouette sunk into the ground, so the piece
// visually "fixes" into a matching notch — level 1 is the zigzag-bottom
// block from the sketch; every level after brings a new shape.
const SHAPES: { name: string; pts: Pt[] }[] = [
  {
    name: "Zigzag Block",
    pts: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 0.3 },
      { x: 0.5, y: 1 },
      { x: 0, y: 0.3 },
      { x: -0.5, y: 1 },
      { x: -1, y: 0.3 },
    ],
  },
  {
    name: "Triangle",
    pts: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 0, y: 1 },
    ],
  },
  {
    name: "Diamond",
    pts: [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ],
  },
  {
    name: "T-Block",
    pts: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: -0.2 },
      { x: 0.4, y: -0.2 },
      { x: 0.4, y: 1 },
      { x: -0.4, y: 1 },
      { x: -0.4, y: -0.2 },
      { x: -1, y: -0.2 },
    ],
  },
  {
    name: "Hexagon",
    pts: [
      { x: -0.5, y: -1 },
      { x: 0.5, y: -1 },
      { x: 1, y: 0 },
      { x: 0.5, y: 1 },
      { x: -0.5, y: 1 },
      { x: -1, y: 0 },
    ],
  },
  {
    name: "Chevron",
    pts: [
      { x: -1, y: -1 },
      { x: 0, y: -0.2 },
      { x: 1, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ],
  },
];

const LEVEL_COLORS = [
  { light: "#fde68a", base: "#f59e0b", deep: "#d97706" },
  { light: "#bae6fd", base: "#38bdf8", deep: "#0284c7" },
  { light: "#ddd6fe", base: "#a78bfa", deep: "#7c3aed" },
  { light: "#a7f3d0", base: "#34d399", deep: "#059669" },
  { light: "#fbcfe8", base: "#f472b6", deep: "#db2777" },
  { light: "#fef08a", base: "#facc15", deep: "#ca8a04" },
];

type Layout = {
  width: number;
  height: number;
  planeY: number;
  ropeLength: number;
  groundY: number;
  gravity: number; // px/s²
  pieceSize: number; // full width/height of the piece's unit box
  planeSpeed: number;
};

type Star = { x: number; y: number; r: number; twinkle: number };

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
};

function computeLayout(width: number, height: number): Layout {
  const planeY = height * PLANE_Y_FRAC;
  const pieceHangY = height * PIECE_HANG_FRAC;
  return {
    width,
    height,
    planeY,
    ropeLength: pieceHangY - planeY,
    groundY: height * GROUND_FRAC,
    // Tuned so the drop takes ~1s: long enough that the plane's forward
    // speed carries the piece along a clearly visible parabolic arc.
    gravity: height * 1.15,
    pieceSize: Math.max(34, Math.min(64, width * 0.12)),
    planeSpeed: Math.max(110, width * 0.2),
  };
}

function resizeCanvas(canvas: HTMLCanvasElement): Layout {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const viewport = window.visualViewport;
  const width = Math.round(viewport?.width ?? window.innerWidth);
  const height = Math.round(viewport?.height ?? window.innerHeight);
  const ctx = canvas.getContext("2d");

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  if (ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }

  return computeLayout(width, height);
}

function makeStars(width: number, height: number): Star[] {
  const count = Math.round((width * height) / 9000);
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height * GROUND_FRAC,
    r: Math.random() * 1.4 + 0.4,
    twinkle: Math.random() * Math.PI * 2,
  }));
}

// Trace the shape polygon into the current path, scaled to `half` and
// assuming the context is already translated/rotated to the piece center.
function tracePath(ctx: CanvasRenderingContext2D, pts: Pt[], half: number) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x * half, pts[0].y * half);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x * half, pts[i].y * half);
  }
  ctx.closePath();
}

const SkyDrop = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const starsRef = useRef<Star[]>([]);
  const lastTimeRef = useRef<number>(0);

  const phaseRef = useRef<Phase>("swing");
  const levelRef = useRef(1);
  const resultRef = useRef<{
    text: string;
    sub: string;
    color: string;
    timer: number;
    success: boolean;
  }>({ text: "", sub: "", color: "#ffffff", timer: 0, success: false });
  const particlesRef = useRef<Particle[]>([]);
  const trailRef = useRef<Pt[]>([]);

  const planeRef = useRef({ x: 0, vx: 1 });
  const ropeRef = useRef({ theta: 0, thetaDot: 0 });
  const pieceRef = useRef({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    rotation: 0,
    rotationSpeed: 0,
  });
  const targetRef = useRef({ x: 0 });

  const shapeForLevel = (level: number) => SHAPES[(level - 1) % SHAPES.length];
  const colorForLevel = (level: number) =>
    LEVEL_COLORS[(level - 1) % LEVEL_COLORS.length];

  // Landing tolerance: how far off-center (in px) the piece may be and
  // still count as fixed into the slot. Shrinks a little as levels climb.
  const toleranceFor = (level: number, pieceSize: number) =>
    pieceSize * Math.max(0.2, 0.34 - (level - 1) * 0.02);

  const planeSpeedFor = (level: number, layout: Layout) =>
    layout.planeSpeed * Math.min(1.6, 1 + (level - 1) * 0.07);

  const resetRound = () => {
    const layout = layoutRef.current;
    if (!layout) return;

    const dir = Math.random() < 0.5 ? 1 : -1;
    planeRef.current = {
      x: dir > 0 ? SIDE_PAD : layout.width - SIDE_PAD,
      vx: planeSpeedFor(levelRef.current, layout) * dir,
    };
    ropeRef.current = { theta: (Math.random() - 0.5) * 0.5, thetaDot: 0 };
    const margin = layout.pieceSize;
    targetRef.current = {
      x: margin + Math.random() * (layout.width - margin * 2),
    };
    pieceRef.current.rotation = 0;
    pieceRef.current.rotationSpeed = 0;
    trailRef.current = [];
    phaseRef.current = "swing";
  };

  const spawnBurst = (x: number, y: number, color: string, count: number) => {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * 110;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 60,
        life: 0.5 + Math.random() * 0.35,
        maxLife: 0.85,
        color,
      });
    }
  };

  const dropPiece = () => {
    const layout = layoutRef.current;
    if (!layout || phaseRef.current !== "swing") return;

    // Real release velocity: the plane's forward velocity plus the rope
    // tip's tangential swing velocity — the piece then flies a genuine
    // projectile parabola from that initial condition.
    const { theta, thetaDot } = ropeRef.current;
    const plane = planeRef.current;
    const piece = pieceRef.current;
    piece.vx = plane.vx + layout.ropeLength * thetaDot * Math.cos(theta);
    piece.vy = -layout.ropeLength * thetaDot * Math.sin(theta);
    piece.rotation = theta;
    piece.rotationSpeed = thetaDot;
    trailRef.current = [];
    phaseRef.current = "falling";
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const init = () => {
      const layout = resizeCanvas(canvas);
      layoutRef.current = layout;
      starsRef.current = makeStars(layout.width, layout.height);
      resetRound();
    };
    init();
    lastTimeRef.current = performance.now();

    const handleResize = () => init();
    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);

    const handlePointerDown = () => dropPiece();
    canvas.addEventListener("pointerdown", handlePointerDown);

    const tick = (now: number) => {
      const ctx = canvas.getContext("2d");
      const layout = layoutRef.current;
      if (!ctx || !layout) {
        animationRef.current = requestAnimationFrame(tick);
        return;
      }

      const dt = Math.min(
        1 / 30,
        Math.max(0, (now - lastTimeRef.current) / 1000),
      );
      lastTimeRef.current = now;

      const { width, planeY, ropeLength, groundY, gravity, pieceSize } = layout;
      const plane = planeRef.current;
      const piece = pieceRef.current;
      const rope = ropeRef.current;
      const target = targetRef.current;
      const half = pieceSize / 2;
      const sink = pieceSize * SLOT_SINK_FRAC;

      // Plane ping-pongs between the two side margins. A direction flip is
      // an impulsive pivot-velocity change, so it whips the pendulum — the
      // hanging piece keeps its inertia while the anchor reverses.
      plane.x += plane.vx * dt;
      let flipDelta = 0;
      if (plane.x > width - SIDE_PAD) {
        plane.x = width - SIDE_PAD;
        flipDelta = -2 * Math.abs(plane.vx);
        plane.vx = -Math.abs(plane.vx);
      } else if (plane.x < SIDE_PAD) {
        plane.x = SIDE_PAD;
        flipDelta = 2 * Math.abs(plane.vx);
        plane.vx = Math.abs(plane.vx);
      }

      if (phaseRef.current === "swing") {
        if (flipDelta !== 0) {
          rope.thetaDot -= (flipDelta * Math.cos(rope.theta)) / ropeLength;
        }
        const thetaDotDot =
          -(gravity / ropeLength) * Math.sin(rope.theta) -
          SWING_DAMPING * rope.thetaDot;
        rope.thetaDot += thetaDotDot * dt;
        rope.thetaDot = Math.max(
          -MAX_SWING_RATE,
          Math.min(MAX_SWING_RATE, rope.thetaDot),
        );
        rope.theta += rope.thetaDot * dt;
        piece.x = plane.x + ropeLength * Math.sin(rope.theta);
        piece.y = planeY + ropeLength * Math.cos(rope.theta);
        piece.rotation = rope.theta;
      } else if (phaseRef.current === "falling") {
        piece.vy += gravity * dt;
        piece.x += piece.vx * dt;
        piece.y += piece.vy * dt;
        // The piece keeps its swing rotation at release, then stabilizes
        // toward upright as it falls (spring + damping), so it can slot in.
        piece.rotationSpeed +=
          (-piece.rotation * 7 - piece.rotationSpeed * 3.2) * dt;
        piece.rotation += piece.rotationSpeed * dt;

        trailRef.current.push({ x: piece.x, y: piece.y });
        if (trailRef.current.length > 40) trailRef.current.shift();

        const tol = toleranceFor(levelRef.current, pieceSize);
        const fits = Math.abs(piece.x - target.x) <= tol;
        // A fitting piece falls past the surface INTO the slot; a miss
        // stops on the ground itself.
        const floorY = fits ? groundY + sink : groundY;
        if (piece.y + half >= floorY) {
          piece.y = floorY - half;
          if (fits) {
            piece.x = target.x;
            piece.rotation = 0;
            resultRef.current = {
              text: "PERFECT!",
              sub: `Level ${levelRef.current} clear!`,
              color: "#4ade80",
              timer: RESULT_HOLD_SUCCESS_S,
              success: true,
            };
            spawnBurst(
              target.x,
              groundY,
              colorForLevel(levelRef.current).base,
              30,
            );
            spawnBurst(target.x, groundY, "#4ade80", 16);
          } else {
            // Fell over where it landed.
            piece.rotation = Math.max(
              -0.5,
              Math.min(0.5, piece.vx * 0.004),
            );
            resultRef.current = {
              text: "MISSED!",
              sub: "Try again",
              color: "#f87171",
              timer: RESULT_HOLD_MISS_S,
              success: false,
            };
            spawnBurst(piece.x, groundY, "#94a3b8", 14);
          }
          phaseRef.current = "result";
        }
      } else if (phaseRef.current === "result") {
        resultRef.current.timer -= dt;
        if (resultRef.current.timer <= 0) {
          if (resultRef.current.success) levelRef.current += 1;
          resetRound();
        }
      }

      // Particles
      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        p.vy += 320 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }

      draw(ctx, layout, now / 1000);
      animationRef.current = requestAnimationFrame(tick);
    };

    const draw = (ctx: CanvasRenderingContext2D, layout: Layout, t: number) => {
      const { width, height, planeY, groundY, pieceSize } = layout;
      const half = pieceSize / 2;
      const sink = pieceSize * SLOT_SINK_FRAC;
      const level = levelRef.current;
      const shape = shapeForLevel(level);
      const colors = colorForLevel(level);
      // Where a correctly-placed piece rests: partly sunk into the slot.
      const slotRestY = groundY + sink - half;

      // Sky
      ctx.clearRect(0, 0, width, height);
      const sky = ctx.createLinearGradient(0, 0, 0, groundY);
      sky.addColorStop(0, "#0b1330");
      sky.addColorStop(0.55, "#111c3f");
      sky.addColorStop(1, "#182554");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, groundY);
      drawCanvasWatermark(ctx, width, height);

      // Stars
      ctx.save();
      for (const star of starsRef.current) {
        const alpha = 0.35 + 0.35 * Math.sin(t * 1.6 + star.twinkle);
        ctx.fillStyle = `rgba(226, 246, 255, ${Math.max(0.1, alpha)})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Background label — literally sits behind the plane/piece/ground.
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(226, 246, 255, 0.1)";
      const labelSize = Math.max(16, Math.min(30, width * 0.055));
      ctx.font = `900 ${labelSize}px Arial, Helvetica, sans-serif`;
      ctx.fillText("TAP SCREEN TO DROP THIS PIECE", width / 2, height * 0.5);
      ctx.restore();

      // Ground
      const groundGrad = ctx.createLinearGradient(0, groundY, 0, height);
      groundGrad.addColorStop(0, "#1e2a1f");
      groundGrad.addColorStop(1, "#0b120c");
      ctx.fillStyle = groundGrad;
      ctx.fillRect(0, groundY, width, height - groundY);
      ctx.strokeStyle = "rgba(148, 222, 176, 0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(width, groundY);
      ctx.stroke();

      // The slot: the piece's own silhouette cut into the ground. The
      // below-surface part is a dark cavity; the above-surface part is a
      // pulsing dashed ghost showing exactly how the piece must sit.
      const { x: targetX } = targetRef.current;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, groundY, width, height - groundY);
      ctx.clip();
      ctx.translate(targetX, slotRestY);
      tracePath(ctx, shape.pts, half + 2);
      ctx.fillStyle = "#04070d";
      ctx.fill();
      ctx.restore();

      ctx.save();
      const pulse = 0.45 + 0.3 * Math.sin(t * 4);
      ctx.translate(targetX, slotRestY);
      tracePath(ctx, shape.pts, half + 2);
      ctx.strokeStyle = `rgba(250, 204, 21, ${pulse})`;
      ctx.shadowColor = "rgba(250, 204, 21, 0.6)";
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([7, 6]);
      ctx.stroke();
      ctx.restore();

      // Trail of the fall — makes the parabolic arc readable.
      const trail = trailRef.current;
      ctx.save();
      for (let i = 0; i < trail.length; i++) {
        const alpha = ((i + 1) / trail.length) * 0.4;
        ctx.fillStyle = `rgba(226, 246, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(trail[i].x, trail[i].y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Rope + plane (rope only while the piece is still attached)
      const plane = planeRef.current;
      const piece = pieceRef.current;
      if (phaseRef.current === "swing") {
        ctx.save();
        ctx.strokeStyle = "rgba(226, 232, 240, 0.75)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(plane.x, planeY + 6);
        ctx.lineTo(piece.x, piece.y - half * 0.6);
        ctx.stroke();
        ctx.restore();
      }

      // Plane (emoji, mirrored to face its direction of travel)
      ctx.save();
      ctx.translate(plane.x, planeY);
      if (plane.vx < 0) ctx.scale(-1, 1);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${Math.max(28, width * 0.065)}px Arial, sans-serif`;
      ctx.fillText("✈️", 0, 0);
      ctx.restore();

      // The piece
      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.rotation);
      const grad = ctx.createLinearGradient(-half, -half, half, half);
      grad.addColorStop(0, colors.light);
      grad.addColorStop(0.5, colors.base);
      grad.addColorStop(1, colors.deep);
      tracePath(ctx, shape.pts, half);
      ctx.fillStyle = grad;
      ctx.shadowColor = colors.base;
      ctx.shadowBlur = 16;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      // Particles
      for (const p of particlesRef.current) {
        const alpha = Math.max(0, p.life / p.maxLife);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Heading (no shadowBlur on fillText — WebKit ghosting bug)
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const titleSize = Math.max(18, Math.min(26, width * 0.05));
      ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
      ctx.font = `900 ${titleSize}px Arial, Helvetica, sans-serif`;
      ctx.fillText("Sky Drop", width / 2, Math.max(30, height * 0.055));
      ctx.fillStyle = "rgba(248, 250, 252, 0.72)";
      const subSize = Math.max(12, Math.min(15, width * 0.03));
      ctx.font = `700 ${subSize}px Arial, Helvetica, sans-serif`;
      ctx.fillText(
        "Drop the piece into its matching slot",
        width / 2,
        Math.max(30, height * 0.055) + titleSize * 0.85,
      );

      // Level badge
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(250, 204, 21, 0.92)";
      const levelSize = Math.max(15, Math.min(20, width * 0.036));
      ctx.font = `900 ${levelSize}px Arial, Helvetica, sans-serif`;
      ctx.fillText(`LEVEL ${level}`, width - 18, 26);
      ctx.fillStyle = "rgba(226, 246, 255, 0.6)";
      ctx.font = `700 ${Math.max(11, levelSize * 0.62)}px Arial, Helvetica, sans-serif`;
      ctx.fillText(shape.name, width - 18, 26 + levelSize * 0.95);

      // Result banner
      if (phaseRef.current === "result" && resultRef.current.timer > 0) {
        const { text, sub, color, timer } = resultRef.current;
        const alpha = Math.min(1, timer / 0.25);
        ctx.save();
        ctx.globalAlpha = Math.min(1, alpha + 0.4);
        ctx.textAlign = "center";
        ctx.fillStyle = color;
        const resultSize = Math.max(24, Math.min(40, width * 0.09));
        ctx.font = `900 ${resultSize}px Arial, Helvetica, sans-serif`;
        ctx.fillText(text, width / 2, height * 0.32);
        ctx.fillStyle = "rgba(248, 250, 252, 0.85)";
        ctx.font = `800 ${Math.max(14, resultSize * 0.42)}px Arial, Helvetica, sans-serif`;
        ctx.fillText(sub, width / 2, height * 0.32 + resultSize * 0.85);
        ctx.restore();
      }
    };

    animationRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationRef.current !== null)
        cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
      canvas.removeEventListener("pointerdown", handlePointerDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="sky-drop-root">
      <canvas
        ref={canvasRef}
        className="sky-drop-canvas"
        aria-label="Sky Drop game"
      />
      <style jsx>{`
        .sky-drop-root {
          position: fixed;
          inset: 0;
          width: 100%;
          height: 100dvh;
          overflow: hidden;
          background: #020617;
          touch-action: none;
        }
        .sky-drop-canvas {
          position: fixed;
          inset: 0;
          width: 100dvw !important;
          height: 100dvh !important;
          min-height: 100dvh !important;
        }
      `}</style>
    </div>
  );
};

export default SkyDrop;
