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
const MATCH_MS = 60000;
const RESULT_DELAY_MS = 5000;
// balls and orbs are 0.66x their original size
const BALL_RADIUS_RATIO = 0.014 * 1.5 * 0.66;
// orbs carry a "2x" / "½x" label, so they need enough face to stay readable
const ORB_RADIUS_RATIO = BALL_RADIUS_RATIO * 2.2;
const START_PER_TEAM = 4;
// after an orb hit a team ignores orbs briefly — without this a team that falls
// behind gets chain-halved to zero in seconds and the match never reaches 0:00
const TEAM_COOLDOWN_MS = 2500;
const MAX_PER_TEAM = 64;
const INK = "#0f172a";
const PAPER = "#f8fafc";
const WALL_THICKNESS_RATIO = 0.016;

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "menu" | "playing";
type BallKind = "yin" | "yang";
type OrbKind = "double" | "half";

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

function getOrbRadius(arena: Arena) {
  return arena.size * ORB_RADIUS_RATIO;
}

function clampToArena(v: number, min: number, span: number, r: number) {
  return Math.min(Math.max(v, min + r), min + span - r);
}

// picks a random point inside one of the four quadrant rooms
function randomPointInRoom(arena: Arena, col: 0 | 1, row: 0 | 1, r: number) {
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
  // black starts walled off in the top-left room, white in the bottom-right.
  // starting at 4 apiece takes three ½x hits to wipe a team out, so matches
  // usually run the full clock instead of ending in a quick knockout
  for (let i = 0; i < START_PER_TEAM; i++) {
    const p = randomPointInRoom(arena, 0, 0, r);
    balls.push(makeBall("yin", p.x, p.y, r));
  }
  for (let i = 0; i < START_PER_TEAM; i++) {
    const p = randomPointInRoom(arena, 1, 1, r);
    balls.push(makeBall("yang", p.x, p.y, r));
  }
  return balls;
}

function makeOrb(kind: OrbKind, arena: Arena): Orb {
  const r = getOrbRadius(arena);
  // orbs live in the two rooms the balls DON'T start in, one each
  const p =
    kind === "double"
      ? randomPointInRoom(arena, 1, 0, r)
      : randomPointInRoom(arena, 0, 1, r);
  const v = randomVelocity(ORB_SPEED);
  return {
    x: p.x,
    y: p.y,
    vx: v.vx,
    vy: v.vy,
    r,
    kind,
    pulse: Math.random() * Math.PI * 2,
  };
}

function spawnOrbs(arena: Arena): Orb[] {
  return [makeOrb("double", arena), makeOrb("half", arena)];
}

// ─── Team count changes ───────────────────────────────────────────────────────

function countOf(balls: Ball[], kind: BallKind) {
  return balls.reduce((n, b) => (b.kind === kind ? n + 1 : n), 0);
}

// doubles the team by cloning each of its balls next to its parent
function doubleTeam(balls: Ball[], kind: BallKind, arena: Arena): Ball[] {
  const team = balls.filter((b) => b.kind === kind);
  const clonesAllowed = Math.min(team.length, MAX_PER_TEAM - team.length);
  const clones: Ball[] = [];
  for (let i = 0; i < clonesAllowed; i++) {
    const parent = team[i];
    const angle = Math.random() * Math.PI * 2;
    const clone = makeBall(
      kind,
      clampToArena(
        parent.x + Math.cos(angle) * parent.r * 1.2,
        arena.x,
        arena.size,
        parent.r,
      ),
      clampToArena(
        parent.y + Math.sin(angle) * parent.r * 1.2,
        arena.y,
        arena.size,
        parent.r,
      ),
      parent.r,
    );
    clone.glow = 1;
    clones.push(clone);
  }
  return [...balls, ...clones];
}

// halves the team — a lone ball is wiped out entirely
function halveTeam(balls: Ball[], kind: BallKind): Ball[] {
  const team = balls.filter((b) => b.kind === kind);
  const survivors = team.length === 1 ? 0 : Math.floor(team.length / 2);
  const kept = new Set(team.slice(0, survivors));
  return balls.filter((b) => b.kind !== kind || kept.has(b));
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

// equal-mass elastic bounce — black and white just knock each other away now
function resolveBallPair(a: Ball, b: Ball) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distSq = dx * dx + dy * dy;
  const minDist = a.r + b.r;
  if (distSq >= minDist * minDist) return;

  const dist = Math.sqrt(distSq);
  // clones spawn on top of their parent, so handle the exact-overlap case
  const nx = dist > 0.0001 ? dx / dist : 1;
  const ny = dist > 0.0001 ? dy / dist : 0;

  const overlap = (minDist - dist) / 2;
  a.x -= nx * overlap;
  a.y -= ny * overlap;
  b.x += nx * overlap;
  b.y += ny * overlap;

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const vDotN = rvx * nx + rvy * ny;
  if (vDotN > 0) return; // already separating

  a.vx += vDotN * nx;
  a.vy += vDotN * ny;
  b.vx -= vDotN * nx;
  b.vy -= vDotN * ny;
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

  // bright rising arpeggio for a team doubling
  const gain2x = () => {
    const ctx = ensure();
    if (!ctx || ctx.state !== "running") return;
    [523.25, 659.25, 880].forEach((freq, i) => {
      window.setTimeout(() => ping(`gain${i}`, freq, 0.22, 0.13), i * 55);
    });
  };

  // dull falling pair for a team being halved
  const lose2x = () => {
    const ctx = ensure();
    if (!ctx || ctx.state !== "running") return;
    [392, 261.63].forEach((freq, i) => {
      window.setTimeout(() => ping(`lose${i}`, freq, 0.3, 0.14), i * 80);
    });
  };

  const horn = () => {
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
    wallOrb: () => ping("wallOrb", 220, 0.18, 0.08),
    gain2x,
    lose2x,
    horn,
    dispose: () => {
      stopMusic();
      void ac?.close();
      ac = null;
    },
  };
}

// ─── Drawing: Balls ───────────────────────────────────────────────────────────

// solid discs rather than full taijitu swirls — at 0.66x size the swirl turns to
// mud, while a black/white disc stays legible down to a few pixels
function drawBall(ctx: CanvasRenderingContext2D, ball: Ball) {
  const { r, glow } = ball;
  const isYin = ball.kind === "yin";

  ctx.save();
  ctx.translate(ball.x, ball.y);

  ctx.shadowColor = isYin
    ? `rgba(148, 163, 184, ${0.45 + glow * 0.5})`
    : `rgba(248, 250, 252, ${0.5 + glow * 0.5})`;
  ctx.shadowBlur = r * (0.9 + glow * 1.6);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = isYin ? INK : PAPER;
  ctx.fill();
  ctx.shadowBlur = 0;

  // black reads as a bright ring around a dark centre, white as a solid disc —
  // at this size that silhouette difference carries further than any inner dot
  if (isYin) {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(226, 232, 240, 0.95)";
    ctx.lineWidth = Math.max(1.4, r * 0.36);
    ctx.stroke();
  }

  ctx.restore();
}

// ─── Drawing: Power orbs ──────────────────────────────────────────────────────

function drawOrb(ctx: CanvasRenderingContext2D, orb: Orb) {
  const { r } = orb;
  const isDouble = orb.kind === "double";
  const pulse = 0.5 + Math.sin(orb.pulse) * 0.5;
  const hue = isDouble ? "52, 211, 153" : "248, 113, 113";

  ctx.save();
  ctx.translate(orb.x, orb.y);

  ctx.save();
  ctx.shadowColor = `rgba(${hue}, ${0.4 + pulse * 0.4})`;
  ctx.shadowBlur = r * (0.7 + pulse * 0.5);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  grad.addColorStop(0, isDouble ? "#134e4a" : "#4c1d1d");
  grad.addColorStop(1, "#0a0a0a");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${hue}, ${0.65 + pulse * 0.3})`;
  ctx.lineWidth = Math.max(1.4, r * 0.11);
  ctx.stroke();

  // label — no shadowBlur on fillText, it ghosts badly on iOS
  ctx.shadowBlur = 0;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = isDouble ? "#a7f3d0" : "#fecaca";
  ctx.font = `900 ${Math.max(9, r * 0.78)}px Arial, Helvetica, sans-serif`;
  ctx.fillText(isDouble ? "2x" : "½x", 0, r * 0.06);

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

  // no shadowBlur on fillText — it ghosts on iOS; a flat dark background is enough
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "#f8fafc";
  ctx.font = `900 ${mobile ? 22 : 32}px Arial, Helvetica, sans-serif`;
  const cx = x + size / 2;
  ctx.fillText("Black vs White:", cx, y - (mobile ? 92 : 96));
  ctx.fillText("who owns 60 seconds?", cx, y - (mobile ? 68 : 60));

  ctx.font = `700 ${mobile ? 12 : 14}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = "rgba(248, 250, 252, 0.68)";
  ctx.fillText("Grab 2x to multiply. Touch ½x and half your army dies", cx, y - (mobile ? 46 : 36));
  ctx.restore();
}

// live scoreboard: black count · clock · white count
function drawScoreboard(
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  mobile: boolean,
  yin: number,
  yang: number,
  msLeft: number,
) {
  const cx = arena.x + arena.size / 2;
  const baseY = arena.y - (mobile ? 16 : 12);
  const dotR = mobile ? 7 : 9;
  const gap = mobile ? 52 : 68;
  const seconds = Math.max(0, Math.ceil(msLeft / 1000));

  ctx.save();
  ctx.textBaseline = "middle";

  // clock in the middle, turning red in the last ten seconds
  ctx.textAlign = "center";
  ctx.font = `900 ${mobile ? 20 : 24}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = seconds <= 10 ? "#fca5a5" : "#f8fafc";
  ctx.fillText(`0:${String(seconds).padStart(2, "0")}`, cx, baseY);

  ctx.font = `900 ${mobile ? 17 : 21}px Arial, Helvetica, sans-serif`;

  // black team on the left
  ctx.beginPath();
  ctx.arc(cx - gap - dotR * 2.2, baseY, dotR, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.strokeStyle = "rgba(226, 232, 240, 0.85)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.fillStyle = "#e2e8f0";
  ctx.fillText(String(yin), cx - gap, baseY);

  // white team on the right
  ctx.beginPath();
  ctx.arc(cx + gap + dotR * 2.2, baseY, dotR, 0, Math.PI * 2);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.textAlign = "right";
  ctx.fillStyle = "#e2e8f0";
  ctx.fillText(String(yang), cx + gap, baseY);

  ctx.restore();
}

function drawResult(
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  mobile: boolean,
  progress: number,
  text: string,
) {
  const alpha = Math.min(progress * 3, 1);
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f8fafc";
  ctx.font = `900 ${mobile ? 20 : 28}px Arial, Helvetica, sans-serif`;
  ctx.fillText(
    text,
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
  const orbsRef = useRef<Orb[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTRef = useRef<number>(0);
  const audioRef = useRef(createAudio());
  const phaseRef = useRef<Phase>("menu");
  const startedAtRef = useRef<number | null>(null);
  const endedAtRef = useRef<number | null>(null);
  const resultRef = useRef<string>("");
  const cooldownRef = useRef<Record<BallKind, number>>({ yin: 0, yang: 0 });
  const finalCountsRef = useRef<{ yin: number; yang: number }>({ yin: 0, yang: 0 });

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
    startedAtRef.current = performance.now();
    endedAtRef.current = null;
    resultRef.current = "";
    cooldownRef.current = { yin: 0, yang: 0 };
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
      drawWalls(ctx, arena, mobile);

      if (phaseRef.current === "playing") {
        const orbs = orbsRef.current;
        const wallSegs = getWallSegments(arena);
        const wallHalfThickness = arena.size * WALL_THICKNESS_RATIO;
        const running = endedAtRef.current === null;

        for (const b of ballsRef.current) {
          if (running) {
            b.x += b.vx * dt;
            b.y += b.vy * dt;
          }
          if (b.glow > 0) b.glow = Math.max(0, b.glow - dt * 1.4);

          const playWallSound = () =>
            b.kind === "yin" ? audio.wallYin() : audio.wallYang();

          resolveBoundaryCollision(b, arena, playWallSound);
          resolveWallSegCollisions(b, wallSegs, wallHalfThickness, playWallSound);
        }

        for (const orb of orbs) {
          if (running) {
            orb.x += orb.vx * dt;
            orb.y += orb.vy * dt;
          }
          orb.pulse += dt * 4;

          resolveBoundaryCollision(orb, arena, () => audio.wallOrb());
          resolveWallSegCollisions(orb, wallSegs, wallHalfThickness, () =>
            audio.wallOrb(),
          );
        }

        if (running) {
          // balls bounce off each other now — opposite colours no longer merge
          const balls = ballsRef.current;
          for (let i = 0; i < balls.length; i++) {
            for (let j = i + 1; j < balls.length; j++) {
              resolveBallPair(balls[i], balls[j]);
            }
          }

          // a ball touching an orb doubles or halves its whole team, then the
          // orb jumps to a fresh spot so one hit can't cascade
          for (let i = 0; i < orbs.length; i++) {
            const orb = orbs[i];
            const hit = ballsRef.current.find(
              (b) =>
                Math.hypot(b.x - orb.x, b.y - orb.y) < b.r + orb.r &&
                now >= cooldownRef.current[b.kind],
            );
            if (!hit) continue;

            cooldownRef.current[hit.kind] = now + TEAM_COOLDOWN_MS;

            if (orb.kind === "double") {
              ballsRef.current = doubleTeam(ballsRef.current, hit.kind, arena);
              audio.gain2x();
            } else {
              ballsRef.current = halveTeam(ballsRef.current, hit.kind);
              audio.lose2x();
            }
            orbs[i] = makeOrb(orb.kind, arena);
          }

          const yin = countOf(ballsRef.current, "yin");
          const yang = countOf(ballsRef.current, "yang");
          const elapsed = now - (startedAtRef.current ?? now);

          // a wipeout ends it early; otherwise the clock decides
          if (elapsed >= MATCH_MS || yin === 0 || yang === 0) {
            endedAtRef.current = now;
            finalCountsRef.current = { yin, yang };
            resultRef.current =
              yin === yang
                ? `DRAW — ${yin} EACH`
                : yin > yang
                  ? `BLACK WINS ${yin} – ${yang}`
                  : `WHITE WINS ${yang} – ${yin}`;
            audio.horn();
          }
        }

        for (const b of ballsRef.current) drawBall(ctx, b);
        for (const orb of orbs) drawOrb(ctx, orb);

        const ended = endedAtRef.current;
        const counts = ended
          ? finalCountsRef.current
          : {
              yin: countOf(ballsRef.current, "yin"),
              yang: countOf(ballsRef.current, "yang"),
            };
        const msLeft = ended
          ? Math.max(0, MATCH_MS - (ended - (startedAtRef.current ?? ended)))
          : MATCH_MS - (now - (startedAtRef.current ?? now));

        drawScoreboard(ctx, arena, mobile, counts.yin, counts.yang, msLeft);

        if (ended !== null) {
          drawResult(ctx, arena, mobile, (now - ended) / 600, resultRef.current);
          if (now - ended > RESULT_DELAY_MS) {
            ballsRef.current = [];
            orbsRef.current = [];
            endedAtRef.current = null;
            startedAtRef.current = null;
            phaseRef.current = "menu";
            setPhase("menu");
          }
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
