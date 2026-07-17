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
const SWING_DAMPING = 0.35; // rad/s of angular velocity lost per second
const RESULT_HOLD_S = 1.15; // how long PERFECT!/MISSED! stays on screen

type Phase = "swing" | "falling" | "result";

type Layout = {
  width: number;
  height: number;
  planeY: number;
  ropeLength: number;
  groundY: number;
  gravity: number; // px/s²
  pieceSize: number;
  targetWidth: number;
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
    gravity: height * 2.2,
    pieceSize: Math.max(26, Math.min(46, width * 0.09)),
    targetWidth: Math.max(46, Math.min(92, width * 0.18)),
    planeSpeed: Math.max(90, width * 0.15),
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

const SkyDrop = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const starsRef = useRef<Star[]>([]);
  const lastTimeRef = useRef<number>(0);

  const phaseRef = useRef<Phase>("swing");
  const resultRef = useRef<{ text: string; color: string; timer: number }>({
    text: "",
    color: "#ffffff",
    timer: 0,
  });
  const scoreRef = useRef({ hits: 0, attempts: 0 });
  const particlesRef = useRef<Particle[]>([]);

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

  const resetRound = () => {
    const layout = layoutRef.current;
    if (!layout) return;

    const dir = Math.random() < 0.5 ? 1 : -1;
    planeRef.current = {
      x: dir > 0 ? SIDE_PAD : layout.width - SIDE_PAD,
      vx: layout.planeSpeed * dir,
    };
    ropeRef.current = { theta: (Math.random() - 0.5) * 0.55, thetaDot: 0 };
    targetRef.current = {
      x:
        layout.targetWidth +
        Math.random() * (layout.width - layout.targetWidth * 2),
    };
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

    const { theta, thetaDot } = ropeRef.current;
    const plane = planeRef.current;
    const vx = plane.vx + layout.ropeLength * thetaDot * Math.cos(theta);
    const vy = -layout.ropeLength * thetaDot * Math.sin(theta);
    pieceRef.current.vx = vx;
    pieceRef.current.vy = vy;
    pieceRef.current.rotationSpeed = Math.max(-6, Math.min(6, vx * 0.02));
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

      const dt = Math.min(1 / 30, Math.max(0, (now - lastTimeRef.current) / 1000));
      lastTimeRef.current = now;

      const { width, planeY, ropeLength, groundY, gravity, pieceSize, targetWidth } = layout;
      const plane = planeRef.current;
      const piece = pieceRef.current;
      const target = targetRef.current;

      // Plane ping-pongs between the two side margins.
      plane.x += plane.vx * dt;
      if (plane.x > width - SIDE_PAD) {
        plane.x = width - SIDE_PAD;
        plane.vx = -Math.abs(plane.vx);
      } else if (plane.x < SIDE_PAD) {
        plane.x = SIDE_PAD;
        plane.vx = Math.abs(plane.vx);
      }

      if (phaseRef.current === "swing") {
        const rope = ropeRef.current;
        const thetaDotDot =
          -(gravity / ropeLength) * Math.sin(rope.theta) -
          SWING_DAMPING * rope.thetaDot;
        rope.thetaDot += thetaDotDot * dt;
        rope.theta += rope.thetaDot * dt;
        piece.x = plane.x + ropeLength * Math.sin(rope.theta);
        piece.y = planeY + ropeLength * Math.cos(rope.theta);
      } else if (phaseRef.current === "falling") {
        piece.vy += gravity * dt;
        piece.x += piece.vx * dt;
        piece.y += piece.vy * dt;
        piece.rotation += piece.rotationSpeed * dt;

        const pieceHalf = pieceSize / 2;
        if (piece.y + pieceHalf >= groundY) {
          piece.y = groundY - pieceHalf;
          const left = Math.max(piece.x - pieceHalf, target.x - targetWidth / 2);
          const right = Math.min(piece.x + pieceHalf, target.x + targetWidth / 2);
          const overlap = Math.max(0, right - left);
          const success = overlap >= pieceHalf;

          scoreRef.current.attempts += 1;
          if (success) scoreRef.current.hits += 1;
          resultRef.current = {
            text: success ? "PERFECT!" : "MISSED!",
            color: success ? "#4ade80" : "#f87171",
            timer: RESULT_HOLD_S,
          };
          spawnBurst(
            piece.x,
            groundY,
            success ? "#4ade80" : "#94a3b8",
            success ? 26 : 14,
          );
          phaseRef.current = "result";
        }
      } else if (phaseRef.current === "result") {
        resultRef.current.timer -= dt;
        if (resultRef.current.timer <= 0) resetRound();
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
      const { width, height, planeY, groundY, pieceSize, targetWidth } = layout;

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

      // Target slot
      const { x: targetX } = targetRef.current;
      ctx.save();
      const pulse = 0.55 + 0.35 * Math.sin(t * 4);
      ctx.strokeStyle = `rgba(250, 204, 21, ${pulse})`;
      ctx.shadowColor = "rgba(250, 204, 21, 0.65)";
      ctx.shadowBlur = 14;
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(
        targetX - targetWidth / 2,
        groundY - 10,
        targetWidth,
        20,
      );
      ctx.restore();

      // Rope + plane (only while attached)
      const plane = planeRef.current;
      const piece = pieceRef.current;
      if (phaseRef.current === "swing") {
        ctx.save();
        ctx.strokeStyle = "rgba(226, 232, 240, 0.75)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(plane.x, planeY + 6);
        ctx.lineTo(piece.x, piece.y);
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

      // Piece (glowing rounded square)
      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.rotation);
      const half = pieceSize / 2;
      const grad = ctx.createLinearGradient(-half, -half, half, half);
      grad.addColorStop(0, "#fde68a");
      grad.addColorStop(0.5, "#f59e0b");
      grad.addColorStop(1, "#fb923c");
      ctx.fillStyle = grad;
      ctx.shadowColor = "rgba(245, 158, 11, 0.7)";
      ctx.shadowBlur = 16;
      const r = pieceSize * 0.18;
      ctx.beginPath();
      ctx.moveTo(-half + r, -half);
      ctx.arcTo(half, -half, half, half, r);
      ctx.arcTo(half, half, -half, half, r);
      ctx.arcTo(-half, half, -half, -half, r);
      ctx.arcTo(-half, -half, half, -half, r);
      ctx.closePath();
      ctx.fill();
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
        "Tap the screen to release the piece onto the target",
        width / 2,
        Math.max(30, height * 0.055) + titleSize * 0.85,
      );

      // Score
      const { hits, attempts } = scoreRef.current;
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(226, 246, 255, 0.85)";
      const scoreSize = Math.max(14, Math.min(18, width * 0.032));
      ctx.font = `800 ${scoreSize}px Arial, Helvetica, sans-serif`;
      ctx.fillText(`${hits} / ${attempts}`, width - 18, 24);

      // Result banner
      if (phaseRef.current === "result" && resultRef.current.timer > 0) {
        const { text, color, timer } = resultRef.current;
        const alpha = Math.min(1, timer / 0.25);
        ctx.save();
        ctx.globalAlpha = Math.min(1, alpha + 0.4);
        ctx.textAlign = "center";
        ctx.fillStyle = color;
        const resultSize = Math.max(24, Math.min(40, width * 0.09));
        ctx.font = `900 ${resultSize}px Arial, Helvetica, sans-serif`;
        ctx.fillText(text, width / 2, height * 0.32);
        ctx.restore();
      }
    };

    animationRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
      canvas.removeEventListener("pointerdown", handlePointerDown);
    };
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
