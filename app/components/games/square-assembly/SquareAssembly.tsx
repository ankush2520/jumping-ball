"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { drawCanvasWatermark } from "@/app/lib/watermark";

// ─── Types ────────────────────────────────────────────────────────────────────

type Point = { x: number; y: number };
type PieceKind = "square";
type CellKind = "empty" | "square";
type GamePhase = "editor" | "simulation";

type EdgeSlot = { index: number; attached: boolean };

type Piece = {
  id: number;
  kind: PieceKind;
  color: string;
  localX: number;
  localY: number;
  localRotation: number;
  vertices: Point[];
  edges: EdgeSlot[];
  filled: boolean; // false = ghost slot on cluster, true = real piece
};

type Body = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  angularVelocity: number;
  pieces: Piece[];
  glowColor: "none" | "green" | "red";
  glowTime: number;
  attachPulse: number;
  isCluster: boolean; // the moving target body
};

type Arena = {
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
};

type Collision = { normal: Point; overlap: number };

type AssemblyAudio = {
  unlock: () => Promise<void>;
  playCollision: (bodyId: number) => void;
  playAttach: () => void;
  playComplete: () => void;
  dispose: () => void;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PHYSICS_SUBSTEPS = 4;
const RESTITUTION = 1.0;
const GRID_DIVISIONS = 25;
const BODY_SPEED_RATIO = 0.15;
const GLOW_DURATION = 0.5;
const MAX_DT = 1 / 30;

const SQUARE_COLOR = "#d77026";

let sharedAudioContext: AudioContext | null = null;
let _bodyIdCounter = 0;
let _pieceIdCounter = 0;

// ─── Math helpers ─────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const rng = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

const rotatePoint = ({ x, y }: Point, a: number): Point => ({
  x: x * Math.cos(a) - y * Math.sin(a),
  y: x * Math.sin(a) + y * Math.cos(a),
});

const subPoints = (a: Point, b: Point): Point => ({
  x: a.x - b.x,
  y: a.y - b.y,
});
const scalePoint = (p: Point, s: number): Point => ({ x: p.x * s, y: p.y * s });
const dotProduct = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const distancePt = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const normalize = ({ x, y }: Point): Point => {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
};

// ─── Shape geometry ───────────────────────────────────────────────────────────

const getSquareVerts = (s: number): Point[] => {
  const h = s / 2;
  return [
    { x: -h, y: -h },
    { x: h, y: -h },
    { x: h, y: h },
    { x: -h, y: h },
  ];
};

const getPieceLocalVerts = (_kind: PieceKind, s: number): Point[] =>
  getSquareVerts(s);

const getEdgeSlots = (): EdgeSlot[] =>
  Array.from({ length: 4 }, (_, i) => ({ index: i, attached: false }));

// ─── Audio ────────────────────────────────────────────────────────────────────

const createAudio = (): AssemblyAudio => {
  let audio: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  // Per-body cooldown map: bodyId → last play time. Allows simultaneous hits on different bodies.
  const bodyHitTime = new Map<number, number>();
  let noteIdx = 0; // rotates through pentatonic so consecutive collisions sound different
  // C major pentatonic — soft, non-jarring at medium octave
  const pentatonic = [261.63, 329.63, 392.0, 440.0, 523.25, 659.25, 783.99];

  const ensureAudio = () => {
    if (audio) return audio;
    const w = window as Window &
      typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const AudioContextClass = w.AudioContext || w.webkitAudioContext;
    if (!AudioContextClass) return null;
    sharedAudioContext = sharedAudioContext || new AudioContextClass();
    audio = sharedAudioContext;
    if (!audio) return null;
    masterGain = audio.createGain();
    masterGain.gain.value = 0.18;
    masterGain.connect(audio.destination);
    return audio;
  };

  // Soft bell-like sine tone: slow attack, long gentle release
  const playBell = (freq: number, peakGain: number, attackSec: number, releaseSec: number, when = 0) => {
    const ac = ensureAudio();
    if (!ac || ac.state !== "running" || !masterGain) return;
    const now = ac.currentTime + when;
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1800;
    filter.Q.value = 0.5;
    filter.connect(masterGain);
    [
      { ratio: 1, g: peakGain },
      { ratio: 2, g: peakGain * 0.3 },
      { ratio: 3, g: peakGain * 0.08 },
    ].forEach(({ ratio, g }) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * ratio * rng(0.999, 1.001), now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(g, now + attackSec);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + attackSec + releaseSec);
      osc.connect(gain);
      gain.connect(filter);
      osc.start(now);
      osc.stop(now + attackSec + releaseSec + 0.05);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    });
    window.setTimeout(() => filter.disconnect(), (when + attackSec + releaseSec + 0.2) * 1000);
  };

  return {
    unlock: async () => {
      const ac = ensureAudio();
      if (ac?.state === "suspended") await ac.resume();
    },
    playCollision: (bodyId: number) => {
      const ac = ensureAudio();
      if (!ac || ac.state !== "running") return;
      const now = ac.currentTime;
      // Each body gets its own 100ms cooldown — simultaneous hits on different bodies all play
      const last = bodyHitTime.get(bodyId) ?? 0;
      if (now - last < 0.10) return;
      bodyHitTime.set(bodyId, now);
      // Advance note index so each collision gets a unique note in sequence
      const freq = pentatonic[noteIdx % pentatonic.length];
      noteIdx = (noteIdx + 1) % pentatonic.length;
      playBell(freq * 0.5, 0.055, 0.010, 0.32);
    },
    playAttach: () => {
      // Two rising notes — a gentle "click-chime"
      const base = pentatonic[2]; // G4 = 392 Hz
      playBell(base, 0.14, 0.01, 0.9);
      playBell(base * 1.5, 0.10, 0.01, 1.1, 0.09);
    },
    playComplete: () => {
      // Soft ascending arpeggio: C-E-G-C
      const chord = [261.63, 329.63, 392.0, 523.25];
      chord.forEach((f, i) => playBell(f, 0.18, 0.02, 2.2, i * 0.13));
    },
    dispose: () => {
      masterGain?.disconnect();
      masterGain = null;
      audio = null;
    },
  };
};

// ─── Canvas / arena ───────────────────────────────────────────────────────────

// Layout (canvas-space, top to bottom):
//   topMargin  →  headingH (text here)  →  4×cellSize gap  →  arena  →  botPad  →  bottomMargin
//
// headingH must clear the home-button overlay (~44px) so text never overlaps it.
// The whole block is centered in the canvas so topMargin ≥ 0 absorbs leftover space.
//
// Algebraic solve for arenaSize when height-constrained (topMargin → 0):
//   headingH + 4*(A/G) + A + botPad = height
//   A * (1 + 4/G) = height - headingH - botPad
const resizeCanvas = (canvas: HTMLCanvasElement): Arena => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.offsetWidth || window.innerWidth;
  const height = canvas.offsetHeight || window.innerHeight;
  const ctx = canvas.getContext("2d");
  const isMobile = width < 600;
  const hPad = isMobile ? width * 0.06 : 28;
  const headingH = isMobile ? 120 : 100; // clears home-button + leaves room for heading text
  const botPad = 16;
  const availW = Math.max(220, width - hPad);
  const arenaSizeFromH = (height - headingH - botPad) / (1 + 4 / GRID_DIVISIONS);
  const arenaSize = clamp(Math.min(availW, Math.max(220, arenaSizeFromH)), 220, 920);
  const cellSize = arenaSize / GRID_DIVISIONS;
  const gapH = 4 * cellSize;
  // Center the full content block vertically; extra space becomes symmetric top/bottom margin
  const blockH = headingH + gapH + arenaSize + botPad;
  const topMargin = Math.max(0, (height - blockH) / 2);
  const arenaY = topMargin + headingH + gapH;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  if (ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
  }
  return {
    x: (width - arenaSize) / 2,
    y: arenaY,
    width: arenaSize,
    height: arenaSize,
    dpr,
  };
};

// ─── World transforms ─────────────────────────────────────────────────────────

const getPieceWorldTransform = (body: Body, piece: Piece) => {
  const lp = rotatePoint({ x: piece.localX, y: piece.localY }, body.rotation);
  return {
    x: body.x + lp.x,
    y: body.y + lp.y,
    rotation: body.rotation + piece.localRotation,
  };
};

const getPieceWorldVerts = (body: Body, piece: Piece): Point[] => {
  const tr = getPieceWorldTransform(body, piece);
  return piece.vertices.map((v) => {
    const r = rotatePoint(v, tr.rotation);
    return { x: tr.x + r.x, y: tr.y + r.y };
  });
};

const getBodyWorldVerts = (body: Body): Point[] =>
  body.pieces.flatMap((p) => getPieceWorldVerts(body, p));

// ─── Body factory ─────────────────────────────────────────────────────────────

const getShapeSize = (arena: Arena) => arena.width / GRID_DIVISIONS;
const getBodySpeed = (arena: Arena) => arena.width * BODY_SPEED_RATIO;

const preserveBodySpeed = (body: Body, arena: Arena) => {
  const target = getBodySpeed(arena);
  const cur = Math.hypot(body.vx, body.vy);
  if (cur < 0.001) {
    const a = rng(0, Math.PI * 2);
    body.vx = Math.cos(a) * target;
    body.vy = Math.sin(a) * target;
    return;
  }
  body.vx = (body.vx / cur) * target;
  body.vy = (body.vy / cur) * target;
};

// Build the moving cluster from the user's grid design.
// Pieces start as ghost (filled=false); loose pieces snap in over time.
const createClusterBody = (
  targets: Array<{ col: number; row: number; kind: PieceKind }>,
  arena: Arena,
): Body => {
  const s = getShapeSize(arena);
  const avgCol =
    targets.reduce((sum, t) => sum + t.col, 0) / targets.length;
  const avgRow =
    targets.reduce((sum, t) => sum + t.row, 0) / targets.length;

  const pieces: Piece[] = targets.map((t) => ({
    id: _pieceIdCounter++,
    kind: t.kind,
    color: SQUARE_COLOR,
    localX: (t.col - avgCol) * s,
    localY: (t.row - avgRow) * s,
    localRotation: 0,
    vertices: getPieceLocalVerts(t.kind, s),
    edges: getEdgeSlots(),
    filled: false,
  }));

  const speed = getBodySpeed(arena);
  const angle = rng(0, Math.PI * 2);
  const spawnX =
    arena.x + arena.width * (0.3 + Math.random() * 0.4);
  const spawnY =
    arena.y + arena.height * (0.3 + Math.random() * 0.4);

  return {
    id: _bodyIdCounter++,
    x: spawnX,
    y: spawnY,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    rotation: 0,
    angularVelocity: 0,
    pieces,
    glowColor: "none",
    glowTime: 0,
    attachPulse: 0,
    isCluster: true,
  };
};

const trySpawnShape = (
  arena: Arena,
  bodies: Body[],
  _cluster: Body | null,
): Body | null => {
  if (bodies.length >= 200) return null;
  const s = getShapeSize(arena);
  let spawnX = 0, spawnY = 0, found = false;

  // Try progressively tighter clearance so we always fit every square
  for (const clearanceMult of [2.0, 1.4, 1.0, 0.6]) {
    const clearance = s * clearanceMult;
    const margin = s;
    for (let attempt = 0; attempt < 200; attempt++) {
      const cx = arena.x + margin + Math.random() * (arena.width - margin * 2);
      const cy = arena.y + margin + Math.random() * (arena.height - margin * 2);
      const clear = bodies.every((body) => {
        if (body.isCluster) return true;
        return body.pieces.every((piece) => {
          const tr = getPieceWorldTransform(body, piece);
          return distancePt({ x: tr.x, y: tr.y }, { x: cx, y: cy }) > clearance;
        });
      });
      if (clear) { spawnX = cx; spawnY = cy; found = true; break; }
    }
    if (found) break;
  }

  if (!found) return null;

  const kind: PieceKind = "square";

  const speed = getBodySpeed(arena);
  const angle = rng(0, Math.PI * 2);

  return {
    id: _bodyIdCounter++,
    x: spawnX,
    y: spawnY,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    rotation: (Math.floor(Math.random() * 4) * Math.PI) / 2,
    angularVelocity: 0,
    pieces: [
      {
        id: _pieceIdCounter++,
        kind,
        color: SQUARE_COLOR,
        localX: 0,
        localY: 0,
        localRotation: 0,
        vertices: getPieceLocalVerts(kind, s),
        edges: getEdgeSlots(),
        filled: true,
      },
    ],
    glowColor: "none",
    glowTime: 0,
    attachPulse: 0,
    isCluster: false,
  };
};

// ─── SAT collision ────────────────────────────────────────────────────────────

const projectPolygon = (verts: Point[], axis: Point) => {
  let min = dotProduct(verts[0], axis),
    max = min;
  for (const v of verts) {
    const p = dotProduct(v, axis);
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return { min, max };
};

const getAxes = (verts: Point[]): Point[] =>
  verts.map((v, i) => {
    const n = verts[(i + 1) % verts.length];
    const e = subPoints(n, v);
    return normalize({ x: -e.y, y: e.x });
  });

const getPolyCollision = (
  aV: Point[],
  bV: Point[],
  aC: Point,
  bC: Point,
): Collision | null => {
  const axes = [...getAxes(aV), ...getAxes(bV)];
  let minOverlap = Infinity,
    minAxis = axes[0];
  for (const axis of axes) {
    const a = projectPolygon(aV, axis);
    const b = projectPolygon(bV, axis);
    const overlap = Math.min(a.max, b.max) - Math.max(a.min, b.min);
    if (overlap <= 0) return null;
    if (overlap < minOverlap) {
      minOverlap = overlap;
      minAxis = axis;
    }
  }
  const d = subPoints(bC, aC);
  return {
    normal: dotProduct(d, minAxis) < 0 ? scalePoint(minAxis, -1) : minAxis,
    overlap: minOverlap,
  };
};

const getBodyCollision = (a: Body, b: Body): Collision | null => {
  // For the cluster, only filled pieces have solid geometry.
  // Ghost slots stay passable so loose squares can approach and snap in.
  const aPieces = a.isCluster ? a.pieces.filter((p) => p.filled) : a.pieces;
  const bPieces = b.isCluster ? b.pieces.filter((p) => p.filled) : b.pieces;
  if (aPieces.length === 0 || bPieces.length === 0) return null;
  let best: Collision | null = null;
  for (const ap of aPieces) {
    for (const bp of bPieces) {
      const col = getPolyCollision(
        getPieceWorldVerts(a, ap),
        getPieceWorldVerts(b, bp),
        { x: a.x, y: a.y },
        { x: b.x, y: b.y },
      );
      if (col && (!best || col.overlap > best.overlap)) best = col;
    }
  }
  return best;
};

// ─── Target snapping ──────────────────────────────────────────────────────────

// When a loose piece overlaps a ghost slot on the moving cluster, it snaps in.
// Snap threshold grows gently over time so late-game stragglers always eventually land.
const snapToCluster = (
  bodies: Body[],
  cluster: Body,
  arena: Arena,
  elapsedSec: number,
  onSnap: () => void,
) => {
  const s = getShapeSize(arena);
  // 0–50 s: stays at 0.65 cells; 50 s+: grows to 2.5 cells over 40 s
  const magnetT = elapsedSec > 20 ? Math.min(1, (elapsedSec - 20) / 40) : 0;
  const threshold = s * (0.65 + magnetT * 1.85);

  for (let i = bodies.length - 1; i >= 0; i--) {
    const body = bodies[i];
    if (body.isCluster) continue;
    const piece = body.pieces[0];
    const wt = getPieceWorldTransform(body, piece);

    for (const cp of cluster.pieces) {
      if (cp.filled) continue;
      const cwt = getPieceWorldTransform(cluster, cp);
      if (Math.hypot(wt.x - cwt.x, wt.y - cwt.y) < threshold) {
        cp.filled = true;
        bodies.splice(i, 1);
        cluster.glowColor = "green";
        cluster.glowTime = GLOW_DURATION;
        cluster.attachPulse = 1;
        onSnap();
        break;
      }
    }
  }
};

// Phase 1 (0–50 s): gentle velocity steering toward nearest unfilled slot.
// Phase 2 (50 s+): escalating magnet — stronger steering + direct velocity pull
//                  + a position nudge that bypasses bouncing entirely.
// The position nudge is the key to guaranteeing completion: wall reflections
// reset velocity direction but can't undo a direct position shift.
const applyClusterAttraction = (
  bodies: Body[],
  cluster: Body,
  arena: Arena,
  subDt: number,
  elapsedSec: number,
) => {
  const s = getShapeSize(arena);
  const magnetActive = elapsedSec >= 20;
  const magnetT = magnetActive ? Math.min(1, (elapsedSec - 20) / 40) : 0;

  // Attract radius: 3.5 cells normally, grows to fill entire arena in magnet phase
  const attractRadius = magnetActive
    ? arena.width * 2           // whole arena when magnet is on
    : s * 3.5;

  // Steer: gentle normally, strong in magnet phase
  const maxSteerPerSec = magnetActive ? 4 + magnetT * 10 : 1.8;

  // Direct pull: velocity component added toward slot each substep (magnet only)
  const pullAccel = magnetT * 280; // px / s²

  // Position nudge: direct position shift toward slot, bypasses velocity (magnet only)
  // Grows from 0 → 90 px/s over 40 s after trigger
  const nudgeSpeed = magnetT * 90; // px / s

  for (const body of bodies) {
    if (body.isCluster) continue;
    const piece = body.pieces[0];
    const wt = getPieceWorldTransform(body, piece);

    let nearDist = Infinity;
    let nearX = 0, nearY = 0;
    for (const cp of cluster.pieces) {
      if (cp.filled) continue;
      const cwt = getPieceWorldTransform(cluster, cp);
      const d = Math.hypot(cwt.x - wt.x, cwt.y - wt.y);
      if (d < nearDist) { nearDist = d; nearX = cwt.x; nearY = cwt.y; }
    }

    if (nearDist >= attractRadius || nearDist < 0.5) continue;

    const dx = nearX - wt.x;
    const dy = nearY - wt.y;
    const invDist = 1 / nearDist;

    // ── 1. Velocity steering (bend direction toward slot) ──
    const falloff = Math.max(0, 1 - nearDist / attractRadius);
    const steerPerSec = maxSteerPerSec * falloff * falloff;
    const targetAngle = Math.atan2(dy, dx);
    const curAngle = Math.atan2(body.vy, body.vx);
    let diff = targetAngle - curAngle;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const steer = Math.sign(diff) * Math.min(Math.abs(diff), steerPerSec * subDt);
    const curSpeed = Math.hypot(body.vx, body.vy);
    if (curSpeed > 0.01) {
      const newAngle = curAngle + steer;
      body.vx = Math.cos(newAngle) * curSpeed;
      body.vy = Math.sin(newAngle) * curSpeed;
    }

    if (!magnetActive) continue;

    // ── 2. Velocity pull (acceleration toward slot) ──
    body.vx += dx * invDist * pullAccel * subDt;
    body.vy += dy * invDist * pullAccel * subDt;
    // Keep speed from going wild — cap at 2× normal
    const newSpeed = Math.hypot(body.vx, body.vy);
    const speedCap = getBodySpeed(arena) * (1 + magnetT);
    if (newSpeed > speedCap) {
      body.vx = (body.vx / newSpeed) * speedCap;
      body.vy = (body.vy / newSpeed) * speedCap;
    }

    // ── 3. Position nudge (direct drift, immune to wall reflections) ──
    const moveDist = Math.min(nearDist * 0.9, nudgeSpeed * subDt);
    body.x += dx * invDist * moveDist;
    body.y += dy * invDist * moveDist;
  }
};

// ─── Physics ──────────────────────────────────────────────────────────────────

const resolveWallCollisions = (
  arena: Arena,
  bodies: Body[],
  onCollide: (bodyId: number) => void,
) => {
  const L = arena.x,
    R = arena.x + arena.width,
    T = arena.y,
    B = arena.y + arena.height;
  bodies.forEach((body) => {
    const verts = getBodyWorldVerts(body);
    const minX = Math.min(...verts.map((v) => v.x));
    const maxX = Math.max(...verts.map((v) => v.x));
    const minY = Math.min(...verts.map((v) => v.y));
    const maxY = Math.max(...verts.map((v) => v.y));
    let hit = false;
    if (minX < L) {
      body.x += L - minX;
      body.vx = Math.abs(body.vx) * RESTITUTION;
      hit = true;
    }
    if (maxX > R) {
      body.x -= maxX - R;
      body.vx = -Math.abs(body.vx) * RESTITUTION;
      hit = true;
    }
    if (minY < T) {
      body.y += T - minY;
      body.vy = Math.abs(body.vy) * RESTITUTION;
      hit = true;
    }
    if (maxY > B) {
      body.y -= maxY - B;
      body.vy = -Math.abs(body.vy) * RESTITUTION;
      hit = true;
    }
    if (hit) {
      preserveBodySpeed(body, arena);
      body.glowColor = "red";
      body.glowTime = Math.max(body.glowTime, 0.16);
      onCollide(body.id);
    }
  });
};

const resolveBodyCollisions = (
  arena: Arena,
  bodies: Body[],
  audio: AssemblyAudio | null,
  clusterSolid: boolean,
) => {
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i],
        b = bodies[j];
      // After 50 s merge time, cluster becomes ghost — loose squares pass through
      if (!clusterSolid && (a.isCluster || b.isCluster)) continue;
      const col = getBodyCollision(a, b);
      if (!col) continue;
      const { normal, overlap } = col;
      const correction = overlap * 0.6 + 0.5;
      // Cluster is heavy — push it much less than a loose piece
      const aShare = a.isCluster ? 0.05 : b.isCluster ? 0.95 : 0.5;
      const bShare = 1 - aShare;
      a.x -= normal.x * correction * aShare;
      a.y -= normal.y * correction * aShare;
      b.x += normal.x * correction * bShare;
      b.y += normal.y * correction * bShare;
      const relV = subPoints({ x: b.vx, y: b.vy }, { x: a.vx, y: a.vy });
      const vn = dotProduct(relV, normal);
      if (vn < 0) {
        // Cluster mass = total piece count so it barely deflects
        const ma = a.pieces.length;
        const mb = b.pieces.length;
        const impulse = (-(1 + RESTITUTION) * vn) / (1 / ma + 1 / mb);
        a.vx -= (impulse * normal.x) / ma;
        a.vy -= (impulse * normal.y) / ma;
        b.vx += (impulse * normal.x) / mb;
        b.vy += (impulse * normal.y) / mb;
        preserveBodySpeed(a, arena);
        preserveBodySpeed(b, arena);
      }
      if (!a.isCluster) { a.glowColor = "red"; a.glowTime = 0.25; }
      if (!b.isCluster) { b.glowColor = "red"; b.glowTime = 0.25; }
      // Play for both bodies — each gets its own per-body cooldown and a unique note
      audio?.playCollision(a.id);
      audio?.playCollision(b.id);
    }
  }
};

// ─── Drawing ──────────────────────────────────────────────────────────────────

const getFittedFontSize = (
  ctx: CanvasRenderingContext2D,
  lines: string[],
  maxWidth: number,
  maxSize: number,
  minSize: number,
) => {
  let size = maxSize;
  while (size > minSize) {
    ctx.font = `900 ${size}px Arial, Helvetica, sans-serif`;
    if (lines.every((line) => ctx.measureText(line).width <= maxWidth))
      return size;
    size -= 1;
  }
  return minSize;
};

const getHeadingLines = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fontSize: number,
) => {
  ctx.font = `900 ${fontSize}px Arial, Helvetica, sans-serif`;
  if (ctx.measureText(text).width <= maxWidth) return [text];
  const words = text.split(" ");
  const midpoint = Math.ceil(words.length / 2);
  let bestLines = [
    words.slice(0, midpoint).join(" "),
    words.slice(midpoint).join(" "),
  ];
  let bestWidth = Number.POSITIVE_INFINITY;
  for (let split = 1; split < words.length; split++) {
    const lines = [
      words.slice(0, split).join(" "),
      words.slice(split).join(" "),
    ];
    const widest = Math.max(
      ctx.measureText(lines[0]).width,
      ctx.measureText(lines[1]).width,
    );
    if (widest < bestWidth) {
      bestWidth = widest;
      bestLines = lines;
    }
  }
  return bestLines;
};

const drawArenaFrame = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  headingText: string,
) => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = ctx.canvas.width / dpr;
  const H = ctx.canvas.height / dpr;
  const isMobile = W < 600;
  const lineW = isMobile ? 2.25 : 3;
  const glowB = 11;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, W, H);

  const bg = ctx.createRadialGradient(
    arena.x + arena.width * 0.58,
    arena.y + arena.height * 0.46,
    20,
    arena.x + arena.width * 0.5,
    arena.y + arena.height * 0.5,
    arena.width * 0.72,
  );
  bg.addColorStop(0, "rgba(244, 63, 94, 0.07)");
  bg.addColorStop(0.48, "rgba(59, 130, 246, 0.06)");
  bg.addColorStop(1, "rgba(2, 6, 23, 0)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  drawCanvasWatermark(ctx, W, H);

  ctx.save();
  ctx.strokeStyle = "rgba(2, 6, 23, 0.5)";
  ctx.lineWidth = isMobile ? 9 : 12;
  ctx.strokeRect(arena.x + 6, arena.y + 6, arena.width - 12, arena.height - 12);
  ctx.strokeStyle = "rgba(124, 143, 163, 0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    arena.x + 10,
    arena.y + 10,
    arena.width - 20,
    arena.height - 20,
  );
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "rgba(124, 143, 163, 0.32)";
  ctx.shadowBlur = glowB;
  ctx.strokeStyle = "rgba(124, 143, 163, 0.82)";
  ctx.lineWidth = lineW;
  ctx.lineCap = "round";
  ctx.strokeRect(arena.x, arena.y, arena.width, arena.height);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(226, 232, 240, 0.08)";
  ctx.lineWidth = 1;
  ctx.strokeRect(arena.x + 5, arena.y + 5, arena.width - 10, arena.height - 10);
  if (headingText) {
    // Heading sits in the space above the arena. Bottom of text = arena.y - 4*cellSize.
    const s = arena.width / GRID_DIVISIONS;
    const textBottomY = arena.y - 4 * s;
    const maxHeadingWidth = Math.min(arena.width + 8, W - 24);
    const maxHeadingSize = isMobile ? 22 : 28;
    const headingLines = getHeadingLines(ctx, headingText, maxHeadingWidth, maxHeadingSize);
    const headingSize = getFittedFontSize(
      ctx,
      headingLines,
      maxHeadingWidth,
      maxHeadingSize,
      isMobile ? 14 : 17,
    );
    ctx.fillStyle = "rgba(241, 245, 249, 0.95)";
    ctx.shadowColor = "rgba(148, 163, 184, 0.35)";
    ctx.shadowBlur = isMobile ? 8 : 14;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.font = `900 ${headingSize}px Arial, Helvetica, sans-serif`;
    const lineHeight = headingSize * 1.18;
    headingLines.forEach((line, index) => {
      ctx.fillText(
        line,
        arena.x + arena.width / 2,
        textBottomY - (headingLines.length - index - 1) * lineHeight,
      );
    });
  }
  ctx.restore();
};

const drawEditorGrid = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  grid: CellKind[][],
) => {
  const s = getShapeSize(arena);

  for (let r = 0; r < GRID_DIVISIONS; r++) {
    for (let c = 0; c < GRID_DIVISIONS; c++) {
      ctx.fillStyle = "rgba(100, 130, 160, 0.04)";
      ctx.fillRect(arena.x + c * s + 0.5, arena.y + r * s + 0.5, s - 1, s - 1);
    }
  }

  ctx.save();
  ctx.strokeStyle = "rgba(100, 120, 150, 0.22)";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= GRID_DIVISIONS; i++) {
    ctx.beginPath();
    ctx.moveTo(arena.x + i * s, arena.y);
    ctx.lineTo(arena.x + i * s, arena.y + arena.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(arena.x, arena.y + i * s);
    ctx.lineTo(arena.x + arena.width, arena.y + i * s);
    ctx.stroke();
  }
  ctx.restore();

  for (let r = 0; r < GRID_DIVISIONS; r++) {
    for (let c = 0; c < GRID_DIVISIONS; c++) {
      const kind = grid[r][c];
      if (kind === "empty") continue;
      const cx = arena.x + (c + 0.5) * s;
      const cy = arena.y + (r + 0.5) * s;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = SQUARE_COLOR;
      ctx.shadowColor = "rgba(215,112,38,0.7)";
      ctx.shadowBlur = 7;
      const h = s / 2 - 1;
      ctx.fillRect(-h, -h, h * 2, h * 2);
      ctx.restore();
    }
  }
};

// Draws each body. Ghost cluster pieces (filled=false) are drawn faded.
const drawBody = (ctx: CanvasRenderingContext2D, body: Body) => {
  const glowCol =
    body.glowColor === "green"
      ? "rgba(34, 197, 94, 0.9)"
      : body.glowColor === "red"
        ? "rgba(239, 68, 68, 0.9)"
        : "rgba(148, 163, 184, 0.18)";
  const pulse = 1 + body.attachPulse * 0.07;

  body.pieces.forEach((piece) => {
    if (!piece.filled) return; // ghost slots are invisible
    const tr = getPieceWorldTransform(body, piece);
    ctx.save();
    ctx.translate(body.x, body.y);
    ctx.scale(pulse, pulse);
    ctx.translate(tr.x - body.x, tr.y - body.y);
    ctx.rotate(tr.rotation);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    piece.vertices.forEach((v, i) => {
      if (i === 0) ctx.moveTo(v.x, v.y);
      else ctx.lineTo(v.x, v.y);
    });
    ctx.closePath();
    if (piece.filled) {
      ctx.shadowColor = glowCol;
      ctx.shadowBlur = 12 + body.glowTime * 38;
    }
    ctx.fillStyle = piece.color;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = piece.filled
      ? "rgba(255, 255, 255, 0.15)"
      : "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  });
};


// ─── Component ────────────────────────────────────────────────────────────────

const makeEmptyGrid = (): CellKind[][] =>
  Array.from({ length: GRID_DIVISIONS }, () =>
    new Array<CellKind>(GRID_DIVISIONS).fill("empty"),
  );

const SquareAssembly = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<AssemblyAudio | null>(null);
  const arenaRef = useRef<Arena | null>(null);
  const bodiesRef = useRef<Body[]>([]);
  const clusterBodyRef = useRef<Body | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const startTimeRef = useRef(0);
  const phaseRef = useRef<GamePhase>("editor");
  const gridRef = useRef<CellKind[][]>(makeEmptyGrid());
  const completeSoundPlayedRef = useRef(false);
  const mergeCountdownRef = useRef<number | null>(null);
  const [phase, setPhase] = useState<GamePhase>("editor");
  const [editorError, setEditorError] = useState(false);
  const [mergeCountdown, setMergeCountdown] = useState<number | null>(null);

  if (audioRef.current === null) audioRef.current = createAudio();

  const startSimulation = useCallback(() => {
    const arena = arenaRef.current;
    if (!arena) return;

    const targets: Array<{ col: number; row: number; kind: PieceKind }> = [];
    gridRef.current.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell !== "empty")
          targets.push({ col: c, row: r, kind: "square" });
      });
    });

    if (targets.length === 0) {
      setEditorError(true);
      window.setTimeout(() => setEditorError(false), 2000);
      return;
    }

    _bodyIdCounter = 0;
    _pieceIdCounter = 0;

    const cluster = createClusterBody(targets, arena);
    clusterBodyRef.current = cluster;

    // Spawn exactly as many loose squares as the user designed
    const allBodies: Body[] = [cluster];
    for (let i = 0; i < targets.length; i++) {
      const b = trySpawnShape(arena, allBodies, cluster);
      if (b) allBodies.push(b);
    }
    bodiesRef.current = allBodies;

    startTimeRef.current = 0;
    lastTimeRef.current = performance.now();
    completeSoundPlayedRef.current = false;
    phaseRef.current = "simulation";
    setPhase("simulation");
    audioRef.current?.unlock();
  }, []);

  const resetToEditor = useCallback(() => {
    bodiesRef.current = [];
    clusterBodyRef.current = null;
    completeSoundPlayedRef.current = false;
    phaseRef.current = "editor";
    setPhase("editor");
  }, []);

  // Re-compute arena after phase change so canvas size (flex:1 vs 100dvh) is respected
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const id = window.requestAnimationFrame(() => {
      arenaRef.current = resizeCanvas(canvas);
    });
    return () => window.cancelAnimationFrame(id);
  }, [phase]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    arenaRef.current = resizeCanvas(canvas);
    lastTimeRef.current = performance.now();

    const draw = (time: number) => {
      const arena = arenaRef.current;
      if (!arena) return;

      if (phaseRef.current === "editor") {
        drawArenaFrame(ctx, arena, "What Shape will these squares form?");
        drawEditorGrid(ctx, arena, gridRef.current);
      } else {
        if (startTimeRef.current === 0) startTimeRef.current = time;
        const dt = Math.min((time - lastTimeRef.current) / 1000, MAX_DT);
        lastTimeRef.current = time;

        const cluster = clusterBodyRef.current;
        const total = cluster ? cluster.pieces.length : 0;
        const filled = cluster
          ? cluster.pieces.filter((p) => p.filled).length
          : 0;
        const allFilled = total > 0 && filled === total;
        const elapsedSec = (time - startTimeRef.current) / 1000;

        // Play completion sound once when all slots filled, then keep running
        if (allFilled && !completeSoundPlayedRef.current) {
          completeSoundPlayedRef.current = true;
          audioRef.current?.playComplete();
        }

        const MERGE_DELAY = 5;
        const mergeElapsed = Math.max(0, elapsedSec - MERGE_DELAY);
        const mergingStarted = elapsedSec >= MERGE_DELAY;
        const clusterSolid = mergeElapsed < 50;

        const subDt = dt / PHYSICS_SUBSTEPS;
        for (let step = 0; step < PHYSICS_SUBSTEPS; step++) {
          bodiesRef.current.forEach((body) => {
            body.x += body.vx * subDt;
            body.y += body.vy * subDt;
            body.glowTime = Math.max(0, body.glowTime - subDt);
            body.attachPulse = Math.max(0, body.attachPulse - subDt * 3.2);
            if (body.glowTime <= 0) body.glowColor = "none";
          });
          resolveWallCollisions(arena, bodiesRef.current, (bodyId) =>
            audioRef.current?.playCollision(bodyId),
          );
          resolveBodyCollisions(arena, bodiesRef.current, audioRef.current, clusterSolid);
          if (cluster && mergingStarted && !allFilled) {
            applyClusterAttraction(bodiesRef.current, cluster, arena, subDt, mergeElapsed);
            snapToCluster(bodiesRef.current, cluster, arena, mergeElapsed, () =>
              audioRef.current?.playAttach(),
            );
          }
        }

        // Update DOM countdown (only re-renders on value change, max 6 times)
        const nextCountdown = mergingStarted ? null : Math.ceil(MERGE_DELAY - elapsedSec);
        if (nextCountdown !== mergeCountdownRef.current) {
          mergeCountdownRef.current = nextCountdown;
          setMergeCountdown(nextCountdown);
        }

        drawArenaFrame(ctx, arena, "What Shape will these squares form?");
        bodiesRef.current.forEach((b) => drawBody(ctx, b));
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    const handleResize = () => {
      arenaRef.current = resizeCanvas(canvas);
    };

    const handleCanvasInteraction = (e: MouseEvent | TouchEvent) => {
      audioRef.current?.unlock();
      if (phaseRef.current !== "editor") return;
      const arena = arenaRef.current;
      if (!arena) return;
      const s = getShapeSize(arena);
      const pe = e as PointerEvent;
      const rect = canvas.getBoundingClientRect();
      const col = Math.floor((pe.clientX - rect.left - arena.x) / s);
      const row = Math.floor((pe.clientY - rect.top - arena.y) / s);
      if (col >= 0 && col < GRID_DIVISIONS && row >= 0 && row < GRID_DIVISIONS) {
        const cur = gridRef.current[row][col];
        gridRef.current[row][col] = cur === "empty" ? "square" : "empty";
      }
    };

    window.addEventListener("resize", handleResize);
    // pointerdown covers mouse, touch, and stylus uniformly — no touch/click split needed
    canvas.addEventListener("pointerdown", handleCanvasInteraction as EventListener);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", handleResize);
      canvas.removeEventListener("pointerdown", handleCanvasInteraction as EventListener);
    };
  }, []);

  return (
    <div className={`assembly-root${phase === "editor" ? " editor-cursor" : ""}`}>
      <canvas ref={canvasRef} className="assembly-canvas" />

      <div className="bottom-bar">
        {phase === "editor" ? (
          <>
            <p className="editor-hint">
              Click cells to place&nbsp;<span className="sq-swatch">■</span>&nbsp;squares, click again to remove
            </p>
            {editorError && (
              <p className="editor-error">Select at least one cell first</p>
            )}
            <div className="editor-actions">
              <button
                className="btn-clear"
                onClick={() => { gridRef.current = makeEmptyGrid(); }}
              >
                Clear
              </button>
              <button className="btn-start" onClick={startSimulation}>
                ▶ Start Simulation
              </button>
            </div>
          </>
        ) : (
          <>
            {mergeCountdown !== null && (
              <p className="merge-countdown">
                Merging will begin in {mergeCountdown} sec{mergeCountdown !== 1 ? "s" : ""}
              </p>
            )}
            <button className="btn-edit" onClick={resetToEditor}>
              ← Edit
            </button>
          </>
        )}
      </div>

      <style jsx>{`
        .assembly-root {
          display: flex;
          flex-direction: column;
          position: relative;
          width: 100%;
          height: 100dvh;
          overflow: hidden;
          background: #020617;
        }
        .assembly-canvas {
          display: block;
          width: 100%;
          flex: 1;
          min-height: 0 !important;
          height: 0 !important;
          cursor: default;
          touch-action: none;
        }
        .editor-cursor .assembly-canvas {
          cursor: crosshair;
        }
        .bottom-bar {
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 10px 16px 16px;
          background: #020617;
          min-height: 68px;
        }
        .merge-countdown {
          color: rgba(241, 245, 249, 0.72);
          font-size: 12px;
          font-family: Arial, Helvetica, sans-serif;
        }
        .editor-hint {
          color: rgba(241, 245, 249, 0.55);
          font-size: 12px;
          font-family: Arial, Helvetica, sans-serif;
          white-space: nowrap;
        }
        .editor-error {
          color: rgba(248, 113, 113, 0.9);
          font-size: 12px;
          font-family: Arial, Helvetica, sans-serif;
          white-space: nowrap;
        }
        .sq-swatch {
          color: #d77026;
        }
        .editor-actions {
          display: flex;
          gap: 10px;
        }
        .btn-start {
          background: rgba(34, 197, 94, 0.12);
          border: 1.5px solid rgba(34, 197, 94, 0.55);
          color: #4ade80;
          padding: 8px 22px;
          border-radius: 7px;
          font-size: 13px;
          font-weight: 700;
          font-family: Arial, Helvetica, sans-serif;
          cursor: pointer;
          letter-spacing: 0.03em;
        }
        .btn-start:hover {
          background: rgba(34, 197, 94, 0.22);
        }
        .btn-clear {
          background: rgba(100, 120, 150, 0.08);
          border: 1.5px solid rgba(100, 120, 150, 0.3);
          color: rgba(241, 245, 249, 0.55);
          padding: 8px 16px;
          border-radius: 7px;
          font-size: 13px;
          font-family: Arial, Helvetica, sans-serif;
          cursor: pointer;
        }
        .btn-clear:hover {
          background: rgba(100, 120, 150, 0.16);
        }
        .btn-edit {
          background: rgba(100, 120, 150, 0.08);
          border: 1.5px solid rgba(100, 120, 150, 0.28);
          color: rgba(241, 245, 249, 0.65);
          padding: 5px 13px;
          border-radius: 6px;
          font-size: 12px;
          font-family: Arial, Helvetica, sans-serif;
          cursor: pointer;
        }
        .btn-edit:hover {
          background: rgba(100, 120, 150, 0.18);
        }
      `}</style>
    </div>
  );
};

export default SquareAssembly;
