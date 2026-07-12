"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { drawCanvasWatermark } from "@/app/lib/watermark";

// ─── Constants ────────────────────────────────────────────────────────────────

const HUD_DESKTOP = 148;
const HUD_MOBILE = 168;
const BASE_SPEED = 150;
const BOMB_SPEED = BASE_SPEED * 0.5;
const MAX_DT = 1 / 30;
const SOUND_GAP_MS = 60;
const RESET_DELAY_MS = 5000;
const BLAST_DELAY_MS = 2200;
const BALL_RADIUS_RATIO = 0.014 * 1.5;
const INK = "#0f172a";
const PAPER = "#f8fafc";
const PLAIN = "#94a3b8";
const LINE = "rgba(148, 163, 184, 0.55)";
const WALL_THICKNESS_RATIO = 0.016;

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "menu" | "playing";
type BallKind = "yin" | "yang" | "full";

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

type Bomb = Mover & {
  pulse: number;
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

function spawnBalls(arena: Arena): Ball[] {
  const r = getBallRadius(arena);
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

function spawnBomb(arena: Arena): Bomb {
  const r = getBallRadius(arena);
  const margin = r * 1.6;
  const half = arena.size * 0.5 - margin * 2;

  // the bomb spawns in one of the two rooms the balls DON'T start in
  const inTopRightRoom = Math.random() < 0.5;
  const bx = inTopRightRoom
    ? arena.x + arena.size * 0.5 + margin + Math.random() * half
    : arena.x + margin + Math.random() * half;
  const by = inTopRightRoom
    ? arena.y + margin + Math.random() * half
    : arena.y + arena.size * 0.5 + margin + Math.random() * half;

  const v = randomVelocity(BOMB_SPEED);
  return { x: bx, y: by, vx: v.vx, vy: v.vy, r, pulse: Math.random() * Math.PI * 2 };
}

// ─── Maze walls ───────────────────────────────────────────────────────────────

function getWallSegments(arena: Arena): WallSeg[] {
  const { x, y, size } = arena;
  const at = (f: number) => x + size * f;
  const up = (f: number) => y + size * f;
  const vx = at(0.5);
  const hy = up(0.5);

  return [
    // central cross — gaps are narrower and pushed toward the corners, so
    // reaching them takes a longer detour than a straight shot through the middle
    { x1: vx, y1: y, x2: vx, y2: up(0.14) },
    { x1: vx, y1: up(0.24), x2: vx, y2: up(0.78) },
    { x1: vx, y1: up(0.88), x2: vx, y2: y + size },
    { x1: x, y1: hy, x2: at(0.14), y2: hy },
    { x1: at(0.24), y1: hy, x2: at(0.78), y2: hy },
    { x1: at(0.88), y1: hy, x2: x + size, y2: hy },
    // two staggered decoy stubs per quadrant, forcing an S-turn instead of a
    // straight run toward the nearest gap
    { x1: at(0.08), y1: up(0.2), x2: at(0.24), y2: up(0.2) },
    { x1: at(0.3), y1: up(0.06), x2: at(0.3), y2: up(0.2) },
    { x1: at(0.62), y1: up(0.14), x2: at(0.62), y2: up(0.3) },
    { x1: at(0.7), y1: up(0.38), x2: at(0.9), y2: up(0.38) },
    { x1: at(0.6), y1: up(0.68), x2: at(0.78), y2: up(0.68) },
    { x1: at(0.86), y1: up(0.74), x2: at(0.86), y2: up(0.92) },
    { x1: at(0.16), y1: up(0.62), x2: at(0.16), y2: up(0.8) },
    { x1: at(0.24), y1: up(0.88), x2: at(0.44), y2: up(0.88) },
  ];
}

function resolveWallSegCollisions(
  body: Mover,
  segs: WallSeg[],
  halfThickness: number,
  onHit: () => void,
) {
  for (const seg of segs) {
    const rx = Math.min(seg.x1, seg.x2) - halfThickness;
    const ry = Math.min(seg.y1, seg.y2) - halfThickness;
    const rw = Math.abs(seg.x2 - seg.x1) + halfThickness * 2;
    const rh = Math.abs(seg.y2 - seg.y1) + halfThickness * 2;

    const closestX = Math.min(Math.max(body.x, rx), rx + rw);
    const closestY = Math.min(Math.max(body.y, ry), ry + rh);
    const dx = body.x - closestX;
    const dy = body.y - closestY;
    const distSq = dx * dx + dy * dy;
    if (distSq >= body.r * body.r) continue;

    const dist = Math.sqrt(distSq);
    let nx: number;
    let ny: number;
    if (dist > 0.0001) {
      nx = dx / dist;
      ny = dy / dist;
    } else {
      const overlapX = rw / 2 - Math.abs(body.x - (rx + rw / 2));
      const overlapY = rh / 2 - Math.abs(body.y - (ry + rh / 2));
      if (overlapX < overlapY) {
        nx = body.x < rx + rw / 2 ? -1 : 1;
        ny = 0;
      } else {
        nx = 0;
        ny = body.y < ry + rh / 2 ? -1 : 1;
      }
    }

    const overlap = body.r - dist;
    body.x += nx * overlap;
    body.y += ny * overlap;

    const vDotN = body.vx * nx + body.vy * ny;
    if (vDotN < 0) {
      body.vx -= 2 * vDotN * nx;
      body.vy -= 2 * vDotN * ny;
    }
    onHit();
  }
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

  const meet = () => {
    const ctx = ensure();
    if (!ctx || ctx.state !== "running") return;
    [440, 660, 880].forEach((freq, i) => {
      window.setTimeout(() => ping(`meet${i}`, freq, 0.3, 0.14), i * 70);
    });
  };

  const blast = () => {
    const ctx = ensure();
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;

    // filtered noise burst
    const bufferSize = ctx.sampleRate * 0.4;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.setValueAtTime(1800, t);
    noiseFilter.frequency.exponentialRampToValueAtTime(120, t + 0.4);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.32, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(t);
    noise.stop(t + 0.4);

    // low thump
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.35);
    oscGain.gain.setValueAtTime(0.4, t);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
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
    wallYin: () => pianoNote("wallYin", 261.63), // C4
    wallYang: () => pianoNote("wallYang", 392.0), // G4
    wallBomb: () => ping("wallBomb", 220, 0.18, 0.08),
    meet,
    blast,
    dispose: () => {
      stopMusic();
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

// ─── Drawing: Bomb ────────────────────────────────────────────────────────────

function drawBomb(ctx: CanvasRenderingContext2D, bomb: Bomb) {
  const { r } = bomb;
  const danger = 0.5 + Math.sin(bomb.pulse) * 0.5;

  ctx.save();
  ctx.translate(bomb.x, bomb.y);

  ctx.save();
  ctx.shadowColor = `rgba(239, 68, 68, ${0.35 + danger * 0.4})`;
  ctx.shadowBlur = r * 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  const grad = ctx.createRadialGradient(
    -r * 0.3,
    -r * 0.3,
    r * 0.1,
    0,
    0,
    r,
  );
  grad.addColorStop(0, "#3f3f46");
  grad.addColorStop(1, "#0a0a0a");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(239, 68, 68, ${0.4 + danger * 0.3})`;
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(-r * 0.32, -r * 0.32, r * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(r * 0.32, -r * 0.85);
  ctx.quadraticCurveTo(r * 0.95, -r * 1.3, r * 0.62, -r * 1.75);
  ctx.strokeStyle = "#78350f";
  ctx.lineWidth = Math.max(1.5, r * 0.12);
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(r * 0.62, -r * 1.75, r * (0.16 + danger * 0.08), 0, Math.PI * 2);
  ctx.fillStyle = danger > 0.5 ? "#fde047" : "#f97316";
  ctx.shadowColor = "#fbbf24";
  ctx.shadowBlur = r * 0.8;
  ctx.fill();

  ctx.restore();
}

// ─── Drawing: Arena / Title ───────────────────────────────────────────────────

function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, W, H);
}

function drawArena(ctx: CanvasRenderingContext2D, arena: Arena, mobile: boolean) {
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

function drawBlastFlash(
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  mobile: boolean,
  progress: number,
  point: { x: number; y: number },
) {
  const t = Math.min(progress, 1);

  ctx.save();
  const ringR = arena.size * 0.04 + t * arena.size * 0.34;
  const ringAlpha = Math.max(0, 1 - t) * 0.85;
  ctx.beginPath();
  ctx.arc(point.x, point.y, ringR, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(248, 113, 113, ${ringAlpha})`;
  ctx.lineWidth = Math.max(2, arena.size * 0.01);
  ctx.shadowColor = "rgba(248, 113, 113, 0.8)";
  ctx.shadowBlur = 16;
  ctx.stroke();
  ctx.restore();

  const alpha = Math.sin(t * Math.PI);
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fca5a5";
  ctx.shadowColor = "rgba(248, 113, 113, 0.85)";
  ctx.shadowBlur = 18;
  ctx.font = `900 ${mobile ? 18 : 26}px Arial, Helvetica, sans-serif`;
  ctx.fillText(
    "BOOM! GAME OVER",
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
  const bombRef = useRef<Bomb | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTRef = useRef<number>(0);
  const audioRef = useRef(createAudio());
  const phaseRef = useRef<Phase>("menu");
  const metAtRef = useRef<number | null>(null);
  const blastAtRef = useRef<number | null>(null);
  const blastPointRef = useRef<{ x: number; y: number } | null>(null);

  const [phase, setPhase] = useState<Phase>("menu");

  const setup = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { arena } = resizeCanvas(canvas);
    arenaRef.current = arena;
    if (phaseRef.current === "playing" && ballsRef.current.length === 0) {
      ballsRef.current = spawnBalls(arena);
      bombRef.current = spawnBomb(arena);
    }
  }, []);

  const startGame = useCallback(() => {
    audioRef.current.unlock();
    phaseRef.current = "playing";
    metAtRef.current = null;
    blastAtRef.current = null;
    setPhase("playing");
    const canvas = canvasRef.current;
    if (canvas) {
      const { arena } = resizeCanvas(canvas);
      arenaRef.current = arena;
      ballsRef.current = spawnBalls(arena);
      bombRef.current = spawnBomb(arena);
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
      drawWalls(ctx, arena, mobile);

      if (phaseRef.current === "playing") {
        const balls = ballsRef.current;
        const bomb = bombRef.current;
        const wallSegs = getWallSegments(arena);
        const wallHalfThickness = arena.size * WALL_THICKNESS_RATIO;

        for (const b of balls) {
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          if (b.glow > 0) b.glow = Math.max(0, b.glow - dt * 1.4);

          const playWallSound = () => {
            if (b.kind === "yin") audio.wallYin();
            else if (b.kind === "yang") audio.wallYang();
            else {
              audio.wallYin();
              audio.wallYang();
            }
          };

          resolveBoundaryCollision(b, arena, playWallSound);
          resolveWallSegCollisions(b, wallSegs, wallHalfThickness, playWallSound);
        }

        if (bomb) {
          bomb.x += bomb.vx * dt;
          bomb.y += bomb.vy * dt;
          bomb.pulse += dt * 4;

          resolveBoundaryCollision(bomb, arena, () => audio.wallBomb());
          resolveWallSegCollisions(bomb, wallSegs, wallHalfThickness, () =>
            audio.wallBomb(),
          );
        }

        let blasted = false;
        if (bomb && balls.length === 2) {
          for (const b of balls) {
            const dx = b.x - bomb.x;
            const dy = b.y - bomb.y;
            if (Math.hypot(dx, dy) < b.r + bomb.r) {
              blasted = true;
              break;
            }
          }
        }

        if (blasted && bomb) {
          blastPointRef.current = { x: bomb.x, y: bomb.y };
          blastAtRef.current = now;
          ballsRef.current = [];
          bombRef.current = null;
          audio.blast();
        } else if (balls.length === 2) {
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
            metAtRef.current = now;
            audio.meet();
          }
        } else if (balls.length === 1 && metAtRef.current !== null) {
          if (now - metAtRef.current > RESET_DELAY_MS) {
            ballsRef.current = [];
            bombRef.current = null;
            metAtRef.current = null;
            phaseRef.current = "menu";
            setPhase("menu");
          }
        }

        if (blastAtRef.current !== null) {
          if (now - blastAtRef.current > BLAST_DELAY_MS) {
            blastAtRef.current = null;
            blastPointRef.current = null;
            phaseRef.current = "menu";
            setPhase("menu");
          }
        }

        for (const b of ballsRef.current) drawBall(ctx, b);
        if (bombRef.current) drawBomb(ctx, bombRef.current);

        if (metAtRef.current !== null) {
          drawMeetFlash(ctx, arena, mobile, (now - metAtRef.current) / 900);
        }
        if (blastAtRef.current !== null && blastPointRef.current) {
          drawBlastFlash(
            ctx,
            arena,
            mobile,
            (now - blastAtRef.current) / BLAST_DELAY_MS,
            blastPointRef.current,
          );
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
