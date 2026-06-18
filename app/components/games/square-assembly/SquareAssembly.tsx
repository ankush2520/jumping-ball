"use client";

import React, { useEffect, useRef } from "react";
import { drawCanvasWatermark } from "@/app/lib/watermark";

// ─── Types ────────────────────────────────────────────────────────────────────

type Point = { x: number; y: number };
type PieceKind = "square" | "triangle";

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
};

type Arena = {
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
};

type Collision = { normal: Point; overlap: number };

type EdgeInfo = {
  body: Body;
  piece: Piece;
  slot: EdgeSlot;
  start: Point;
  end: Point;
  direction: Point;
  midpoint: Point;
};

type AttachCheck = {
  edgeA: EdgeInfo | null;
  edgeB: EdgeInfo | null;
  angleDiff: number;
  valid: boolean;
};

type AssemblyAudio = {
  unlock: () => Promise<void>;
  playCollision: () => void;
  playAttach: () => void;
  dispose: () => void;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const HUD_RESERVED_HEIGHT_DESKTOP = 142;
const HUD_RESERVED_HEIGHT_MOBILE = 158;
const ARENA_SAFE_SPACING = 24;
const MOBILE_BOTTOM_SAFE_SPACING = 28;
const PHYSICS_SUBSTEPS = 4;
const RESTITUTION = 1.0;
const SHAPE_SIZE_RATIO = 0.06;
const BODY_SPEED_RATIO = 0.3;
const ATTACH_ANGLE_TOL = (22 * Math.PI) / 180;
const GLOW_DURATION = 0.5;
const MAX_DT = 1 / 30;
const INITIAL_SHAPE_COUNT = 7;
const SPAWN_INTERVAL_SECS = 0.5;

const SHAPE_PALETTE: string[] = [
  "#f97316",
  "#38bdf8",
  "#a78bfa",
  "#34d399",
  "#fb923c",
  "#f472b6",
  "#facc15",
  "#60a5fa",
  "#4ade80",
  "#c084fc",
  "#fbbf24",
  "#f43f5e",
];

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

const addPoints = (a: Point, b: Point): Point => ({
  x: a.x + b.x,
  y: a.y + b.y,
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

const getTriangleVerts = (s: number): Point[] => {
  const h = (s * Math.sqrt(3)) / 2;
  return [
    { x: 0, y: (-2 * h) / 3 },
    { x: s / 2, y: h / 3 },
    { x: -s / 2, y: h / 3 },
  ];
};

const getPieceLocalVerts = (kind: PieceKind, s: number): Point[] =>
  kind === "square" ? getSquareVerts(s) : getTriangleVerts(s);

const getEdgeSlots = (kind: PieceKind): EdgeSlot[] =>
  Array.from({ length: kind === "square" ? 4 : 3 }, (_, i) => ({
    index: i,
    attached: false,
  }));

// ─── Audio ────────────────────────────────────────────────────────────────────

const createAudio = (): AssemblyAudio => {
  let audio: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let lastCollisionAt = 0;
  const pianoNotes = [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33];

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
    masterGain.gain.value = 0.28;
    masterGain.connect(audio.destination);
    return audio;
  };

  const playTone = (freq: number, dur: number, gainVal: number) => {
    const ac = ensureAudio();
    if (!ac || ac.state !== "running" || !masterGain) return;
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.62, now + dur);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(gainVal, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  };

  const playPianoNote = (freq: number) => {
    const ac = ensureAudio();
    if (!ac || ac.state !== "running" || !masterGain) return;
    const now = ac.currentTime;
    const outGain = ac.createGain();
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(3600, now);
    filter.frequency.exponentialRampToValueAtTime(1250, now + 0.42);
    outGain.gain.setValueAtTime(0.0001, now);
    outGain.gain.linearRampToValueAtTime(0.42, now + 0.006);
    outGain.gain.exponentialRampToValueAtTime(0.13, now + 0.07);
    outGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.58);
    outGain.connect(filter);
    filter.connect(masterGain);
    [
      { ratio: 1, gain: 0.18 },
      { ratio: 2, gain: 0.075 },
      { ratio: 3, gain: 0.035 },
      { ratio: 4.01, gain: 0.014 },
    ].forEach(({ ratio, gain }, i) => {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = i === 0 ? "triangle" : "sine";
      osc.frequency.setValueAtTime(freq * ratio * rng(0.998, 1.002), now);
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45 + i * 0.04);
      osc.connect(g);
      g.connect(outGain);
      osc.start(now);
      osc.stop(now + 0.64);
      osc.onended = () => {
        osc.disconnect();
        g.disconnect();
      };
    });
    window.setTimeout(() => {
      outGain.disconnect();
      filter.disconnect();
    }, 700);
  };

  return {
    unlock: async () => {
      const ac = ensureAudio();
      if (ac?.state === "suspended") await ac.resume();
    },
    playCollision: () => {
      const ac = ensureAudio();
      if (!ac) return;
      const now = ac.currentTime;
      if (now - lastCollisionAt < 0.06) return;
      lastCollisionAt = now;
      playPianoNote(pianoNotes[Math.floor(Math.random() * pianoNotes.length)]);
    },
    playAttach: () => {
      playTone(440, 0.18, 0.11);
      window.setTimeout(() => playTone(660, 0.2, 0.12), 48);
    },
    dispose: () => {
      masterGain?.disconnect();
      masterGain = null;
      audio = null;
    },
  };
};

// ─── Canvas / arena ───────────────────────────────────────────────────────────

const resizeCanvas = (canvas: HTMLCanvasElement): Arena => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  const ctx = canvas.getContext("2d");
  const isMobile = width < 600;
  const hudH = isMobile
    ? HUD_RESERVED_HEIGHT_MOBILE
    : HUD_RESERVED_HEIGHT_DESKTOP;
  const hPad = isMobile ? width * 0.06 : 28;
  const bot = isMobile ? MOBILE_BOTTOM_SAFE_SPACING : ARENA_SAFE_SPACING;
  const availW = Math.max(220, width - hPad);
  const availH = Math.max(220, height - hudH - bot);

  // On mobile use the full available rectangle; on desktop keep a square
  const arenaW = isMobile ? availW : clamp(Math.min(availW, availH), 220, 920);
  const arenaH = isMobile ? availH : arenaW;

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  if (ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
  }
  return {
    x: (width - arenaW) / 2,
    y: hudH,
    width: arenaW,
    height: arenaH,
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

const getShapeSize = (arena: Arena) => arena.width * SHAPE_SIZE_RATIO;
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

const trySpawnShape = (arena: Arena, bodies: Body[]): Body | null => {
  const s = getShapeSize(arena);
  const clearance = s * 2.2;
  const margin = clearance;
  let spawnX = 0,
    spawnY = 0,
    found = false;

  for (let attempt = 0; attempt < 120; attempt++) {
    const cx = arena.x + margin + Math.random() * (arena.width - margin * 2);
    const cy = arena.y + margin + Math.random() * (arena.height - margin * 2);
    const clear = bodies.every((body) =>
      body.pieces.every((piece) => {
        const tr = getPieceWorldTransform(body, piece);
        return distancePt({ x: tr.x, y: tr.y }, { x: cx, y: cy }) > clearance;
      }),
    );
    if (clear) {
      spawnX = cx;
      spawnY = cy;
      found = true;
      break;
    }
  }

  if (!found) return null;

  const kind: PieceKind = Math.random() < 0.5 ? "square" : "triangle";
  const color = SHAPE_PALETTE[_pieceIdCounter % SHAPE_PALETTE.length];
  const speed = getBodySpeed(arena);
  const angle = rng(0, Math.PI * 2);

  return {
    id: _bodyIdCounter++,
    x: spawnX,
    y: spawnY,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    rotation: rng(0, Math.PI * 2),
    angularVelocity: rng(-Math.PI * 0.45, Math.PI * 0.45),
    pieces: [
      {
        id: _pieceIdCounter++,
        kind,
        color,
        localX: 0,
        localY: 0,
        localRotation: 0,
        vertices: getPieceLocalVerts(kind, s),
        edges: getEdgeSlots(kind),
      },
    ],
    glowColor: "none",
    glowTime: 0,
    attachPulse: 0,
  };
};

const createInitialBodies = (arena: Arena): Body[] => {
  _bodyIdCounter = 0;
  _pieceIdCounter = 0;
  const bodies: Body[] = [];
  for (let i = 0; i < INITIAL_SHAPE_COUNT; i++) {
    const body = trySpawnShape(arena, bodies);
    if (body) bodies.push(body);
  }
  return bodies;
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
  let best: Collision | null = null;
  for (const ap of a.pieces) {
    for (const bp of b.pieces) {
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

// ─── Edge / attachment detection ──────────────────────────────────────────────

const getEdgeWorldInfo = (
  body: Body,
  piece: Piece,
  slot: EdgeSlot,
): EdgeInfo | null => {
  if (slot.attached) return null;
  const verts = getPieceWorldVerts(body, piece);
  const start = verts[slot.index];
  const end = verts[(slot.index + 1) % verts.length];
  const direction = normalize(subPoints(end, start));
  const midpoint = scalePoint(addPoints(start, end), 0.5);
  return { body, piece, slot, start, end, direction, midpoint };
};

const getFreeEdges = (body: Body): EdgeInfo[] =>
  body.pieces.flatMap((p) =>
    p.edges
      .map((s) => getEdgeWorldInfo(body, p, s))
      .filter((e): e is EdgeInfo => e !== null),
  );

const getEndpointDistance = (a: EdgeInfo, b: EdgeInfo) => {
  const rev = distancePt(a.start, b.end) + distancePt(a.end, b.start);
  const same = distancePt(a.start, b.start) + distancePt(a.end, b.end);
  return Math.min(rev, same);
};

const checkAttachment = (
  bodyA: Body,
  bodyB: Body,
  shapeSize: number,
): AttachCheck => {
  const maxEp = shapeSize * 0.62;
  const maxMid = shapeSize * 0.54;
  let best: AttachCheck = {
    edgeA: null,
    edgeB: null,
    angleDiff: Math.PI,
    valid: false,
  };

  for (const ae of getFreeEdges(bodyA)) {
    for (const be of getFreeEdges(bodyB)) {
      const angleDiff = Math.acos(
        clamp(dotProduct(ae.direction, scalePoint(be.direction, -1)), -1, 1),
      );
      const epDist = getEndpointDistance(ae, be);
      const midDist = distancePt(ae.midpoint, be.midpoint);
      const score = epDist + midDist * 0.75;
      const bestScore =
        best.edgeA && best.edgeB
          ? getEndpointDistance(best.edgeA, best.edgeB) +
            distancePt(best.edgeA.midpoint, best.edgeB.midpoint) * 0.75
          : Infinity;
      if (score < bestScore) {
        best = {
          edgeA: ae,
          edgeB: be,
          angleDiff,
          valid:
            epDist <= maxEp &&
            midDist <= maxMid &&
            angleDiff <= ATTACH_ANGLE_TOL,
        };
      }
    }
  }
  return best;
};

const snapAndMerge = (
  bodies: Body[],
  bodyA: Body,
  bodyB: Body,
  check: AttachCheck,
  arena: Arena,
): boolean => {
  if (!check.edgeA || !check.edgeB) return false;

  // Save B's state so we can revert if the snap is geometrically invalid
  const savedRotB = bodyB.rotation;
  const savedXB = bodyB.x;
  const savedYB = bodyB.y;

  const angleCorrection =
    Math.atan2(check.edgeA.direction.y, check.edgeA.direction.x) -
    Math.atan2(-check.edgeB.direction.y, -check.edgeB.direction.x);
  bodyB.rotation += angleCorrection;

  const refreshed = getEdgeWorldInfo(
    bodyB,
    check.edgeB.piece,
    check.edgeB.slot,
  );
  if (!refreshed) {
    bodyB.rotation = savedRotB;
    return false;
  }

  const translation = subPoints(check.edgeA.midpoint, refreshed.midpoint);
  bodyB.x += translation.x;
  bodyB.y += translation.y;

  // Abort if any piece of B significantly overlaps any piece of A (> 1.5px)
  // The two directly-connecting pieces touch at ~0 overlap and are allowed
  const snapOverlapThreshold = 1.5;
  const connectingAPiece = check.edgeA.piece.id;
  const connectingBPiece = check.edgeB.piece.id;
  const hasConflict = bodyB.pieces.some((bPiece) => {
    const bVerts = getPieceWorldVerts(bodyB, bPiece);
    const bC = { x: bodyB.x, y: bodyB.y };
    return bodyA.pieces.some((aPiece) => {
      if (aPiece.id === connectingAPiece && bPiece.id === connectingBPiece)
        return false;
      const col = getPolyCollision(
        getPieceWorldVerts(bodyA, aPiece),
        bVerts,
        { x: bodyA.x, y: bodyA.y },
        bC,
      );
      return col !== null && col.overlap > snapOverlapThreshold;
    });
  });

  if (hasConflict) {
    bodyB.rotation = savedRotB;
    bodyB.x = savedXB;
    bodyB.y = savedYB;
    return false;
  }

  const ma = bodyA.pieces.length,
    mb = bodyB.pieces.length,
    total = ma + mb;
  bodyA.vx = (bodyA.vx * ma + bodyB.vx * mb) / total;
  bodyA.vy = (bodyA.vy * ma + bodyB.vy * mb) / total;
  bodyA.angularVelocity =
    (bodyA.angularVelocity * ma + bodyB.angularVelocity * mb) / total;
  preserveBodySpeed(bodyA, arena);

  bodyB.pieces.forEach((piece) => {
    const wt = getPieceWorldTransform(bodyB, piece);
    const rel = rotatePoint(
      subPoints({ x: wt.x, y: wt.y }, { x: bodyA.x, y: bodyA.y }),
      -bodyA.rotation,
    );
    bodyA.pieces.push({
      ...piece,
      localX: rel.x,
      localY: rel.y,
      localRotation: wt.rotation - bodyA.rotation,
      edges: piece.edges.map((e) => ({ ...e })),
    });
  });

  check.edgeA.slot.attached = true;
  const absorbedPiece = bodyA.pieces.find(
    (p) => p.id === check.edgeB?.piece.id,
  );
  if (absorbedPiece) {
    const absorbedSlot = absorbedPiece.edges.find(
      (e) => e.index === check.edgeB?.slot.index,
    );
    if (absorbedSlot) absorbedSlot.attached = true;
  }

  bodyA.glowColor = "green";
  bodyA.glowTime = GLOW_DURATION;
  bodyA.attachPulse = 1;

  const idx = bodies.indexOf(bodyB);
  if (idx >= 0) bodies.splice(idx, 1);

  return true;
};

// ─── Physics ──────────────────────────────────────────────────────────────────

const resolveWallCollisions = (
  arena: Arena,
  bodies: Body[],
  onCollide: () => void,
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
      onCollide();
    }
  });
};

const resolveBodyCollisions = (
  arena: Arena,
  bodies: Body[],
  audio: AssemblyAudio | null,
  shapeSize: number,
) => {
  for (let pass = 0; pass < 3; pass++) {
    let merged = false;
    for (let i = 0; i < bodies.length && !merged; i++) {
      for (let j = i + 1; j < bodies.length && !merged; j++) {
        const a = bodies[i],
          b = bodies[j];
        const col = getBodyCollision(a, b);
        if (!col) continue;

        const check = checkAttachment(a, b, shapeSize);
        if (check.valid) {
          const didMerge = snapAndMerge(bodies, a, b, check, arena);
          if (didMerge) {
            audio?.playAttach();
            merged = true;
            continue;
          }
          // merge aborted (geometric conflict) — fall through to bounce
        }

        const { normal, overlap } = col;
        const correction = overlap * 0.6 + 0.5;
        a.x -= normal.x * correction;
        a.y -= normal.y * correction;
        b.x += normal.x * correction;
        b.y += normal.y * correction;

        const relV = subPoints({ x: b.vx, y: b.vy }, { x: a.vx, y: a.vy });
        const vn = dotProduct(relV, normal);
        if (vn < 0) {
          const ma = a.pieces.length,
            mb = b.pieces.length;
          const impulse = (-(1 + RESTITUTION) * vn) / (1 / ma + 1 / mb);
          a.vx -= (impulse * normal.x) / ma;
          a.vy -= (impulse * normal.y) / ma;
          b.vx += (impulse * normal.x) / mb;
          b.vy += (impulse * normal.y) / mb;
          preserveBodySpeed(a, arena);
          preserveBodySpeed(b, arena);
        }

        a.glowColor = "red";
        a.glowTime = 0.25;
        b.glowColor = "red";
        b.glowTime = 0.25;
        audio?.playCollision();
      }
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
    if (lines.every((line) => ctx.measureText(line).width <= maxWidth)) {
      return size;
    }
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

  for (let split = 1; split < words.length; split += 1) {
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

const drawArenaFrame = (ctx: CanvasRenderingContext2D, arena: Arena) => {
  const isMobile = window.innerWidth < 600;
  const lineW = isMobile ? 2.25 : 3;
  const glowB = isMobile ? 11 : 11;
  const headingText = "WHAT WEIRD STRUCTURE WILL THESE RANDOM SHAPES MAKE?";

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

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
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  drawCanvasWatermark(ctx, window.innerWidth, window.innerHeight);

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
  ctx.fillStyle = "rgba(241, 245, 249, 0.92)";
  ctx.shadowColor = "rgba(148, 163, 184, 0.32)";
  ctx.shadowBlur = isMobile ? 8 : 12;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const maxHeadingWidth = Math.min(arena.width - 20, window.innerWidth - 32);
  const maxHeadingSize = isMobile ? 20 : 26;
  const headingLines = getHeadingLines(
    ctx,
    headingText,
    maxHeadingWidth,
    maxHeadingSize,
  );
  const headingSize = getFittedFontSize(
    ctx,
    headingLines,
    maxHeadingWidth,
    maxHeadingSize,
    isMobile ? 13 : 16,
  );
  ctx.font = `900 ${headingSize}px Arial, Helvetica, sans-serif`;
  const lineHeight = headingSize * 1.14;
  const bottomY = Math.max(
    headingSize + 16 + lineHeight * (headingLines.length - 1),
    arena.y - (isMobile ? 38 : 48),
  );
  headingLines.forEach((line, index) => {
    ctx.fillText(
      line,
      arena.x + arena.width / 2,
      bottomY - (headingLines.length - index - 1) * lineHeight,
    );
  });

  ctx.restore();
};

const drawBody = (ctx: CanvasRenderingContext2D, body: Body) => {
  const glowCol =
    body.glowColor === "green"
      ? "rgba(34, 197, 94, 0.9)"
      : body.glowColor === "red"
        ? "rgba(239, 68, 68, 0.9)"
        : "rgba(148, 163, 184, 0.18)";
  const pulse = 1 + body.attachPulse * 0.07;

  body.pieces.forEach((piece) => {
    const tr = getPieceWorldTransform(body, piece);
    ctx.save();
    ctx.translate(body.x, body.y);
    ctx.scale(pulse, pulse);
    ctx.translate(tr.x - body.x, tr.y - body.y);
    ctx.rotate(tr.rotation);
    ctx.beginPath();
    piece.vertices.forEach((v, i) => {
      if (i === 0) ctx.moveTo(v.x, v.y);
      else ctx.lineTo(v.x, v.y);
    });
    ctx.closePath();
    ctx.shadowColor = glowCol;
    ctx.shadowBlur = 12 + body.glowTime * 38;
    ctx.fillStyle = piece.color;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  });
};

const isArenaTooCrowded = (
  arena: Arena,
  bodies: Body[],
  shapeSize: number,
): boolean => {
  if (bodies.length === 0) return false;
  let maxW = 0,
    maxH = 0;
  for (const body of bodies) {
    const verts = getBodyWorldVerts(body);
    const minX = Math.min(...verts.map((v) => v.x));
    const maxX = Math.max(...verts.map((v) => v.x));
    const minY = Math.min(...verts.map((v) => v.y));
    const maxY = Math.max(...verts.map((v) => v.y));
    maxW = Math.max(maxW, maxX - minX);
    maxH = Math.max(maxH, maxY - minY);
  }
  const minClearance = shapeSize * 2.5;
  return (
    arena.width - maxW < minClearance || arena.height - maxH < minClearance
  );
};

const drawStats = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  pieceCount: number,
  bodyCount: number,
  elapsedSec: number,
  arenaFull: boolean,
) => {
  const isMobile = window.innerWidth < 600;
  const mins = Math.floor(elapsedSec / 60);
  const secs = String(Math.floor(elapsedSec % 60)).padStart(2, "0");
  const statusText = arenaFull ? "Arena Full!" : `Clusters: ${bodyCount}`;
  ctx.save();
  ctx.fillStyle = "rgba(241, 245, 249, 0.72)";
  ctx.font = `700 ${isMobile ? 11 : 13}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(
    `Pieces: ${pieceCount}  ·  ${statusText}  ·  Time: ${mins}:${secs}`,
    arena.x + arena.width / 2,
    arena.y + arena.height + (isMobile ? 10 : 14),
  );
  ctx.restore();
};

// ─── Component ────────────────────────────────────────────────────────────────

const SquareAssembly = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<AssemblyAudio | null>(null);
  const arenaRef = useRef<Arena | null>(null);
  const bodiesRef = useRef<Body[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const startTimeRef = useRef(0);
  const spawnTimerRef = useRef(SPAWN_INTERVAL_SECS);
  const arenaFullRef = useRef(false);

  if (audioRef.current === null) audioRef.current = createAudio();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const initialize = () => {
      const arena = resizeCanvas(canvas);
      arenaRef.current = arena;
      bodiesRef.current = createInitialBodies(arena);
      arenaFullRef.current = false;
      spawnTimerRef.current = SPAWN_INTERVAL_SECS;
      startTimeRef.current = 0;
    };

    const draw = (time: number) => {
      const arena = arenaRef.current;
      if (!arena) return;

      if (startTimeRef.current === 0) startTimeRef.current = time;
      const dt = Math.min((time - lastTimeRef.current) / 1000, MAX_DT);
      lastTimeRef.current = time;

      const shapeSize = getShapeSize(arena);

      if (!arenaFullRef.current) {
        spawnTimerRef.current -= dt;
        if (spawnTimerRef.current <= 0) {
          spawnTimerRef.current = SPAWN_INTERVAL_SECS;
          if (isArenaTooCrowded(arena, bodiesRef.current, shapeSize)) {
            arenaFullRef.current = true;
          } else {
            const body = trySpawnShape(arena, bodiesRef.current);
            if (body) bodiesRef.current.push(body);
            else arenaFullRef.current = true;
          }
        }
      }

      const subDt = dt / PHYSICS_SUBSTEPS;
      for (let step = 0; step < PHYSICS_SUBSTEPS; step++) {
        bodiesRef.current.forEach((body) => {
          body.x += body.vx * subDt;
          body.y += body.vy * subDt;
          body.rotation += body.angularVelocity * subDt;
          body.glowTime = Math.max(0, body.glowTime - subDt);
          body.attachPulse = Math.max(0, body.attachPulse - subDt * 3.2);
          if (body.glowTime <= 0) body.glowColor = "none";
        });
        resolveWallCollisions(arena, bodiesRef.current, () =>
          audioRef.current?.playCollision(),
        );
        resolveBodyCollisions(
          arena,
          bodiesRef.current,
          audioRef.current,
          shapeSize,
        );
      }

      const elapsedSec = (time - startTimeRef.current) / 1000;
      const pieces = bodiesRef.current.reduce((s, b) => s + b.pieces.length, 0);
      const bods = bodiesRef.current.length;

      drawArenaFrame(ctx, arena);
      bodiesRef.current.forEach((b) => drawBody(ctx, b));
      drawStats(ctx, arena, pieces, bods, elapsedSec, arenaFullRef.current);

      rafRef.current = requestAnimationFrame(draw);
    };

    initialize();
    lastTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(draw);

    const handleResize = () => {
      arenaRef.current = resizeCanvas(canvas);
    };
    const handleInteract = () => audioRef.current?.unlock();
    window.addEventListener("resize", handleResize);
    canvas.addEventListener("click", handleInteract);
    canvas.addEventListener("touchstart", handleInteract, { passive: true });

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", handleResize);
      canvas.removeEventListener("click", handleInteract);
      canvas.removeEventListener("touchstart", handleInteract);
    };
  }, []);

  return (
    <div className="assembly-root">
      <canvas ref={canvasRef} className="assembly-canvas" />
      <style jsx>{`
        .assembly-root {
          position: relative;
          width: 100%;
          height: 100dvh;
          min-height: 100dvh;
          max-height: 100dvh;
          overflow: hidden;
          background: #020617;
        }
        .assembly-canvas {
          display: block;
          width: 100%;
          height: 100dvh;
          min-height: 100dvh;
          max-height: 100dvh;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
};

export default SquareAssembly;
