"use client";

import React, { useEffect, useRef, useState } from "react";

type Species = "predator" | "prey" | "healer" | "void";

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
};

type Arena = {
  width: number;
  height: number;
  dpr: number;
};

type SpeciesCounts = Record<Species, number>;

type SetupConfig = {
  prey: number;
  predator: number;
  healer: number;
  void: number;
};

const MAX_ENTITIES = 180;
const MAX_SPEED = 95;
const WALL_RESTITUTION = 0.92;
const COUNTER_UPDATE_INTERVAL = 0.22;
const SIMULATION_SPEED = 2;

const defaultSetup: SetupConfig = {
  prey: 30,
  predator: 5,
  healer: 7,
  void: 2,
};

const setupLimits: Record<
  keyof SetupConfig,
  { label: string; min: number; max: number }
> = {
  prey: { label: "Prey", min: 5, max: 80 },
  predator: { label: "Predators", min: 0, max: 20 },
  healer: { label: "Healers", min: 0, max: 20 },
  void: { label: "Voids", min: 0, max: 8 },
};

const presets: Array<{ label: string; config: SetupConfig }> = [
  { label: "Balanced", config: defaultSetup },
  {
    label: "Predator Chaos",
    config: { prey: 32, predator: 14, healer: 4, void: 1 },
  },
  {
    label: "Prey Explosion",
    config: { prey: 70, predator: 3, healer: 8, void: 1 },
  },
  {
    label: "Void Apocalypse",
    config: { prey: 40, predator: 5, healer: 5, void: 6 },
  },
];

const speciesColors: Record<Species, string> = {
  predator: "#ef4444",
  prey: "#3b82f6",
  healer: "#22c55e",
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
  const [counts, setCounts] = useState<SpeciesCounts>({
    predator: 0,
    prey: 0,
    healer: 0,
    void: 0,
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
        entity.radius =
          species === "void" ? 13 : species === "predator" ? 8 : 6;
        entity.energy =
          species === "void" ? 120 : species === "predator" ? 90 : 62;
        entity.species = species;
        entity.alive = true;
        entity.age = 0;
        return entity;
      }

      return null;
    };

    const countSpecies = () => {
      const nextCounts: SpeciesCounts = {
        predator: 0,
        prey: 0,
        healer: 0,
        void: 0,
      };
      const entities = entitiesRef.current;
      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        if (!entity.alive) continue;
        nextCounts[entity.species] += 1;
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

      const config = setupConfigRef.current;
      for (let i = 0; i < config.prey; i++) spawnEntity("prey");
      for (let i = 0; i < config.predator; i++) spawnEntity("predator");
      for (let i = 0; i < config.healer; i++) spawnEntity("healer");
      for (let i = 0; i < config.void; i++) spawnEntity("void");
      setCounts(countSpecies());
    };

    const nearestPrey = (predator: Entity) => {
      let nearest: Entity | null = null;
      let nearestDistanceSq = Infinity;
      const entities = entitiesRef.current;
      for (let i = 0; i < entities.length; i++) {
        const prey = entities[i];
        if (!prey.alive || prey.species !== "prey") continue;
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
        entity.vx += (dx / distance) * 42 * dt;
        entity.vy += (dy / distance) * 42 * dt;

        if (distance < entity.radius + prey.radius) {
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

    const stepHealer = (entity: Entity, dt: number) => {
      wander(entity, dt, 24);
      const entities = entitiesRef.current;
      for (let i = 0; i < entities.length; i++) {
        const predator = entities[i];
        if (!predator.alive || predator.species !== "predator") continue;
        const dx = predator.x - entity.x;
        const dy = predator.y - entity.y;
        if (dx * dx + dy * dy < 76 * 76) {
          predator.energy -= 5.5 * dt;
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

    const stepSimulation = (dt: number) => {
      const arena = arenaRef.current;
      const entities = entitiesRef.current;
      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        if (!entity.alive) continue;

        entity.age += dt;
        if (entity.species === "predator") {
          stepPredator(entity, dt);
        } else if (entity.species === "prey") {
          stepPrey(entity, dt);
        } else if (entity.species === "healer") {
          stepHealer(entity, dt);
        } else {
          stepVoid(entity, dt);
        }

        if (!entity.alive) continue;
        entity.vx *= 0.995;
        entity.vy *= 0.995;
        clampSpeed(entity, entity.species === "void" ? 34 : MAX_SPEED);
        entity.x += entity.vx * dt;
        entity.y += entity.vy * dt;
        bounceWalls(entity, arena);
      }
    };

    const render = () => {
      const arena = arenaRef.current;
      ctx.setTransform(arena.dpr, 0, 0, arena.dpr, 0, 0);
      ctx.fillStyle = "#071018";
      ctx.fillRect(0, 0, arena.width, arena.height);

      const entities = entitiesRef.current;
      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        if (!entity.alive) continue;
        ctx.fillStyle = speciesColors[entity.species];
        ctx.beginPath();
        ctx.arc(entity.x, entity.y, entity.radius, 0, Math.PI * 2);
        ctx.fill();
        if (entity.species === "void") {
          ctx.strokeStyle = "#334155";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
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
          <span>Predator</span>
          <strong>{counts.predator}</strong>
        </div>
        <div>
          <span>Prey</span>
          <strong>{counts.prey}</strong>
        </div>
        <div>
          <span>Healer</span>
          <strong>{counts.healer}</strong>
        </div>
        <div>
          <span>Void</span>
          <strong>{counts.void}</strong>
        </div>
        <button type="button" className="ecosystem-reset" onClick={reopenSetup}>
          Reset
        </button>
      </div>
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
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
          gap: 10px;
          min-width: min(520px, calc(100vw - 32px));
          padding: 10px 12px;
          border: 1px solid rgba(226, 232, 240, 0.12);
          border-radius: 12px;
          background: rgba(2, 6, 23, 0.52);
          color: rgba(226, 232, 240, 0.72);
          font-family: var(--font-geist-mono), monospace;
          text-transform: uppercase;
          backdrop-filter: blur(6px);
        }

        .ecosystem-counters div {
          display: grid;
          gap: 4px;
        }

        .ecosystem-counters span {
          font-size: 0.55rem;
        }

        .ecosystem-counters strong {
          color: #f8fafc;
          font-size: 0.86rem;
        }

        .ecosystem-reset {
          align-self: center;
          min-height: 34px;
          padding: 0 12px;
          border: 1px solid rgba(226, 232, 240, 0.16);
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.72);
          color: rgba(248, 250, 252, 0.86);
          font-family: var(--font-geist-mono), monospace;
          font-size: 0.64rem;
          font-weight: 800;
          text-transform: uppercase;
          cursor: pointer;
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
            left: 10px;
            right: 10px;
            bottom: 32px;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            min-width: 0;
            padding: 9px 10px;
          }

          .ecosystem-reset {
            grid-column: 1 / -1;
            min-height: 40px;
          }

          .ecosystem-counters span {
            font-size: 0.48rem;
          }

          .ecosystem-counters strong {
            font-size: 0.78rem;
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
