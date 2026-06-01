import { BALL_COUNT, CRITICAL_MAX_DURATION, performanceMode, SUPERNOVA_BLOOM_FADE_STAGE, SUPERNOVA_COLLAPSE_STAGE, SUPERNOVA_IGNITION_STAGE } from "../constants";
import type { Arena, BlackHole, CycleState, ExplosionParticle, GravityBall, ShockwaveRing, TrailParticle } from "../types";

export const drawBackground = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  time: number,
  blackHole: BlackHole | null,
  alpha = 1,
) => {
  const { width, height } = arena;
  const massGlow = blackHole
    ? Math.min(1, (blackHole.mass - 1) / BALL_COUNT)
    : 0;
  const darkening = 0.06 + massGlow * 0.24;

  ctx.save();
  ctx.globalAlpha = alpha;
  if (performanceMode) {
    const darkness = Math.max(4, Math.round(8 - massGlow * 5));
    ctx.fillStyle = `rgb(3, ${darkness}, ${Math.round(18 - massGlow * 8)})`;
  } else {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#030712");
    gradient.addColorStop(0.5, "#06091d");
    gradient.addColorStop(1, "#020b12");
    ctx.fillStyle = gradient;
  }
  ctx.fillRect(0, 0, width, height);

  if (!performanceMode) {
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "rgba(125, 249, 255, 0.06)";
    ctx.lineWidth = 1;
    const grid = 82;
    const offset = (time * (7 + massGlow * 12)) % grid;
    for (let x = -grid + offset; x < width + grid; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = -grid + offset; y < height + grid; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = alpha;
  if (blackHole) {
    const glow = ctx.createRadialGradient(
      blackHole.x,
      blackHole.y,
      blackHole.radius,
      blackHole.x,
      blackHole.y,
      Math.min(width, height) * (0.34 + massGlow * 0.1),
    );
    glow.addColorStop(0, `rgba(125, 249, 255, ${0.09 + massGlow * 0.1})`);
    glow.addColorStop(0.28, `rgba(96, 165, 250, ${0.045 + massGlow * 0.06})`);
    glow.addColorStop(0.62, `rgba(168, 85, 247, ${0.02 + massGlow * 0.035})`);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.fillStyle = `rgba(0, 0, 0, ${darkening * alpha})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
};

export const drawCriticalOverlay = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  time: number,
  cycle: CycleState,
) => {
  if (cycle.phase !== "critical") return;
  const phaseAge = time - cycle.phaseStartedAt;
  const duration = cycle.phaseDuration ?? CRITICAL_MAX_DURATION;
  const progress = Math.min(1, Math.max(0, phaseAge / duration));
  const pulse = Math.sin(time * 5.8) * 0.5 + 0.5;
  const alpha = 0.06 + (progress * 0.04 + pulse * 0.02);
  const hueChoice = (Math.sin(time * 3.4) + 1) * 0.5;
  const color =
    hueChoice > 0.5 ? "rgba(255, 100, 190, " : "rgba(90, 240, 255, ";

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = `${color}${alpha})`;
  ctx.fillRect(0, 0, arena.width, arena.height);
  ctx.restore();
};

export const drawBlackHole = (
  ctx: CanvasRenderingContext2D,
  blackHole: BlackHole,
  time: number,
  cycle: CycleState,
  visualScale: number,
) => {
  const massRatio = Math.min(1, (blackHole.mass - 1) / BALL_COUNT);
  const pulse = Math.sin(time * (2.1 + massRatio)) * 0.5 + 0.5;
  const explosionAge = time - cycle.shockwaveAt;
  const explosionPulse =
    explosionAge >= 0 ? Math.max(0, 1 - explosionAge / 0.5) : 0;
  const awakeningPulse = cycle.phase === "awakening" ? pulse * 0.18 : 0;
  const criticalPulse =
    cycle.phase === "critical" ? Math.sin(time * 8.8) * 0.5 + 0.5 : 0;
  const coreRadius = blackHole.radius * visualScale;
  const ringRadius = coreRadius * (1.82 + pulse * 0.06 + criticalPulse * 0.09);
  const glowScale =
    0.72 + visualScale * 0.28 + awakeningPulse + criticalPulse * 0.12;
  const collapseBoost =
    (cycle.phase === "collapse" ? 1.35 : 1) + explosionPulse * 1.25;

  ctx.save();
  ctx.translate(blackHole.x, blackHole.y);
  ctx.globalCompositeOperation = "lighter";

  const haloScale = visualScale < 1 ? 0.78 : 1;
  const halo = ctx.createRadialGradient(
    0,
    0,
    coreRadius,
    0,
    0,
    coreRadius * (5.1 + explosionPulse * 2.8) * glowScale * haloScale,
  );
  halo.addColorStop(
    0,
    `rgba(255, 255, 255, ${0.1 + massRatio * 0.06 + explosionPulse * 0.14})`,
  );
  halo.addColorStop(
    0.1,
    `rgba(125, 249, 255, ${0.14 + massRatio * 0.12 + explosionPulse * 0.18})`,
  );
  halo.addColorStop(
    0.36,
    `rgba(96, 165, 250, ${0.05 + massRatio * 0.08 + explosionPulse * 0.1})`,
  );
  halo.addColorStop(
    0.66,
    `rgba(168, 85, 247, ${0.025 + massRatio * 0.045 + explosionPulse * 0.07})`,
  );
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(
    -coreRadius * 6,
    -coreRadius * 6,
    coreRadius * 12,
    coreRadius * 12,
  );

  ctx.save();
  ctx.rotate(blackHole.rotationAngle);
  const accretion = ctx.createRadialGradient(
    0,
    0,
    coreRadius,
    0,
    0,
    ringRadius * 1.38,
  );
  accretion.addColorStop(0, "rgba(0, 0, 0, 0)");
  accretion.addColorStop(
    0.36,
    `rgba(255, 255, 255, ${0.2 * collapseBoost * glowScale})`,
  );
  accretion.addColorStop(
    0.45,
    `rgba(125, 249, 255, ${0.25 * collapseBoost * glowScale})`,
  );
  accretion.addColorStop(
    0.54,
    `rgba(167, 139, 250, ${0.13 * collapseBoost * glowScale})`,
  );
  accretion.addColorStop(0.72, "rgba(0, 0, 0, 0)");
  ctx.scale(1.45, 0.38);
  ctx.fillStyle = accretion;
  ctx.beginPath();
  ctx.arc(0, 0, ringRadius * 1.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const distortion = ctx.createRadialGradient(
    0,
    0,
    coreRadius * 0.95,
    0,
    0,
    coreRadius * 3.35,
  );
  distortion.addColorStop(0, "rgba(0, 0, 0, 0)");
  distortion.addColorStop(
    0.48,
    `rgba(255, 255, 255, ${0.065 + massRatio * 0.06})`,
  );
  distortion.addColorStop(
    0.54,
    `rgba(125, 249, 255, ${0.028 + massRatio * 0.04})`,
  );
  distortion.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = distortion;
  ctx.beginPath();
  ctx.arc(0, 0, coreRadius * 3.35, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 28; i++) {
    const lane = i % 5;
    const angle = -blackHole.rotationAngle * (2.4 + lane * 0.28) + i * 0.84;
    const radius =
      coreRadius * (1.5 + lane * 0.32) + Math.sin(time * 2 + i) * 4;
    const size = (0.85 + lane * 0.18) * visualScale;
    const alpha = (0.18 + massRatio * 0.16 + (4 - lane) * 0.022) * glowScale;
    ctx.fillStyle =
      i % 2 === 0
        ? `rgba(125, 249, 255, ${alpha})`
        : `rgba(167, 139, 250, ${alpha * 0.8})`;
    ctx.beginPath();
    ctx.arc(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      size,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.globalCompositeOperation = "source-over";
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, coreRadius * 1.45);
  core.addColorStop(0, "rgba(0, 0, 0, 1)");
  core.addColorStop(0.68, "rgba(0, 0, 0, 1)");
  core.addColorStop(0.78, `rgba(6, 182, 212, ${0.3 + massRatio * 0.2})`);
  core.addColorStop(0.86, "rgba(0, 0, 0, 0.92)");
  core.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, coreRadius * 1.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

export const drawExplosion = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  cycle: CycleState,
  blackHole: BlackHole,
  particles: ExplosionParticle[],
  shockwaves: ShockwaveRing[],
  time: number,
  dt: number,
  visualScale: number,
) => {
  if (cycle.phase === "collapse") {
    const collapseAge = time - cycle.phaseStartedAt;
    const tension = Math.min(1, collapseAge / SUPERNOVA_COLLAPSE_STAGE);
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${0.28 + tension * 0.34})`;
    ctx.fillRect(0, 0, arena.width, arena.height);
    ctx.restore();
  }

  if (cycle.shockwaveAt <= 0) return;
  const age = time - cycle.shockwaveAt;
  if (age < 0) return;
  const massRatio = Math.min(1, (blackHole.mass - 1) / BALL_COUNT);
  const isRedMood = massRatio > 0.88;
  const originX = shockwaves[0]?.x ?? blackHole.x;
  const originY = shockwaves[0]?.y ?? blackHole.y;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (let i = 0; i < shockwaves.length; i++) {
    const ring = shockwaves[i];
    if (!ring.active) continue;

    ring.age += dt;
    if (ring.age < 0) continue;
    if (ring.age >= ring.duration) {
      ring.active = false;
      continue;
    }

    const progress = ring.age / ring.duration;
    const alpha = (1 - progress) * ring.alpha;
    if (alpha > 0) {
      ctx.strokeStyle = `rgba(125, 249, 255, ${alpha})`;
      ctx.lineWidth = 1 + ring.width * visualScale * (1 - progress);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.maxRadius * progress, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  if (age < SUPERNOVA_IGNITION_STAGE) {
    const alpha = isRedMood ? 0.92 : 0.88;
    ctx.fillStyle = isRedMood
      ? `rgba(255, 60, 90, ${alpha})`
      : `rgba(90, 240, 255, ${alpha})`;
    ctx.fillRect(0, 0, arena.width, arena.height);
    ctx.fillStyle = isRedMood
      ? `rgba(255, 90, 180, ${alpha * 0.45})`
      : `rgba(160, 230, 255, ${alpha * 0.45})`;
    ctx.fillRect(0, 0, arena.width, arena.height);
  } else if (age < SUPERNOVA_IGNITION_STAGE + SUPERNOVA_BLOOM_FADE_STAGE) {
    const bloomAge = age - SUPERNOVA_IGNITION_STAGE;
    const fade = 1 - bloomAge / SUPERNOVA_BLOOM_FADE_STAGE;
    const alpha = Math.max(0, fade) * 0.9;
    ctx.fillStyle = isRedMood
      ? `rgba(255, 60, 90, ${alpha * 0.62})`
      : `rgba(90, 240, 255, ${alpha * 0.62})`;
    ctx.fillRect(0, 0, arena.width, arena.height);

    const radialGlow = ctx.createRadialGradient(
      originX,
      originY,
      0,
      originX,
      originY,
      Math.max(arena.width, arena.height) * (0.42 + bloomAge * 0.24),
    );
    radialGlow.addColorStop(
      0,
      isRedMood
        ? `rgba(255, 160, 220, ${alpha})`
        : `rgba(210, 255, 255, ${alpha})`,
    );
    radialGlow.addColorStop(
      0.34,
      isRedMood
        ? `rgba(255, 60, 90, ${alpha * 0.52})`
        : `rgba(90, 240, 255, ${alpha * 0.5})`,
    );
    radialGlow.addColorStop(
      1,
      isRedMood ? "rgba(255, 60, 90, 0)" : "rgba(90, 240, 255, 0)",
    );
    ctx.fillStyle = radialGlow;
    ctx.fillRect(0, 0, arena.width, arena.height);
  }

  for (let i = 0; i < particles.length; i++) {
    const particle = particles[i];
    if (!particle.active) continue;

    particle.life -= dt;
    if (particle.life <= 0) {
      particle.active = false;
      continue;
    }

    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= 0.992;
    particle.vy *= 0.992;

    const alpha = particle.life / particle.maxLife;
    const tailX = particle.x - particle.vx * 0.018;
    const tailY = particle.y - particle.vy * 0.018;
    ctx.strokeStyle = particle.color.replace("ALPHA", `${0.62 * alpha}`);
    ctx.lineWidth = Math.max(0.8, particle.radius * visualScale);
    ctx.beginPath();
    ctx.moveTo(tailX - particle.vx * 0.01, tailY - particle.vy * 0.01);
    ctx.lineTo(particle.x, particle.y);
    ctx.stroke();

    ctx.fillStyle = particle.color.replace("ALPHA", `${0.52 * alpha}`);
    ctx.beginPath();
    ctx.arc(
      particle.x,
      particle.y,
      particle.radius * visualScale,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.restore();
};

export const drawSpawnRings = (
  ctx: CanvasRenderingContext2D,
  rings: ShockwaveRing[],
  dt: number,
  visualScale: number,
) => {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    if (!ring.active) continue;

    ring.age += dt;
    if (ring.age < 0 || ring.duration <= 0 || ring.maxRadius <= 0) continue;
    if (ring.age >= ring.duration) {
      ring.active = false;
      continue;
    }

    const progress = ring.age / ring.duration;
    const alpha = (1 - progress) * ring.alpha;
    const radius = Math.max(0, ring.maxRadius * progress);
    if (radius <= 0 || alpha <= 0) continue;
    ctx.strokeStyle = `rgba(125, 249, 255, ${alpha})`;
    ctx.lineWidth = Math.max(0.8, ring.width * visualScale * (1 - progress));
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
};

export const drawBall = (
  ctx: CanvasRenderingContext2D,
  ball: GravityBall,
  visualScale: number,
) => {
  const radius = ball.radius * visualScale;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = ball.color;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.32)";
  ctx.lineWidth = Math.max(0.7, 1.15 * visualScale);
  ctx.stroke();
  ctx.restore();
};

export const drawTrails = (
  ctx: CanvasRenderingContext2D,
  trails: TrailParticle[],
  dt: number,
  visualScale: number,
) => {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (let i = 0; i < trails.length; i++) {
    const trail = trails[i];
    if (!trail.active) continue;

    trail.life -= dt;
    if (trail.life <= 0) {
      trail.active = false;
      continue;
    }

    const alpha = trail.life / trail.maxLife;
    ctx.fillStyle = trail.color.replace(
      "ALPHA",
      `${0.095 * alpha * (0.78 + visualScale * 0.22)}`,
    );
    ctx.beginPath();
    ctx.arc(
      trail.x,
      trail.y,
      trail.radius * visualScale * (0.48 + alpha * 0.58),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.restore();
};
