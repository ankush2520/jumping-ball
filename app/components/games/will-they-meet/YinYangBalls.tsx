"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { drawCanvasWatermark } from "@/app/lib/watermark";

// ─── Constants ────────────────────────────────────────────────────────────────

const HUD_DESKTOP = 148;
const HUD_MOBILE = 168;
const BASE_SPEED = 150;
const MAX_DT = 1 / 30;
const SOUND_GAP_MS = 60;
const RESET_DELAY_MS = 2600;
const INK = "#0f172a";
const PAPER = "#f8fafc";
const PLAIN = "#94a3b8";
const LINE = "rgba(148, 163, 184, 0.55)";
const WALL_THICKNESS_RATIO = 0.016;

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "menu" | "playing";
type BallKind = "yin" | "yang" | "full";

type Ball = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  kind: BallKind;
  glow: number;
};

type Arena = {
  x: number;
  y: number;
  size: number;
  W: number;
  H: number;
};

type WallSeg = { x1: number; y1: number; x2: number; y2: number };

// ─── Canvas / Arena ───────────────────────────────────────────────────────────

function resizeCanvas(canvas: HTMLCanvasElement): { arena: Arena } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(window.visualViewport?.width ?? window.innerWidth);
  const H = Math.round(window.visualViewport?.height ?? window.innerHeight);
  const mobile = W < 600;
  const hudH = mobile ? HUD_MOBILE : HUD_DESKTOP;
  const pad = mobile ? 16 : 24;
  const size = Math.min(W - pad * 2, H - hudH - pad, 600);
  const x = Math.round((W - size) / 2);
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

  return { arena: { x, y, size, W, H } };
}

// ─── Physics ──────────────────────────────────────────────────────────────────

function randomVelocity(speed: number) {
  const angle = Math.random() * Math.PI * 2;
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

function spawnBalls(arena: Arena): Ball[] {
  const r = arena.size * 0.0325;
  const margin = r * 1.6;
  const half = arena.size * 0.5 - margin * 2;

  // yin spawns walled off in the top-left room, yang in the bottom-right room —
  // they have to find the gaps in the maze walls to reach each other
  const tlX = arena.x + margin + Math.random() * half;
  const tlY = arena.y + margin + Math.random() * half;
  const brX = arena.x + arena.size * 0.5 + margin + Math.random() * half;
  const brY = arena.y + arena.size * 0.5 + margin + Math.random() * half;

  const v1 = randomVelocity(BASE_SPEED);
  const v2 = randomVelocity(BASE_SPEED);

  return [
    { x: tlX, y: tlY, vx: v1.vx, vy: v1.vy, r, kind: "yin", glow: 0 },
    { x: brX, y: brY, vx: v2.vx, vy: v2.vy, r, kind: "yang", glow: 0 },
  ];
}

// ─── Maze walls ───────────────────────────────────────────────────────────────

function getWallSegments(arena: Arena): WallSeg[] {
  const { x, y, size } = arena;
  const vx = x + size * 0.5;
  const hy = y + size * 0.5;

  return [
    // vertical divider, small open gap through the middle
    { x1: vx, y1: y, x2: vx, y2: y + size * 0.46 },
    { x1: vx, y1: y + size * 0.54, x2: vx, y2: y + size },
    // horizontal divider, small open gap on the left
    { x1: x, y1: hy, x2: x + size * 0.16, y2: hy },
    { x1: x + size * 0.24, y1: hy, x2: x + size, y2: hy },
  ];
}

function resolveWallSegCollisions(
  ball: Ball,
  segs: WallSeg[],
  halfThickness: number,
  onHit: () => void,
) {
  for (const seg of segs) {
    const rx = Math.min(seg.x1, seg.x2) - halfThickness;
    const ry = Math.min(seg.y1, seg.y2) - halfThickness;
    const rw = Math.abs(seg.x2 - seg.x1) + halfThickness * 2;
    const rh = Math.abs(seg.y2 - seg.y1) + halfThickness * 2;

    const closestX = Math.min(Math.max(ball.x, rx), rx + rw);
    const closestY = Math.min(Math.max(ball.y, ry), ry + rh);
    const dx = ball.x - closestX;
    const dy = ball.y - closestY;
    const distSq = dx * dx + dy * dy;
    if (distSq >= ball.r * ball.r) continue;

    const dist = Math.sqrt(distSq);
    let nx: number;
    let ny: number;
    if (dist > 0.0001) {
      nx = dx / dist;
      ny = dy / dist;
    } else {
      const overlapX = rw / 2 - Math.abs(ball.x - (rx + rw / 2));
      const overlapY = rh / 2 - Math.abs(ball.y - (ry + rh / 2));
      if (overlapX < overlapY) {
        nx = ball.x < rx + rw / 2 ? -1 : 1;
        ny = 0;
      } else {
        nx = 0;
        ny = ball.y < ry + rh / 2 ? -1 : 1;
      }
    }

    const overlap = ball.r - dist;
    ball.x += nx * overlap;
    ball.y += ny * overlap;

    const vDotN = ball.vx * nx + ball.vy * ny;
    if (vDotN < 0) {
      ball.vx -= 2 * vDotN * nx;
      ball.vy -= 2 * vDotN * ny;
    }
    onHit();
  }
}

function drawWalls(ctx: CanvasRenderingContext2D, arena: Arena, mobile: boolean) {
  const segs = getWallSegments(arena);
  ctx.save();
  ctx.shadowColor = "rgba(148, 163, 184, 0.32)";
  ctx.shadowBlur = mobile ? 8 : 12;
  ctx.strokeStyle = "rgba(148, 163, 184, 0.75)";
  ctx.lineWidth = mobile ? 2.5 : 3.5;
  ctx.lineCap = "round";
  for (const seg of segs) {
    ctx.beginPath();
    ctx.moveTo(seg.x1, seg.y1);
    ctx.lineTo(seg.x2, seg.y2);
    ctx.stroke();
  }
  ctx.restore();
}

// ─── Audio ────────────────────────────────────────────────────────────────────

function createAudio() {
  let ac: AudioContext | null = null;
  let lastAt = 0;

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

  const ping = (freq: number, duration: number, vol: number) => {
    const now = Date.now();
    if (now - lastAt < SOUND_GAP_MS) return;
    lastAt = now;
    const ctx = ensure();
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.03);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  };

  const meet = () => {
    const ctx = ensure();
    if (!ctx || ctx.state !== "running") return;
    [440, 660, 880].forEach((freq, i) => {
      window.setTimeout(() => ping(freq, 0.3, 0.14), i * 70);
    });
  };

  return {
    unlock: () => ensure(),
    wall: () => ping(220, 0.18, 0.08),
    meet,
    dispose: () => {
      void ac?.close();
      ac = null;
    },
  };
}

// ─── Drawing: Yin-Yang ────────────────────────────────────────────────────────

function paintTaijitu(
  ctx: CanvasRenderingContext2D,
  r: number,
  glow: number,
  kind: BallKind,
) {
  ctx.save();
  ctx.shadowColor = `rgba(226, 232, 240, ${0.35 + glow * 0.5})`;
  ctx.shadowBlur = r * (0.3 + glow * 0.7);

  // full circle, always fully round — plain gray base for whatever isn't inked yet
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = PLAIN;
  ctx.fill();

  ctx.shadowBlur = 0;

  // the classic S-curve comma shape (one natural half of the swirl, not a straight cut)
  const comma = new Path2D();
  comma.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
  comma.arc(0, -r / 2, r / 2, Math.PI / 2, -Math.PI / 2, true);
  comma.arc(0, r / 2, r / 2, Math.PI / 2, -Math.PI / 2, false);
  comma.closePath();

  if (kind !== "full") {
    // faint divider so the plain half still hints at the missing swirl
    ctx.save();
    ctx.strokeStyle = LINE;
    ctx.lineWidth = Math.max(1, r * 0.025);
    ctx.stroke(comma);
    ctx.restore();
  }

  const yinActive = kind === "yin" || kind === "full";
  const yangActive = kind === "yang" || kind === "full";

  if (yinActive) {
    // ink the region OPPOSITE the comma path (the upper-dominant kidney) —
    // filling the comma directly leaves ink in the lower half, which is backwards
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
    // restore the comma region: true white if it's also active (full), else stays plain gray
    ctx.fillStyle = yangActive ? PAPER : PLAIN;
    ctx.fill(comma);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(0, -r / 2, r / 8, 0, Math.PI * 2);
    ctx.fillStyle = PAPER;
    ctx.fill();
  } else if (yangActive) {
    // yin side never touched this circle, so the comma region is still plain gray — paint it true white
    ctx.fillStyle = PAPER;
    ctx.fill(comma);
  }

  if (yangActive) {
    ctx.beginPath();
    ctx.arc(0, r / 2, r / 8, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1.5, r * 0.03);
  ctx.stroke();

  ctx.restore();
}

function drawBall(ctx: CanvasRenderingContext2D, ball: Ball) {
  ctx.save();
  ctx.translate(ball.x, ball.y);
  paintTaijitu(ctx, ball.r, ball.glow, ball.kind);
  ctx.restore();
}

// ─── Drawing: Arena / Title ───────────────────────────────────────────────────

function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, W, H);
}

function drawArena(
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  mobile: boolean,
  meetings: number,
) {
  const { x, y, size } = arena;

  ctx.save();
  ctx.shadowColor = "rgba(148, 163, 184, 0.32)";
  ctx.shadowBlur = 20;
  ctx.strokeStyle = "rgba(148, 163, 184, 0.78)";
  ctx.lineWidth = mobile ? 1.5 : 2;
  ctx.strokeRect(x, y, size, size);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(226, 232, 240, 0.07)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 5, y + 5, size - 10, size - 10);
  ctx.restore();

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "#f8fafc";
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = mobile ? 6 : 8;
  ctx.font = `900 ${mobile ? 22 : 32}px Arial, Helvetica, sans-serif`;
  const cx = x + size / 2;
  ctx.fillText("Will these two balls", cx, y - (mobile ? 62 : 84));
  ctx.fillText("ever meet?", cx, y - (mobile ? 38 : 48));

  ctx.font = `700 ${mobile ? 12 : 14}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = "rgba(248, 250, 252, 0.68)";
  ctx.shadowBlur = 0;
  ctx.fillText("When yin meets yang, they become whole", cx, y - 14);
  ctx.restore();

  if (meetings > 0) {
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = `800 ${mobile ? 11 : 12}px Arial, Helvetica, sans-serif`;
    ctx.fillStyle = "rgba(248, 250, 252, 0.55)";
    ctx.fillText(
      `MEETINGS: ${meetings}`,
      x + 4,
      y + size + (mobile ? 10 : 14),
    );
    ctx.restore();
  }
}

function drawMenuPreview(ctx: CanvasRenderingContext2D, arena: Arena, t: number) {
  const r = arena.size * 0.075;
  const wobble = Math.sin(t * 0.9) * arena.size * 0.07;
  const cx = arena.x + arena.size / 2;
  const cy = arena.y + arena.size / 2;
  const gap = r * 1.5;

  drawBall(ctx, {
    x: cx - gap - wobble * 0.3,
    y: cy,
    vx: 0,
    vy: 0,
    r,
    kind: "yin",
    glow: 0,
  });
  drawBall(ctx, {
    x: cx + gap + wobble * 0.3,
    y: cy,
    vx: 0,
    vy: 0,
    r,
    kind: "yang",
    glow: 0,
  });
}

function drawMeetFlash(
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  mobile: boolean,
  progress: number,
) {
  const alpha = Math.sin(Math.min(progress, 1) * Math.PI);
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f8fafc";
  ctx.shadowColor = "rgba(226, 232, 240, 0.8)";
  ctx.shadowBlur = 18;
  ctx.font = `900 ${mobile ? 20 : 28}px Arial, Helvetica, sans-serif`;
  ctx.fillText(
    "THEY MET!",
    arena.x + arena.size / 2,
    arena.y + arena.size + (mobile ? 34 : 44),
  );
  ctx.restore();
}

// ─── Component ────────────────────────────────────────────────────────────────

const YinYangBalls = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<Arena | null>(null);
  const ballsRef = useRef<Ball[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTRef = useRef<number>(0);
  const audioRef = useRef(createAudio());
  const phaseRef = useRef<Phase>("menu");
  const meetingsRef = useRef(0);
  const metAtRef = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>("menu");

  const setup = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { arena } = resizeCanvas(canvas);
    arenaRef.current = arena;
    if (phaseRef.current === "playing" && ballsRef.current.length === 0) {
      ballsRef.current = spawnBalls(arena);
    }
  }, []);

  const startGame = useCallback(() => {
    audioRef.current.unlock();
    phaseRef.current = "playing";
    meetingsRef.current = 0;
    metAtRef.current = null;
    setPhase("playing");
    const canvas = canvasRef.current;
    if (canvas) {
      const { arena } = resizeCanvas(canvas);
      arenaRef.current = arena;
      ballsRef.current = spawnBalls(arena);
    }
  }, []);

  useEffect(() => {
    setup();
    window.addEventListener("resize", setup);
    window.visualViewport?.addEventListener("resize", setup);
    return () => {
      window.removeEventListener("resize", setup);
      window.visualViewport?.removeEventListener("resize", setup);
    };
  }, [setup]);

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

      drawBackground(ctx, W, H);
      drawCanvasWatermark(ctx, W, H);
      drawArena(ctx, arena, mobile, meetingsRef.current);
      drawWalls(ctx, arena, mobile);

      if (phaseRef.current === "menu") {
        drawMenuPreview(ctx, arena, now / 1000);
      } else {
        const balls = ballsRef.current;
        const right = arena.x + arena.size;
        const bottom = arena.y + arena.size;
        const wallSegs = getWallSegments(arena);
        const wallHalfThickness = arena.size * WALL_THICKNESS_RATIO;

        for (const b of balls) {
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          if (b.glow > 0) b.glow = Math.max(0, b.glow - dt * 1.4);

          if (b.x - b.r < arena.x) {
            b.x = arena.x + b.r;
            b.vx = Math.abs(b.vx);
            audio.wall();
          }
          if (b.x + b.r > right) {
            b.x = right - b.r;
            b.vx = -Math.abs(b.vx);
            audio.wall();
          }
          if (b.y - b.r < arena.y) {
            b.y = arena.y + b.r;
            b.vy = Math.abs(b.vy);
            audio.wall();
          }
          if (b.y + b.r > bottom) {
            b.y = bottom - b.r;
            b.vy = -Math.abs(b.vy);
            audio.wall();
          }

          resolveWallSegCollisions(b, wallSegs, wallHalfThickness, () =>
            audio.wall(),
          );
        }

        if (balls.length === 2) {
          const [a, b] = balls;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);

          if (dist < a.r + b.r) {
            const mr = Math.max(a.r, b.r) * 1.22;
            const mvx = (a.vx + b.vx) / 2;
            const mvy = (a.vy + b.vy) / 2;
            const speed = Math.hypot(mvx, mvy) || BASE_SPEED;
            const nx = (mvx / speed) * BASE_SPEED;
            const ny = (mvy / speed) * BASE_SPEED;
            const mx = Math.min(
              Math.max((a.x + b.x) / 2, arena.x + mr),
              arena.x + arena.size - mr,
            );
            const my = Math.min(
              Math.max((a.y + b.y) / 2, arena.y + mr),
              arena.y + arena.size - mr,
            );

            ballsRef.current = [
              { x: mx, y: my, vx: nx, vy: ny, r: mr, kind: "full", glow: 1 },
            ];
            meetingsRef.current += 1;
            metAtRef.current = now;
            audio.meet();
          }
        } else if (balls.length === 1 && metAtRef.current !== null) {
          if (now - metAtRef.current > RESET_DELAY_MS) {
            ballsRef.current = spawnBalls(arena);
            metAtRef.current = null;
          }
        }

        for (const b of ballsRef.current) drawBall(ctx, b);

        if (metAtRef.current !== null) {
          drawMeetFlash(ctx, arena, mobile, (now - metAtRef.current) / 900);
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
    <div className="yy-root">
      <canvas ref={canvasRef} className="yy-canvas" />

      {phase === "menu" && (
        <div className="yy-menu">
          <p className="yy-menu-sub">
            Two halves bounce and search for each other
          </p>
          <button type="button" className="yy-play-btn" onClick={startGame}>
            PLAY
          </button>
        </div>
      )}

      <style jsx>{`
        .yy-root {
          position: relative;
          width: 100%;
          height: 100dvh;
          min-height: 100dvh;
          overflow: hidden;
          background: #020617;
          color: #f8fafc;
        }

        .yy-canvas {
          position: absolute;
          inset: 0;
          width: 100% !important;
          height: 100dvh !important;
          min-height: 100dvh !important;
        }

        .yy-menu {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 20px;
          pointer-events: none;
          padding: 0 24px;
        }

        .yy-menu-sub {
          margin: 0;
          font-family: Arial, Helvetica, sans-serif;
          font-size: clamp(0.7rem, 2.2vw, 0.9rem);
          font-weight: 600;
          color: rgba(248, 250, 252, 0.55);
          letter-spacing: 0.05em;
          text-align: center;
        }

        .yy-play-btn {
          pointer-events: all;
          padding: 13px 52px;
          border: 1px solid rgba(203, 213, 225, 0.5);
          border-radius: 12px;
          background: rgba(30, 41, 59, 0.55);
          color: #f8fafc;
          font-family: Arial, Helvetica, sans-serif;
          font-size: clamp(0.95rem, 2.5vw, 1.1rem);
          font-weight: 900;
          letter-spacing: 0.18em;
          cursor: pointer;
          backdrop-filter: blur(10px);
          box-shadow: 0 0 28px rgba(148, 163, 184, 0.18);
          transition:
            transform 0.2s,
            box-shadow 0.2s,
            background 0.2s;
        }

        .yy-play-btn:hover {
          background: rgba(51, 65, 85, 0.7);
          box-shadow: 0 0 40px rgba(148, 163, 184, 0.32);
          transform: scale(1.05);
        }

        .yy-play-btn:active {
          transform: scale(0.97);
        }
      `}</style>
    </div>
  );
};

export default YinYangBalls;
