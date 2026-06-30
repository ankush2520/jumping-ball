"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { drawCanvasWatermark } from "@/app/lib/watermark";

// ─── Constants ────────────────────────────────────────────────────────────────

const HUD_DESKTOP     = 142;
const HUD_MOBILE      = 158;
const BALL_RADIUS     = 6;     // all balls start at the same size
const BASE_SPEED      = 170;
const MAX_DT          = 1 / 30;
const SOUND_GAP_MS    = 60;

const BALL_COLORS = [
  { hue: 0   }, // red
  { hue: 120 }, // green
  { hue: 240 }, // blue
];
const BALLS_PER_COLOR = 4;

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "menu" | "playing";

type Circle = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hue: number;
  glow: number;
};

type Arena = {
  x: number;
  y: number;
  size: number;
  W: number;
  H: number;
};

// ─── Canvas / Arena ───────────────────────────────────────────────────────────

function resizeCanvas(canvas: HTMLCanvasElement): { arena: Arena; dpr: number } {
  const dpr    = Math.min(window.devicePixelRatio || 1, 2);
  const W      = Math.round(window.visualViewport?.width  ?? window.innerWidth);
  const H      = Math.round(window.visualViewport?.height ?? window.innerHeight);
  const mobile = W < 600;
  const hudH   = mobile ? HUD_MOBILE : HUD_DESKTOP;
  const pad    = mobile ? 16 : 24;
  const size   = Math.min(W - pad * 2, H - hudH - pad, 620);
  const x      = Math.round((W - size) / 2);
  const y      = hudH;

  canvas.style.width  = `${W}px`;
  canvas.style.height = `${H}px`;
  canvas.width  = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);

  const ctx = canvas.getContext("2d");
  if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(dpr, dpr); }

  return { arena: { x, y, size, W, H }, dpr };
}

// ─── Physics ──────────────────────────────────────────────────────────────────

function spawnCircles(arena: Arena): Circle[] {
  const circles: Circle[] = [];
  let id = 0;
  for (const { hue } of BALL_COLORS) {
    for (let i = 0; i < BALLS_PER_COLOR; i++) {
      const r   = BALL_RADIUS;
      const x   = arena.x + r + Math.random() * (arena.size - r * 2);
      const y   = arena.y + r + Math.random() * (arena.size - r * 2);
      const ang = Math.random() * Math.PI * 2;
      circles.push({ id: id++, x, y, vx: Math.cos(ang) * BASE_SPEED, vy: Math.sin(ang) * BASE_SPEED, r, hue, glow: 0 });
    }
  }
  return circles;
}

// Elastic bounce between two different-color circles
function bounceCirclePair(a: Circle, b: Circle): boolean {
  const dx   = b.x - a.x;
  const dy   = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const min  = a.r + b.r;
  if (dist >= min || dist === 0) return false;

  const overlap = (min - dist) / 2;
  const nx = dx / dist;
  const ny = dy / dist;
  a.x -= nx * overlap;
  a.y -= ny * overlap;
  b.x += nx * overlap;
  b.y += ny * overlap;

  const dvx = b.vx - a.vx;
  const dvy = b.vy - a.vy;
  const dot = dvx * nx + dvy * ny;
  if (dot > 0) return false;

  // Mass proportional to r²
  const ma = a.r * a.r;
  const mb = b.r * b.r;
  const mt = ma + mb;
  const imp = (2 * dot) / (mt / ma + mt / mb);
  a.vx += (imp * mb / mt) * nx;
  a.vy += (imp * mb / mt) * ny;
  b.vx -= (imp * ma / mt) * nx;
  b.vy -= (imp * ma / mt) * ny;

  a.glow = 0.35;
  b.glow = 0.35;
  return true;
}

// ─── Audio ────────────────────────────────────────────────────────────────────

function createAudio() {
  let ac: AudioContext | null = null;
  let lastAt = 0;

  const ensure = () => {
    if (!ac) {
      const w = window as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
      const AC = w.AudioContext || w.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
    }
    if (ac.state === "suspended") void ac.resume();
    return ac;
  };

  const ping = (freq: number, vol = 0.1) => {
    const now = Date.now();
    if (now - lastAt < SOUND_GAP_MS) return;
    lastAt = now;
    const ctx = ensure();
    if (!ctx || ctx.state !== "running") return;
    const t    = ctx.currentTime;
    const osc  = ctx.createOscillator();
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
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  };

  return {
    unlock: () => ensure(),
    wall:   (hue: number) => ping(180 + hue * 0.6, 0.07),
    bounce: (hue: number) => ping(300 + hue * 0.5, 0.10),
    merge:  (hue: number) => ping(500 + hue * 0.4, 0.18),
    dispose: () => { void ac?.close(); ac = null; },
  };
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, W, H);
}

function drawArena(ctx: CanvasRenderingContext2D, arena: Arena, mobile: boolean) {
  const { x, y, size } = arena;

  ctx.save();
  ctx.shadowColor = "rgba(100, 160, 255, 0.32)";
  ctx.shadowBlur  = 20;
  ctx.strokeStyle = "rgba(148, 163, 184, 0.76)";
  ctx.lineWidth   = mobile ? 1.5 : 2;
  ctx.strokeRect(x, y, size, size);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(226, 232, 240, 0.07)";
  ctx.lineWidth   = 1;
  ctx.strokeRect(x + 5, y + 5, size - 10, size - 10);
  ctx.restore();

  ctx.save();
  ctx.textAlign    = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle    = "rgba(241, 245, 249, 0.94)";
  ctx.shadowColor  = "rgba(148, 163, 184, 0.3)";
  ctx.shadowBlur   = 14;
  ctx.font         = `900 ${mobile ? 24 : 36}px Arial, Helvetica, sans-serif`;
  ctx.fillText("COLLIDING SHAPES", x + size / 2, y - (mobile ? 38 : 48));
  ctx.font         = `700 ${mobile ? 10 : 13}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle    = "rgba(248, 250, 252, 0.6)";
  ctx.shadowBlur   = 0;
  ctx.fillText(
    "Same color balls merge — different colors bounce",
    x + size / 2,
    y - (mobile ? 10 : 12),
  );
  ctx.restore();
}

function drawCircles(ctx: CanvasRenderingContext2D, circles: Circle[]) {
  for (const c of circles) {
    const glowing = c.glow > 0;
    ctx.save();
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fillStyle   = `hsl(${c.hue}, 88%, 58%)`;
    ctx.shadowColor = `hsl(${c.hue}, 100%, 68%)`;
    ctx.shadowBlur  = glowing ? c.r * 2.8 : c.r * 1.1;
    ctx.fill();
    // specular highlight
    ctx.beginPath();
    ctx.arc(c.x - c.r * 0.28, c.y - c.r * 0.3, c.r * 0.36, 0, Math.PI * 2);
    ctx.fillStyle  = "rgba(255,255,255,0.22)";
    ctx.shadowBlur = 0;
    ctx.fill();
    ctx.restore();
  }
}

function drawMenuCircles(ctx: CanvasRenderingContext2D, arena: Arena, t: number) {
  const dots = [
    { hue: 0,   ox: 0.2, oy: 0.45 },
    { hue: 0,   ox: 0.35, oy: 0.62 },
    { hue: 120, ox: 0.5, oy: 0.35 },
    { hue: 120, ox: 0.65, oy: 0.58 },
    { hue: 240, ox: 0.8, oy: 0.42 },
    { hue: 240, ox: 0.5, oy: 0.7  },
  ];
  for (let i = 0; i < dots.length; i++) {
    const d  = dots[i];
    const r  = BALL_RADIUS * 1.5;
    const cx = arena.x + d.ox * arena.size;
    const cy = arena.y + d.oy * arena.size + Math.sin(t * 0.4 + i * 1.1) * 18;
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle   = `hsl(${d.hue}, 88%, 58%)`;
    ctx.shadowColor = `hsl(${d.hue}, 100%, 68%)`;
    ctx.shadowBlur  = r * 2;
    ctx.fill();
    ctx.restore();
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

const CollidingShapes = () => {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const arenaRef   = useRef<Arena | null>(null);
  const circlesRef = useRef<Circle[]>([]);
  const rafRef     = useRef<number | null>(null);
  const lastTRef   = useRef<number>(0);
  const audioRef   = useRef(createAudio());
  const phaseRef   = useRef<Phase>("menu");
  const nextIdRef  = useRef(BALLS_PER_COLOR * BALL_COLORS.length);

  const [phase, setPhase] = useState<Phase>("menu");

  const setup = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { arena } = resizeCanvas(canvas);
    arenaRef.current = arena;
    if (phaseRef.current === "playing") {
      nextIdRef.current  = BALLS_PER_COLOR * BALL_COLORS.length;
      circlesRef.current = spawnCircles(arena);
    }
  }, []);

  const startGame = useCallback(() => {
    audioRef.current.unlock();
    phaseRef.current   = "playing";
    nextIdRef.current  = BALLS_PER_COLOR * BALL_COLORS.length;
    setPhase("playing");
    const canvas = canvasRef.current;
    if (canvas) {
      const { arena } = resizeCanvas(canvas);
      arenaRef.current   = arena;
      circlesRef.current = spawnCircles(arena);
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
      const dt   = Math.min((now - lastTRef.current) / 1000, MAX_DT);
      lastTRef.current = now;

      const canvas = canvasRef.current;
      const arena  = arenaRef.current;
      const ctx    = canvas?.getContext("2d");
      if (!ctx || !arena) { rafRef.current = requestAnimationFrame(tick); return; }

      const { W, H } = arena;
      const mobile   = W < 600;

      drawBackground(ctx, W, H);
      drawCanvasWatermark(ctx, W, H);
      drawArena(ctx, arena, mobile);

      if (phaseRef.current === "menu") {
        drawMenuCircles(ctx, arena, now / 1000);
      } else {
        const circles = circlesRef.current;
        const right   = arena.x + arena.size;
        const bottom  = arena.y + arena.size;

        // ── Move + wall bounce ─────────────────────────────────────────────
        for (const c of circles) {
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          if (c.glow > 0) c.glow -= dt;

          if (c.x - c.r < arena.x) { c.x = arena.x + c.r; c.vx =  Math.abs(c.vx); audio.wall(c.hue); }
          if (c.x + c.r > right)   { c.x = right  - c.r;  c.vx = -Math.abs(c.vx); audio.wall(c.hue); }
          if (c.y - c.r < arena.y) { c.y = arena.y + c.r; c.vy =  Math.abs(c.vy); audio.wall(c.hue); }
          if (c.y + c.r > bottom)  { c.y = bottom  - c.r; c.vy = -Math.abs(c.vy); audio.wall(c.hue); }
        }

        // ── Collision: merge same-color, bounce different-color ────────────
        const toRemove = new Set<number>();
        const toAdd: Circle[] = [];

        for (let i = 0; i < circles.length; i++) {
          for (let j = i + 1; j < circles.length; j++) {
            const a = circles[i];
            const b = circles[j];
            if (toRemove.has(a.id) || toRemove.has(b.id)) continue;

            const dx   = b.x - a.x;
            const dy   = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            if (dist >= a.r + b.r || dist === 0) continue;

            if (a.hue === b.hue) {
              // ── Merge ───────────────────────────────────────────────────
              const ma = a.r * a.r;
              const mb = b.r * b.r;
              const mt = ma + mb;
              // Position at mass-weighted centre
              const mx = (a.x * ma + b.x * mb) / mt;
              const my = (a.y * ma + b.y * mb) / mt;
              // Momentum-conserving velocity
              const mvx = (a.vx * ma + b.vx * mb) / mt;
              const mvy = (a.vy * ma + b.vy * mb) / mt;
              // New radius = sum of radii (doubles when equal)
              const nr  = a.r + b.r;

              toRemove.add(a.id);
              toRemove.add(b.id);
              toAdd.push({
                id:   nextIdRef.current++,
                x:    mx,
                y:    my,
                vx:   mvx,
                vy:   mvy,
                r:    nr,
                hue:  a.hue,
                glow: 0.8,
              });
              audio.merge(a.hue);
            } else {
              // ── Elastic bounce ──────────────────────────────────────────
              if (bounceCirclePair(a, b)) {
                audio.bounce((a.hue + b.hue) / 2);
              }
            }
          }
        }

        if (toRemove.size > 0) {
          circlesRef.current = circles.filter(c => !toRemove.has(c.id)).concat(toAdd);
        }

        drawCircles(ctx, circlesRef.current);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    lastTRef.current = performance.now();
    rafRef.current   = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      audio.dispose();
    };
  }, []);

  return (
    <div className="cs-root">
      <canvas ref={canvasRef} className="cs-canvas" />

      {phase === "menu" && (
        <div className="cs-menu">
          <p className="cs-menu-sub">Same color balls merge · Different colors bounce</p>
          <button type="button" className="cs-play-btn" onClick={startGame}>
            PLAY
          </button>
        </div>
      )}

      <style jsx>{`
        .cs-root {
          position: relative;
          width: 100%;
          height: 100dvh;
          min-height: 100dvh;
          overflow: hidden;
          background: #020617;
          color: #f8fafc;
        }

        .cs-canvas {
          position: absolute;
          inset: 0;
          width: 100% !important;
          height: 100dvh !important;
          min-height: 100dvh !important;
        }

        .cs-menu {
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

        .cs-menu-sub {
          margin: 0;
          font-family: Arial, Helvetica, sans-serif;
          font-size: clamp(0.7rem, 2.2vw, 0.9rem);
          font-weight: 600;
          color: rgba(248, 250, 252, 0.52);
          letter-spacing: 0.05em;
          text-align: center;
        }

        .cs-play-btn {
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
          transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
        }

        .cs-play-btn:hover {
          background: rgba(22, 78, 160, 0.68);
          box-shadow: 0 0 40px rgba(60, 130, 255, 0.36);
          transform: scale(1.05);
        }

        .cs-play-btn:active {
          transform: scale(0.97);
        }
      `}</style>
    </div>
  );
};

export default CollidingShapes;
