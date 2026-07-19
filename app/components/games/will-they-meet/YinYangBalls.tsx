"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { drawCanvasWatermark } from "@/app/lib/watermark";

// ─── Constants ────────────────────────────────────────────────────────────────

const HUD_DESKTOP = 148;
const HUD_MOBILE = 168;
const BASE_SPEED = 150;
const ORB_SPEED = BASE_SPEED * 0.5;
const MAX_DT = 1 / 30;
const SOUND_GAP_MS = 60;
// balls and orbs are 0.66x their original size, and orbs match a starting ball
const BALL_RADIUS_RATIO = 0.014 * 1.5 * 0.66;
const ORB_RADIUS_RATIO = BALL_RADIUS_RATIO;
const START_PER_TEAM = 1;
// each "grow" hit scales that one ball's radius by this much
const GROWTH_FACTOR = 1.25;
// a ball stops growing once it spans the arena — at this point it fills the
// square edge to edge and has no free area left to claim
const MAX_RADIUS_RATIO = 0.48;
const MAX_PER_TEAM = 64;
const TEAM_RED = "#ef4444";
const TEAM_GREEN = "#22c55e";
// power-up hues deliberately avoid red/green so they never read as a team ball
const ORB_GROW = "251, 191, 36"; // amber
const ORB_CLONE = "56, 189, 248"; // cyan

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "menu" | "playing";
type BallKind = "red" | "green";
type OrbKind = "grow" | "clone";

type Mover = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
};

type Ball = Mover & {
  kind: BallKind;
  glow: number;
};

type Orb = Mover & {
  kind: OrbKind;
  pulse: number;
  // balls currently overlapping this orb. An orb fires only on the frame a ball
  // first touches it — without this a ball that has grown large enough to
  // swallow the orb would re-trigger it on every single frame.
  touching: Set<Ball>;
};

type Arena = {
  x: number;
  y: number;
  size: number;
  W: number;
  H: number;
};


// ─── Canvas / Arena ───────────────────────────────────────────────────────────

function resizeCanvas(canvas: HTMLCanvasElement): { arena: Arena } {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
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

function getBallRadius(arena: Arena) {
  return arena.size * BALL_RADIUS_RATIO;
}

function getOrbRadius(arena: Arena) {
  return arena.size * ORB_RADIUS_RATIO;
}

function clampToArena(v: number, min: number, span: number, r: number) {
  return Math.min(Math.max(v, min + r), min + span - r);
}

// picks a random point inside one of the arena's four quadrants — the arena is
// open now, so these only spread the starting positions apart
function randomPointInQuadrant(arena: Arena, col: 0 | 1, row: 0 | 1, r: number) {
  const margin = r * 1.6;
  const half = arena.size * 0.5 - margin * 2;
  return {
    x: arena.x + arena.size * 0.5 * col + margin + Math.random() * half,
    y: arena.y + arena.size * 0.5 * row + margin + Math.random() * half,
  };
}

function makeBall(kind: BallKind, x: number, y: number, r: number): Ball {
  const v = randomVelocity(BASE_SPEED);
  return { x, y, vx: v.vx, vy: v.vy, r, kind, glow: 0 };
}

function spawnBalls(arena: Arena): Ball[] {
  const r = getBallRadius(arena);
  const balls: Ball[] = [];
  // red starts in the top-left quadrant, green in the bottom-right
  for (let i = 0; i < START_PER_TEAM; i++) {
    const p = randomPointInQuadrant(arena, 0, 0, r);
    balls.push(makeBall("red", p.x, p.y, r));
  }
  for (let i = 0; i < START_PER_TEAM; i++) {
    const p = randomPointInQuadrant(arena, 1, 1, r);
    balls.push(makeBall("green", p.x, p.y, r));
  }
  return balls;
}

function makeOrb(kind: OrbKind, arena: Arena): Orb {
  const r = getOrbRadius(arena);
  // orbs start in the two quadrants the balls DON'T, one each
  const p =
    kind === "grow"
      ? randomPointInQuadrant(arena, 1, 0, r)
      : randomPointInQuadrant(arena, 0, 1, r);
  const v = randomVelocity(ORB_SPEED);
  return {
    x: p.x,
    y: p.y,
    vx: v.vx,
    vy: v.vy,
    r,
    kind,
    pulse: Math.random() * Math.PI * 2,
    touching: new Set<Ball>(),
  };
}

function spawnOrbs(arena: Arena): Orb[] {
  return [makeOrb("grow", arena), makeOrb("clone", arena)];
}

// ─── Ball powers ──────────────────────────────────────────────────────────────

function countOf(balls: Ball[], kind: BallKind) {
  return balls.reduce((n, b) => (b.kind === kind ? n + 1 : n), 0);
}

// grows one ball, capped once it spans the arena, and nudges it back inside so
// the new radius can't leave it straddling a wall
function growBall(ball: Ball, arena: Arena) {
  const maxR = arena.size * MAX_RADIUS_RATIO;
  if (ball.r >= maxR) return false;

  ball.r = Math.min(maxR, ball.r * GROWTH_FACTOR);
  ball.x = clampToArena(ball.x, arena.x, arena.size, ball.r);
  ball.y = clampToArena(ball.y, arena.y, arena.size, ball.r);
  ball.glow = 1;
  return true;
}

// adds one more ball of the same colour AND the same radius as the one that hit
// the orb — a ball grown to 3x spawns a 3x twin, not a fresh small one
function cloneBall(balls: Ball[], parent: Ball, arena: Arena): Ball[] {
  if (countOf(balls, parent.kind) >= MAX_PER_TEAM) return balls;
  // two balls this size need 4r of clear width; past that the twin would spawn
  // permanently overlapped and the pair resolver would jitter it forever
  if (parent.r * 4 > arena.size) return balls;

  const angle = Math.random() * Math.PI * 2;
  const clone = makeBall(
    parent.kind,
    clampToArena(
      parent.x + Math.cos(angle) * parent.r * 2.1,
      arena.x,
      arena.size,
      parent.r,
    ),
    clampToArena(
      parent.y + Math.sin(angle) * parent.r * 2.1,
      arena.y,
      arena.size,
      parent.r,
    ),
    parent.r,
  );
  clone.glow = 1;
  return [...balls, clone];
}

// Elastic bounce with mass proportional to area. Balls can now differ hugely in
// size, and equal-mass maths would let a tiny ball punt a giant one across the
// arena; weighting by r² makes the big one shrug it off instead.
function resolveBallPair(a: Ball, b: Ball) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distSq = dx * dx + dy * dy;
  const minDist = a.r + b.r;
  if (distSq >= minDist * minDist) return;

  const dist = Math.sqrt(distSq);
  // clones spawn beside their parent but can still land flush, so handle the
  // exact-overlap case rather than dividing by zero
  const nx = dist > 0.0001 ? dx / dist : 1;
  const ny = dist > 0.0001 ? dy / dist : 0;

  const invA = 1 / (a.r * a.r);
  const invB = 1 / (b.r * b.r);
  const invSum = invA + invB;

  // separate them along the normal, the lighter ball giving way the most
  const overlap = minDist - dist;
  a.x -= nx * overlap * (invA / invSum);
  a.y -= ny * overlap * (invA / invSum);
  b.x += nx * overlap * (invB / invSum);
  b.y += ny * overlap * (invB / invSum);

  const vDotN = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vDotN > 0) return; // already separating

  const impulse = (-2 * vDotN) / invSum;
  a.vx -= impulse * invA * nx;
  a.vy -= impulse * invA * ny;
  b.vx += impulse * invB * nx;
  b.vy += impulse * invB * ny;
}

function resolveBoundaryCollision(
  body: Mover,
  arena: Arena,
  onHit: () => void,
) {
  const right = arena.x + arena.size;
  const bottom = arena.y + arena.size;
  let hit = false;

  if (body.x - body.r < arena.x) {
    body.x = arena.x + body.r;
    body.vx = Math.abs(body.vx);
    hit = true;
  }
  if (body.x + body.r > right) {
    body.x = right - body.r;
    body.vx = -Math.abs(body.vx);
    hit = true;
  }
  if (body.y - body.r < arena.y) {
    body.y = arena.y + body.r;
    body.vy = Math.abs(body.vy);
    hit = true;
  }
  if (body.y + body.r > bottom) {
    body.y = bottom - body.r;
    body.vy = -Math.abs(body.vy);
    hit = true;
  }

  if (hit) onHit();
}

// ─── Audio ────────────────────────────────────────────────────────────────────

function createAudio() {
  let ac: AudioContext | null = null;
  const lastAtByChannel: Record<string, number> = {};
  let musicMaster: GainNode | null = null;
  let musicNodes: AudioScheduledSourceNode[] = [];

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

  const throttled = (channel: string) => {
    const now = Date.now();
    if (now - (lastAtByChannel[channel] ?? 0) < SOUND_GAP_MS) return false;
    lastAtByChannel[channel] = now;
    return true;
  };

  const ping = (
    channel: string,
    freq: number,
    duration: number,
    vol: number,
  ) => {
    if (!throttled(channel)) return;
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

  // a soft plucked-piano tone (harmonics through a lowpass), used for the balls hitting walls
  const pianoNote = (channel: string, freq: number) => {
    if (!throttled(channel)) return;
    const ctx = ensure();
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const outputGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const harmonics = [
      { ratio: 1, gain: 0.16 },
      { ratio: 2, gain: 0.06 },
      { ratio: 3, gain: 0.025 },
    ];

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(3200, t);
    filter.frequency.exponentialRampToValueAtTime(1100, t + 0.4);
    outputGain.gain.setValueAtTime(0.0001, t);
    outputGain.gain.linearRampToValueAtTime(0.34, t + 0.006);
    outputGain.gain.exponentialRampToValueAtTime(0.1, t + 0.07);
    outputGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    outputGain.connect(filter);
    filter.connect(ctx.destination);

    harmonics.forEach((h, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i === 0 ? "triangle" : "sine";
      osc.frequency.setValueAtTime(freq * h.ratio, t);
      gain.gain.setValueAtTime(h.gain, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4 + i * 0.03);
      osc.connect(gain);
      gain.connect(outputGain);
      osc.start(t);
      osc.stop(t + 0.55);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    });

    window.setTimeout(() => {
      outputGain.disconnect();
      filter.disconnect();
    }, 620);
  };

  // low swelling pair for a ball growing
  const grow = () => {
    const ctx = ensure();
    if (!ctx || ctx.state !== "running") return;
    [196.0, 293.66].forEach((freq, i) => {
      window.setTimeout(() => ping(`grow${i}`, freq, 0.34, 0.13), i * 70);
    });
  };

  // bright rising arpeggio for a ball splitting off a twin
  const clone = () => {
    const ctx = ensure();
    if (!ctx || ctx.state !== "running") return;
    [523.25, 659.25, 880].forEach((freq, i) => {
      window.setTimeout(() => ping(`clone${i}`, freq, 0.22, 0.13), i * 55);
    });
  };

  // very quiet, slow ambient pad — starts once and loops for as long as the audio context lives
  const startMusic = () => {
    if (musicMaster) return;
    const ctx = ensure();
    if (!ctx) return;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.02, ctx.currentTime + 3);
    master.connect(ctx.destination);
    musicMaster = master;

    const chord = [130.81, 164.81, 196.0, 261.63]; // C3, E3, G3, C4 — calm major triad
    chord.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;

      const voiceGain = ctx.createGain();
      voiceGain.gain.value = 0.45 / (i + 1);

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.015;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.12 / (i + 1);
      lfo.connect(lfoGain);
      lfoGain.connect(voiceGain.gain);

      osc.connect(voiceGain);
      voiceGain.connect(master);
      osc.start();
      lfo.start();
      musicNodes.push(osc, lfo);
    });
  };

  const stopMusic = () => {
    musicNodes.forEach((node) => {
      try {
        node.stop();
      } catch {
        // already stopped
      }
      node.disconnect();
    });
    musicNodes = [];
    musicMaster?.disconnect();
    musicMaster = null;
  };

  return {
    unlock: () => {
      ensure();
      startMusic();
    },
    wallRed: () => pianoNote("wallRed", 261.63), // C4
    wallGreen: () => pianoNote("wallGreen", 392.0), // G4
    wallOrb: () => ping("wallOrb", 220, 0.18, 0.08),
    grow,
    clone,
    dispose: () => {
      stopMusic();
      void ac?.close();
      ac = null;
    },
  };
}

// ─── Drawing: Balls ───────────────────────────────────────────────────────────

// solid discs — at 0.66x size hue carries much further than any inner detail
function drawBall(ctx: CanvasRenderingContext2D, ball: Ball) {
  const { r, glow } = ball;
  const isRed = ball.kind === "red";

  ctx.save();
  ctx.translate(ball.x, ball.y);

  ctx.shadowColor = isRed
    ? `rgba(239, 68, 68, ${0.55 + glow * 0.45})`
    : `rgba(34, 197, 94, ${0.55 + glow * 0.45})`;
  ctx.shadowBlur = r * (1.1 + glow * 1.6);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = isRed ? TEAM_RED : TEAM_GREEN;
  ctx.fill();
  ctx.shadowBlur = 0;

  // pale rim lifts the saturated fill off the dark background
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = isRed
    ? "rgba(254, 226, 226, 0.8)"
    : "rgba(220, 252, 231, 0.8)";
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.stroke();

  ctx.restore();
}

// ─── Drawing: Power orbs ──────────────────────────────────────────────────────

function drawOrb(ctx: CanvasRenderingContext2D, orb: Orb) {
  const { r } = orb;
  const isGrow = orb.kind === "grow";
  const pulse = 0.5 + Math.sin(orb.pulse) * 0.5;
  const hue = isGrow ? ORB_GROW : ORB_CLONE;

  ctx.save();
  ctx.translate(orb.x, orb.y);

  ctx.save();
  ctx.shadowColor = `rgba(${hue}, ${0.55 + pulse * 0.45})`;
  ctx.shadowBlur = r * (1.4 + pulse * 1.2);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${hue})`;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(248, 250, 252, 0.9)";
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.stroke();

  // the orb is now ball-sized, so the label rides above it instead of inside.
  // outlined with strokeText rather than a shadow — shadowBlur on text ghosts on iOS
  const label = isGrow ? "SIZE" : "+1";
  const fontSize = Math.max(11, r * 1.7);
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.font = `900 ${fontSize}px Arial, Helvetica, sans-serif`;
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2.5, fontSize * 0.3);
  ctx.strokeStyle = "rgba(2, 6, 23, 0.95)";
  ctx.strokeText(label, 0, -r * 1.5);
  ctx.fillStyle = `rgb(${hue})`;
  ctx.fillText(label, 0, -r * 1.5);

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

  // no shadowBlur on fillText — it ghosts on iOS; a flat dark background is enough
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "#f8fafc";
  ctx.font = `900 ${mobile ? 22 : 32}px Arial, Helvetica, sans-serif`;
  const cx = x + size / 2;
  ctx.fillText("Red vs Green:", cx, y - (mobile ? 92 : 96));
  ctx.fillText("who takes over?", cx, y - (mobile ? 68 : 60));

  ctx.font = `700 ${mobile ? 12 : 14}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = "rgba(248, 250, 252, 0.68)";
  ctx.fillText(
    "SIZE makes a ball bigger. +1 clones it at the same size",
    cx,
    y - (mobile ? 46 : 36),
  );
  ctx.restore();
}

// live scoreboard: red count · green count
function drawScoreboard(
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  mobile: boolean,
  red: number,
  green: number,
) {
  const cx = arena.x + arena.size / 2;
  const baseY = arena.y - (mobile ? 16 : 12);
  const dotR = mobile ? 7 : 9;
  const gap = mobile ? 34 : 44;

  ctx.save();
  ctx.textBaseline = "middle";
  ctx.font = `900 ${mobile ? 19 : 23}px Arial, Helvetica, sans-serif`;

  // red team on the left
  ctx.beginPath();
  ctx.arc(cx - gap - dotR * 2.2, baseY, dotR, 0, Math.PI * 2);
  ctx.fillStyle = TEAM_RED;
  ctx.fill();
  ctx.textAlign = "left";
  ctx.fillStyle = "#fecaca";
  ctx.fillText(String(red), cx - gap, baseY);

  // green team on the right
  ctx.beginPath();
  ctx.arc(cx + gap + dotR * 2.2, baseY, dotR, 0, Math.PI * 2);
  ctx.fillStyle = TEAM_GREEN;
  ctx.fill();
  ctx.textAlign = "right";
  ctx.fillStyle = "#bbf7d0";
  ctx.fillText(String(green), cx + gap, baseY);

  ctx.restore();
}

// ─── Component ────────────────────────────────────────────────────────────────

const YinYangBalls = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<Arena | null>(null);
  const ballsRef = useRef<Ball[]>([]);
  const orbsRef = useRef<Orb[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTRef = useRef<number>(0);
  const audioRef = useRef(createAudio());
  const phaseRef = useRef<Phase>("menu");

  const [phase, setPhase] = useState<Phase>("menu");

  const setup = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { arena } = resizeCanvas(canvas);
    arenaRef.current = arena;
    if (phaseRef.current === "playing" && ballsRef.current.length === 0) {
      ballsRef.current = spawnBalls(arena);
      orbsRef.current = spawnOrbs(arena);
    }
  }, []);

  const startGame = useCallback(() => {
    audioRef.current.unlock();
    phaseRef.current = "playing";
    setPhase("playing");
    const canvas = canvasRef.current;
    if (canvas) {
      const { arena } = resizeCanvas(canvas);
      arenaRef.current = arena;
      ballsRef.current = spawnBalls(arena);
      orbsRef.current = spawnOrbs(arena);
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
      drawArena(ctx, arena, mobile);

      if (phaseRef.current === "playing") {
        const orbs = orbsRef.current;

        for (const b of ballsRef.current) {
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          if (b.glow > 0) b.glow = Math.max(0, b.glow - dt * 1.4);

          resolveBoundaryCollision(b, arena, () =>
            b.kind === "red" ? audio.wallRed() : audio.wallGreen(),
          );
        }

        for (const orb of orbs) {
          orb.x += orb.vx * dt;
          orb.y += orb.vy * dt;
          orb.pulse += dt * 4;

          resolveBoundaryCollision(orb, arena, () => audio.wallOrb());
        }

        // balls bounce off each other — opposite colours never merge
        const balls = ballsRef.current;
        for (let i = 0; i < balls.length; i++) {
          for (let j = i + 1; j < balls.length; j++) {
            resolveBallPair(balls[i], balls[j]);
          }
        }

        // Orb effects fire once, on the frame a ball first makes contact, and
        // apply to that single ball rather than its whole team. Orbs never move
        // off their trajectory when hit.
        for (const orb of orbs) {
          const overlapping = new Set<Ball>();

          for (const b of ballsRef.current) {
            if (Math.hypot(b.x - orb.x, b.y - orb.y) >= b.r + orb.r) continue;
            overlapping.add(b);
            if (orb.touching.has(b)) continue; // already counted on entry

            if (orb.kind === "grow") {
              if (growBall(b, arena)) audio.grow();
            } else {
              ballsRef.current = cloneBall(ballsRef.current, b, arena);
              audio.clone();
            }
          }

          orb.touching = overlapping;
        }

        for (const b of ballsRef.current) drawBall(ctx, b);
        for (const orb of orbs) drawOrb(ctx, orb);

        drawScoreboard(
          ctx,
          arena,
          mobile,
          countOf(ballsRef.current, "red"),
          countOf(ballsRef.current, "green"),
        );
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
