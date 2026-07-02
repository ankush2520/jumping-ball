"use client";

import React, { useEffect, useRef, useState } from "react";
import { drawCanvasWatermark } from "@/app/lib/watermark";

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
  attached: boolean;
};

type TrianglePiece = {
  id: number;
  color: string;
  localX: number;
  localY: number;
  localRotation: number;
  vertices: Point[];
  connectors: ConnectorSide[];
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
  connector: ConnectorSide;
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
  playSuccess: () => void;
  dispose: () => void;
};

const HUD_RESERVED_HEIGHT_DESKTOP = 194;
const HUD_RESERVED_HEIGHT_MOBILE = 210;
const ARENA_SAFE_SPACING = 24;
const MOBILE_BOTTOM_SAFE_SPACING = 28;
const PHYSICS_SUBSTEPS = 3;
const RESTITUTION = 1;
const SPEED_SCALE = 1.5;
const BODY_SPEED_RATIO = 0.32 * SPEED_SCALE;
const CONNECTOR_TOLERANCE_RADIANS = (15 * Math.PI) / 180;
const SAFFRON = "#28d0ea";
const TRIANGLE_COLORS = [SAFFRON, SAFFRON, SAFFRON, SAFFRON];
const SQUARE_SIZE_SCALE = 0.75 * 0.8 * 0.75; // reduced by 0.75x

let sharedAudioContext: AudioContext | null = null;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const randomBetween = (min: number, max: number) =>
  min + Math.random() * (max - min);

const rotatePoint = (point: Point, rotation: number): Point => {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
};

const addPoints = (a: Point, b: Point): Point => ({
  x: a.x + b.x,
  y: a.y + b.y,
});

const subPoints = (a: Point, b: Point): Point => ({
  x: a.x - b.x,
  y: a.y - b.y,
});

const scalePoint = (point: Point, scale: number): Point => ({
  x: point.x * scale,
  y: point.y * scale,
});

const normalize = (point: Point): Point => {
  const length = Math.hypot(point.x, point.y) || 1;
  return { x: point.x / length, y: point.y / length };
};

const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;

const getBodySpeed = (arena: Arena, squareCount: number) => {
  const baseSpeed = arena.width * BODY_SPEED_RATIO;
  const speedMultiplier = 0.7 + (0.3 * (squareCount - 1)) / 24;
  return baseSpeed * speedMultiplier;
};

const preserveBodySpeed = (
  body: RigidBody,
  arena: Arena,
  squareCount: number,
) => {
  const targetSpeed = getBodySpeed(arena, squareCount);
  const currentSpeed = Math.hypot(body.vx, body.vy);

  if (currentSpeed < 0.001) {
    const angle = randomBetween(0, Math.PI * 2);
    body.vx = Math.cos(angle) * targetSpeed;
    body.vy = Math.sin(angle) * targetSpeed;
    return;
  }

  body.vx = (body.vx / currentSpeed) * targetSpeed;
  body.vy = (body.vy / currentSpeed) * targetSpeed;
};

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
  const bottomSpacing = isMobile
    ? MOBILE_BOTTOM_SAFE_SPACING
    : ARENA_SAFE_SPACING;
  const availableWidth = Math.max(220, width - horizontalPadding);
  const availableHeight = Math.max(
    220,
    height - hudReservedHeight - bottomSpacing,
  );
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
  const pianoNotes = [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33];

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

  const playPianoNote = (frequency: number) => {
    const context = ensureAudio();
    if (!context || context.state !== "running" || !masterGain) return;

    const now = context.currentTime;
    const outputGain = context.createGain();
    const filter = context.createBiquadFilter();
    const harmonics = [
      { ratio: 1, gain: 0.18 },
      { ratio: 2, gain: 0.075 },
      { ratio: 3, gain: 0.035 },
      { ratio: 4.01, gain: 0.014 },
    ];

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(3600, now);
    filter.frequency.exponentialRampToValueAtTime(1250, now + 0.42);
    outputGain.gain.setValueAtTime(0.0001, now);
    outputGain.gain.linearRampToValueAtTime(0.42, now + 0.006);
    outputGain.gain.exponentialRampToValueAtTime(0.13, now + 0.07);
    outputGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.58);
    outputGain.connect(filter);
    filter.connect(masterGain);

    harmonics.forEach((harmonic, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = index === 0 ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(
        frequency * harmonic.ratio * randomBetween(0.998, 1.002),
        now,
      );
      gain.gain.setValueAtTime(harmonic.gain, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45 + index * 0.04);
      oscillator.connect(gain);
      gain.connect(outputGain);
      oscillator.start(now);
      oscillator.stop(now + 0.64);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    });

    window.setTimeout(() => {
      outputGain.disconnect();
      filter.disconnect();
    }, 700);
  };

  return {
    unlock: async () => {
      const context = ensureAudio();
      if (!context) return;
      if (context.state === "suspended") {
        await context.resume();
      }
    },
    playCollision: () => {
      const context = ensureAudio();
      if (!context) return;
      const now = context.currentTime;
      if (now - lastCollisionAt < 0.06) return;
      lastCollisionAt = now;
      playPianoNote(pianoNotes[Math.floor(Math.random() * pianoNotes.length)]);
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

const createTriangleConnectors = (triangleIndex: number): ConnectorSide[] => {
  void triangleIndex;

  return [0, 1, 2].map((index) => ({
    index,
    kind: "plain",
    attached: false,
  }));
};

const getSquareSize = (arena: Arena, squareCount: number) => {
  const baseSize = arena.width * 0.18 * SQUARE_SIZE_SCALE;
  return baseSize * Math.sqrt(25 / squareCount);
};

const createInitialBodies = (
  arena: Arena,
  squareCount: number,
): RigidBody[] => {
  const size = getSquareSize(arena, squareCount);
  const half = size / 2;
  const triangleCount = squareCount * 4;
  const margin = half * 1.25;
  const speed = getBodySpeed(arena, squareCount);
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

  const bodies: RigidBody[] = [];

  for (let index = 0; index < triangleCount; index += 1) {
    const triangleIndex = index % triangles.length;
    const points = triangles[triangleIndex];
    const centroid = centroidOf(points);
    const angle = randomBetween(0, Math.PI * 2);
    const launchSpeed = speed;
    let x = arena.x + margin + Math.random() * (arena.width - margin * 2);
    let y = arena.y + margin + Math.random() * (arena.height - margin * 2);

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const candidateX =
        arena.x + margin + Math.random() * (arena.width - margin * 2);
      const candidateY =
        arena.y + margin + Math.random() * (arena.height - margin * 2);
      const separated = bodies.every(
        (body) =>
          Math.hypot(body.x - candidateX, body.y - candidateY) > half * 1.35,
      );

      if (separated) {
        x = candidateX;
        y = candidateY;
        break;
      }
    }

    bodies.push({
      id: index,
      x,
      y,
      vx: Math.cos(angle) * launchSpeed,
      vy: Math.sin(angle) * launchSpeed,
      rotation: 0,
      angularVelocity: 0,
      pieces: [
        {
          id: index,
          color: TRIANGLE_COLORS[triangleIndex],
          localX: 0,
          localY: 0,
          localRotation: 0,
          vertices: points.map((point) => ({
            x: point.x - centroid.x,
            y: point.y - centroid.y,
          })),
          connectors: createTriangleConnectors(triangleIndex),
        },
      ],
      glowColor: "none",
      glowTime: 0,
      attachPulse: 0,
    });
  }

  return bodies;
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

const getBodyCollision = (
  first: RigidBody,
  second: RigidBody,
): Collision | null => {
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
  connector: ConnectorSide,
): EdgeInfo | null => {
  if (connector.attached) return null;

  const vertices = getPieceWorldVertices(body, piece);
  const start = vertices[connector.index];
  const end = vertices[(connector.index + 1) % vertices.length];
  const direction = normalize(subPoints(end, start));
  const normal = normalize({ x: -direction.y, y: direction.x });

  return {
    body,
    piece,
    connector,
    start,
    end,
    direction,
    normal,
    midpoint: scalePoint(addPoints(start, end), 0.5),
  };
};

const getOpenConnectorEdges = (body: RigidBody) =>
  body.pieces.flatMap((piece) =>
    piece.connectors
      .map((connector) => getConnectorEdge(body, piece, connector))
      .filter((edge): edge is EdgeInfo => edge !== null),
  );

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const getEndpointDistance = (first: EdgeInfo, second: EdgeInfo) => {
  const reversed =
    distance(first.start, second.end) + distance(first.end, second.start);
  const same =
    distance(first.start, second.start) + distance(first.end, second.end);
  return Math.min(reversed, same);
};

const getAngleDiff = (first: EdgeInfo, second: EdgeInfo) => {
  const oppositeDot = clamp(
    dot(first.direction, scalePoint(second.direction, -1)),
    -1,
    1,
  );
  return Math.acos(oppositeDot);
};

const checkAttachment = (
  first: RigidBody,
  second: RigidBody,
  arena: Arena,
  squareCount: number,
): AttachmentCheck => {
  const squareSize = getSquareSize(arena, squareCount);
  const maxEndpointDistance = squareSize * 1.73;
  const maxMidpointDistance = squareSize * 1.36;
  let best: AttachmentCheck = {
    first: null,
    second: null,
    angleDiff: Math.PI,
    valid: false,
  };

  for (const firstEdge of getOpenConnectorEdges(first)) {
    for (const secondEdge of getOpenConnectorEdges(second)) {
      const angleDiff = getAngleDiff(firstEdge, secondEdge);
      const endpointDistance = getEndpointDistance(firstEdge, secondEdge);
      const midpointDistance = distance(
        firstEdge.midpoint,
        secondEdge.midpoint,
      );
      const score = endpointDistance + midpointDistance * 0.75;
      const bestScore =
        best.first && best.second
          ? getEndpointDistance(best.first, best.second) +
            distance(best.first.midpoint, best.second.midpoint) * 0.75
          : Number.POSITIVE_INFINITY;

      if (score < bestScore) {
        const edgesAreTouching =
          endpointDistance <= maxEndpointDistance &&
          midpointDistance <= maxMidpointDistance;

        best = {
          first: firstEdge,
          second: secondEdge,
          angleDiff,
          valid: edgesAreTouching && angleDiff <= CONNECTOR_TOLERANCE_RADIANS,
        };
      }
    }
  }

  return best;
};

const snapAndAttachBodies = (
  arena: Arena,
  bodies: RigidBody[],
  first: RigidBody,
  second: RigidBody,
  check: AttachmentCheck,
  squareCount: number,
) => {
  if (!check.first || !check.second) return;

  const angleCorrection =
    Math.atan2(check.first.direction.y, check.first.direction.x) -
    Math.atan2(-check.second.direction.y, -check.second.direction.x);
  second.rotation += angleCorrection;

  const refreshedSecondEdge = getConnectorEdge(
    second,
    check.second.piece,
    check.second.connector,
  );
  if (!refreshedSecondEdge) return;

  const translation = subPoints(
    check.first.midpoint,
    refreshedSecondEdge.midpoint,
  );
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
      connectors: piece.connectors.map((connector) => ({ ...connector })),
    });
  });

  check.first.connector.attached = true;
  const secondConnectorIndex = check.second.connector.index;
  const mergedPiece = first.pieces.find(
    (piece) => piece.id === check.second?.piece.id,
  );
  if (mergedPiece) {
    const mergedConnector = mergedPiece.connectors.find(
      (connector) => connector.index === secondConnectorIndex,
    );
    if (mergedConnector) {
      mergedConnector.attached = true;
    }
  }

  first.vx = mergedVx;
  first.vy = mergedVy;
  preserveBodySpeed(first, arena, squareCount);
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
  allowMerge: boolean,
  squareCount: number,
) => {
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const first = bodies[i];
      const second = bodies[j];
      const collision = getBodyCollision(first, second);

      if (!collision) continue;

      const attachment = checkAttachment(first, second, arena, squareCount);
      debugRef.current = attachment;

      if (attachment.valid) {
        // indicate potential attachment but only actually merge when allowed
        first.glowColor = "green";
        second.glowColor = "green";
        first.glowTime = 0.5;
        second.glowTime = 0.5;
        if (allowMerge) {
          audio?.playSuccess();
          snapAndAttachBodies(
            arena,
            bodies,
            first,
            second,
            attachment,
            squareCount,
          );
          return;
        }
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
          (-(1 + RESTITUTION) * velocityAlongNormal) /
          (1 / firstMass + 1 / secondMass);
        first.vx -= (impulse * normal.x) / firstMass;
        first.vy -= (impulse * normal.y) / firstMass;
        second.vx += (impulse * normal.x) / secondMass;
        second.vy += (impulse * normal.y) / secondMass;
        preserveBodySpeed(first, arena, squareCount);
        preserveBodySpeed(second, arena, squareCount);
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
  squareCount: number,
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
      collided = true;
    }
    if (maxX > right) {
      body.x -= maxX - right;
      body.vx = -Math.abs(body.vx) * RESTITUTION;
      collided = true;
    }
    if (minY < top) {
      body.y += top - minY;
      body.vy = Math.abs(body.vy) * RESTITUTION;
      collided = true;
    }
    if (maxY > bottom) {
      body.y -= maxY - bottom;
      body.vy = -Math.abs(body.vy) * RESTITUTION;
      collided = true;
    }

    if (collided) {
      preserveBodySpeed(body, arena, squareCount);
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
  ctx.font = `900 ${isMobile ? 22 : 32}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const cx = arena.x + arena.width / 2;
  ctx.fillText("What weird shape", cx, arena.y - (isMobile ? 66 : 90));
  ctx.fillText(
    "will these triangles make?",
    cx,
    arena.y - (isMobile ? 42 : 54),
  );
  ctx.font = `800 ${isMobile ? 13 : 15}px Arial, Helvetica, sans-serif`;
  const subtitle = isMobile
    ? ["Can we see a perfect square!"]
    : ["Can we see a perfect square!"];
  subtitle.forEach((line, index) => {
    ctx.fillText(
      line,
      arena.x + arena.width / 2,
      arena.y - 15 - (subtitle.length - index - 1) * (isMobile ? 13 : 18),
    );
  });
  ctx.restore();
};

const drawTrianglePath = (ctx: CanvasRenderingContext2D, vertices: Point[]) => {
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
    void debugEnabled;
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
    ctx.shadowColor = "rgba(255, 255, 255, 0.76)";
    ctx.shadowBlur = 9;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.76)";
    ctx.lineWidth = 2;
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

const SHUFFLE_LABEL = "Shuffling !";

const BrokenSquare = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<BrokenSquareAudio | null>(null);
  const arenaRef = useRef<Arena | null>(null);
  const bodiesRef = useRef<RigidBody[]>([]);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const debugEnabledRef = useRef(false);
  const lastAttachmentCheckRef = useRef<AttachmentCheck | null>(null);
  const mergeStartRef = useRef<number | null>(null);
  const mergeGraceEndRef = useRef<number | null>(null);
  const allowCollisionRef = useRef(false);
  const allowMergeRef = useRef(false);
  const [mergeRemaining, setMergeRemaining] = useState<number | null>(null);
  const lastMergeDisplayedRef = useRef<number | null>(null);
  const [squareCount, setSquareCount] = useState(25);
  const squareCountRef = useRef(25);
  squareCountRef.current = squareCount;
  const [started, setStarted] = useState(false);
  const [showCountPanel, setShowCountPanel] = useState(false);

  if (audioRef.current === null) {
    audioRef.current = createAudio();
  }

  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const syncBodiesToArena = (arena: Arena) => {
      bodiesRef.current = createInitialBodies(arena, squareCountRef.current);
    };

    const initialize = () => {
      const arena = resizeCanvas(canvas);
      arenaRef.current = arena;
      syncBodiesToArena(arena);
      const now = performance.now();
      lastTimeRef.current = now;
      lastAttachmentCheckRef.current = null;
      mergeStartRef.current = now + 5000;
      mergeGraceEndRef.current = now + 8000;
      allowCollisionRef.current = false;
      allowMergeRef.current = false;
    };

    const stepPhysics = (dt: number, arena: Arena) => {
      const subDt = dt / PHYSICS_SUBSTEPS;
      const sc = squareCountRef.current;
      const isCountdown = !allowCollisionRef.current;
      const countdownSpeed = getBodySpeed(arena, 1) * 5;

      for (let step = 0; step < PHYSICS_SUBSTEPS; step += 1) {
        if (isCountdown) {
          bodiesRef.current.forEach((body) => {
            const spd = Math.hypot(body.vx, body.vy);
            if (spd > 0.001) {
              body.vx = (body.vx / spd) * countdownSpeed;
              body.vy = (body.vy / spd) * countdownSpeed;
            }
          });
        }

        bodiesRef.current.forEach((body) => {
          body.x += body.vx * subDt;
          body.y += body.vy * subDt;
          body.angularVelocity = 0;
          body.glowTime = Math.max(0, body.glowTime - subDt);
          body.attachPulse = Math.max(0, body.attachPulse - subDt * 3.2);
          if (body.glowTime <= 0) {
            body.glowColor = "none";
          }
        });

        resolveWallCollisions(
          arena,
          bodiesRef.current,
          () => audioRef.current?.playCollision(),
          sc,
        );
        if (!isCountdown) {
          resolveBodyCollisions(
            arena,
            bodiesRef.current,
            audioRef.current,
            lastAttachmentCheckRef,
            allowMergeRef.current,
            sc,
          );
        }
      }
    };

    const draw = (time: number) => {
      const arena = arenaRef.current;
      if (!arena) return;

      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.033);
      lastTimeRef.current = time;

      // Phase 1 (0–5s): label visible, no collisions
      let remaining: number | null = null;
      if (mergeStartRef.current !== null && !allowCollisionRef.current) {
        remaining = Math.max(
          0,
          Math.ceil((mergeStartRef.current - time) / 1000),
        );
        if (remaining === 0) {
          allowCollisionRef.current = true;
          remaining = null;
        }
      }
      // Phase 2 (5–8s): collisions on, merge still off, no label
      if (
        allowCollisionRef.current &&
        !allowMergeRef.current &&
        mergeGraceEndRef.current !== null &&
        time >= mergeGraceEndRef.current
      ) {
        allowMergeRef.current = true;
      }

      if (lastMergeDisplayedRef.current !== remaining) {
        lastMergeDisplayedRef.current = remaining;
        setMergeRemaining(remaining);
      }

      drawArenaFrame(ctx, arena);

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

      animationRef.current = requestAnimationFrame(draw);
    };

    const handleResize = () => {
      const arena = resizeCanvas(canvas);
      arenaRef.current = arena;
      syncBodiesToArena(arena);
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
  }, [started]);

  useEffect(() => {
    if (!arenaRef.current) return;
    bodiesRef.current = createInitialBodies(arenaRef.current, squareCount);
    const now = performance.now();
    mergeStartRef.current = now + 5000;
    mergeGraceEndRef.current = now + 8000;
    allowCollisionRef.current = false;
    allowMergeRef.current = false;
    lastMergeDisplayedRef.current = null;
    setMergeRemaining(null);
  }, [squareCount]);

  return (
    <div className="broken-square-root">
      <canvas ref={canvasRef} className="broken-square-canvas" />

      {started && (
        <button
          type="button"
          aria-label="Change square count"
          title="Change square count"
          className="square-count-button"
          onClick={() => setShowCountPanel((prev) => !prev)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="currentColor"
          >
            <rect x="3" y="3" width="7" height="7" rx="1.3" />
            <rect x="14" y="3" width="7" height="7" rx="1.3" />
            <rect x="3" y="14" width="7" height="7" rx="1.3" />
            <rect x="14" y="14" width="7" height="7" rx="1.3" />
          </svg>
        </button>
      )}

      {started && showCountPanel && (
        <div className="scc-panel">
          <span className="scc-label">SQUARE COUNT</span>
          <div className="scc-row">
            <span className="scc-num">1</span>
            <input
              type="range"
              min={1}
              max={25}
              value={squareCount}
              onChange={(e) => setSquareCount(Number(e.target.value))}
              className="scc-slider"
            />
            <span className="scc-num">25</span>
          </div>
          <span className="scc-value">
            {squareCount} {squareCount === 1 ? "square" : "squares"} ·{" "}
            {squareCount * 4} triangles
          </span>
        </div>
      )}

      {!started && (
        <div className="setup-overlay">
          <div className="setup-card">
            <div className="setup-badge">MERGING TRIANGLES</div>
            <h2 className="setup-heading">How many squares?</h2>
            <p className="setup-sub">
              Each square splits into 4 triangles · merge them back
            </p>
            <div className="setup-count-display">
              <span className="setup-count-num">{squareCount}</span>
              <span className="setup-count-unit">
                {squareCount === 1 ? "square" : "squares"}
              </span>
            </div>
            <div className="setup-triangles-hint">
              {squareCount * 4} triangles
            </div>
            <div className="setup-slider-row">
              <span className="setup-range-num">1</span>
              <input
                type="range"
                min={1}
                max={25}
                value={squareCount}
                onChange={(e) => setSquareCount(Number(e.target.value))}
                className="setup-slider"
              />
              <span className="setup-range-num">25</span>
            </div>
            <button
              className="setup-play-btn"
              onClick={() => {
                void audioRef.current?.unlock();
                setStarted(true);
              }}
            >
              ▶&nbsp;&nbsp;PLAY
            </button>
          </div>
        </div>
      )}

      {mergeRemaining !== null && (
        <div className="merge-overlay">
          <div className="merge-box">
            <div className="shuffle-label">{SHUFFLE_LABEL}</div>
            <div className="merge-msg">Merging will begin in</div>
            <div className="merge-counter">{mergeRemaining}</div>
          </div>
        </div>
      )}
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

        /* ── Setup overlay ── */
        .setup-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(2, 6, 23, 0.82);
          backdrop-filter: blur(6px);
          z-index: 20;
          padding: 24px;
        }

        .setup-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
          width: min(420px, 100%);
          padding: 36px 32px 32px;
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.07) 0%,
            rgba(15, 10, 30, 0.72) 100%
          );
          border: 1px solid rgba(168, 85, 247, 0.32);
          border-radius: 24px;
          box-shadow:
            0 0 60px rgba(168, 85, 247, 0.1),
            0 24px 60px rgba(2, 6, 23, 0.5),
            inset 0 1px 0 rgba(255, 255, 255, 0.12);
          text-align: center;
        }

        .setup-badge {
          font-size: 0.65rem;
          font-weight: 900;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: rgba(168, 85, 247, 0.9);
          border: 1px solid rgba(168, 85, 247, 0.32);
          border-radius: 999px;
          padding: 3px 12px;
          background: rgba(168, 85, 247, 0.1);
        }

        .setup-heading {
          margin: 0;
          font-size: clamp(1.4rem, 5vw, 1.9rem);
          font-weight: 900;
          color: #f8fafc;
          letter-spacing: -0.01em;
        }

        .setup-sub {
          margin: 0;
          font-size: 0.78rem;
          color: rgba(248, 250, 252, 0.5);
          line-height: 1.4;
        }

        .setup-count-display {
          display: flex;
          align-items: baseline;
          gap: 8px;
          margin: 4px 0 0;
        }

        .setup-count-num {
          font-size: clamp(3rem, 12vw, 5rem);
          font-weight: 900;
          line-height: 1;
          background: linear-gradient(135deg, #c084fc, #a855f7, #818cf8);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .setup-count-unit {
          font-size: 1rem;
          font-weight: 700;
          color: rgba(248, 250, 252, 0.6);
        }

        .setup-triangles-hint {
          font-size: 0.8rem;
          font-weight: 600;
          color: rgba(168, 85, 247, 0.7);
          margin-top: -8px;
        }

        .setup-slider-row {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
        }

        .setup-range-num {
          font-size: 0.72rem;
          font-weight: 700;
          color: rgba(248, 250, 252, 0.4);
          min-width: 16px;
          text-align: center;
        }

        .setup-slider {
          flex: 1;
          height: 4px;
          accent-color: #a855f7;
          cursor: pointer;
        }

        .setup-play-btn {
          margin-top: 8px;
          width: 100%;
          min-height: 52px;
          border: none;
          border-radius: 16px;
          background: linear-gradient(135deg, #a855f7, #7c3aed);
          color: #fff;
          font-size: 1rem;
          font-weight: 900;
          letter-spacing: 0.1em;
          cursor: pointer;
          box-shadow:
            0 8px 24px rgba(168, 85, 247, 0.38),
            inset 0 1px 0 rgba(255, 255, 255, 0.22);
          transition:
            transform 0.18s ease,
            box-shadow 0.18s ease;
        }

        .setup-play-btn:hover {
          transform: translateY(-2px);
          box-shadow:
            0 12px 32px rgba(168, 85, 247, 0.5),
            inset 0 1px 0 rgba(255, 255, 255, 0.28);
        }

        .setup-play-btn:active {
          transform: translateY(0);
        }

        /* ── Square count button (mirrors the home button, top-right) ── */
        .square-count-button {
          position: fixed;
          right: 10px;
          top: 10px;
          z-index: 20;
          width: 34px;
          height: 34px;
          display: grid;
          place-items: center;
          padding: 0;
          border-radius: 999px;
          border: 1px solid rgba(248, 250, 252, 0.16);
          background: rgba(15, 23, 42, 0.58);
          color: #f8fafc;
          cursor: pointer;
          box-shadow: 0 8px 22px rgba(15, 23, 42, 0.28);
          backdrop-filter: blur(8px);
        }

        @media (max-width: 599px) {
          .square-count-button {
            right: 14px;
            top: calc(14px + env(safe-area-inset-top, 0px));
            width: 42px;
            height: 42px;
            z-index: 40;
          }

          .square-count-button svg {
            width: 20px;
            height: 20px;
          }
        }

        /* ── Compact in-game panel ── */
        .scc-panel {
          position: fixed;
          top: 52px;
          right: 10px;
          z-index: 20;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          background: rgba(2, 6, 23, 0.94);
          border: 1px solid rgba(168, 85, 247, 0.4);
          border-radius: 12px;
          padding: 8px 16px 6px;
          box-shadow: 0 8px 22px rgba(2, 6, 23, 0.5);
          backdrop-filter: blur(8px);
          pointer-events: all;
          z-index: 10;
          min-width: 220px;
        }

        .scc-label {
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(168, 85, 247, 0.9);
        }

        .scc-row {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
        }

        .scc-num {
          font-size: 10px;
          font-weight: 700;
          color: rgba(248, 250, 252, 0.5);
          min-width: 12px;
          text-align: center;
        }

        .scc-slider {
          flex: 1;
          height: 3px;
          accent-color: #a855f7;
          cursor: pointer;
          background: transparent;
        }

        .scc-value {
          font-size: 10px;
          font-weight: 600;
          color: rgba(248, 250, 252, 0.7);
          letter-spacing: 0.04em;
        }

        @media (max-width: 599px) {
          .scc-panel {
            top: calc(78px + env(safe-area-inset-top, 0px));
            right: 14px;
          }
        }

        /* ── Merge countdown ── */
        .merge-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
        }
        .merge-box {
          text-align: center;
          color: #f8fafc;
          background: rgba(2, 6, 23, 0.36);
          padding: 14px 22px;
          border-radius: 10px;
          backdrop-filter: blur(4px);
        }
        .shuffle-label {
          font-family: "Courier New", Courier, monospace;
          font-weight: 900;
          font-size: 13px;
          letter-spacing: 0.1em;
          color: rgba(248, 250, 252, 0.9);
          margin-bottom: 4px;
        }

        .merge-msg {
          font-weight: 700;
          font-size: 16px;
          margin-bottom: 6px;
        }
        .merge-counter {
          font-weight: 900;
          font-size: 28px;
        }
      `}</style>
    </div>
  );
};

export default BrokenSquare;
