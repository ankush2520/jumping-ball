"use client";

import React, { useEffect, useRef } from "react";

type Arena = {
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
};

type Point = {
  x: number;
  y: number;
};

type ConnectorSide = {
  index: number;
  kind: "plain";
  matchKey: string;
  attached: boolean;
};

type TrianglePiece = {
  id: number;
  color: string;
  localX: number;
  localY: number;
  localRotation: number;
  vertices: Point[];
  connector: ConnectorSide;
};

type RigidBody = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  angularVelocity: number;
  pieces: TrianglePiece[];
  glowColor: "none" | "red" | "green";
  glowTime: number;
  attachPulse: number;
};

type Collision = {
  normal: Point;
  overlap: number;
};

type EdgeInfo = {
  body: RigidBody;
  piece: TrianglePiece;
  start: Point;
  end: Point;
  direction: Point;
  normal: Point;
  midpoint: Point;
};

type AttachmentCheck = {
  first: EdgeInfo | null;
  second: EdgeInfo | null;
  angleDiff: number;
  valid: boolean;
};

type BrokenSquareAudio = {
  unlock: () => Promise<void>;
  playCollision: () => void;
  playBreak: () => void;
  playSuccess: () => void;
  dispose: () => void;
};

const HUD_RESERVED_HEIGHT_DESKTOP = 142;
const HUD_RESERVED_HEIGHT_MOBILE = 158;
const ARENA_SAFE_SPACING = 24;
const MOBILE_BOTTOM_SAFE_SPACING = 28;
const HOLD_DURATION = 1;
const BREAK_DURATION = 0.42;
const PHYSICS_SUBSTEPS = 3;
const RESTITUTION = 0.96;
const CONNECTOR_TOLERANCE_RADIANS = (15 * Math.PI) / 180;
const SAFFRON = "#f97316";
const TRIANGLE_COLORS = [SAFFRON, SAFFRON, SAFFRON, SAFFRON];

let sharedAudioContext: AudioContext | null = null;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const randomBetween = (min: number, max: number) =>
  min + Math.random() * (max - min);

const easeOutBack = (value: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (value - 1) ** 3 + c1 * (value - 1) ** 2;
};

const easeOutCubic = (value: number) => 1 - (1 - value) ** 3;

const rotatePoint = (point: Point, rotation: number): Point => {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
};

const addPoints = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });

const subPoints = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });

const scalePoint = (point: Point, scale: number): Point => ({
  x: point.x * scale,
  y: point.y * scale,
});

const normalize = (point: Point): Point => {
  const length = Math.hypot(point.x, point.y) || 1;
  return { x: point.x / length, y: point.y / length };
};

const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;

const resizeCanvas = (canvas: HTMLCanvasElement): Arena => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  const ctx = canvas.getContext("2d");
  const isMobile = width < 600;
  const hudReservedHeight = isMobile
    ? HUD_RESERVED_HEIGHT_MOBILE
    : HUD_RESERVED_HEIGHT_DESKTOP;
  const horizontalPadding = isMobile ? width * 0.12 : 28;
  const bottomSpacing = isMobile ? MOBILE_BOTTOM_SAFE_SPACING : ARENA_SAFE_SPACING;
  const availableWidth = Math.max(220, width - horizontalPadding);
  const availableHeight = Math.max(220, height - hudReservedHeight - bottomSpacing);
  const arenaSize = clamp(Math.min(availableWidth, availableHeight), 220, 920);

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
    x: (width - arenaSize) / 2,
    y: hudReservedHeight,
    width: arenaSize,
    height: arenaSize,
    dpr,
  };
};

const createAudio = (): BrokenSquareAudio => {
  let audio: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let lastCollisionAt = 0;

  const ensureAudio = () => {
    if (audio) return audio;
    const audioWindow = window as Window &
      typeof globalThis & {
        webkitAudioContext?: typeof AudioContext;
      };
    const AudioContextClass =
      audioWindow.AudioContext || audioWindow.webkitAudioContext;
    if (!AudioContextClass) return null;

    sharedAudioContext = sharedAudioContext || new AudioContextClass();
    audio = sharedAudioContext;
    masterGain = audio.createGain();
    masterGain.gain.value = 0.28;
    masterGain.connect(audio.destination);
    return audio;
  };

  const playTone = (frequency: number, duration: number, gainValue: number) => {
    const context = ensureAudio();
    if (!context || context.state !== "running" || !masterGain) return;

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      frequency * 0.62,
      now + duration,
    );
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainValue, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(masterGain);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  };

  return {
    unlock: async () => {
      const context = ensureAudio();
      if (!context) return;
      if (context.state === "suspended") {
        await context.resume();
      }
    },
    playBreak: () => {
      playTone(620, 0.18, 0.18);
      window.setTimeout(() => playTone(930, 0.16, 0.12), 48);
    },
    playCollision: () => {
      const context = ensureAudio();
      if (!context) return;
      const now = context.currentTime;
      if (now - lastCollisionAt < 0.045) return;
      lastCollisionAt = now;
      playTone(randomBetween(220, 360), 0.13, 0.08);
    },
    playSuccess: () => {
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

const centroidOf = (points: Point[]) => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
});

const createInitialBodies = (arena: Arena): RigidBody[] => {
  const size = arena.width * 0.18;
  const half = size / 2;
  const center = {
    x: arena.x + arena.width / 2,
    y: arena.y + arena.height / 2,
  };
  const speed = arena.width * 0.22;
  const triangles = [
    [
      { x: -half, y: -half },
      { x: half, y: -half },
      { x: 0, y: 0 },
    ],
    [
      { x: half, y: -half },
      { x: half, y: half },
      { x: 0, y: 0 },
    ],
    [
      { x: half, y: half },
      { x: -half, y: half },
      { x: 0, y: 0 },
    ],
    [
      { x: -half, y: half },
      { x: -half, y: -half },
      { x: 0, y: 0 },
    ],
  ];

  return triangles.map((points, index) => {
    const centroid = centroidOf(points);
    const direction = Math.atan2(centroid.y, centroid.x);
    const launchAngle = direction + randomBetween(-0.38, 0.38);
    const launchSpeed = speed * randomBetween(0.86, 1.16);

    return {
      id: index,
      x: center.x + centroid.x,
      y: center.y + centroid.y,
      vx: Math.cos(launchAngle) * launchSpeed,
      vy: Math.sin(launchAngle) * launchSpeed,
      rotation: 0,
      angularVelocity: randomBetween(-2.2, 2.2),
      pieces: [
        {
          id: index,
          color: TRIANGLE_COLORS[index],
          localX: 0,
          localY: 0,
          localRotation: 0,
          vertices: points.map((point) => ({
            x: point.x - centroid.x,
            y: point.y - centroid.y,
          })),
          connector: {
            index: 2,
            kind: "plain",
            matchKey: "square-diagonal",
            attached: false,
          },
        },
      ],
      glowColor: "none",
      glowTime: 0,
      attachPulse: 0,
    };
  });
};

const getPieceWorldTransform = (body: RigidBody, piece: TrianglePiece) => {
  const localPosition = rotatePoint(
    { x: piece.localX, y: piece.localY },
    body.rotation,
  );

  return {
    x: body.x + localPosition.x,
    y: body.y + localPosition.y,
    rotation: body.rotation + piece.localRotation,
  };
};

const getPieceWorldVertices = (body: RigidBody, piece: TrianglePiece) => {
  const transform = getPieceWorldTransform(body, piece);

  return piece.vertices.map((vertex) => {
    const rotated = rotatePoint(vertex, transform.rotation);
    return {
      x: transform.x + rotated.x,
      y: transform.y + rotated.y,
    };
  });
};

const getBodyWorldVertices = (body: RigidBody) =>
  body.pieces.flatMap((piece) => getPieceWorldVertices(body, piece));

const projectPolygon = (vertices: Point[], axis: Point) => {
  let min = dot(vertices[0], axis);
  let max = min;

  vertices.forEach((vertex) => {
    const projection = dot(vertex, axis);
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  });

  return { min, max };
};

const getAxes = (vertices: Point[]) =>
  vertices.map((vertex, index) => {
    const next = vertices[(index + 1) % vertices.length];
    const edge = subPoints(next, vertex);
    return normalize({ x: -edge.y, y: edge.x });
  });

const getPolygonCollision = (
  firstVertices: Point[],
  secondVertices: Point[],
  firstCenter: Point,
  secondCenter: Point,
): Collision | null => {
  const axes = [...getAxes(firstVertices), ...getAxes(secondVertices)];
  let smallestOverlap = Number.POSITIVE_INFINITY;
  let smallestAxis = axes[0];

  for (const axis of axes) {
    const firstProjection = projectPolygon(firstVertices, axis);
    const secondProjection = projectPolygon(secondVertices, axis);
    const overlap =
      Math.min(firstProjection.max, secondProjection.max) -
      Math.max(firstProjection.min, secondProjection.min);

    if (overlap <= 0) return null;
    if (overlap < smallestOverlap) {
      smallestOverlap = overlap;
      smallestAxis = axis;
    }
  }

  const centerDelta = subPoints(secondCenter, firstCenter);
  if (dot(centerDelta, smallestAxis) < 0) {
    smallestAxis = scalePoint(smallestAxis, -1);
  }

  return { normal: smallestAxis, overlap: smallestOverlap };
};

const getBodyCollision = (first: RigidBody, second: RigidBody): Collision | null => {
  let bestCollision: Collision | null = null;

  for (const firstPiece of first.pieces) {
    for (const secondPiece of second.pieces) {
      const collision = getPolygonCollision(
        getPieceWorldVertices(first, firstPiece),
        getPieceWorldVertices(second, secondPiece),
        { x: first.x, y: first.y },
        { x: second.x, y: second.y },
      );

      if (
        collision &&
        (!bestCollision || collision.overlap > bestCollision.overlap)
      ) {
        bestCollision = collision;
      }
    }
  }

  return bestCollision;
};

const getConnectorEdge = (
  body: RigidBody,
  piece: TrianglePiece,
): EdgeInfo | null => {
  if (piece.connector.attached) return null;

  const vertices = getPieceWorldVertices(body, piece);
  const start = vertices[piece.connector.index];
  const end = vertices[(piece.connector.index + 1) % vertices.length];
  const direction = normalize(subPoints(end, start));
  const normal = normalize({ x: -direction.y, y: direction.x });

  return {
    body,
    piece,
    start,
    end,
    direction,
    normal,
    midpoint: scalePoint(addPoints(start, end), 0.5),
  };
};

const getOpenConnectorEdges = (body: RigidBody) =>
  body.pieces
    .map((piece) => getConnectorEdge(body, piece))
    .filter((edge): edge is EdgeInfo => edge !== null);

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const getEndpointDistance = (first: EdgeInfo, second: EdgeInfo) => {
  const reversed =
    distance(first.start, second.end) + distance(first.end, second.start);
  const same = distance(first.start, second.start) + distance(first.end, second.end);
  return Math.min(reversed, same);
};

const getAngleDiff = (first: EdgeInfo, second: EdgeInfo) => {
  const oppositeDot = clamp(dot(first.direction, scalePoint(second.direction, -1)), -1, 1);
  return Math.acos(oppositeDot);
};

const checkAttachment = (
  first: RigidBody,
  second: RigidBody,
  arena: Arena,
): AttachmentCheck => {
  const maxEndpointDistance = arena.width * 0.085;
  const maxMidpointDistance = arena.width * 0.07;
  let best: AttachmentCheck = {
    first: null,
    second: null,
    angleDiff: Math.PI,
    valid: false,
  };

  for (const firstEdge of getOpenConnectorEdges(first)) {
    for (const secondEdge of getOpenConnectorEdges(second)) {
      if (firstEdge.piece.connector.matchKey !== secondEdge.piece.connector.matchKey) {
        continue;
      }

      const angleDiff = getAngleDiff(firstEdge, secondEdge);
      const endpointDistance = getEndpointDistance(firstEdge, secondEdge);
      const midpointDistance = distance(firstEdge.midpoint, secondEdge.midpoint);
      const score = angleDiff + endpointDistance / Math.max(1, arena.width);
      const bestScore =
        best.angleDiff +
        (best.first && best.second
          ? getEndpointDistance(best.first, best.second) / Math.max(1, arena.width)
          : 10);

      if (score < bestScore) {
        best = {
          first: firstEdge,
          second: secondEdge,
          angleDiff,
          valid:
            angleDiff <= CONNECTOR_TOLERANCE_RADIANS &&
            endpointDistance <= maxEndpointDistance &&
            midpointDistance <= maxMidpointDistance,
        };
      }
    }
  }

  return best;
};

const snapAndAttachBodies = (
  bodies: RigidBody[],
  first: RigidBody,
  second: RigidBody,
  check: AttachmentCheck,
) => {
  if (!check.first || !check.second) return;

  const angleCorrection =
    Math.atan2(check.first.direction.y, check.first.direction.x) -
    Math.atan2(-check.second.direction.y, -check.second.direction.x);
  second.rotation += angleCorrection;

  const refreshedSecondEdge = getConnectorEdge(second, check.second.piece);
  if (!refreshedSecondEdge) return;

  const translation = subPoints(check.first.midpoint, refreshedSecondEdge.midpoint);
  second.x += translation.x;
  second.y += translation.y;

  const mergedVx = (first.vx + second.vx) / 2;
  const mergedVy = (first.vy + second.vy) / 2;
  const mergedAngularVelocity =
    (first.angularVelocity * first.pieces.length +
      second.angularVelocity * second.pieces.length) /
    (first.pieces.length + second.pieces.length);

  second.pieces.forEach((piece) => {
    const worldTransform = getPieceWorldTransform(second, piece);
    const relativePosition = rotatePoint(
      { x: worldTransform.x - first.x, y: worldTransform.y - first.y },
      -first.rotation,
    );
    first.pieces.push({
      ...piece,
      localX: relativePosition.x,
      localY: relativePosition.y,
      localRotation: worldTransform.rotation - first.rotation,
    });
  });

  check.first.piece.connector.attached = true;
  const mergedPiece = first.pieces.find((piece) => piece.id === check.second?.piece.id);
  if (mergedPiece) {
    mergedPiece.connector.attached = true;
  }

  first.vx = mergedVx;
  first.vy = mergedVy;
  first.angularVelocity = mergedAngularVelocity;
  first.glowColor = "green";
  first.glowTime = 0.5;
  first.attachPulse = 1;

  const secondIndex = bodies.indexOf(second);
  if (secondIndex >= 0) {
    bodies.splice(secondIndex, 1);
  }
};

const resolveBodyCollisions = (
  arena: Arena,
  bodies: RigidBody[],
  audio: BrokenSquareAudio | null,
  debugRef: React.MutableRefObject<AttachmentCheck | null>,
) => {
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const first = bodies[i];
      const second = bodies[j];
      const collision = getBodyCollision(first, second);

      if (!collision) continue;

      const attachment = checkAttachment(first, second, arena);
      debugRef.current = attachment;

      if (attachment.valid) {
        first.glowColor = "green";
        second.glowColor = "green";
        first.glowTime = 0.5;
        second.glowTime = 0.5;
        audio?.playSuccess();
        snapAndAttachBodies(bodies, first, second, attachment);
        return;
      }

      const { normal, overlap } = collision;
      const correction = overlap / 2 + 0.35;
      first.x -= normal.x * correction;
      first.y -= normal.y * correction;
      second.x += normal.x * correction;
      second.y += normal.y * correction;

      const relativeVelocity = {
        x: second.vx - first.vx,
        y: second.vy - first.vy,
      };
      const velocityAlongNormal = dot(relativeVelocity, normal);

      if (velocityAlongNormal < 0) {
        const firstMass = first.pieces.length;
        const secondMass = second.pieces.length;
        const impulse =
          (-(1 + RESTITUTION) * velocityAlongNormal) / (1 / firstMass + 1 / secondMass);
        first.vx -= (impulse * normal.x) / firstMass;
        first.vy -= (impulse * normal.y) / firstMass;
        second.vx += (impulse * normal.x) / secondMass;
        second.vy += (impulse * normal.y) / secondMass;

        const tangent = { x: -normal.y, y: normal.x };
        const tangentSpeed = dot(relativeVelocity, tangent);
        first.angularVelocity -= tangentSpeed * 0.006 + randomBetween(-0.16, 0.16);
        second.angularVelocity += tangentSpeed * 0.006 + randomBetween(-0.16, 0.16);
      }

      first.glowColor = "red";
      second.glowColor = "red";
      first.glowTime = 0.5;
      second.glowTime = 0.5;
      audio?.playCollision();
    }
  }
};

const resolveWallCollisions = (
  arena: Arena,
  bodies: RigidBody[],
  playCollision: () => void,
) => {
  const left = arena.x;
  const right = arena.x + arena.width;
  const top = arena.y;
  const bottom = arena.y + arena.height;

  bodies.forEach((body) => {
    const vertices = getBodyWorldVertices(body);
    const minX = Math.min(...vertices.map((vertex) => vertex.x));
    const maxX = Math.max(...vertices.map((vertex) => vertex.x));
    const minY = Math.min(...vertices.map((vertex) => vertex.y));
    const maxY = Math.max(...vertices.map((vertex) => vertex.y));
    let collided = false;

    if (minX < left) {
      body.x += left - minX;
      body.vx = Math.abs(body.vx) * RESTITUTION;
      body.angularVelocity += randomBetween(-0.22, 0.22);
      collided = true;
    }
    if (maxX > right) {
      body.x -= maxX - right;
      body.vx = -Math.abs(body.vx) * RESTITUTION;
      body.angularVelocity += randomBetween(-0.22, 0.22);
      collided = true;
    }
    if (minY < top) {
      body.y += top - minY;
      body.vy = Math.abs(body.vy) * RESTITUTION;
      body.angularVelocity += randomBetween(-0.22, 0.22);
      collided = true;
    }
    if (maxY > bottom) {
      body.y -= maxY - bottom;
      body.vy = -Math.abs(body.vy) * RESTITUTION;
      body.angularVelocity += randomBetween(-0.22, 0.22);
      collided = true;
    }

    if (collided) {
      body.glowColor = "red";
      body.glowTime = Math.max(body.glowTime, 0.16);
      playCollision();
    }
  });
};

const drawArenaFrame = (ctx: CanvasRenderingContext2D, arena: Arena) => {
  const isMobile = window.innerWidth < 600;
  const boundaryLineWidth = isMobile ? 2.25 : 3;
  const boundaryGlow = isMobile ? 7 : 11;

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
  bg.addColorStop(0, "rgba(249, 115, 22, 0.08)");
  bg.addColorStop(0.48, "rgba(59, 130, 246, 0.07)");
  bg.addColorStop(1, "rgba(2, 6, 23, 0)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  ctx.save();
  ctx.strokeStyle = "rgba(2, 6, 23, 0.5)";
  ctx.lineWidth = isMobile ? 9 : 12;
  ctx.strokeRect(arena.x + 6, arena.y + 6, arena.width - 12, arena.height - 12);
  ctx.strokeStyle = "rgba(124, 143, 163, 0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(arena.x + 10, arena.y + 10, arena.width - 20, arena.height - 20);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "rgba(124, 143, 163, 0.32)";
  ctx.shadowBlur = boundaryGlow;
  ctx.strokeStyle = "rgba(124, 143, 163, 0.82)";
  ctx.lineWidth = boundaryLineWidth;
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
  ctx.font = `900 ${isMobile ? 25 : 38}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("BROKEN SQUARE", arena.x + arena.width / 2, arena.y - (isMobile ? 42 : 52));
  ctx.font = `800 ${isMobile ? 10 : 15}px Arial, Helvetica, sans-serif`;
  const subtitle = isMobile
    ? ["WHAT HAPPENS AFTER A PERFECT", "SQUARE BREAKS APART?"]
    : ["WHAT HAPPENS AFTER A PERFECT SQUARE BREAKS APART?"];
  subtitle.forEach((line, index) => {
    ctx.fillText(
      line,
      arena.x + arena.width / 2,
      arena.y - 15 - (subtitle.length - index - 1) * (isMobile ? 13 : 18),
    );
  });
  ctx.restore();
};

const drawTrianglePath = (
  ctx: CanvasRenderingContext2D,
  vertices: Point[],
) => {
  ctx.beginPath();
  vertices.forEach((vertex, index) => {
    if (index === 0) {
      ctx.moveTo(vertex.x, vertex.y);
    } else {
      ctx.lineTo(vertex.x, vertex.y);
    }
  });
  ctx.closePath();
};

const drawBody = (
  ctx: CanvasRenderingContext2D,
  body: RigidBody,
  debugEnabled: boolean,
) => {
  const glowColor =
    body.glowColor === "green"
      ? "rgba(34, 197, 94, 0.9)"
      : body.glowColor === "red"
        ? "rgba(239, 68, 68, 0.9)"
        : SAFFRON;
  const pulseScale = 1 + body.attachPulse * 0.08;

  body.pieces.forEach((piece) => {
    const transform = getPieceWorldTransform(body, piece);

    ctx.save();
    ctx.translate(body.x, body.y);
    ctx.scale(pulseScale, pulseScale);
    ctx.translate(transform.x - body.x, transform.y - body.y);
    ctx.rotate(transform.rotation);
    drawTrianglePath(ctx, piece.vertices);
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 18 + body.glowTime * 54;
    ctx.fillStyle = piece.color;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.42 + body.glowTime * 0.5})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    const start = piece.vertices[piece.connector.index];
    const end = piece.vertices[(piece.connector.index + 1) % piece.vertices.length];
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.shadowColor = "rgba(255, 255, 255, 0.95)";
    ctx.shadowBlur = piece.connector.attached ? 5 : 14;
    ctx.strokeStyle = piece.connector.attached
      ? "rgba(187, 247, 208, 0.78)"
      : "rgba(255, 255, 255, 0.96)";
    ctx.lineWidth = debugEnabled ? 5 : 4;
    ctx.stroke();
    ctx.restore();
  });
};

const drawWholeSquare = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  elapsed: number,
) => {
  const size = arena.width * 0.18;
  const pulse = elapsed >= HOLD_DURATION ? 1.08 : 1;
  const flash = clamp((elapsed - HOLD_DURATION) / 0.1, 0, 1);
  const x = arena.x + arena.width / 2;
  const y = arena.y + arena.height / 2;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pulse, pulse);
  ctx.shadowColor = "rgba(249, 115, 22, 0.68)";
  ctx.shadowBlur = 24 + flash * 34;
  ctx.fillStyle = SAFFRON;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255, 247, 237, 0.52)";
  ctx.strokeRect(-size / 2 + 1, -size / 2 + 1, size - 2, size - 2);
  if (flash > 0) {
    ctx.globalAlpha = flash * 0.34;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-size / 2, -size / 2, size, size);
  }
  ctx.restore();
};

const drawBreakAnimation = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  bodies: RigidBody[],
  progress: number,
) => {
  const eased = easeOutBack(progress);
  const flash = 1 - clamp(progress / 0.24, 0, 1);
  const separation = arena.width * 0.075 * eased;
  const scale = 1 + Math.sin(progress * Math.PI) * 0.06;
  const center = { x: arena.x + arena.width / 2, y: arena.y + arena.height / 2 };

  if (flash > 0) {
    ctx.save();
    ctx.globalAlpha = flash * 0.34;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(arena.x, arena.y, arena.width, arena.height);
    ctx.restore();
  }

  bodies.forEach((body) => {
    const dx = body.x - center.x;
    const dy = body.y - center.y;
    const length = Math.hypot(dx, dy) || 1;
    const piece = body.pieces[0];

    ctx.save();
    ctx.translate(
      body.x + (dx / length) * separation,
      body.y + (dy / length) * separation,
    );
    ctx.rotate((body.id - 1.5) * 0.05 * easeOutCubic(progress));
    ctx.scale(scale, scale);
    drawTrianglePath(ctx, piece.vertices);
    ctx.shadowColor = piece.color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = piece.color;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.46)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  });
};

const drawDebugOverlay = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  bodies: RigidBody[],
  lastCheck: AttachmentCheck | null,
) => {
  bodies.flatMap(getOpenConnectorEdges).forEach((edge) => {
    ctx.save();
    ctx.shadowColor = "rgba(255, 255, 255, 0.8)";
    ctx.shadowBlur = 9;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(edge.start.x, edge.start.y);
    ctx.lineTo(edge.end.x, edge.end.y);
    ctx.stroke();
    ctx.restore();
  });

  const angleText =
    lastCheck && lastCheck.first && lastCheck.second
      ? `${Math.round((lastCheck.angleDiff * 180) / Math.PI)} deg`
      : "--";
  const validText = lastCheck?.valid ? "VALID" : "INVALID";

  ctx.save();
  ctx.fillStyle = "rgba(2, 6, 23, 0.72)";
  ctx.fillRect(arena.x + 12, arena.y + 12, 210, 72);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.strokeRect(arena.x + 12, arena.y + 12, 210, 72);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 12px Arial, Helvetica, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("DEBUG: CONNECTORS", arena.x + 24, arena.y + 24);
  ctx.fillStyle = lastCheck?.valid ? "#86efac" : "#fca5a5";
  ctx.fillText(`ANGLE: ${angleText}`, arena.x + 24, arena.y + 43);
  ctx.fillText(`ATTACHMENT: ${validText}`, arena.x + 24, arena.y + 60);
  ctx.restore();
};

const BrokenSquare = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<BrokenSquareAudio | null>(null);
  const arenaRef = useRef<Arena | null>(null);
  const bodiesRef = useRef<RigidBody[]>([]);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const startedAtRef = useRef(0);
  const breakSoundPlayedRef = useRef(false);
  const physicsActivatedRef = useRef(false);
  const debugEnabledRef = useRef(false);
  const lastAttachmentCheckRef = useRef<AttachmentCheck | null>(null);

  if (audioRef.current === null) {
    audioRef.current = createAudio();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const syncBodiesToArena = (arena: Arena) => {
      bodiesRef.current = createInitialBodies(arena);
    };

    const initialize = () => {
      const arena = resizeCanvas(canvas);
      arenaRef.current = arena;
      syncBodiesToArena(arena);
      const now = performance.now();
      startedAtRef.current = now;
      lastTimeRef.current = now;
      breakSoundPlayedRef.current = false;
      physicsActivatedRef.current = false;
      lastAttachmentCheckRef.current = null;
    };

    const activatePhysicsPositions = (arena: Arena) => {
      const center = { x: arena.x + arena.width / 2, y: arena.y + arena.height / 2 };
      const separation = arena.width * 0.075;
      bodiesRef.current.forEach((body) => {
        const dx = body.x - center.x;
        const dy = body.y - center.y;
        const length = Math.hypot(dx, dy) || 1;
        body.x += (dx / length) * separation;
        body.y += (dy / length) * separation;
      });
    };

    const stepPhysics = (dt: number, arena: Arena) => {
      const subDt = dt / PHYSICS_SUBSTEPS;

      for (let step = 0; step < PHYSICS_SUBSTEPS; step += 1) {
        bodiesRef.current.forEach((body) => {
          body.x += body.vx * subDt;
          body.y += body.vy * subDt;
          body.rotation += body.angularVelocity * subDt;
          body.angularVelocity *= 0.999;
          body.glowTime = Math.max(0, body.glowTime - subDt);
          body.attachPulse = Math.max(0, body.attachPulse - subDt * 3.2);
          if (body.glowTime <= 0) {
            body.glowColor = "none";
          }
        });

        resolveWallCollisions(arena, bodiesRef.current, () =>
          audioRef.current?.playCollision(),
        );
        resolveBodyCollisions(
          arena,
          bodiesRef.current,
          audioRef.current,
          lastAttachmentCheckRef,
        );
      }
    };

    const draw = (time: number) => {
      const arena = arenaRef.current;
      if (!arena) return;

      const elapsed = (time - startedAtRef.current) / 1000;
      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.033);
      lastTimeRef.current = time;

      drawArenaFrame(ctx, arena);

      if (elapsed < HOLD_DURATION) {
        drawWholeSquare(ctx, arena, elapsed);
      } else if (elapsed < HOLD_DURATION + BREAK_DURATION) {
        if (!breakSoundPlayedRef.current) {
          breakSoundPlayedRef.current = true;
          audioRef.current?.playBreak();
        }
        const progress = clamp((elapsed - HOLD_DURATION) / BREAK_DURATION, 0, 1);
        drawBreakAnimation(ctx, arena, bodiesRef.current, progress);
        if (progress >= 0.99 && !physicsActivatedRef.current) {
          activatePhysicsPositions(arena);
          physicsActivatedRef.current = true;
        }
      } else {
        if (!physicsActivatedRef.current) {
          activatePhysicsPositions(arena);
          physicsActivatedRef.current = true;
        }
        stepPhysics(dt, arena);
        bodiesRef.current.forEach((body) =>
          drawBody(ctx, body, debugEnabledRef.current),
        );
        if (debugEnabledRef.current) {
          drawDebugOverlay(
            ctx,
            arena,
            bodiesRef.current,
            lastAttachmentCheckRef.current,
          );
        }
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    const handleResize = () => {
      const arena = resizeCanvas(canvas);
      arenaRef.current = arena;
      syncBodiesToArena(arena);
      const elapsed = (performance.now() - startedAtRef.current) / 1000;
      if (elapsed >= HOLD_DURATION + BREAK_DURATION) {
        activatePhysicsPositions(arena);
        physicsActivatedRef.current = true;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      void audioRef.current?.unlock();
      if (event.key.toLowerCase() === "d") {
        debugEnabledRef.current = !debugEnabledRef.current;
      }
    };

    const unlockSound = () => {
      void audioRef.current?.unlock();
    };

    initialize();
    animationRef.current = requestAnimationFrame(draw);
    window.addEventListener("resize", handleResize);
    window.addEventListener("pointerdown", unlockSound, { passive: true });
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("pointerdown", unlockSound);
      window.removeEventListener("keydown", handleKeyDown);
      audioRef.current?.dispose();
    };
  }, []);

  return (
    <div className="broken-square-root">
      <canvas ref={canvasRef} className="broken-square-canvas" />
      <style jsx>{`
        .broken-square-root {
          position: relative;
          width: 100%;
          height: 100dvh;
          min-height: 100dvh;
          max-height: 100dvh;
          overflow: hidden;
          background: #020617;
          color: #f8fafc;
        }

        .broken-square-canvas {
          width: 100%;
          height: 100dvh;
          min-height: 100dvh;
          max-height: 100dvh;
        }
      `}</style>
    </div>
  );
};

export default BrokenSquare;
