"use client";

import React, { useEffect, useRef, useState } from "react";

type Ball = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alive: boolean;
  escaped: boolean;
};

type Arena = {
  x: number;
  y: number;
  width: number;
  height: number;
  canvasWidth: number;
  canvasHeight: number;
};

type Ring = {
  radius: number;
  thickness: number;
  gapSize: number;
  offset: number;
  speed: number;
  color: string;
};

type HudStats = {
  escaped: number;
  remaining: number;
  total: number;
  finished: boolean;
};

const MAX_DT = 1 / 30;
const PHYSICS_SUBSTEPS = 3;
const TEST_BALL_COUNT = 30;
const CENTER_EXIT_RATIO = 0.066;
const BALL_COLORS = [
  "#67e8f9",
  "#a7f3d0",
  "#fde68a",
  "#f9a8d4",
  "#c4b5fd",
  "#fca5a5",
  "#93c5fd",
  "#fb7185",
];

const randomBetween = (min: number, max: number) =>
  min + Math.random() * (max - min);

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const randomBallCount = () => TEST_BALL_COUNT;

const normalizeAngle = (angle: number) => {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
};

const angleDistance = (a: number, b: number) => {
  const fullTurn = Math.PI * 2;
  const diff = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(diff, fullTurn - diff);
};

const getCenter = (arena: Arena) => ({
  x: arena.x + arena.width / 2,
  y: arena.y + arena.height / 2,
});

const getCenterExitRadius = (arena: Arena) =>
  Math.min(arena.width, arena.height) * CENTER_EXIT_RATIO;

const resizeCanvas = (canvas: HTMLCanvasElement): Arena => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvasWidth = window.innerWidth;
  const canvasHeight = window.innerHeight;
  const safeTop = canvasWidth < 680 ? 86 : 76;
  const safeBottom = canvasWidth < 680 ? 82 : 30;
  const availableHeight = Math.max(420, canvasHeight - safeTop - safeBottom);
  const height = Math.floor(Math.min(availableHeight * 0.96, 860));
  const width = Math.floor(Math.min(canvasWidth * 0.84, height * 0.56, 450));
  const x = Math.floor((canvasWidth - width) / 2);
  const y = Math.floor(safeTop + (availableHeight - height) / 2);
  const ctx = canvas.getContext("2d");

  canvas.style.width = `${canvasWidth}px`;
  canvas.style.height = `${canvasHeight}px`;
  canvas.width = Math.floor(canvasWidth * dpr);
  canvas.height = Math.floor(canvasHeight * dpr);

  if (ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
  }

  return { x, y, width, height, canvasWidth, canvasHeight };
};

const createRings = (arena: Arena): Ring[] => {
  const base = Math.min(arena.width, arena.height);
  const thickness = clamp(base * 0.016, 5, 8);
  const gapSize = 1.18;
  const radiusUnit = base * 0.0475;

  return [
    {
      radius: radiusUnit * 8,
      thickness,
      gapSize,
      offset: -Math.PI / 2,
      speed: 0.62,
      color: "#38bdf8",
    },
    {
      radius: radiusUnit * 5,
      thickness,
      gapSize: gapSize * 0.94,
      offset: Math.PI * 0.2,
      speed: -0.82,
      color: "#a78bfa",
    },
    {
      radius: radiusUnit * 3,
      thickness,
      gapSize: gapSize * 0.88,
      offset: Math.PI * 0.9,
      speed: 1.02,
      color: "#f472b6",
    },
  ];
};

const createAudio = () => {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  return new AudioContextClass();
};

const playTone = (
  audio: AudioContext | null,
  frequency: number,
  duration: number,
  gainValue: number,
  type: OscillatorType,
) => {
  if (!audio) return;

  if (audio.state === "suspended") {
    void audio.resume();
  }

  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const now = audio.currentTime;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
};

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const spawnBalls = (arena: Arena, rings: Ring[], count: number): Ball[] => {
  const balls: Ball[] = [];
  const center = getCenter(arena);
  const outerRing = rings[0];
  const exitRadius = getCenterExitRadius(arena);

  for (let i = 0; i < count; i++) {
    const radius = clamp(
      Math.min(arena.width, arena.height) * randomBetween(0.012, 0.018),
      4,
      7,
    );
    let x = arena.x + radius;
    let y = arena.y + radius;

    for (let attempt = 0; attempt < 140; attempt++) {
      x = randomBetween(arena.x + radius, arena.x + arena.width - radius);
      y = randomBetween(arena.y + radius, arena.y + arena.height - radius);

      const distanceFromCenter = Math.hypot(x - center.x, y - center.y);
      const outsideMaze =
        distanceFromCenter >
        outerRing.radius + outerRing.thickness * 0.5 + radius + 10;
      const outsideExit = distanceFromCenter > exitRadius + radius + 18;
      const offRingWalls = rings.every(
        (ring) =>
          Math.abs(distanceFromCenter - ring.radius) >
          ring.thickness * 0.5 + radius + 2,
      );
      const separated = balls.every(
        (ball) => Math.hypot(x - ball.x, y - ball.y) > radius + ball.radius + 1,
      );

      if (outsideMaze && outsideExit && offRingWalls && separated) break;
    }

    const speed = randomBetween(arena.height * 0.2, arena.height * 0.34);
    const angle = randomBetween(0, Math.PI * 2);
    balls.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius,
      color: BALL_COLORS[i % BALL_COLORS.length],
      alive: true,
      escaped: false,
    });
  }

  return balls;
};

const resolveBallCollisions = (balls: Ball[]) => {
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i];
    if (!a.alive) continue;

    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j];
      if (!b.alive) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const minDistance = a.radius + b.radius;
      const distanceSq = dx * dx + dy * dy;

      if (distanceSq <= 0 || distanceSq >= minDistance * minDistance) continue;

      const distance = Math.sqrt(distanceSq);
      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = minDistance - distance;

      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;

      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const velocityAlongNormal = rvx * nx + rvy * ny;

      if (velocityAlongNormal > 0) continue;

      const impulse = -velocityAlongNormal * 0.98;
      a.vx -= impulse * nx;
      a.vy -= impulse * ny;
      b.vx += impulse * nx;
      b.vy += impulse * ny;
    }
  }
};

const isInRingGap = (
  ballAngle: number,
  ballRadius: number,
  ring: Ring,
  elapsedSeconds: number,
) => {
  const gapCenter = ring.offset + elapsedSeconds * ring.speed;
  const ballAllowance = (ballRadius / ring.radius) * 1.4;
  return angleDistance(ballAngle, gapCenter) < ring.gapSize / 2 + ballAllowance;
};

const resolveRingCollision = (
  ball: Ball,
  arena: Arena,
  ring: Ring,
  elapsedSeconds: number,
  previousX: number,
  previousY: number,
) => {
  const center = getCenter(arena);
  const dx = ball.x - center.x;
  const dy = ball.y - center.y;
  const distance = Math.max(Math.hypot(dx, dy), 0.0001);
  const previousDx = previousX - center.x;
  const previousDy = previousY - center.y;
  const previousDistance = Math.max(
    Math.hypot(previousDx, previousDy),
    0.0001,
  );
  const collisionBand = ring.thickness * 0.5 + ball.radius;
  const isOverlapping = Math.abs(distance - ring.radius) <= collisionBand;
  const crossedRing =
    (previousDistance - ring.radius) * (distance - ring.radius) <= 0;

  if (!isOverlapping && !crossedRing) return false;

  let collisionX = ball.x;
  let collisionY = ball.y;
  if (crossedRing && previousDistance !== distance) {
    const travelRatio = clamp(
      (ring.radius - previousDistance) / (distance - previousDistance),
      0,
      1,
    );
    collisionX = previousX + (ball.x - previousX) * travelRatio;
    collisionY = previousY + (ball.y - previousY) * travelRatio;
  }

  const angle = Math.atan2(collisionY - center.y, collisionX - center.x);
  if (isInRingGap(angle, ball.radius, ring, elapsedSeconds)) return false;

  const nx = (collisionX - center.x) / Math.max(
    Math.hypot(collisionX - center.x, collisionY - center.y),
    0.0001,
  );
  const ny = (collisionY - center.y) / Math.max(
    Math.hypot(collisionX - center.x, collisionY - center.y),
    0.0001,
  );
  const outsideRing = previousDistance >= ring.radius;
  const targetDistance = outsideRing
    ? ring.radius + collisionBand
    : ring.radius - collisionBand;

  ball.x = center.x + nx * targetDistance;
  ball.y = center.y + ny * targetDistance;

  const radialVelocity = ball.vx * nx + ball.vy * ny;
  const movingIntoWall =
    (outsideRing && radialVelocity < 0) || (!outsideRing && radialVelocity > 0);

  if (movingIntoWall) {
    ball.vx -= radialVelocity * nx * 1.96;
    ball.vy -= radialVelocity * ny * 1.96;
  }

  return true;
};

const drawBackground = (ctx: CanvasRenderingContext2D, arena: Arena) => {
  const gradient = ctx.createLinearGradient(0, 0, 0, arena.canvasHeight);
  gradient.addColorStop(0, "#08111f");
  gradient.addColorStop(0.58, "#020617");
  gradient.addColorStop(1, "#050816");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, arena.canvasWidth, arena.canvasHeight);

  ctx.fillStyle = "rgba(226, 232, 240, 0.7)";
  for (let i = 0; i < 72; i++) {
    const x = (i * 83.13) % arena.canvasWidth;
    const y = (i * 47.91) % arena.canvasHeight;
    ctx.globalAlpha = i % 6 === 0 ? 0.42 : 0.2;
    ctx.beginPath();
    ctx.arc(x, y, i % 8 === 0 ? 1.1 : 0.62, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};

const drawArena = (ctx: CanvasRenderingContext2D, arena: Arena) => {
  ctx.save();
  ctx.fillStyle = "rgba(2, 6, 23, 0.58)";
  ctx.fillRect(arena.x, arena.y, arena.width, arena.height);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
  ctx.lineWidth = 2;
  ctx.strokeRect(arena.x, arena.y, arena.width, arena.height);
  ctx.restore();
};

const drawRings = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  rings: Ring[],
  elapsedSeconds: number,
) => {
  const center = getCenter(arena);

  rings.forEach((ring) => {
    const gapCenter = normalizeAngle(ring.offset + elapsedSeconds * ring.speed);
    const start = gapCenter + ring.gapSize / 2;
    const end = gapCenter - ring.gapSize / 2 + Math.PI * 2;

    ctx.save();
    ctx.shadowColor = ring.color;
    ctx.shadowBlur = 10;
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = ring.thickness;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(center.x, center.y, ring.radius, start, end);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(248, 250, 252, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(center.x, center.y, ring.radius, start, end);
    ctx.stroke();

    const markerRadius = ring.radius;
    const markerA = gapCenter - ring.gapSize / 2;
    const markerB = gapCenter + ring.gapSize / 2;
    ctx.fillStyle = "rgba(187, 247, 208, 0.9)";
    [markerA, markerB].forEach((angle) => {
      ctx.beginPath();
      ctx.arc(
        center.x + Math.cos(angle) * markerRadius,
        center.y + Math.sin(angle) * markerRadius,
        Math.max(2, ring.thickness * 0.28),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    });
    ctx.restore();
  });
};

const drawCenterExit = (ctx: CanvasRenderingContext2D, arena: Arena) => {
  const center = getCenter(arena);
  const radius = getCenterExitRadius(arena);
  const gradient = ctx.createRadialGradient(
    center.x,
    center.y,
    1,
    center.x,
    center.y,
    radius * 1.7,
  );
  gradient.addColorStop(0, "rgba(240, 253, 244, 1)");
  gradient.addColorStop(0.42, "rgba(34, 197, 94, 0.88)");
  gradient.addColorStop(1, "rgba(34, 197, 94, 0)");

  ctx.save();
  ctx.shadowColor = "#22c55e";
  ctx.shadowBlur = 18;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius * 1.7, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.fillStyle = "#dcfce7";
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const drawBalls = (ctx: CanvasRenderingContext2D, balls: Ball[]) => {
  balls.forEach((ball) => {
    if (!ball.alive) return;

    const gradient = ctx.createRadialGradient(
      ball.x - ball.radius * 0.3,
      ball.y - ball.radius * 0.3,
      1,
      ball.x,
      ball.y,
      ball.radius * 1.3,
    );
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.28, ball.color);
    gradient.addColorStop(1, "rgba(15, 23, 42, 0.64)");

    ctx.save();
    ctx.shadowColor = ball.color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
};

const VortexEscape = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<Arena | null>(null);
  const ringsRef = useRef<Ring[]>([]);
  const ballsRef = useRef<Ball[]>([]);
  const totalBallsRef = useRef(0);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const startTimeRef = useRef(0);
  const lastHudUpdateRef = useRef(0);
  const lastBounceSoundRef = useRef(0);
  const finishedRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [hud, setHud] = useState<HudStats>({
    escaped: 0,
    remaining: 0,
    total: 0,
    finished: false,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const countBalls = () => {
      const balls = ballsRef.current;
      return {
        escaped: balls.filter((ball) => ball.escaped).length,
        remaining: balls.filter((ball) => ball.alive).length,
      };
    };

    const updateHud = () => {
      const counts = countBalls();
      setHud({
        ...counts,
        total: totalBallsRef.current,
        finished: finishedRef.current,
      });
    };

    const markFinished = () => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      updateHud();
    };

    const reset = () => {
      const arena = resizeCanvas(canvas);
      const rings = createRings(arena);
      const total = randomBallCount();

      arenaRef.current = arena;
      ringsRef.current = rings;
      totalBallsRef.current = total;
      ballsRef.current = spawnBalls(arena, rings, total);
      lastTimeRef.current = performance.now();
      startTimeRef.current = lastTimeRef.current;
      finishedRef.current = false;
      updateHud();
    };

    const playBounce = (now: number) => {
      if (now - lastBounceSoundRef.current < 55) return;
      lastBounceSoundRef.current = now;
      playTone(audioRef.current, randomBetween(170, 280), 0.052, 0.04, "sine");
    };

    const stepPhysics = (dt: number, now: number, elapsedSeconds: number) => {
      const arena = arenaRef.current;
      if (!arena || finishedRef.current) return;

      const balls = ballsRef.current;
      const rings = ringsRef.current;
      const center = getCenter(arena);
      const exitRadius = getCenterExitRadius(arena);
      const left = arena.x;
      const right = arena.x + arena.width;
      const top = arena.y;
      const bottom = arena.y + arena.height;

      balls.forEach((ball) => {
        if (!ball.alive) return;

        const previousX = ball.x;
        const previousY = ball.y;
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;

        const centerDistance = Math.hypot(ball.x - center.x, ball.y - center.y);
        if (centerDistance < exitRadius + ball.radius * 0.25) {
          ball.alive = false;
          ball.escaped = true;
          playTone(audioRef.current, 760, 0.16, 0.06, "triangle");
          return;
        }

        let bounced = false;
        if (ball.x - ball.radius < left) {
          ball.x = left + ball.radius;
          ball.vx = Math.abs(ball.vx);
          bounced = true;
        } else if (ball.x + ball.radius > right) {
          ball.x = right - ball.radius;
          ball.vx = -Math.abs(ball.vx);
          bounced = true;
        }

        if (ball.y - ball.radius < top) {
          ball.y = top + ball.radius;
          ball.vy = Math.abs(ball.vy);
          bounced = true;
        } else if (ball.y + ball.radius > bottom) {
          ball.y = bottom - ball.radius;
          ball.vy = -Math.abs(ball.vy);
          bounced = true;
        }

        for (const ring of rings) {
          if (
            resolveRingCollision(
              ball,
              arena,
              ring,
              elapsedSeconds,
              previousX,
              previousY,
            )
          ) {
            bounced = true;
          }
        }

        const speed = Math.hypot(ball.vx, ball.vy);
        const maxSpeed = arena.height * 0.54;
        const minSpeed = arena.height * 0.14;
        if (speed > maxSpeed) {
          ball.vx = (ball.vx / speed) * maxSpeed;
          ball.vy = (ball.vy / speed) * maxSpeed;
        } else if (speed < minSpeed) {
          const angle = randomBetween(0, Math.PI * 2);
          ball.vx += Math.cos(angle) * minSpeed * 0.22;
          ball.vy += Math.sin(angle) * minSpeed * 0.22;
        }

        if (bounced) playBounce(now);
      });

      resolveBallCollisions(balls);
      balls.forEach((ball) => {
        if (!ball.alive) return;

        for (const ring of rings) {
          resolveRingCollision(
            ball,
            arena,
            ring,
            elapsedSeconds,
            ball.x,
            ball.y,
          );
        }
      });

      if (balls.every((ball) => !ball.alive)) {
        markFinished();
      }
    };

    const draw = (elapsedSeconds: number) => {
      const arena = arenaRef.current;
      if (!arena) return;

      drawBackground(ctx, arena);
      drawArena(ctx, arena);
      drawRings(ctx, arena, ringsRef.current, elapsedSeconds);
      drawCenterExit(ctx, arena);
      drawBalls(ctx, ballsRef.current);
    };

    const frame = (now: number) => {
      const dt = Math.min((now - lastTimeRef.current) / 1000, MAX_DT);
      const elapsedSeconds = (now - startTimeRef.current) / 1000;
      const substepDt = dt / PHYSICS_SUBSTEPS;

      lastTimeRef.current = now;
      for (let i = 0; i < PHYSICS_SUBSTEPS; i++) {
        stepPhysics(substepDt, now, elapsedSeconds + substepDt * i);
      }
      draw(elapsedSeconds);

      if (now - lastHudUpdateRef.current > 120) {
        updateHud();
        lastHudUpdateRef.current = now;
      }

      animationRef.current = requestAnimationFrame(frame);
    };

    const handleResize = () => {
      const previousArena = arenaRef.current;
      const existingBalls = ballsRef.current;
      const arena = resizeCanvas(canvas);

      arenaRef.current = arena;
      ringsRef.current = createRings(arena);

      if (!previousArena) return;

      const scaleX = arena.width / previousArena.width;
      const scaleY = arena.height / previousArena.height;
      const scale = Math.min(scaleX, scaleY);
      existingBalls.forEach((ball) => {
        ball.x = arena.x + (ball.x - previousArena.x) * scaleX;
        ball.y = arena.y + (ball.y - previousArena.y) * scaleY;
        ball.vx *= scale;
        ball.vy *= scale;
        ball.radius = clamp(ball.radius * scale, 4, 7);
      });
    };

    const unlockAudio = () => {
      if (!audioRef.current) {
        audioRef.current = createAudio();
      }
      if (audioRef.current?.state === "suspended") {
        void audioRef.current.resume();
      }
      if (audioRef.current) {
        setSoundEnabled(true);
        playTone(audioRef.current, 520, 0.12, 0.055, "triangle");
      }
    };

    const handlePointerDown = () => {
      unlockAudio();
    };

    reset();
    animationRef.current = requestAnimationFrame(frame);
    window.addEventListener("resize", handleResize);
    window.addEventListener("pointerdown", handlePointerDown, { passive: true });

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("pointerdown", handlePointerDown);
      void audioRef.current?.close();
    };
  }, []);

  return (
    <div className="vortex-root">
      <canvas ref={canvasRef} aria-label="Vortex Escape simulation" />

      <section className="vortex-title" aria-label="Simulation title">
        <h1>Vortex Escape</h1>
        <p>HOW MANY BALLS CAN REACH THE CENTER EXIT?</p>
      </section>

      <section className="vortex-hud" aria-label="Simulation score">
        <div>
          <span>ESCAPED</span>
          <strong>{hud.escaped}</strong>
        </div>
        <div>
          <span>REMAINING</span>
          <strong>{hud.remaining}</strong>
        </div>
        <div>
          <span>BALLS</span>
          <strong>{hud.total}</strong>
        </div>
      </section>

      <button
        type="button"
        className="sound-button"
        onClick={() => {
          if (!audioRef.current) {
            audioRef.current = createAudio();
          }
          if (audioRef.current?.state === "suspended") {
            void audioRef.current.resume();
          }
          if (audioRef.current) {
            setSoundEnabled(true);
            playTone(audioRef.current, 520, 0.12, 0.055, "triangle");
          }
        }}
      >
        {soundEnabled ? "SOUND ON" : "ENABLE SOUND"}
      </button>

      {hud.finished ? (
        <div className="result-overlay" role="status" aria-live="polite">
          <div className="result-panel">
            <span>RESULT</span>
            <strong>{hud.escaped} BALLS ESCAPED</strong>
          </div>
        </div>
      ) : null}

      <style jsx>{`
        .vortex-root {
          position: relative;
          width: 100vw;
          height: 100dvh;
          overflow: hidden;
          background: #020617;
          color: #f8fafc;
          touch-action: none;
        }

        canvas {
          width: 100vw;
          height: 100dvh;
          min-height: 100dvh;
        }

        .vortex-title {
          position: fixed;
          top: calc(14px + env(safe-area-inset-top, 0px));
          left: 50%;
          z-index: 3;
          width: min(600px, calc(100vw - 96px));
          transform: translateX(-50%);
          text-align: center;
          pointer-events: none;
        }

        .vortex-title h1 {
          margin: 0;
          color: #f8fafc;
          font-size: clamp(1.35rem, 4vw, 2.25rem);
          font-weight: 900;
          line-height: 1;
          letter-spacing: 0;
          text-shadow:
            0 0 18px rgba(34, 211, 238, 0.36),
            0 6px 20px rgba(2, 6, 23, 0.92);
        }

        .vortex-title p {
          margin: 7px 0 0;
          color: #86efac;
          font-size: clamp(0.58rem, 1.55vw, 0.78rem);
          font-weight: 800;
          letter-spacing: 0.1em;
          text-shadow: 0 0 12px rgba(34, 197, 94, 0.36);
        }

        .vortex-hud {
          position: fixed;
          right: 14px;
          top: calc(14px + env(safe-area-inset-top, 0px));
          z-index: 4;
          display: grid;
          grid-template-columns: repeat(3, minmax(72px, 1fr));
          gap: 8px;
          width: min(300px, calc(100vw - 28px));
        }

        .vortex-hud div,
        .result-panel {
          border: 1px solid rgba(148, 163, 184, 0.22);
          border-radius: 8px;
          background: rgba(2, 6, 23, 0.7);
          box-shadow:
            0 14px 32px rgba(2, 6, 23, 0.34),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(10px);
        }

        .vortex-hud div {
          display: grid;
          min-height: 46px;
          place-items: center;
          padding: 7px 6px 6px;
        }

        .vortex-hud span,
        .result-panel span {
          color: rgba(203, 213, 225, 0.74);
          font-size: 0.56rem;
          font-weight: 800;
          letter-spacing: 0.1em;
        }

        .vortex-hud strong {
          color: #f8fafc;
          font-size: 1.05rem;
          line-height: 1;
        }

        .sound-button {
          position: fixed;
          left: 14px;
          bottom: calc(14px + env(safe-area-inset-bottom, 0px));
          z-index: 5;
          min-height: 40px;
          padding: 0 14px;
          border: 1px solid rgba(134, 239, 172, 0.45);
          border-radius: 8px;
          background: rgba(2, 6, 23, 0.74);
          color: #bbf7d0;
          cursor: pointer;
          font-size: 0.68rem;
          font-weight: 900;
          letter-spacing: 0.08em;
          box-shadow:
            0 12px 28px rgba(2, 6, 23, 0.36),
            0 0 18px rgba(34, 197, 94, 0.14);
          backdrop-filter: blur(10px);
        }

        .result-overlay {
          position: fixed;
          inset: 0;
          z-index: 6;
          display: grid;
          place-items: center;
          padding: 20px;
          background: rgba(2, 6, 23, 0.38);
          pointer-events: none;
        }

        .result-panel {
          display: grid;
          gap: 10px;
          width: min(380px, 88vw);
          padding: 24px;
          text-align: center;
          box-shadow:
            0 0 34px rgba(34, 197, 94, 0.18),
            0 24px 58px rgba(2, 6, 23, 0.55);
        }

        .result-panel strong {
          color: #bbf7d0;
          font-size: clamp(1.35rem, 6vw, 2.15rem);
          line-height: 1;
          letter-spacing: 0;
          text-shadow: 0 0 16px rgba(34, 197, 94, 0.36);
        }

        @media (max-width: 720px) {
          .vortex-title {
            top: calc(16px + env(safe-area-inset-top, 0px));
            width: min(320px, calc(100vw - 104px));
          }

          .vortex-hud {
            right: 8px;
            left: 8px;
            top: auto;
            bottom: calc(8px + env(safe-area-inset-bottom, 0px));
            width: auto;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 5px;
          }

          .vortex-hud div {
            min-height: 42px;
            padding: 6px 3px 5px;
          }

          .vortex-hud span {
            font-size: 0.48rem;
            letter-spacing: 0.06em;
          }

          .vortex-hud strong {
            font-size: 0.94rem;
          }

          .sound-button {
            left: 8px;
            bottom: calc(60px + env(safe-area-inset-bottom, 0px));
            min-height: 36px;
            padding: 0 11px;
            font-size: 0.6rem;
          }
        }
      `}</style>
    </div>
  );
};

export default VortexEscape;
