"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { drawCanvasWatermark } from "@/app/lib/watermark";

// ─── Constants ────────────────────────────────────────────────────────────────

const HUD_DESKTOP = 150;
const HUD_MOBILE = 168;
const MAX_DT = 1 / 30;
const SUBSTEPS = 5;
const SOUND_GAP_MS = 55;

const GRAVITY_K = 0.45; // px/s² per px of corridor width
const MAX_FALL_K = 1.85; // px/s cap per px of corridor width
const WALL_RESTITUTION = 0.92;
const BALL_RESTITUTION = 0.82;
const ANTI_STALL_SECS = 1.3; // tolerant enough to let a ball wait stuck

const RACE_END_GRACE_MS = 6000;
const COUNTDOWN_MS = 3000;
const START_SCREEN_FRACTION = 0.2; // where the start platform sits on screen (0 = top)
const PLATFORM_OPEN_MS = 450;

const BALL_DEFS = [
  { name: "Red", hue: 0 },
  { name: "Yellow", hue: 60 },
  { name: "Green", hue: 120 },
  { name: "Cyan", hue: 180 },
  { name: "Blue", hue: 240 },
  { name: "Pink", hue: 300 },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "menu" | "countdown" | "racing" | "finished";

type Ball = {
  id: number;
  name: string;
  hue: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  glow: number;
  finished: boolean;
  rank: number | null;
  stuckTimer: number;
  maxY: number;
};

type PlatformHalf = { x: number; y: number; w: number; h: number };
type StartPlatform = { left: PlatformHalf; right: PlatformHalf };

type Course = {
  platform: StartPlatform;
  finishY: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  hue: number;
};

type Arena = {
  x: number;
  y: number;
  width: number;
  height: number;
  W: number;
  H: number;
};

type RaceAudio = {
  unlock: () => void;
  hit: (hue: number) => void;
  penalty: () => void;
  win: () => void;
  dispose: () => void;
};

// ─── Canvas / Arena ───────────────────────────────────────────────────────────

function resizeCanvas(canvas: HTMLCanvasElement): {
  arena: Arena;
  dpr: number;
} {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(window.visualViewport?.width ?? window.innerWidth);
  const H = Math.round(window.visualViewport?.height ?? window.innerHeight);
  const mobile = W < 600;
  const hudH = mobile ? HUD_MOBILE : HUD_DESKTOP;
  const pad = mobile ? 0 : 24;
  const maxWidth = mobile ? Infinity : 520;
  const width = Math.min(W - pad * 2, maxWidth);
  const height = Math.max(240, H - hudH - (mobile ? 0 : pad));
  const x = Math.round((W - width) / 2);
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

  return { arena: { x, y, width, height, W, H }, dpr };
}

// ─── Course generation ────────────────────────────────────────────────────────
//
// No obstacles yet — just the start platform and an empty corridor down to
// the finish line. Obstacles are being redesigned from scratch.

function buildStartPlatform(arena: Arena, ballR: number): StartPlatform {
  const width = arena.width;
  const left = arena.x;
  const y = ballR * 7.4;
  const h = ballR * 1.6;
  const gap = width * 0.14;
  const halfW = (width - gap) / 2;
  return {
    left: { x: left, y, w: halfW, h },
    right: { x: left + halfW + gap, y, w: halfW, h },
  };
}

function generateCourse(arena: Arena, ballR: number): Course {
  const levelH = arena.height;

  const platform = buildStartPlatform(arena, ballR);
  const level1Y0 = platform.left.y + platform.left.h + ballR * 3;
  // 3 empty screen-heights of corridor before the finish line — obstacles
  // to be redesigned from scratch.
  const finishY = level1Y0 + levelH * 3 + ballR * 12;

  return { platform, finishY };
}

function spawnBalls(platform: StartPlatform, ballR: number): Ball[] {
  const leftXs = [0.22, 0.5, 0.78].map(
    (f) => platform.left.x + platform.left.w * f,
  );
  const rightXs = [0.22, 0.5, 0.78].map(
    (f) => platform.right.x + platform.right.w * f,
  );
  const xs = [...leftXs, ...rightXs];
  const y = platform.left.y - ballR * 1.3;
  return BALL_DEFS.map((def, i) => ({
    id: i,
    name: def.name,
    hue: def.hue,
    x: xs[i],
    y,
    vx: 0,
    vy: 0,
    r: ballR,
    glow: 0,
    finished: false,
    rank: null,
    stuckTimer: 0,
    maxY: y,
  }));
}

// ─── Collision helpers ────────────────────────────────────────────────────────

function resolveWalls(
  ball: Ball,
  left: number,
  right: number,
  audio: RaceAudio,
) {
  if (ball.x - ball.r < left) {
    ball.x = left + ball.r;
    ball.vx = Math.abs(ball.vx) * WALL_RESTITUTION;
    audio.hit(ball.hue);
  }
  if (ball.x + ball.r > right) {
    ball.x = right - ball.r;
    ball.vx = -Math.abs(ball.vx) * WALL_RESTITUTION;
    audio.hit(ball.hue);
  }
}

function bounceBalls(a: Ball, b: Ball, audio: RaceAudio) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const min = a.r + b.r;
  if (dist >= min || dist === 0) return;
  const overlap = (min - dist) / 2;
  const nx = dx / dist;
  const ny = dy / dist;
  a.x -= nx * overlap;
  a.y -= ny * overlap;
  b.x += nx * overlap;
  b.y += ny * overlap;
  const dvx = b.vx - a.vx;
  const dvy = b.vy - a.vy;
  const vn = dvx * nx + dvy * ny;
  if (vn > 0) return;
  const imp = (-(1 + BALL_RESTITUTION) * vn) / 2;
  a.vx -= imp * nx;
  a.vy -= imp * ny;
  b.vx += imp * nx;
  b.vy += imp * ny;
  a.glow = 0.35;
  b.glow = 0.35;
  audio.hit((a.hue + b.hue) / 2);
}

function applyAntiStall(ball: Ball, dt: number) {
  if (ball.y > ball.maxY + ball.r * 0.15) {
    ball.maxY = ball.y;
    ball.stuckTimer = 0;
    return;
  }
  ball.stuckTimer += dt;
  if (ball.stuckTimer > ANTI_STALL_SECS) {
    ball.vx += (Math.random() - 0.5) * ball.r * 16;
    ball.vy = Math.max(ball.vy, 0) + ball.r * 10;
    ball.stuckTimer = 0;
    ball.maxY = ball.y;
  }
}

// ─── Particles ────────────────────────────────────────────────────────────────

function spawnBurst(
  particles: Particle[],
  x: number,
  y: number,
  hue: number,
  count: number,
) {
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 40 + Math.random() * 90;
    particles.push({
      x,
      y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 40,
      life: 0.5 + Math.random() * 0.4,
      maxLife: 0.9,
      hue,
    });
  }
  if (particles.length > 180) particles.splice(0, particles.length - 180);
}

function updateParticles(particles: Particle[], dt: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.vy += 260 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  camY: number,
  arenaY: number,
) {
  for (const p of particles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y - camY + arenaY, 3, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${p.hue}, 90%, 62%)`;
    ctx.fill();
    ctx.restore();
  }
}

// ─── Audio ────────────────────────────────────────────────────────────────────

function createAudio(): RaceAudio {
  let ac: AudioContext | null = null;
  let lastAt = 0;
  const timeouts: number[] = [];

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

  const ping = (freq: number, vol = 0.1, throttle = true) => {
    const now = Date.now();
    if (throttle && now - lastAt < SOUND_GAP_MS) return;
    lastAt = now;
    const ctx = ensure();
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
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
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  };

  const sweep = (from: number, to: number, dur: number, vol: number) => {
    const ctx = ensure();
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.03);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  };

  return {
    unlock: () => {
      ensure();
    },
    hit: (hue: number) => ping(220 + hue * 0.5, 0.075),
    penalty: () => sweep(520, 160, 0.24, 0.18),
    win: () => {
      sweep(440, 880, 0.18, 0.18);
      timeouts.push(window.setTimeout(() => ping(660, 0.16, false), 120));
      timeouts.push(window.setTimeout(() => ping(880, 0.18, false), 260));
    },
    dispose: () => {
      timeouts.forEach((id) => window.clearTimeout(id));
      timeouts.length = 0;
      void ac?.close();
      ac = null;
    },
  };
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.clearRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#020617");
  grad.addColorStop(1, "#050b1f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

function drawCorridor(
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  camY: number,
) {
  const { x, y, width, height } = arena;

  ctx.save();
  ctx.strokeStyle = "rgba(226, 232, 240, 0.05)";
  ctx.lineWidth = 1;
  const spacing = 90;
  const firstGuide = Math.floor(camY / spacing) * spacing;
  for (let wy = firstGuide; wy < camY + height + spacing; wy += spacing) {
    const sy = wy - camY + y;
    if (sy < y || sy > y + height) continue;
    ctx.beginPath();
    ctx.moveTo(x + 6, sy);
    ctx.lineTo(x + width - 6, sy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStartPlatform(
  ctx: CanvasRenderingContext2D,
  platform: StartPlatform,
  camY: number,
  arenaY: number,
  t: number,
) {
  const halves: { half: PlatformHalf; dir: -1 | 1 }[] = [
    { half: platform.left, dir: -1 },
    { half: platform.right, dir: 1 },
  ];
  ctx.save();
  ctx.fillStyle = "#334155";
  ctx.strokeStyle = "rgba(148, 163, 184, 0.8)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(100, 160, 255, 0.3)";
  ctx.shadowBlur = 10;
  for (const { half, dir } of halves) {
    const slideX = dir * t * half.w * 0.9;
    const dropY = t * half.h * 6;
    const sy = half.y - camY + arenaY + dropY;
    ctx.globalAlpha = Math.max(0, 1 - t * 1.2);
    ctx.beginPath();
    ctx.rect(half.x + slideX, sy, half.w, half.h);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawFinishLine(
  ctx: CanvasRenderingContext2D,
  course: Course,
  arena: Arena,
  camY: number,
) {
  const sy = course.finishY - camY + arena.y;
  if (sy < -60 || sy > arena.y + arena.height + 60) return;
  const tile = 14;
  ctx.save();
  for (let i = 0; i * tile < arena.width; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#e2e8f0" : "#0f172a";
    ctx.fillRect(arena.x + i * tile, sy, tile, tile * 0.7);
  }
  ctx.font = "900 14px Arial, Helvetica, sans-serif";
  ctx.fillStyle = "#f8fafc";
  ctx.textAlign = "center";
  ctx.fillText("FINISH", arena.x + arena.width / 2, sy - 8);
  ctx.restore();
}

function drawBalls(
  ctx: CanvasRenderingContext2D,
  balls: Ball[],
  camY: number,
  arenaY: number,
  leaderId: number | null,
  bob: (index: number) => number,
) {
  balls.forEach((b, i) => {
    const sy = b.y + bob(i) - camY + arenaY;
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, sy, b.r, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${b.hue}, 88%, 58%)`;
    ctx.shadowColor = `hsl(${b.hue}, 100%, 68%)`;
    ctx.shadowBlur = b.glow > 0 ? b.r * 2.6 : b.r * 1.2;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(b.x - b.r * 0.28, sy - b.r * 0.3, b.r * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.24)";
    ctx.shadowBlur = 0;
    ctx.fill();
    ctx.restore();

    if (leaderId === b.id && !b.finished) {
      ctx.save();
      ctx.font = `${Math.round(b.r * 1.8)}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("👑", b.x, sy - b.r * 1.15);
      ctx.restore();
    }
  });
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  mobile: boolean,
  phase: Phase,
  balls: Ball[],
  finishY: number,
  leaderName: string,
) {
  const { x, width } = arena;
  const cx = x + width / 2;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(241, 245, 249, 0.96)";
  ctx.shadowColor = "rgba(96, 165, 250, 0.35)";
  ctx.shadowBlur = 16;
  ctx.font = `900 ${mobile ? 26 : 38}px Arial, Helvetica, sans-serif`;
  ctx.fillText("BALL RACE", cx, mobile ? 44 : 56);

  ctx.font = `700 ${mobile ? 12 : 14}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = "rgba(248, 250, 252, 0.7)";
  ctx.shadowBlur = 0;
  const subtitle =
    phase === "racing"
      ? `${leaderName} is leading!`
      : phase === "countdown"
        ? "Get ready…"
        : phase === "finished"
          ? "Race complete!"
          : "6 balls enter. Only 1 wins the maze.";
  ctx.fillText(subtitle, cx, mobile ? 66 : 80);
  ctx.restore();

  if (phase === "racing" || phase === "finished") {
    const trackY = mobile ? 84 : 100;
    const trackW = width - (mobile ? 24 : 12);
    const trackX = cx - trackW / 2;
    ctx.save();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(trackX, trackY);
    ctx.lineTo(trackX + trackW, trackY);
    ctx.stroke();

    for (const b of balls) {
      const frac = Math.max(0, Math.min(1, b.y / finishY));
      const px = trackX + frac * trackW;
      ctx.beginPath();
      ctx.arc(px, trackY, mobile ? 4 : 5, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(${b.hue}, 88%, 58%)`;
      ctx.shadowColor = `hsl(${b.hue}, 100%, 68%)`;
      ctx.shadowBlur = 6;
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawCountdown(
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  mobile: boolean,
  remainingMs: number,
) {
  const cx = arena.x + arena.width / 2;
  const cy = arena.y + arena.height * 0.35;
  const label =
    remainingMs > 700 ? String(Math.ceil(remainingMs / 1000)) : "GO!";
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(241, 245, 249, 0.96)";
  ctx.shadowColor = "rgba(96, 165, 250, 0.55)";
  ctx.shadowBlur = 26;
  ctx.font = `900 ${mobile ? 64 : 88}px Arial, Helvetica, sans-serif`;
  ctx.fillText(label, cx, cy);
  ctx.restore();
}

// ─── Component ────────────────────────────────────────────────────────────────

const CollidingShapes = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<Arena | null>(null);
  const courseRef = useRef<Course | null>(null);
  const ballsRef = useRef<Ball[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTRef = useRef<number>(0);
  const audioRef = useRef(createAudio());
  const phaseRef = useRef<Phase>("menu");
  const cameraRef = useRef(0);
  const countdownEndAtRef = useRef<number | null>(null);
  const raceStartAtRef = useRef<number | null>(null);
  const raceEndAtRef = useRef<number | null>(null);
  const finishOrderRef = useRef<Ball[]>([]);

  const [phase, setPhase] = useState<Phase>("menu");
  const [standings, setStandings] = useState<Ball[]>([]);

  const buildRace = useCallback((arena: Arena) => {
    const ballR = arena.width * 0.048 * 0.7 * 0.8;
    const course = generateCourse(arena, ballR);
    courseRef.current = course;
    ballsRef.current = spawnBalls(course.platform, ballR);
    particlesRef.current = [];
    // Put the start platform at START_SCREEN_FRACTION of the way down the
    // full screen (HUD included) instead of wherever camera = 0 lands it.
    const platformY = course.platform.left.y;
    const targetScreenY = arena.H * START_SCREEN_FRACTION;
    cameraRef.current = platformY + arena.y - targetScreenY;
    finishOrderRef.current = [];
    raceEndAtRef.current = null;
    raceStartAtRef.current = null;
  }, []);

  const resizeOnly = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { arena } = resizeCanvas(canvas);
    arenaRef.current = arena;
    buildRace(arena);
  }, [buildRace]);

  const handleResize = useCallback(() => {
    resizeOnly();
    if (phaseRef.current !== "menu") {
      phaseRef.current = "countdown";
      countdownEndAtRef.current = performance.now() + COUNTDOWN_MS;
      setPhase("countdown");
    }
  }, [resizeOnly]);

  const startRace = useCallback(() => {
    audioRef.current.unlock();
    const arena = arenaRef.current;
    if (!arena) return;
    buildRace(arena);
    phaseRef.current = "countdown";
    countdownEndAtRef.current = performance.now() + COUNTDOWN_MS;
    setPhase("countdown");
  }, [buildRace]);

  useEffect(() => {
    resizeOnly();
    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, [resizeOnly, handleResize]);

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
      const phaseNow = phaseRef.current;
      const course = courseRef.current;
      const balls = ballsRef.current;
      const raceStartAt = raceStartAtRef.current;

      drawBackground(ctx, W, H);
      drawCanvasWatermark(ctx, W, H);

      if (!course || balls.length === 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (phaseNow === "racing") {
        const left = arena.x;
        const right = arena.x + arena.width;
        const gravity = arena.width * GRAVITY_K;
        const maxFall = arena.width * MAX_FALL_K;
        const subDt = dt / SUBSTEPS;

        for (let s = 0; s < SUBSTEPS; s++) {
          for (const ball of balls) {
            if (ball.finished) continue;
            ball.vy = Math.min(ball.vy + gravity * subDt, maxFall);
            ball.x += ball.vx * subDt;
            ball.y += ball.vy * subDt;
            if (ball.glow > 0) ball.glow -= subDt;
            resolveWalls(ball, left, right, audio);
          }
          for (let i = 0; i < balls.length; i++) {
            for (let j = i + 1; j < balls.length; j++) {
              if (balls[i].finished || balls[j].finished) continue;
              bounceBalls(balls[i], balls[j], audio);
            }
          }
        }

        for (const ball of balls) {
          if (ball.finished) continue;
          applyAntiStall(ball, dt);
        }

        for (const ball of balls) {
          if (!ball.finished && ball.y - ball.r >= course.finishY) {
            ball.finished = true;
            ball.rank = finishOrderRef.current.length + 1;
            finishOrderRef.current.push(ball);
            spawnBurst(particlesRef.current, ball.x, ball.y, ball.hue, 26);
            audio.win();
            if (raceEndAtRef.current === null) {
              raceEndAtRef.current = now + RACE_END_GRACE_MS;
            }
          }
        }

        const leaderY = Math.max(
          ...balls.map((b) => Math.min(b.y, course.finishY)),
        );
        const anchor = arena.height * 0.34;
        const target = leaderY - anchor;
        const desired = Math.max(cameraRef.current, target);
        cameraRef.current +=
          (desired - cameraRef.current) * Math.min(1, dt * 6);

        const allDone = finishOrderRef.current.length === balls.length;
        if (
          raceEndAtRef.current !== null &&
          (now >= raceEndAtRef.current || allDone)
        ) {
          const remaining = balls
            .filter((b) => !b.finished)
            .sort((a, b) => b.y - a.y);
          for (const b of remaining) {
            b.finished = true;
            b.rank = finishOrderRef.current.length + 1;
            finishOrderRef.current.push(b);
          }
          phaseRef.current = "finished";
          setStandings(finishOrderRef.current.slice());
          setPhase("finished");
        }
      }

      if (phaseNow === "racing" || phaseNow === "finished") {
        updateParticles(particlesRef.current, dt);
      }

      const camY = cameraRef.current;

      drawCorridor(ctx, arena, camY);

      if (phaseNow !== "menu") {
        drawFinishLine(ctx, course, arena, camY);
      }

      if (phaseNow === "countdown") {
        drawStartPlatform(ctx, course.platform, camY, arena.y, 0);
      } else if (phaseNow === "racing" && raceStartAt !== null) {
        const openT = Math.min(1, (now - raceStartAt) / PLATFORM_OPEN_MS);
        if (openT < 1) {
          drawStartPlatform(ctx, course.platform, camY, arena.y, openT);
        }
      }

      const leader =
        phaseNow === "racing" || phaseNow === "finished"
          ? balls.reduce((best, b) => (b.y > best.y ? b : best), balls[0])
          : null;

      const bob =
        phaseNow === "menu" || phaseNow === "countdown"
          ? (i: number) => Math.sin(now / 650 + i * 1.3) * balls[i].r * 0.5
          : () => 0;

      drawBalls(ctx, balls, camY, arena.y, leader ? leader.id : null, bob);

      if (phaseNow === "racing" || phaseNow === "finished") {
        drawParticles(ctx, particlesRef.current, camY, arena.y);
      }

      drawHud(
        ctx,
        arena,
        mobile,
        phaseNow,
        balls,
        course.finishY,
        leader ? leader.name : "",
      );

      if (phaseNow === "countdown") {
        const remaining = (countdownEndAtRef.current ?? now) - now;
        if (remaining <= 0) {
          phaseRef.current = "racing";
          setPhase("racing");
          raceStartAtRef.current = now;
          for (const ball of balls) {
            ball.vx = (Math.random() - 0.5) * arena.width * 0.22;
          }
        } else {
          drawCountdown(ctx, arena, mobile, remaining);
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
    <div className="cr-root">
      <canvas ref={canvasRef} className="cr-canvas" />

      {phase === "menu" && (
        <div className="cr-menu">
          <button type="button" className="cr-play-btn" onClick={startRace}>
            ▶ PLAY
          </button>
        </div>
      )}

      {phase === "finished" && (
        <div className="cr-finished">
          <div className="cr-panel">
            <h2 className="cr-panel-title">🏁 Race Complete!</h2>
            <div className="cr-standings">
              {standings.map((b, i) => (
                <div className="cr-standing-row" key={b.id}>
                  <span className="cr-standing-medal">
                    {i === 0
                      ? "🥇"
                      : i === 1
                        ? "🥈"
                        : i === 2
                          ? "🥉"
                          : `${i + 1}.`}
                  </span>
                  <span
                    className="cr-standing-dot"
                    style={{ background: `hsl(${b.hue}, 88%, 58%)` }}
                  />
                  <span className="cr-standing-name">{b.name}</span>
                </div>
              ))}
            </div>
            <button type="button" className="cr-play-btn" onClick={startRace}>
              RACE AGAIN
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        .cr-root {
          position: relative;
          width: 100%;
          height: 100dvh;
          min-height: 100dvh;
          overflow: hidden;
          background: #020617;
          color: #f8fafc;
        }

        .cr-canvas {
          position: absolute;
          inset: 0;
          width: 100% !important;
          height: 100dvh !important;
          min-height: 100dvh !important;
        }

        .cr-menu {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          padding: 0 24px;
        }

        .cr-play-btn {
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
          transition:
            transform 0.2s,
            box-shadow 0.2s,
            background 0.2s;
        }

        .cr-play-btn:hover {
          background: rgba(22, 78, 160, 0.68);
          box-shadow: 0 0 40px rgba(60, 130, 255, 0.36);
          transform: scale(1.05);
        }

        .cr-play-btn:active {
          transform: scale(0.97);
        }

        .cr-finished {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(2, 6, 23, 0.55);
          pointer-events: none;
          padding: 0 20px;
        }

        .cr-panel {
          pointer-events: all;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 18px;
          padding: clamp(20px, 4vw, 32px);
          width: min(92vw, 380px);
          border: 1px solid rgba(100, 180, 255, 0.4);
          border-radius: 18px;
          background: rgba(8, 20, 45, 0.82);
          backdrop-filter: blur(12px);
          box-shadow: 0 0 44px rgba(60, 130, 255, 0.22);
        }

        .cr-panel-title {
          margin: 0;
          font-family: Arial, Helvetica, sans-serif;
          font-size: clamp(1.25rem, 5vw, 1.7rem);
          font-weight: 900;
          text-align: center;
          color: #f8fafc;
        }

        .cr-standings {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .cr-standing-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 14px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.05);
        }

        .cr-standing-medal {
          width: 28px;
          font-size: clamp(0.95rem, 3vw, 1.15rem);
          font-weight: 900;
          text-align: center;
        }

        .cr-standing-dot {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          box-shadow: 0 0 10px currentColor;
          flex-shrink: 0;
        }

        .cr-standing-name {
          font-family: Arial, Helvetica, sans-serif;
          font-size: clamp(0.9rem, 3vw, 1.05rem);
          font-weight: 700;
          color: #f1f5f9;
        }
      `}</style>
    </div>
  );
};

export default CollidingShapes;
