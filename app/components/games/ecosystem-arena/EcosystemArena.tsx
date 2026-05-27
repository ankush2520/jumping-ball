"use client";

import React, { useEffect, useRef, useState } from "react";

type Species = "predator" | "prey" | "void";

type Entity = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  energy: number;
  species: Species;
  alive: boolean;
  age: number;
  angle: number;
};

type Arena = {
  width: number;
  height: number;
  dpr: number;
};

type SafeZone = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  active: boolean;
};

type PopulationCounts = Record<Species, number> & {
  safeZone: number;
};

type SetupConfig = {
  prey: number;
  predator: number;
  void: number;
  safeZone: number;
};

const MAX_ENTITIES = 180;
const MAX_SAFE_ZONES = 6;
const MAX_SPEED = 95;
const WALL_RESTITUTION = 0.92;
const COUNTER_UPDATE_INTERVAL = 0.22;
const SIMULATION_SPEED = 2;

const defaultSetup: SetupConfig = {
  prey: 30,
  predator: 5,
  void: 2,
  safeZone: 3,
};

const setupLimits: Record<
  keyof SetupConfig,
  { label: string; min: number; max: number }
> = {
  prey: { label: "Prey", min: 5, max: 80 },
  predator: { label: "Predators", min: 0, max: 20 },
  void: { label: "Voids", min: 0, max: 8 },
  safeZone: { label: "Safe Zones", min: 0, max: 6 },
};

const presets: Array<{ label: string; config: SetupConfig }> = [
  { label: "Balanced", config: defaultSetup },
  {
    label: "Predator Chaos",
    config: { prey: 32, predator: 14, void: 1, safeZone: 2 },
  },
  {
    label: "Prey Explosion",
    config: { prey: 70, predator: 3, void: 1, safeZone: 5 },
  },
  {
    label: "Void Apocalypse",
    config: { prey: 40, predator: 5, void: 6, safeZone: 1 },
  },
];

const speciesColors: Record<Species, string> = {
  predator: "#ef4444",
  prey: "#3b82f6",
  void: "#050505",
};

const createBlankEntity = (id: number): Entity => ({
  id,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  radius: 6,
  energy: 0,
  species: "prey",
  alive: false,
  age: 0,
  angle: 0,
});

const createBlankSafeZone = (id: number): SafeZone => ({
  id,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  radius: 0,
  active: false,
});

const clampSpeed = (entity: Entity, maxSpeed = MAX_SPEED) => {
  const speed = Math.hypot(entity.vx, entity.vy);
  if (speed <= maxSpeed) return;
  const scale = maxSpeed / speed;
  entity.vx *= scale;
  entity.vy *= scale;
};

const bounceWalls = (entity: Entity, arena: Arena) => {
  if (entity.x - entity.radius < 0) {
    entity.x = entity.radius;
    entity.vx = Math.abs(entity.vx) * WALL_RESTITUTION;
  } else if (entity.x + entity.radius > arena.width) {
    entity.x = arena.width - entity.radius;
    entity.vx = -Math.abs(entity.vx) * WALL_RESTITUTION;
  }

  if (entity.y - entity.radius < 0) {
    entity.y = entity.radius;
    entity.vy = Math.abs(entity.vy) * WALL_RESTITUTION;
  } else if (entity.y + entity.radius > arena.height) {
    entity.y = arena.height - entity.radius;
    entity.vy = -Math.abs(entity.vy) * WALL_RESTITUTION;
  }
};

const EcosystemArena = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const entitiesRef = useRef<Entity[]>(
    Array.from({ length: MAX_ENTITIES }, (_, id) => createBlankEntity(id)),
  );
  const safeZonesRef = useRef<SafeZone[]>(
    Array.from({ length: MAX_SAFE_ZONES }, (_, id) => createBlankSafeZone(id)),
  );
  const arenaRef = useRef<Arena>({ width: 0, height: 0, dpr: 1 });
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const lastCounterUpdateRef = useRef(0);
  const seedRef = useRef(0x9e3779b9);
  const runningRef = useRef(false);
  const setupConfigRef = useRef<SetupConfig>(defaultSetup);
  const startSimulationRef = useRef<(() => void) | null>(null);
  const renderArenaRef = useRef<(() => void) | null>(null);
  const [setupOpen, setSetupOpen] = useState(true);
  const [setupConfig, setSetupConfig] = useState<SetupConfig>(defaultSetup);
  const [counts, setCounts] = useState<PopulationCounts>({
    predator: 0,
    prey: 0,
    void: 0,
    safeZone: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const random = () => {
      seedRef.current = (seedRef.current * 1664525 + 1013904223) >>> 0;
      return seedRef.current / 0xffffffff;
    };

    const randomBetween = (min: number, max: number) =>
      min + random() * (max - min);

    const getSpawnRadius = (species: Species) => {
      const isMobile = arenaRef.current.width < 640;
      if (species === "prey") {
        return randomBetween(isMobile ? 4 : 5, isMobile ? 5 : 6);
      }
      if (species === "predator") {
        return randomBetween(isMobile ? 7 : 9, isMobile ? 9 : 11);
      }
      return randomBetween(isMobile ? 6 : 7, isMobile ? 8 : 9);
    };

    const getPreyBaseRadius = () => (arenaRef.current.width < 640 ? 4.5 : 5.5);

    const spawnSafeZone = (index: number) => {
      const zone = safeZonesRef.current[index];
      const radius = getPreyBaseRadius() * 6;
      const angle = randomBetween(0, Math.PI * 2);
      const speed = randomBetween(8, 15);
      zone.active = true;
      zone.radius = radius;
      zone.x = randomBetween(radius + 12, arenaRef.current.width - radius - 12);
      zone.y = randomBetween(radius + 12, arenaRef.current.height - radius - 12);
      zone.vx = Math.cos(angle) * speed;
      zone.vy = Math.sin(angle) * speed;
    };

    const spawnEntity = (
      species: Species,
      x = randomBetween(28, Math.max(29, arenaRef.current.width - 28)),
      y = randomBetween(28, Math.max(29, arenaRef.current.height - 28)),
    ) => {
      const entities = entitiesRef.current;
      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        if (entity.alive) continue;

        const angle = randomBetween(0, Math.PI * 2);
        const speed =
          species === "void"
            ? randomBetween(8, 18)
            : species === "predator"
              ? randomBetween(20, 36)
              : randomBetween(18, 44);

        entity.x = x;
        entity.y = y;
        entity.vx = Math.cos(angle) * speed;
        entity.vy = Math.sin(angle) * speed;
        entity.radius = getSpawnRadius(species);
        entity.energy =
          species === "void" ? 120 : species === "predator" ? 90 : 62;
        entity.species = species;
        entity.alive = true;
        entity.age = 0;
        entity.angle = angle;
        return entity;
      }

      return null;
    };

    const countSpecies = () => {
      const nextCounts: PopulationCounts = {
        predator: 0,
        prey: 0,
        void: 0,
        safeZone: 0,
      };
      const entities = entitiesRef.current;
      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        if (!entity.alive) continue;
        nextCounts[entity.species] += 1;
      }
      const safeZones = safeZonesRef.current;
      for (let i = 0; i < safeZones.length; i++) {
        if (safeZones[i].active) nextCounts.safeZone += 1;
      }
      return nextCounts;
    };

    const resizeCanvas = () => {
      const isMobile = window.innerWidth < 640;
      const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
      const width = window.innerWidth;
      const height = window.innerHeight;

      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      arenaRef.current = { width, height, dpr };
    };

    const resetArena = () => {
      seedRef.current = 0x9e3779b9;
      resizeCanvas();
      const entities = entitiesRef.current;
      for (let i = 0; i < entities.length; i++) {
        entities[i].alive = false;
      }
      const safeZones = safeZonesRef.current;
      for (let i = 0; i < safeZones.length; i++) {
        safeZones[i].active = false;
      }

      const config = setupConfigRef.current;
      for (let i = 0; i < config.prey; i++) spawnEntity("prey");
      for (let i = 0; i < config.predator; i++) spawnEntity("predator");
      for (let i = 0; i < config.void; i++) spawnEntity("void");
      for (let i = 0; i < config.safeZone; i++) spawnSafeZone(i);
      setCounts(countSpecies());
    };

    const isInsideSafeZone = (entity: Entity) => {
      const safeZones = safeZonesRef.current;
      for (let i = 0; i < safeZones.length; i++) {
        const zone = safeZones[i];
        if (!zone.active) continue;
        const dx = entity.x - zone.x;
        const dy = entity.y - zone.y;
        if (dx * dx + dy * dy < zone.radius * zone.radius) return true;
      }
      return false;
    };

    const nearestSafeZone = (entity: Entity) => {
      let nearest: SafeZone | null = null;
      let nearestDistanceSq = Infinity;
      const safeZones = safeZonesRef.current;
      for (let i = 0; i < safeZones.length; i++) {
        const zone = safeZones[i];
        if (!zone.active) continue;
        const dx = zone.x - entity.x;
        const dy = zone.y - entity.y;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq < nearestDistanceSq) {
          nearestDistanceSq = distanceSq;
          nearest = zone;
        }
      }
      return nearest;
    };

    const nearestPredator = (entity: Entity, maxDistance: number) => {
      let nearest: Entity | null = null;
      let nearestDistanceSq = maxDistance * maxDistance;
      const entities = entitiesRef.current;
      for (let i = 0; i < entities.length; i++) {
        const predator = entities[i];
        if (!predator.alive || predator.species !== "predator") continue;
        const dx = predator.x - entity.x;
        const dy = predator.y - entity.y;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq < nearestDistanceSq) {
          nearestDistanceSq = distanceSq;
          nearest = predator;
        }
      }
      return nearest;
    };

    const nearestPrey = (predator: Entity) => {
      let nearest: Entity | null = null;
      let nearestDistanceSq = Infinity;
      const entities = entitiesRef.current;
      for (let i = 0; i < entities.length; i++) {
        const prey = entities[i];
        if (!prey.alive || prey.species !== "prey") continue;
        if (isInsideSafeZone(prey)) continue;
        const dx = prey.x - predator.x;
        const dy = prey.y - predator.y;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq < nearestDistanceSq) {
          nearestDistanceSq = distanceSq;
          nearest = prey;
        }
      }
      return nearest;
    };

    const wander = (entity: Entity, dt: number, strength: number) => {
      const turn =
        Math.sin(entity.age * 1.7 + entity.id * 12.9898) * strength +
        (random() - 0.5) * strength * 0.6;
      const speed = Math.hypot(entity.vx, entity.vy) || 1;
      const nx = entity.vx / speed;
      const ny = entity.vy / speed;
      entity.vx += (-ny * turn + nx * strength * 0.16) * dt;
      entity.vy += (nx * turn + ny * strength * 0.16) * dt;
    };

    const stepPredator = (entity: Entity, dt: number) => {
      const prey = nearestPrey(entity);
      if (prey) {
        const dx = prey.x - entity.x;
        const dy = prey.y - entity.y;
        const distance = Math.hypot(dx, dy) || 1;
        entity.angle = Math.atan2(dy, dx);
        entity.vx += (dx / distance) * 42 * dt;
        entity.vy += (dy / distance) * 42 * dt;

        if (distance < entity.radius + prey.radius && !isInsideSafeZone(prey)) {
          prey.alive = false;
          entity.energy = Math.min(130, entity.energy + 30);
        }
      } else {
        wander(entity, dt, 22);
      }

      entity.energy -= 2.8 * dt;
      if (entity.energy <= 0) entity.alive = false;
    };

    const stepPrey = (entity: Entity, dt: number) => {
      wander(entity, dt, 34);
      const threat = nearestPredator(entity, 130);
      const zone = threat ? nearestSafeZone(entity) : null;
      if (zone) {
        const dx = zone.x - entity.x;
        const dy = zone.y - entity.y;
        const distance = Math.hypot(dx, dy) || 1;
        entity.vx += (dx / distance) * 58 * dt;
        entity.vy += (dy / distance) * 58 * dt;
      }
      entity.energy += 2.4 * dt;

      if (
        entity.age > 2.2 &&
        entity.energy > 82 &&
        random() < 0.18 * dt
      ) {
        const child = spawnEntity(
          "prey",
          entity.x + randomBetween(-14, 14),
          entity.y + randomBetween(-14, 14),
        );
        if (child) {
          child.energy = 44;
          entity.energy *= 0.55;
        }
      }
    };

    const stepVoid = (entity: Entity, dt: number) => {
      wander(entity, dt, 8);
      const entities = entitiesRef.current;
      for (let i = 0; i < entities.length; i++) {
        const target = entities[i];
        if (!target.alive || target.id === entity.id) continue;
        const dx = target.x - entity.x;
        const dy = target.y - entity.y;
        const minDistance = entity.radius + target.radius;
        if (dx * dx + dy * dy < minDistance * minDistance) {
          target.alive = false;
          entity.energy += 4;
          entity.radius = Math.min(22, entity.radius + 0.08);
        }
      }
    };

    const stepSafeZones = (dt: number) => {
      const arena = arenaRef.current;
      const safeZones = safeZonesRef.current;
      for (let i = 0; i < safeZones.length; i++) {
        const zone = safeZones[i];
        if (!zone.active) continue;

        zone.x += zone.vx * dt;
        zone.y += zone.vy * dt;

        if (zone.x - zone.radius < 0) {
          zone.x = zone.radius;
          zone.vx = Math.abs(zone.vx) * WALL_RESTITUTION;
        } else if (zone.x + zone.radius > arena.width) {
          zone.x = arena.width - zone.radius;
          zone.vx = -Math.abs(zone.vx) * WALL_RESTITUTION;
        }

        if (zone.y - zone.radius < 0) {
          zone.y = zone.radius;
          zone.vy = Math.abs(zone.vy) * WALL_RESTITUTION;
        } else if (zone.y + zone.radius > arena.height) {
          zone.y = arena.height - zone.radius;
          zone.vy = -Math.abs(zone.vy) * WALL_RESTITUTION;
        }
      }
    };

    const repelPredatorFromSafeZones = (predator: Entity) => {
      const safeZones = safeZonesRef.current;
      for (let i = 0; i < safeZones.length; i++) {
        const zone = safeZones[i];
        if (!zone.active) continue;
        const dx = predator.x - zone.x;
        const dy = predator.y - zone.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / dist;
        const ny = dy / dist;
        const minDist = zone.radius + predator.radius;

        if (dist < minDist) {
          predator.x = zone.x + nx * minDist;
          predator.y = zone.y + ny * minDist;

          const dot = predator.vx * nx + predator.vy * ny;
          if (dot < 0) {
            predator.vx -= 2 * dot * nx;
            predator.vy -= 2 * dot * ny;
          }
        }
      }
    };

    const stepSimulation = (dt: number) => {
      const arena = arenaRef.current;
      const entities = entitiesRef.current;
      stepSafeZones(dt);
      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        if (!entity.alive) continue;

        entity.age += dt;
        if (entity.species === "predator") {
          stepPredator(entity, dt);
        } else if (entity.species === "prey") {
          stepPrey(entity, dt);
        } else {
          stepVoid(entity, dt);
        }

        if (!entity.alive) continue;
        entity.vx *= 0.995;
        entity.vy *= 0.995;
        clampSpeed(entity, entity.species === "void" ? 34 : MAX_SPEED);
        if (entity.species === "predator") {
          entity.angle = Math.atan2(entity.vy, entity.vx);
        } else if (entity.species === "void") {
          entity.angle += 0.28 * dt;
        }
        entity.x += entity.vx * dt;
        entity.y += entity.vy * dt;
        if (entity.species === "predator") {
          repelPredatorFromSafeZones(entity);
        }
        bounceWalls(entity, arena);
      }
    };

    const drawRegularPolygon = (
      entity: Entity,
      sides: number,
      rotationOffset = 0,
      radiusScale = 1,
    ) => {
      const radius = entity.radius * radiusScale;
      ctx.beginPath();
      for (let i = 0; i < sides; i++) {
        const angle = entity.angle + rotationOffset + (i / sides) * Math.PI * 2;
        const x = entity.x + Math.cos(angle) * radius;
        const y = entity.y + Math.sin(angle) * radius;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.fill();
    };

    const drawEntity = (entity: Entity) => {
      ctx.fillStyle = speciesColors[entity.species];

      if (entity.species === "prey") {
        ctx.beginPath();
        ctx.arc(entity.x, entity.y, entity.radius, 0, Math.PI * 2);
        ctx.fill();
        return;
      }

      if (entity.species === "predator") {
        drawRegularPolygon(entity, 3, 0, 1.18);
        return;
      }

      const pulse = 1 + Math.sin(entity.age * 2.2) * 0.04;
      const radius = entity.radius * pulse;
      const ringRadius = radius * 1.75;
      ctx.save();
      ctx.translate(entity.x, entity.y);
      ctx.rotate(entity.angle);
      ctx.strokeStyle = "rgba(129, 140, 248, 0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, ringRadius, ringRadius * 0.38, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "#030106";
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(196, 181, 253, 0.42)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    };

    const drawSafeZone = (zone: SafeZone) => {
      ctx.fillStyle = "rgba(56, 189, 248, 0.045)";
      ctx.strokeStyle = "rgba(125, 211, 252, 0.38)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };

    const render = () => {
      const arena = arenaRef.current;
      ctx.setTransform(arena.dpr, 0, 0, arena.dpr, 0, 0);
      ctx.fillStyle = "#071018";
      ctx.fillRect(0, 0, arena.width, arena.height);

      const safeZones = safeZonesRef.current;
      for (let i = 0; i < safeZones.length; i++) {
        const zone = safeZones[i];
        if (zone.active) drawSafeZone(zone);
      }

      const entities = entitiesRef.current;
      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        if (!entity.alive) continue;
        drawEntity(entity);
      }
    };

    renderArenaRef.current = render;
    startSimulationRef.current = () => {
      resetArena();
      runningRef.current = true;
      lastTimeRef.current = 0;
      lastCounterUpdateRef.current = 0;
    };

    const animate = (timeMs: number) => {
      const previous = lastTimeRef.current || timeMs;
      const dt = Math.min(0.033, (timeMs - previous) / 1000) * SIMULATION_SPEED;
      lastTimeRef.current = timeMs;

      if (runningRef.current) {
        stepSimulation(dt);
      }
      render();

      const time = timeMs / 1000;
      if (
        runningRef.current &&
        time - lastCounterUpdateRef.current > COUNTER_UPDATE_INTERVAL
      ) {
        lastCounterUpdateRef.current = time;
        setCounts(countSpecies());
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    const handleResize = () => {
      resizeCanvas();
      render();
    };

    resizeCanvas();
    render();
    animationRef.current = requestAnimationFrame(animate);
    window.addEventListener("resize", handleResize);

    return () => {
      startSimulationRef.current = null;
      renderArenaRef.current = null;
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const updateSetupValue = (species: keyof SetupConfig, value: number) => {
    const limit = setupLimits[species];
    const nextValue = Math.min(limit.max, Math.max(limit.min, value));
    setSetupConfig((current) => ({ ...current, [species]: nextValue }));
  };

  const applyPreset = (config: SetupConfig) => {
    setSetupConfig(config);
  };

  const startSimulation = () => {
    setupConfigRef.current = setupConfig;
    startSimulationRef.current?.();
    setSetupOpen(false);
  };

  const reopenSetup = () => {
    runningRef.current = false;
    setSetupOpen(true);
    renderArenaRef.current?.();
  };

  return (
    <div className="ecosystem-arena">
      <canvas ref={canvasRef} className="ecosystem-canvas" />
      <div className="ecosystem-counters" aria-label="Ecosystem population">
        <div>
          <span>Predators</span>
          <strong>{counts.predator}</strong>
        </div>
        <div>
          <span>Prey</span>
          <strong>{counts.prey}</strong>
        </div>
        <div>
          <span>Voids</span>
          <strong>{counts.void}</strong>
        </div>
        <div>
          <span>Safe Zones</span>
          <strong>{counts.safeZone}</strong>
        </div>
      </div>
      <button type="button" className="ecosystem-reset" onClick={reopenSetup}>
        Reset
      </button>
      {setupOpen ? (
        <div className="setup-overlay" role="dialog" aria-modal="true">
          <div className="setup-panel">
            <h2>Ecosystem Setup</h2>
            <div className="preset-row">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyPreset(preset.config)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="setup-controls">
              {(Object.keys(setupLimits) as Array<keyof SetupConfig>).map(
                (species) => {
                  const limit = setupLimits[species];
                  const value = setupConfig[species];

                  return (
                    <div key={species} className="setup-control">
                      <div className="setup-label">
                        <span>{limit.label}</span>
                        <strong>{value}</strong>
                      </div>
                      <div className="setup-inputs">
                        <button
                          type="button"
                          onClick={() => updateSetupValue(species, value - 1)}
                        >
                          -
                        </button>
                        <input
                          aria-label={limit.label}
                          type="range"
                          min={limit.min}
                          max={limit.max}
                          value={value}
                          onChange={(event) =>
                            updateSetupValue(species, Number(event.target.value))
                          }
                        />
                        <button
                          type="button"
                          onClick={() => updateSetupValue(species, value + 1)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                },
              )}
            </div>
            <button
              type="button"
              className="start-simulation"
              onClick={startSimulation}
            >
              Start Simulation
            </button>
          </div>
        </div>
      ) : null}
      <style jsx>{`
        .ecosystem-arena {
          position: fixed;
          inset: 0;
          overflow: hidden;
          background: #071018;
          touch-action: manipulation;
          user-select: none;
        }

        .ecosystem-canvas {
          display: block;
          width: 100%;
          height: 100%;
        }

        .ecosystem-counters {
          position: fixed;
          left: 16px;
          bottom: 42px;
          z-index: 5;
          display: flex;
          align-items: flex-end;
          gap: 16px;
          color: rgba(248, 250, 252, 0.48);
          font-family: var(--font-geist-mono), monospace;
          text-transform: uppercase;
          pointer-events: none;
          text-shadow:
            0 0 8px rgba(255, 255, 255, 0.18),
            0 1px 6px rgba(0, 0, 0, 0.65);
        }

        .ecosystem-counters div {
          display: grid;
          gap: 2px;
        }

        .ecosystem-counters span {
          color: rgba(248, 250, 252, 0.42);
          font-size: 0.54rem;
          font-weight: 700;
          letter-spacing: 0.08em;
        }

        .ecosystem-counters strong {
          color: rgba(248, 250, 252, 0.82);
          font-size: 0.84rem;
          font-weight: 800;
          line-height: 1;
        }

        .ecosystem-reset {
          position: fixed;
          right: 16px;
          bottom: 38px;
          z-index: 5;
          min-height: 32px;
          padding: 0 13px;
          border: 1px solid rgba(248, 250, 252, 0.12);
          border-radius: 999px;
          background: transparent;
          color: rgba(248, 250, 252, 0.52);
          font-family: var(--font-geist-mono), monospace;
          font-size: 0.62rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          cursor: pointer;
          opacity: 0.58;
          text-shadow: 0 0 8px rgba(255, 255, 255, 0.18);
          transition:
            opacity 0.2s ease,
            color 0.2s ease,
            border-color 0.2s ease;
        }

        .ecosystem-reset:hover,
        .ecosystem-reset:focus-visible {
          border-color: rgba(248, 250, 252, 0.28);
          color: rgba(248, 250, 252, 0.86);
          opacity: 1;
        }

        .setup-overlay {
          position: fixed;
          inset: 0;
          z-index: 30;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: rgba(2, 6, 23, 0.58);
        }

        .setup-panel {
          width: min(460px, 92vw);
          max-height: min(680px, 92vh);
          overflow-y: auto;
          padding: 22px;
          border: 1px solid rgba(226, 232, 240, 0.14);
          border-radius: 16px;
          background: rgba(3, 7, 18, 0.92);
          color: #f8fafc;
          box-shadow: 0 28px 80px rgba(0, 0, 0, 0.46);
          backdrop-filter: blur(14px);
        }

        .setup-panel h2 {
          margin: 0 0 18px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 1.1rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .preset-row {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 18px;
        }

        .preset-row button,
        .setup-inputs button,
        .start-simulation {
          min-height: 42px;
          border: 1px solid rgba(226, 232, 240, 0.15);
          border-radius: 11px;
          background: rgba(15, 23, 42, 0.72);
          color: rgba(248, 250, 252, 0.9);
          font-weight: 800;
          cursor: pointer;
        }

        .setup-controls {
          display: grid;
          gap: 14px;
        }

        .setup-control {
          display: grid;
          gap: 8px;
        }

        .setup-label {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          color: rgba(226, 232, 240, 0.78);
          font-family: var(--font-geist-mono), monospace;
          font-size: 0.75rem;
          text-transform: uppercase;
        }

        .setup-label strong {
          color: #f8fafc;
          font-size: 0.9rem;
        }

        .setup-inputs {
          display: grid;
          grid-template-columns: 44px minmax(0, 1fr) 44px;
          gap: 10px;
          align-items: center;
        }

        .setup-inputs input {
          width: 100%;
          accent-color: #22c55e;
        }

        .start-simulation {
          width: 100%;
          min-height: 48px;
          margin-top: 20px;
          background: rgba(34, 197, 94, 0.2);
          border-color: rgba(34, 197, 94, 0.38);
          color: #dcfce7;
          text-transform: uppercase;
        }

        @media (max-width: 640px) {
          .ecosystem-counters {
            left: 12px;
            bottom: 32px;
            gap: 11px;
          }

          .ecosystem-reset {
            right: 12px;
            bottom: 28px;
            min-height: 32px;
            padding: 0 11px;
            font-size: 0.58rem;
          }

          .ecosystem-counters span {
            font-size: 0.43rem;
          }

          .ecosystem-counters strong {
            font-size: 0.72rem;
          }

          .setup-overlay {
            align-items: flex-start;
            padding: 18px 12px;
          }

          .setup-panel {
            width: 92vw;
            max-height: calc(100vh - 36px);
            padding: 18px;
          }

          .preset-row {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};

export default EcosystemArena;
