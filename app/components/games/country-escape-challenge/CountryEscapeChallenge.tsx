"use client";

import { useEffect, useRef, useState } from "react";
import { drawCanvasWatermark } from "@/app/lib/watermark";

// ─── Types ────────────────────────────────────────────────────────────────────

type Arena = { cx: number; cy: number; radius: number; W: number; H: number };
type Ball  = { x: number; y: number; vx: number; vy: number; r: number; hue: number };
type Phase = "idle" | "running" | "gameover";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_DT          = 1 / 30;
const SPEED_RATIO     = 1.65;
const INIT_R_RATIO    = 0.0092;
const GROWTH_RATE     = 0.011;   // fraction of original arena radius / sec
const SHRINK_RATE     = 0.0055;  // proportional to growth (50% of growth rate)
const HUE_RATE        = 38;      // degrees / sec


const PIANO_NOTES = [
  261.63, 293.66, 329.63, 349.23, 392.0,
  440.0,  493.88, 523.25, 587.33, 659.25,
  698.46, 783.99, 880.0,  987.77, 1046.5,
];

let _sharedAudioCtx: AudioContext | null = null;

// ─── Audio ────────────────────────────────────────────────────────────────────

function createAudio() {
  let ac: AudioContext | null = null;
  let master: GainNode | null = null;
  let noteIdx = 0;

  const ensure = () => {
    if (ac) { if (ac.state === "suspended") ac.resume().catch(() => {}); return ac; }
    const w = window as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const AC = w.AudioContext || w.webkitAudioContext;
    if (!AC) return null;
    if (_sharedAudioCtx?.state === "closed") _sharedAudioCtx = null;
    _sharedAudioCtx = _sharedAudioCtx || new AC();
    ac = _sharedAudioCtx;
    master = ac.createGain();
    master.gain.value = 0.28;
    master.connect(ac.destination);
    return ac;
  };

  const onVis = () => { if (!document.hidden && ac?.state === "suspended") ac.resume().catch(() => {}); };
  document.addEventListener("visibilitychange", onVis);

  const piano = (freq: number) => {
    const ctx = ensure();
    if (!ctx || ctx.state !== "running" || !master) return;
    const now = ctx.currentTime;
    const out  = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.setValueAtTime(3200, now);
    filt.frequency.exponentialRampToValueAtTime(1100, now + 0.55);
    out.gain.setValueAtTime(0.0001, now);
    out.gain.linearRampToValueAtTime(0.38, now + 0.009);
    out.gain.exponentialRampToValueAtTime(0.13, now + 0.09);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
    out.connect(filt); filt.connect(master);
    ([
      { ratio: 1, g: 0.14, t: "triangle" as OscillatorType },
      { ratio: 2, g: 0.052, t: "sine" as OscillatorType },
      { ratio: 3, g: 0.018, t: "sine" as OscillatorType },
    ] as const).forEach(({ ratio, g, t }) => {
      const osc = ctx.createOscillator();
      const gn  = ctx.createGain();
      osc.type = t;
      osc.frequency.setValueAtTime(freq * ratio, now);
      gn.gain.setValueAtTime(g, now);
      gn.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
      osc.connect(gn); gn.connect(out);
      osc.start(now); osc.stop(now + 0.75);
      osc.onended = () => { osc.disconnect(); gn.disconnect(); };
    });
    window.setTimeout(() => { out.disconnect(); filt.disconnect(); }, 900);
  };

  return {
    unlock:  async () => { const c = ensure(); if (c?.state === "suspended") await c.resume(); },
    bounce:  ()       => { piano(PIANO_NOTES[noteIdx % PIANO_NOTES.length]); noteIdx++; },
    dispose: ()       => {
      document.removeEventListener("visibilitychange", onVis);
      master?.disconnect(); master = null; ac = null;
    },
  };
}

// ─── Canvas resize ────────────────────────────────────────────────────────────

function resizeCanvas(canvas: HTMLCanvasElement): { arena: Arena; dpr: number } {
  const dpr    = Math.min(window.devicePixelRatio || 1, 2);
  const W      = window.innerWidth;
  const H      = window.innerHeight;
  const ctx    = canvas.getContext("2d");
  const mobile = W < 600;
  const headH  = mobile ? 120 : 100;
  const pad    = mobile ? 24 : 40;
  const avail  = Math.min(W - pad * 2, H - headH - 20);
  const r      = Math.max(100, Math.min(avail, 560)) / 2;
  const cx     = W / 2;
  const cy     = headH + (H - headH) / 2;
  canvas.style.width  = `${W}px`;
  canvas.style.height = `${H}px`;
  canvas.width  = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(dpr, dpr); ctx.imageSmoothingEnabled = true; }
  return { arena: { cx, cy, radius: r, W, H }, dpr };
}

// ─── Trail canvas helpers ─────────────────────────────────────────────────────

// Prepare (or clear) the offscreen trail canvas to match the main canvas dimensions.
function initTrailCanvas(tc: HTMLCanvasElement, arena: Arena, dpr: number) {
  tc.width  = Math.floor(arena.W * dpr);
  tc.height = Math.floor(arena.H * dpr);
  const tctx = tc.getContext("2d");
  if (tctx) {
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.scale(dpr, dpr);
    tctx.clearRect(0, 0, arena.W, arena.H);
  }
}

// Burn one disc into the offscreen trail canvas.
// Each disc is a copy of the ball: dark fill + thin coloured edge accent.
function burnRing(tc: HTMLCanvasElement, x: number, y: number, r: number, hue: number) {
  const tctx = tc.getContext("2d");
  if (!tctx) return;

  // Solid dark disc (the "body" of the worm segment)
  tctx.beginPath();
  tctx.arc(x, y, r, 0, Math.PI * 2);
  tctx.fillStyle = "#020617";
  tctx.fill();

  // Thin coloured accent ring on the edge (≤8% of radius)
  tctx.beginPath();
  tctx.arc(x, y, r, 0, Math.PI * 2);
  tctx.strokeStyle = `hsl(${hue}, 100%, 62%)`;
  tctx.lineWidth   = Math.max(1.5, r * 0.08);
  tctx.stroke();
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function drawFrame(
  ctx:        CanvasRenderingContext2D,
  arena:      Arena,
  trailCanvas: HTMLCanvasElement,
  bR:         number,
  ball:       Ball,
) {
  const { cx, cy, W, H } = arena;

  // Background
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, W, H);
  drawCanvasWatermark(ctx, W, H);

  // Blit the persistent trail canvas clipped to the circle so nothing leaks outside
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, bR - 1, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(trailCanvas, 0, 0, W, H);
  ctx.restore();

  // Circular boundary
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, bR, 0, Math.PI * 2);
  ctx.strokeStyle = `hsl(${ball.hue}, 88%, 65%)`;
  ctx.lineWidth   = 1.6;
  ctx.shadowColor = `hsl(${ball.hue}, 100%, 72%)`;
  ctx.shadowBlur  = 20;
  ctx.stroke();
  ctx.restore();

  // Ball
  ctx.save();
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  ctx.fillStyle   = `hsl(${ball.hue}, 100%, 60%)`;
  ctx.shadowColor = `hsl(${ball.hue}, 100%, 70%)`;
  ctx.shadowBlur  = ball.r * 1.8;
  ctx.fill();
  ctx.restore();

  // Inner highlight
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.beginPath();
  ctx.arc(ball.x - ball.r * 0.27, ball.y - ball.r * 0.27, ball.r * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.restore();
}

function drawIdle(ctx: CanvasRenderingContext2D, arena: Arena) {
  const { cx, cy, W, H } = arena;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, W, H);
  drawCanvasWatermark(ctx, W, H);
  ctx.beginPath();
  ctx.arc(cx, cy, arena.radius * 0.93, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(148,163,184,0.3)";
  ctx.lineWidth   = 3;
  ctx.stroke();
}

// ─── Component ────────────────────────────────────────────────────────────────

const CountryEscapeChallenge = () => {
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const trailCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef      = useRef(createAudio());
  const arenaRef      = useRef<Arena | null>(null);
  const dprRef        = useRef(1);
  const ballRef       = useRef<Ball | null>(null);
  const bRRef         = useRef(0);
  const origRRef      = useRef(0);
  const lastTRef      = useRef(0);
  const rafRef        = useRef<number | null>(null);
  const phaseRef      = useRef<Phase>("idle");
  const bounceRef     = useRef(0);
  // Distance accumulator for ring spawning
  const trailAccRef   = useRef(0);
  const prevPosRef    = useRef({ x: 0, y: 0 });

  const [phase,       setPhase]       = useState<Phase>("idle");
  const [bounceCount, setBounceCount] = useState(0);

  const startGame = () => {
    const arena = arenaRef.current;
    if (!arena) return;
    void audioRef.current.unlock();

    // Clear / (re-)initialise the offscreen trail canvas
    if (!trailCanvasRef.current) trailCanvasRef.current = document.createElement("canvas");
    initTrailCanvas(trailCanvasRef.current, arena, dprRef.current);

    const initR = arena.radius * INIT_R_RATIO;
    const angle = Math.random() * Math.PI * 2;
    const speed = arena.radius * SPEED_RATIO;

    ballRef.current = {
      x: arena.cx, y: arena.cy,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      r: initR, hue: Math.random() * 360,
    };
    prevPosRef.current  = { x: arena.cx, y: arena.cy };
    trailAccRef.current = 0;

    bRRef.current       = arena.radius * 0.93;
    origRRef.current    = arena.radius;
    bounceRef.current   = 0;
    phaseRef.current    = "running";
    setPhase("running");
    setBounceCount(0);
    lastTRef.current = performance.now();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx    = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const { arena, dpr } = resizeCanvas(canvas);
    arenaRef.current = arena;
    dprRef.current   = dpr;
    lastTRef.current = performance.now();

    const tick = (t: number) => {
      const arena = arenaRef.current!;
      const dt    = Math.min((t - lastTRef.current) / 1000, MAX_DT);
      lastTRef.current = t;

      if (phaseRef.current === "running") {
        const ball   = ballRef.current!;
        const origR  = origRRef.current;

        // Grow ball and shrink boundary
        ball.r        += origR * GROWTH_RATE * dt;
        bRRef.current -= origR * SHRINK_RATE * dt;
        ball.hue = (ball.hue + HUE_RATE * dt) % 360;

        // Move
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;

        // Bounce off circular boundary (before ring-burn so trail stays inside)
        const bR   = bRRef.current;
        const cdx  = ball.x - arena.cx;
        const cdy  = ball.y - arena.cy;
        const dist = Math.hypot(cdx, cdy) || 0.001;

        if (dist + ball.r >= bR) {
          const nx = cdx / dist;
          const ny = cdy / dist;
          const vn = ball.vx * nx + ball.vy * ny;
          if (vn > 0) {
            ball.vx -= 2 * vn * nx;
            ball.vy -= 2 * vn * ny;
            // Random angle jitter ±18° so the ball never follows a fixed pattern
            const jitter = (Math.random() - 0.5) * 0.63;
            const c = Math.cos(jitter), s = Math.sin(jitter);
            const jx = ball.vx * c - ball.vy * s;
            const jy = ball.vx * s + ball.vy * c;
            ball.vx = jx; ball.vy = jy;
            audioRef.current.bounce();
            bounceRef.current++;
            setBounceCount(bounceRef.current);
          }
          // Push ball back inside before recording trail position
          ball.x = arena.cx + nx * (bR - ball.r - 0.5);
          ball.y = arena.cy + ny * (bR - ball.r - 0.5);
        }

        // Distance-based ring spawning — runs after collision so position is always inside
        const dx   = ball.x - prevPosRef.current.x;
        const dy   = ball.y - prevPosRef.current.y;
        trailAccRef.current += Math.hypot(dx, dy);
        prevPosRef.current   = { x: ball.x, y: ball.y };

        // Each disc = current ball size; spacing = 15% of diameter → ~85% overlap
        const drawR   = ball.r;
        const spacing = Math.max(1, drawR * 0.15);
        while (trailAccRef.current >= spacing && trailCanvasRef.current) {
          burnRing(trailCanvasRef.current, ball.x, ball.y, drawR, ball.hue);
          trailAccRef.current -= spacing;
        }

        // Simulation runs until the user stops it manually
      }

      const ball = ballRef.current;
      const bR   = bRRef.current;
      if (ball && bR > 0 && trailCanvasRef.current) {
        drawFrame(ctx, arena, trailCanvasRef.current, bR, ball);
      } else {
        drawIdle(ctx, arena);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    const onResize = () => {
      const { arena, dpr } = resizeCanvas(canvas);
      arenaRef.current = arena;
      dprRef.current   = dpr;
      // Trail canvas is re-initialised on next startGame; resize clears it for now
      if (trailCanvasRef.current) initTrailCanvas(trailCanvasRef.current, arena, dpr);
    };
    const onPtr = () => void audioRef.current.unlock();

    window.addEventListener("resize",     onResize);
    window.addEventListener("pointerdown", onPtr, { passive: true });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize",      onResize);
      window.removeEventListener("pointerdown", onPtr);
      audioRef.current.dispose();
    };
  }, []);

  return (
    <div className="root">
      <canvas ref={canvasRef} className="cv" />

      <div className="hud">
        <h1>Ball grows bigger, boundary gets smaller!</h1>
        {phase === "running" && <p className="bc">Bounces: {bounceCount}</p>}
      </div>

      {phase === "idle" && (
        <div className="panel">
          <button onClick={startGame}>Start</button>
        </div>
      )}

      <style jsx>{`
        .root {
          position: relative;
          width: 100%;
          height: 100dvh;
          overflow: hidden;
          background: #020617;
        }
        .cv {
          display: block;
          width: 100%;
          height: 100dvh;
        }
        .hud {
          position: fixed;
          top: 52px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 6;
          width: min(560px, calc(100% - 40px));
          text-align: center;
          pointer-events: none;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
        }
        h1 {
          margin: 0;
          font-family: Arial, Helvetica, sans-serif;
          font-size: clamp(1rem, 3.5vw, 1.65rem);
          font-weight: 900;
          color: #fff;
          text-shadow:
            0 0 18px rgba(255, 255, 255, 0.12),
            0 8px 24px rgba(2, 6, 23, 0.72);
          letter-spacing: 0.02em;
          line-height: 1.2;
        }
        .bc {
          margin: 0;
          font-family: Arial, Helvetica, sans-serif;
          font-size: clamp(0.85rem, 2vw, 1rem);
          font-weight: 700;
          color: rgba(248, 250, 252, 0.78);
        }
        .panel {
          position: fixed;
          bottom: 36px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 8;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 14px 22px;
          border-radius: 12px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(2, 6, 23, 0.82);
          backdrop-filter: blur(12px);
          box-shadow: 0 16px 48px rgba(2, 6, 23, 0.5);
        }
        .msg {
          margin: 0;
          font-family: Arial, Helvetica, sans-serif;
          font-size: 1rem;
          font-weight: 700;
          color: rgba(248, 250, 252, 0.85);
        }
        button {
          min-height: 44px;
          padding: 0 28px;
          border: 1.5px solid rgba(34, 197, 94, 0.55);
          border-radius: 8px;
          background: rgba(22, 163, 74, 0.2);
          color: #dcfce7;
          font-weight: 900;
          font-size: 14px;
          font-family: Arial, Helvetica, sans-serif;
          letter-spacing: 0.08em;
          cursor: pointer;
        }
        button:hover {
          background: rgba(22, 163, 74, 0.32);
        }
        @media (max-width: 600px) {
          .hud {
            top: calc(14px + env(safe-area-inset-top, 0px) + 48px);
          }
          .panel {
            bottom: max(20px, calc(env(safe-area-inset-bottom, 0px) + 12px));
            width: calc(100% - 32px);
          }
        }
      `}</style>
    </div>
  );
};

export default CountryEscapeChallenge;
