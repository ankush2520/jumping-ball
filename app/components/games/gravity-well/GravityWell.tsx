"use client";

import React, { useEffect, useRef, useState } from "react";
import { BALL_COUNT, BASE_GRAVITY, BASE_HOLE_RADIUS, COLLAPSE_PAUSE, CRITICAL_MAX_DURATION, CRITICAL_MIN_DURATION, CRITICAL_SLOW_MAX, CRITICAL_SLOW_MIN, CRITICAL_TRIGGER_RATIO, CRITICAL_ZOOM, DESKTOP_AWAKENING_PHASE, DESKTOP_CALM_PHASE, DESKTOP_DPR_CAP, EXPLOSION_PARTICLE_COUNT, EXPLOSION_TIME, FRAME_INTERVAL_MS, HUD_UPDATE_INTERVAL, MAX_BALLS, MAX_EXPLOSION_PARTICLES, MAX_SHOCKWAVES, MAX_SPEED, MAX_TRAIL_PARTICLES, MOBILE_AWAKENING_PHASE, MOBILE_CALM_PHASE, MOBILE_DPR_CAP, MOBILE_EXPLOSION_PARTICLE_COUNT, SHAKE_DURATION, SUPERNOVA_COLLAPSE_STAGE, performanceMode } from "./constants";
import type { Arena, BlackHole, CycleState, ExplosionParticle, GravityBall, HudStats, PhysicsScale, ShockwaveRing, TrailParticle } from "./types";
import { createBlankExplosionParticle, createBlankShockwave, createBlankTrailParticle } from "./effects/pools";
import { createPlacedBlackHole, getAbsorbedCount, getHungerStage, mergeBlackHolePair, pickDominantBlackHole as pickDominantBlackHoleFromPair, randomBetween, stepBinaryBlackHolePair } from "./physics/blackHole";
import { createBlankBall, resetExplosionBall, resetOrbitBall } from "./physics/balls";
import { clampSpeed, enforceMinimumSpeed, resolveBallCollision, resolveWallCollision } from "./physics/collision";
import { drawBackground, drawBall, drawBlackHole, drawCriticalOverlay, drawExplosion, drawSpawnRings, drawTrails } from "./render";
import { SoundManager } from "./sound/SoundManager";

const resizeCanvas = (canvas: HTMLCanvasElement): Arena => {
  const isMobile = window.innerWidth < 600;
  const dpr = Math.min(
    window.devicePixelRatio || 1,
    isMobile ? MOBILE_DPR_CAP : DESKTOP_DPR_CAP,
  );
  const width = window.innerWidth;
  const height = window.innerHeight;
  const ctx = canvas.getContext("2d");

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    try {
      // prefer high quality smoothing when available
      const smoothingContext = ctx as CanvasRenderingContext2D & {
        imageSmoothingQuality?: ImageSmoothingQuality;
      };
      if (smoothingContext.imageSmoothingQuality !== undefined)
        smoothingContext.imageSmoothingQuality = "high";
    } catch {
      // ignore
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }

  return { width, height, dpr };
};

const getPhysicsScale = (arena: Arena): PhysicsScale => {
  const isMobile = arena.width < 600;

  return {
    mobileScale: isMobile ? 0.55 : 1,
    speedScale: isMobile ? 0.55 : 1,
    gravityScale: isMobile ? 0.55 : 1,
    growthScale: isMobile ? 0.62 : 1,
    visualScale: isMobile ? 0.45 : 1,
    blackHoleVisualScale: isMobile ? 0.7 : 1,
    explosionScale: isMobile ? 0.6 : 1,
    calmDuration: isMobile ? MOBILE_CALM_PHASE : DESKTOP_CALM_PHASE,
    awakeningDuration: isMobile
      ? MOBILE_AWAKENING_PHASE
      : DESKTOP_AWAKENING_PHASE,
    minCycleTime: isMobile ? 10 : 6,
  };
};

const GravityWell = () => {
  const [hudStats, setHudStats] = useState<HudStats>({
    mass: 1,
    stability: 100,
    charge: 0,
    stage: "Dormant",
  });
  const [showSoundPrompt, setShowSoundPrompt] = useState(true);
  const [waitingForPlacement, setWaitingForPlacement] = useState(true);
  const gravityWellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const soundRef = useRef<SoundManager | null>(null);
  const ballsRef = useRef<GravityBall[]>(
    Array.from({ length: MAX_BALLS }, createBlankBall),
  );
  const explosionParticlesRef = useRef<ExplosionParticle[]>(
    Array.from(
      { length: MAX_EXPLOSION_PARTICLES },
      createBlankExplosionParticle,
    ),
  );
  const trailParticlesRef = useRef<TrailParticle[]>(
    Array.from({ length: MAX_TRAIL_PARTICLES }, createBlankTrailParticle),
  );
  const shockwavesRef = useRef<ShockwaveRing[]>(
    Array.from({ length: MAX_SHOCKWAVES }, createBlankShockwave),
  );
  const blackHoleRef = useRef<BlackHole | null>(null);
  const secondBlackHoleRef = useRef<BlackHole | null>(null);
  const audioStartingRef = useRef<boolean>(false);
  const arenaRef = useRef<Arena>({ width: 0, height: 0, dpr: 1 });
  const cycleRef = useRef<CycleState>({
    phase: "calm",
    phaseStartedAt: 0,
    shockwaveAt: -Infinity,
  });
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const lastHudUpdateRef = useRef<number>(0);
  const pausedRef = useRef<boolean>(false);
  const trailCursorRef = useRef<number>(0);

  if (soundRef.current === null) {
    soundRef.current = new SoundManager();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const spawnOrbitBalls = () => {
      const balls = ballsRef.current;
      const scale = getPhysicsScale(arenaRef.current);
      for (let i = 0; i < balls.length; i++) {
        if (i < BALL_COUNT) {
          resetOrbitBall(balls[i], arenaRef.current, i, scale.speedScale);
        } else {
          balls[i].active = false;
        }
      }
    };

    const emitExplosionParticles = () => {
      const arena = arenaRef.current;
      const blackHole = blackHoleRef.current;
      const particles = explosionParticlesRef.current;
      const originX = blackHole?.x ?? arena.width / 2;
      const originY = blackHole?.y ?? arena.height / 2;
      const particleCount =
        arena.width < 600
          ? MOBILE_EXPLOSION_PARTICLE_COUNT
          : EXPLOSION_PARTICLE_COUNT;

      for (let i = 0; i < particles.length; i++) {
        const particle = particles[i];
        if (i >= particleCount) {
          particle.active = false;
          continue;
        }

        const angle =
          (i / particleCount) * Math.PI * 2 + randomBetween(-0.14, 0.14);
        const speed = randomBetween(760, 1320);
        const life = randomBetween(0.58, 0.88);
        particle.active = true;
        particle.x = originX;
        particle.y = originY;
        particle.vx = Math.cos(angle) * speed;
        particle.vy = Math.sin(angle) * speed;
        particle.life = life;
        particle.maxLife = life;
        particle.radius = randomBetween(1.1, 2.1);
        particle.color =
          i % 3 === 0
            ? "rgba(255, 255, 255, ALPHA)"
            : i % 3 === 1
              ? "rgba(125, 249, 255, ALPHA)"
              : "rgba(167, 139, 250, ALPHA)";
      }
    };

    const emitShockwaves = () => {
      const shockwaves = shockwavesRef.current;
      const blackHole = blackHoleRef.current;
      const maxDimension = Math.max(
        arenaRef.current.width,
        arenaRef.current.height,
      );
      const ringCount = 2;
      for (let i = 0; i < shockwaves.length; i++) {
        const ring = shockwaves[i];
        if (i >= ringCount) {
          ring.active = false;
          continue;
        }

        ring.active = true;
        ring.x = blackHole?.x ?? arenaRef.current.width / 2;
        ring.y = blackHole?.y ?? arenaRef.current.height / 2;
        ring.age = -i * 0.08;
        ring.duration = 1.02 + i * 0.12;
        ring.maxRadius = maxDimension * (1.18 + i * 0.24);
        ring.width = 16 - i * 4;
        ring.alpha = i === 0 ? 0.92 : 0.58;
      }
    };

    const emitSingleRipple = (
      x: number,
      y: number,
      radius: number,
      alpha: number,
      width: number,
      duration = 0.72,
    ) => {
      const ring = shockwavesRef.current[0];
      ring.active = true;
      ring.x = x;
      ring.y = y;
      ring.age = 0;
      ring.duration = duration;
      ring.maxRadius = radius;
      ring.width = width;
      ring.alpha = alpha;
    };

    const respawnFromExplosion = (time: number) => {
      const balls = ballsRef.current;
      const scale = getPhysicsScale(arenaRef.current);
      const originX = blackHoleRef.current?.x ?? arenaRef.current.width / 2;
      const originY = blackHoleRef.current?.y ?? arenaRef.current.height / 2;
      for (let i = 0; i < balls.length; i++) {
        if (i < BALL_COUNT) {
          resetExplosionBall(
            balls[i],
            arenaRef.current,
            i,
            scale.speedScale,
            scale.explosionScale,
            originX,
            originY,
          );
        } else {
          balls[i].active = false;
        }
      }
      emitExplosionParticles();
      emitShockwaves();
      soundRef.current?.playSupernova();
      cycleRef.current = {
        phase: "explosion",
        phaseStartedAt: time,
        shockwaveAt: time,
      };
    };

    const resetArena = () => {
      arenaRef.current = resizeCanvas(canvas);
      for (let i = 0; i < explosionParticlesRef.current.length; i++) {
        explosionParticlesRef.current[i].active = false;
      }
      for (let i = 0; i < trailParticlesRef.current.length; i++) {
        trailParticlesRef.current[i].active = false;
      }
      for (let i = 0; i < shockwavesRef.current.length; i++) {
        shockwavesRef.current[i].active = false;
      }
      spawnOrbitBalls();
      blackHoleRef.current = null;
      secondBlackHoleRef.current = null;
      setWaitingForPlacement(true);
      setHudStats({
        mass: 0,
        stability: 100,
        charge: 0,
        stage: "Dormant",
      });
      cycleRef.current = {
        phase: "calm",
        phaseStartedAt: performance.now() / 1000,
        shockwaveAt: -Infinity,
      };
    };

    const placeBlackHole = (clientX: number, clientY: number) => {
      if (blackHoleRef.current?.active && secondBlackHoleRef.current?.active)
        return;

      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const blackHole = createPlacedBlackHole(arenaRef.current, x, y);

      if (!blackHoleRef.current?.active) {
        blackHoleRef.current = blackHole;
        cycleRef.current = {
          phase: "awakening",
          phaseStartedAt: performance.now() / 1000,
          shockwaveAt: -Infinity,
        };
        setWaitingForPlacement(false);
      } else {
        const first = blackHoleRef.current;
        const dx = blackHole.x - first.x;
        const dy = blackHole.y - first.y;
        const dist = Math.hypot(dx, dy) || 1;
        const tx = -dy / dist;
        const ty = dx / dist;
        const orbitalKick = arenaRef.current.width < 600 ? 38 : 58;
        first.vx -= tx * orbitalKick;
        first.vy -= ty * orbitalKick;
        blackHole.vx += tx * orbitalKick;
        blackHole.vy += ty * orbitalKick;
        secondBlackHoleRef.current = blackHole;
      }

      emitSingleRipple(
        blackHole.x,
        blackHole.y,
        Math.min(arenaRef.current.width, arenaRef.current.height) * 0.18,
        0.42,
        5,
      );
      soundRef.current?.playSpawn();
    };

    const handlePlacePointer = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      placeBlackHole(event.clientX, event.clientY);
    };

    const handlePlaceTouch = (event: TouchEvent) => {
      const touch = event.touches[0] ?? event.changedTouches[0];
      if (!touch) return;
      placeBlackHole(touch.clientX, touch.clientY);
    };

    const absorbBall = (blackHole: BlackHole, ball: GravityBall) => {
      const scale = getPhysicsScale(arenaRef.current);
      ball.active = false;
      blackHole.mass += 1;
      blackHole.targetRadius +=
        Math.max(2.2, ball.radius * 0.24) * scale.growthScale;
      blackHole.strength += (19000 + ball.mass * 14) * scale.growthScale;
      soundRef.current?.playAbsorb(
        Math.min(1, (blackHole.mass - 1) / BALL_COUNT),
      );
    };

    const pickDominantBlackHole = (ball: GravityBall) =>
      pickDominantBlackHoleFromPair(
        blackHoleRef.current,
        secondBlackHoleRef.current,
        ball,
      );

    const mergeBlackHoles = (first: BlackHole, second: BlackHole) => {
      const { x, y } = mergeBlackHolePair(first, second);
      secondBlackHoleRef.current = null;

      emitSingleRipple(
        x,
        y,
        Math.max(arenaRef.current.width, arenaRef.current.height) * 0.72,
        0.72,
        12,
        0.94,
      );
      soundRef.current?.playMerge();
    };

    const stepBinaryBlackHoles = (dt: number) => {
      const first = blackHoleRef.current;
      const second = secondBlackHoleRef.current;
      if (!first?.active || !second?.active) return;

      if (stepBinaryBlackHolePair(first, second, arenaRef.current, dt)) {
        mergeBlackHoles(first, second);
      }
    };

    const emitTrail = (ball: GravityBall) => {
      if (performanceMode && Math.random() < 0.45) return;

      const visualScale = getPhysicsScale(arenaRef.current).visualScale;
      const trails = trailParticlesRef.current;
      const trail = trails[trailCursorRef.current];
      trailCursorRef.current = (trailCursorRef.current + 1) % trails.length;

      trail.active = true;
      trail.x = ball.x;
      trail.y = ball.y;
      trail.life =
        (performanceMode ? 0.22 : 0.34) * (visualScale < 1 ? 0.58 : 1);
      trail.maxLife = trail.life;
      trail.radius = Math.max(1.1, ball.radius * 0.3);
      trail.color = ball.glow.replace(/[\d.]+\)$/, "ALPHA)");
    };

    const emitEscapeStreak = (ball: GravityBall, intensity: number) => {
      const visualScale = getPhysicsScale(arenaRef.current).visualScale;
      const trails = trailParticlesRef.current;
      const trail = trails[trailCursorRef.current];
      trailCursorRef.current = (trailCursorRef.current + 1) % trails.length;

      trail.active = true;
      trail.x = ball.x - ball.vx * 0.018;
      trail.y = ball.y - ball.vy * 0.018;
      trail.life = 0.26 * (visualScale < 1 ? 0.6 : 1);
      trail.maxLife = trail.life;
      trail.radius = Math.max(2, ball.radius * (0.48 + intensity * 0.24));
      trail.color = "rgba(220, 252, 255, ALPHA)";
    };

    const stepFreeBalls = (dt: number) => {
      const arena = arenaRef.current;
      const balls = ballsRef.current;

      for (let i = 0; i < balls.length; i++) {
        const ball = balls[i];
        if (!ball.active) continue;

        ball.vx *= 0.998;
        ball.vy *= 0.998;
        clampSpeed(ball);
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
        resolveWallCollision(ball, arena);
        emitTrail(ball);
      }

      for (let i = 0; i < balls.length; i++) {
        if (!balls[i].active) continue;
        for (let j = i + 1; j < balls.length; j++) {
          if (!balls[j].active) continue;
          const impact = resolveBallCollision(balls[i], balls[j]);
          if (impact > 0) soundRef.current?.playCollision(impact);
        }
      }
    };

    const stepPhysics = (dt: number, time: number) => {
      const arena = arenaRef.current;
      const blackHole = blackHoleRef.current;
      const cycle = cycleRef.current;
      if (!blackHole?.active) {
        stepFreeBalls(dt);
        return;
      }
      const scale = getPhysicsScale(arena);
      const phaseAge = time - cycle.phaseStartedAt;
      const isCritical = cycle.phase === "critical";
      const criticalProgress = isCritical
        ? Math.min(1, phaseAge / (cycle.phaseDuration ?? CRITICAL_MAX_DURATION))
        : 0;
      const awakeningProgress =
        cycle.phase === "awakening"
          ? Math.min(1, phaseAge / scale.awakeningDuration)
          : cycle.phase === "active" ||
              cycle.phase === "collapse" ||
              cycle.phase === "critical"
            ? 1
            : 0;
      const gravityMultiplier =
        cycle.phase === "calm"
          ? 0.05
          : cycle.phase === "awakening"
            ? 0.05 + awakeningProgress * 0.4
            : 1;
      const criticalGravity = isCritical
        ? gravityMultiplier * 1.24
        : gravityMultiplier;
      const absorptionEnabled =
        cycle.phase === "active" ||
        cycle.phase === "critical" ||
        (cycle.phase === "awakening" && awakeningProgress >= 0.7);
      const physicsDt = isCritical
        ? dt *
          (CRITICAL_SLOW_MIN +
            criticalProgress * (CRITICAL_SLOW_MAX - CRITICAL_SLOW_MIN))
        : dt;
      const rotationDt = dt * (isCritical ? 1.9 : 1);

      blackHole.rotationAngle =
        (blackHole.rotationAngle + blackHole.rotationSpeed * rotationDt) %
        (Math.PI * 2);
      blackHole.radius += (blackHole.targetRadius - blackHole.radius) * 0.055;
      const secondBlackHole = secondBlackHoleRef.current;
      if (secondBlackHole?.active) {
        secondBlackHole.rotationAngle =
          (secondBlackHole.rotationAngle +
            secondBlackHole.rotationSpeed * rotationDt) %
          (Math.PI * 2);
        secondBlackHole.radius +=
          (secondBlackHole.targetRadius - secondBlackHole.radius) * 0.055;
        if (cycle.phase === "active") {
          secondBlackHole.targetRadius = Math.max(
            secondBlackHole.targetRadius,
            BASE_HOLE_RADIUS * 0.72,
          );
          secondBlackHole.strength = Math.max(
            secondBlackHole.strength,
            BASE_GRAVITY * scale.gravityScale * 0.72,
          );
        }
      }

      if (cycle.phase === "critical") {
        blackHole.targetRadius = Math.max(
          blackHole.targetRadius,
          BASE_HOLE_RADIUS * 1.18,
        );
        blackHole.strength = Math.max(
          blackHole.strength,
          BASE_GRAVITY * 1.12 * scale.gravityScale,
        );
        if (phaseAge >= (cycle.phaseDuration ?? CRITICAL_MAX_DURATION)) {
          cycleRef.current = {
            phase: "collapse",
            phaseStartedAt: time,
            shockwaveAt: cycle.shockwaveAt,
          };
        }
      } else if (cycle.phase === "collapse") {
        const collapseAge = time - cycle.phaseStartedAt;
        const contractionProgress = Math.min(
          1,
          collapseAge / SUPERNOVA_COLLAPSE_STAGE,
        );
        blackHole.rotationAngle =
          (blackHole.rotationAngle + blackHole.rotationSpeed * dt * 5.2) %
          (Math.PI * 2);
        blackHole.targetRadius = Math.max(
          BASE_HOLE_RADIUS * 0.55,
          blackHole.targetRadius * (1 - 0.09 * (1 - contractionProgress)),
        );
        blackHole.radius += (blackHole.targetRadius - blackHole.radius) * 0.18;
        if (collapseAge > SUPERNOVA_COLLAPSE_STAGE) {
          respawnFromExplosion(time);
          return;
        }
      } else if (cycle.phase === "explosion") {
        if (time - cycle.phaseStartedAt > EXPLOSION_TIME) {
          blackHoleRef.current = null;
          secondBlackHoleRef.current = null;
          setWaitingForPlacement(true);
          setHudStats({
            mass: 0,
            stability: 100,
            charge: 0,
            stage: "Dormant",
          });
          cycleRef.current = {
            phase: "calm",
            phaseStartedAt: time,
            shockwaveAt: cycle.shockwaveAt,
          };
          return;
        }
      } else if (cycle.phase === "calm") {
        blackHole.strength = BASE_GRAVITY * 0.05;
        if (phaseAge > scale.calmDuration) {
          cycleRef.current = {
            phase: "awakening",
            phaseStartedAt: time,
            shockwaveAt: cycle.shockwaveAt,
          };
        }
      } else if (cycle.phase === "awakening") {
        const pulse = Math.sin(time * 4.2) * 0.5 + 0.5;
        blackHole.targetRadius =
          BASE_HOLE_RADIUS * (0.45 + awakeningProgress * 0.55) +
          pulse * awakeningProgress * 0.6;
        blackHole.strength =
          BASE_GRAVITY * (0.05 + awakeningProgress * 0.4) * scale.gravityScale;
        if (awakeningProgress >= 1) {
          blackHole.targetRadius = BASE_HOLE_RADIUS;
          blackHole.strength = BASE_GRAVITY * scale.gravityScale;
          cycleRef.current = {
            phase: "active",
            phaseStartedAt: time,
            shockwaveAt: cycle.shockwaveAt,
          };
        }
      } else {
        const earlyCycleDamping =
          phaseAge < scale.minCycleTime
            ? 0.55 + 0.45 * (phaseAge / scale.minCycleTime)
            : 1;
        blackHole.strength +=
          dt *
          (2500 + blackHole.mass * 260) *
          scale.gravityScale *
          earlyCycleDamping;
      }

      let activeCount = 0;
      const balls = ballsRef.current;
      stepBinaryBlackHoles(physicsDt);
      for (let i = 0; i < balls.length; i++) {
        const ball = balls[i];
        if (!ball.active) continue;
        const dominantBlackHole = pickDominantBlackHole(ball);
        if (!dominantBlackHole) continue;

        const dx = dominantBlackHole.x - ball.x;
        const dy = dominantBlackHole.y - ball.y;
        const actualDistance = Math.hypot(dx, dy) || 1;
        const nx = dx / actualDistance;
        const ny = dy / actualDistance;
        const influenceRadius =
          dominantBlackHole.radius * 8.5 * scale.gravityScale * criticalGravity;
        const stableOrbitRadius = dominantBlackHole.radius * 4.2;
        const plungeRadius = dominantBlackHole.radius * 1.95;
        const absorbRadius = dominantBlackHole.radius + ball.radius * 0.35;

        if (absorptionEnabled && actualDistance < absorbRadius) {
          absorbBall(dominantBlackHole, ball);
          continue;
        }

        if (actualDistance < influenceRadius) {
          const cycleAge = time - cycle.phaseStartedAt;
          const earlyCycleDamping =
            cycle.phase === "active" && cycleAge < scale.minCycleTime
              ? 0.55 + 0.45 * (cycleAge / scale.minCycleTime)
              : 1;
          const tx = -ny;
          const ty = nx;
          const mobileForceScale = arena.width < 600 ? 0.72 : 1;
          const radiusScale = dominantBlackHole.radius / BASE_HOLE_RADIUS;
          const orbitForce =
            (52 + dominantBlackHole.mass * 3.1) *
            radiusScale *
            criticalGravity *
            mobileForceScale *
            earlyCycleDamping;
          const gravityForce =
            dominantBlackHole.strength *
            radiusScale *
            scale.gravityScale *
            criticalGravity *
            mobileForceScale *
            earlyCycleDamping *
            0.0038;
          let radialForce = 0;
          let tangentialForce = 0;
          let orbitalDamping = 0.996;

          if (actualDistance > stableOrbitRadius) {
            const zoneT =
              1 -
              (actualDistance - stableOrbitRadius) /
                Math.max(1, influenceRadius - stableOrbitRadius);
            tangentialForce = orbitForce * (0.58 + zoneT * 0.26);
            radialForce = gravityForce * (0.08 + zoneT * 0.18);
            orbitalDamping = 0.9975;
          } else if (actualDistance > plungeRadius) {
            const zoneT =
              1 -
              (actualDistance - plungeRadius) /
                Math.max(1, stableOrbitRadius - plungeRadius);
            tangentialForce = orbitForce * (0.86 - zoneT * 0.16);
            radialForce = gravityForce * (0.24 + zoneT * 0.22);
            orbitalDamping = 0.9955;
          } else {
            const zoneT =
              1 -
              (actualDistance - absorbRadius) /
                Math.max(1, plungeRadius - absorbRadius);
            const plungeT = Math.min(1, Math.max(0, zoneT));
            tangentialForce = orbitForce * (0.42 - plungeT * 0.24);
            radialForce = gravityForce * (0.88 + plungeT * 1.45);
            orbitalDamping = 0.994;
          }

          ball.vx += (tx * tangentialForce + nx * radialForce) * physicsDt;
          ball.vy += (ty * tangentialForce + ny * radialForce) * physicsDt;

          const inwardVelocity = ball.vx * nx + ball.vy * ny;
          if (inwardVelocity < 0) {
            const outwardReduction = -inwardVelocity * 0.72;
            ball.vx += nx * outwardReduction;
            ball.vy += ny * outwardReduction;
          }

          ball.vx *= orbitalDamping;
          ball.vy *= orbitalDamping;

          const radialVelocity = ball.vx * nx + ball.vy * ny;
          if (
            radialVelocity < -80 &&
            actualDistance < absorbRadius * 2.9 &&
            actualDistance > absorbRadius * 1.12
          ) {
            emitEscapeStreak(
              ball,
              Math.min(1, Math.abs(radialVelocity) / Math.max(1, MAX_SPEED)),
            );
          }
        }

        const damping = cycle.phase === "calm" ? 0.996 : 0.999;
        ball.vx *= damping;
        ball.vy *= damping;
        clampSpeed(ball);

        ball.x += ball.vx * physicsDt;
        ball.y += ball.vy * physicsDt;
        resolveWallCollision(ball, arena);

        if (absorptionEnabled) {
          const postMoveDistance = Math.hypot(
            ball.x - dominantBlackHole.x,
            ball.y - dominantBlackHole.y,
          );
          if (postMoveDistance < absorbRadius) {
            absorbBall(dominantBlackHole, ball);
            continue;
          }
        }

        const postMoveDistance = Math.hypot(
          ball.x - dominantBlackHole.x,
          ball.y - dominantBlackHole.y,
        );
        if (postMoveDistance >= influenceRadius) {
          enforceMinimumSpeed(ball, dominantBlackHole, dt, scale.speedScale);
        } else {
          ball.slowTime = 0;
        }
        clampSpeed(ball);

        if (
          absorptionEnabled &&
          Math.hypot(
            ball.x - dominantBlackHole.x,
            ball.y - dominantBlackHole.y,
          ) < absorbRadius
        ) {
          absorbBall(dominantBlackHole, ball);
          continue;
        }

        emitTrail(ball);
        activeCount += 1;
      }

      for (let i = 0; i < balls.length; i++) {
        if (!balls[i].active) continue;
        for (let j = i + 1; j < balls.length; j++) {
          if (!balls[j].active) continue;
          const impact = resolveBallCollision(balls[i], balls[j]);
          if (impact > 0) soundRef.current?.playCollision(impact);
        }
      }

      for (let i = 0; i < balls.length; i++) {
        const ball = balls[i];
        if (!ball.active) continue;
        const dominantBlackHole = pickDominantBlackHole(ball);
        if (!dominantBlackHole) continue;
        const distanceFromBlackHole = Math.hypot(
          ball.x - dominantBlackHole.x,
          ball.y - dominantBlackHole.y,
        );
        const influenceRadius =
          dominantBlackHole.radius * 8.5 * scale.gravityScale * criticalGravity;
        if (distanceFromBlackHole >= influenceRadius) {
          enforceMinimumSpeed(ball, dominantBlackHole, dt, scale.speedScale);
        } else {
          ball.slowTime = 0;
        }
        clampSpeed(ball);
      }

      const absorbedCount = getAbsorbedCount(blackHole, secondBlackHole);
      if (
        cycle.phase === "active" &&
        activeCount > 0 &&
        absorbedCount >= BALL_COUNT * CRITICAL_TRIGGER_RATIO
      ) {
        cycleRef.current = {
          phase: "critical",
          phaseStartedAt: time,
          shockwaveAt: cycle.shockwaveAt,
          phaseDuration: randomBetween(
            CRITICAL_MIN_DURATION,
            CRITICAL_MAX_DURATION,
          ),
        };
      } else if (cycle.phase === "active" && activeCount === 0) {
        cycleRef.current = {
          phase: "collapse",
          phaseStartedAt: time,
          shockwaveAt: cycle.shockwaveAt,
        };
      }
      if (cycle.phase === "critical") {
        soundRef.current?.playCriticalPulse();
      }
    };

    const updateHud = (time: number) => {
      const blackHole = blackHoleRef.current;
      const secondBlackHole = secondBlackHoleRef.current;
      const cycle = cycleRef.current;
      if (!blackHole || time - lastHudUpdateRef.current < HUD_UPDATE_INTERVAL) {
        return;
      }

      lastHudUpdateRef.current = time;
      const absorbedCount = getAbsorbedCount(blackHole, secondBlackHole);
      const stability =
        cycle.phase === "collapse"
          ? Math.max(
              0,
              Math.round(
                100 * (1 - (time - cycle.phaseStartedAt) / COLLAPSE_PAUSE),
              ),
            )
          : Math.max(0, Math.round(100 - (absorbedCount / BALL_COUNT) * 86));
      const charge =
        cycle.phase === "collapse"
          ? Math.min(
              100,
              Math.round(
                ((time - cycle.phaseStartedAt) / COLLAPSE_PAUSE) * 100,
              ),
            )
          : Math.min(100, Math.round((absorbedCount / BALL_COUNT) * 100));
      const stage =
        cycle.phase === "critical"
          ? "Critical Mass"
          : getHungerStage(absorbedCount);

      setHudStats({
        mass: absorbedCount,
        stability,
        charge,
        stage,
      });
    };

    const animate = (timeMs: number) => {
      if (pausedRef.current) return;
      if (
        lastFrameRef.current > 0 &&
        timeMs - lastFrameRef.current < FRAME_INTERVAL_MS
      ) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }
      lastFrameRef.current = timeMs;

      const arena = arenaRef.current;
      const blackHole = blackHoleRef.current;
      const secondBlackHole = secondBlackHoleRef.current;
      const cycle = cycleRef.current;
      const renderScale = getPhysicsScale(arena);

      const time = timeMs / 1000;
      const previous = lastTimeRef.current || timeMs;
      const dt = Math.min((timeMs - previous) / 1000, 0.032);
      lastTimeRef.current = timeMs;

      const collapseAge =
        cycle.phase === "collapse" ? time - cycle.phaseStartedAt : 0;
      const explosionAge = time - cycle.shockwaveAt;
      const isMobile = arena.width < 600;
      const criticalProgress =
        cycle.phase === "critical"
          ? Math.min(
              1,
              Math.max(
                0,
                (time - cycle.phaseStartedAt) /
                  (cycle.phaseDuration ?? CRITICAL_MAX_DURATION),
              ),
            )
          : 0;
      const shake =
        Math.max(0, 1 - collapseAge / COLLAPSE_PAUSE) *
          (cycle.phase === "collapse" ? (isMobile ? 2.5 : 4.5) : 0) +
        Math.max(0, 1 - explosionAge / SHAKE_DURATION) * (isMobile ? 4 : 8) +
        criticalProgress * (isMobile ? 1.3 : 2.2);
      const shakeX = shake ? randomBetween(-shake, shake) : 0;
      const shakeY = shake ? randomBetween(-shake, shake) : 0;
      const zoom = 1 + criticalProgress * (CRITICAL_ZOOM - 1);
      const centerX = arena.width * 0.5 * arena.dpr;
      const centerY = arena.height * 0.5 * arena.dpr;
      const dx = centerX * (1 - zoom) + shakeX * arena.dpr;
      const dy = centerY * (1 - zoom) + shakeY * arena.dpr;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(dx, dy);
      ctx.scale(arena.dpr * zoom, arena.dpr * zoom);
      ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = "rgba(3, 7, 18, 0.18)";
      ctx.fillRect(-shakeX, -shakeY, arena.width + 24, arena.height + 24);
      drawBackground(ctx, arena, time, blackHole, 0.24);
      drawCriticalOverlay(ctx, arena, time, cycle);

      stepPhysics(dt, time);
      updateHud(time);
      if (blackHole?.active) {
        const totalMass =
          blackHole.mass +
          (secondBlackHole?.active ? secondBlackHole.mass - 1 : 0);
        soundRef.current?.updateHum(
          Math.min(1, (totalMass - 1) / BALL_COUNT),
          cycle.phase === "critical",
        );
      }
      drawTrails(ctx, trailParticlesRef.current, dt, renderScale.visualScale);
      for (let i = 0; i < ballsRef.current.length; i++) {
        const ball = ballsRef.current[i];
        if (ball.active) {
          drawBall(
            ctx,
            ball,
            renderScale.visualScale,
            pickDominantBlackHole(ball),
          );
        }
      }
      if (cycle.shockwaveAt <= 0) {
        drawSpawnRings(ctx, shockwavesRef.current, dt, renderScale.visualScale);
      }
      if (blackHole?.active) {
        drawBlackHole(
          ctx,
          blackHole,
          time,
          cycleRef.current,
          renderScale.blackHoleVisualScale,
        );
        if (secondBlackHole?.active) {
          drawBlackHole(
            ctx,
            secondBlackHole,
            time,
            cycleRef.current,
            renderScale.blackHoleVisualScale,
          );
        }
        drawExplosion(
          ctx,
          arena,
          cycleRef.current,
          blackHole,
          explosionParticlesRef.current,
          shockwavesRef.current,
          time,
          dt,
          renderScale.visualScale,
        );
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    const unlockAudioFromGesture = () => {
      if (audioStartingRef.current || soundRef.current?.isRunning()) return;
      audioStartingRef.current = true;
      void soundRef.current
        ?.initAudio()
        .then((state) => {
          if (state === "running") {
            setShowSoundPrompt(false);
            removeUnlockListeners();
          }
        })
        .finally(() => {
          audioStartingRef.current = false;
        });
    };

    const removeUnlockListeners = () => {
      const root = gravityWellRef.current;
      root?.removeEventListener("pointerdown", unlockAudioFromGesture, true);
      root?.removeEventListener("touchstart", unlockAudioFromGesture, true);
      root?.removeEventListener("click", unlockAudioFromGesture, true);
      window.removeEventListener("pointerdown", unlockAudioFromGesture, true);
      window.removeEventListener("touchstart", unlockAudioFromGesture, true);
      window.removeEventListener("click", unlockAudioFromGesture, true);
      window.removeEventListener("keydown", unlockAudioFromGesture, true);
    };

    resetArena();
    void soundRef.current?.initAudio().then((state) => {
      if (state === "running") {
        setShowSoundPrompt(false);
        removeUnlockListeners();
      }
    });
    const handleVisibilityChange = () => {
      if (document.hidden) {
        pausedRef.current = true;
        soundRef.current?.stopHum();
        soundRef.current?.stopMusic();
        if (animationRef.current !== null) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = null;
        }
        return;
      }

      pausedRef.current = false;
      soundRef.current?.startHum();
      soundRef.current?.startMusic();
      lastTimeRef.current = 0;
      lastFrameRef.current = 0;
      animationRef.current = requestAnimationFrame(animate);
    };

    const root = gravityWellRef.current;
    console.log("Waiting for first user gesture to unlock audio");
    root?.addEventListener("pointerdown", unlockAudioFromGesture, true);
    root?.addEventListener("touchstart", unlockAudioFromGesture, {
      capture: true,
      passive: true,
    });
    root?.addEventListener("click", unlockAudioFromGesture, true);
    window.addEventListener("pointerdown", unlockAudioFromGesture, true);
    window.addEventListener("touchstart", unlockAudioFromGesture, {
      capture: true,
      passive: true,
    });
    window.addEventListener("click", unlockAudioFromGesture, true);
    window.addEventListener("keydown", unlockAudioFromGesture, true);
    if (window.PointerEvent) {
      root?.addEventListener("pointerdown", handlePlacePointer);
    } else {
      root?.addEventListener("touchstart", handlePlaceTouch, { passive: true });
    }
    window.addEventListener("resize", resetArena);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      removeUnlockListeners();
      root?.removeEventListener("pointerdown", handlePlacePointer);
      root?.removeEventListener("touchstart", handlePlaceTouch);
      window.removeEventListener("resize", resetArena);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      soundRef.current?.dispose();
    };
  }, []);

  const roundedMobileCharge = Math.min(
    100,
    Math.max(0, Math.round(hudStats.charge / 5) * 5),
  );
  const mobileStatus =
    hudStats.charge >= 100
      ? "SUPERNOVA READY"
      : hudStats.stability <= 18
        ? "COLLAPSE IMMINENT"
        : hudStats.stage.includes("Critical") || hudStats.charge >= 76
          ? "CRITICAL MASS"
          : hudStats.charge >= 60
            ? `SUPERNOVA ${roundedMobileCharge}%`
            : "";
  return (
    <div ref={gravityWellRef} className="gravity-well">
      <canvas ref={canvasRef} className="gravity-canvas" />
      {showSoundPrompt ? (
        <div className="sound-prompt" aria-hidden="true">
          Tap to enable sound
        </div>
      ) : null}
      <div
        className={`placement-prompt ${waitingForPlacement ? "is-visible" : ""}`}
        aria-hidden={!waitingForPlacement}
      >
        Click anywhere to place black hole
      </div>
      {!waitingForPlacement ? (
        <div className="gravity-stats" aria-label="Black hole status">
          <div>
            <span>Mass</span>
            <strong>{hudStats.mass.toString().padStart(2, "0")}</strong>
          </div>
          <div>
            <span>Stability</span>
            <strong>{hudStats.stability}%</strong>
          </div>
          <div>
            <span>Supernova</span>
            <strong>{hudStats.charge}%</strong>
          </div>
          <p>{hudStats.stage}</p>
        </div>
      ) : null}
      {mobileStatus && !waitingForPlacement ? (
        <div
          key={mobileStatus}
          className="mobile-gravity-status"
          aria-label="Black hole alert"
        >
          {mobileStatus}
        </div>
      ) : null}
      <style jsx>{`
        .gravity-well {
          position: fixed;
          inset: 0;
          min-height: 100vh;
          overflow: hidden;
          background: #030712;
          touch-action: manipulation;
          user-select: none;
        }

        .gravity-canvas {
          display: block;
          width: 100vw;
          height: 100vh;
          min-height: 0;
          transform: none;
          -webkit-transform: none;
        }

        .gravity-stats {
          position: fixed;
          left: 16px;
          bottom: 42px;
          z-index: 5;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          min-width: min(380px, calc(100vw - 32px));
          padding: 9px 11px;
          border: 1px solid rgba(125, 249, 255, 0.11);
          border-radius: 12px;
          background: rgba(3, 7, 18, 0.34);
          color: rgba(226, 246, 255, 0.66);
          font-family: var(--font-geist-mono), monospace;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          backdrop-filter: blur(6px);
        }

        .gravity-stats div {
          display: grid;
          gap: 4px;
        }

        .gravity-stats span {
          font-size: 0.55rem;
        }

        .gravity-stats strong {
          color: #e0faff;
          font-size: 0.8rem;
        }

        .gravity-stats p {
          grid-column: 1 / -1;
          margin: 0;
          color: #67e8f9;
          font-size: 0.58rem;
        }

        .placement-prompt {
          position: fixed;
          top: 50%;
          left: 50%;
          z-index: 6;
          transform: translate(-50%, -50%);
          color: rgba(224, 250, 255, 0.82);
          font-family: var(--font-geist-mono), monospace;
          font-size: clamp(0.78rem, 1.8vw, 1.05rem);
          font-weight: 400;
          letter-spacing: 0.16em;
          text-align: center;
          text-shadow:
            0 0 12px rgba(103, 232, 249, 0.42),
            0 0 28px rgba(96, 165, 250, 0.2);
          text-transform: uppercase;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.55s ease;
          animation: placementPulse 2.8s ease-in-out infinite;
        }

        .placement-prompt.is-visible {
          opacity: 1;
        }

        .mobile-gravity-status {
          display: none;
        }

        .sound-prompt {
          display: none;
        }

        @media (max-width: 640px) {
          .gravity-stats {
            display: none;
          }

          .sound-prompt {
            position: fixed;
            left: 50%;
            bottom: 18px;
            z-index: 6;
            display: block;
            transform: translateX(-50%);
            color: rgba(224, 250, 255, 0.72);
            font-family: var(--font-geist-mono), monospace;
            font-size: 0.64rem;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            pointer-events: none;
            text-shadow: 0 0 12px rgba(103, 232, 249, 0.28);
          }

          .mobile-gravity-status {
            position: fixed;
            top: 56px;
            right: 14px;
            z-index: 5;
            display: block;
            max-width: min(220px, calc(100vw - 28px));
            color: rgba(224, 250, 255, 0.82);
            font-family: var(--font-geist-mono), monospace;
            font-size: 0.66rem;
            font-weight: 600;
            letter-spacing: 0.12em;
            line-height: 1.35;
            text-align: right;
            text-shadow:
              0 0 10px rgba(103, 232, 249, 0.38),
              0 0 18px rgba(167, 139, 250, 0.22);
            text-transform: uppercase;
            pointer-events: none;
            animation: mobileStatusFade 2.4s ease-out forwards;
          }
        }

        @keyframes mobileStatusFade {
          0% {
            opacity: 0;
            transform: translateY(-4px);
          }
          16%,
          62% {
            opacity: 1;
            transform: translateY(0);
          }
          100% {
            opacity: 0;
            transform: translateY(-2px);
          }
        }

        @keyframes placementPulse {
          0%,
          100% {
            filter: brightness(0.92);
            transform: translate(-50%, -50%) scale(1);
          }
          50% {
            filter: brightness(1.16);
            transform: translate(-50%, -50%) scale(1.018);
          }
        }
      `}</style>
    </div>
  );
};

export default GravityWell;
