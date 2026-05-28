"use client";

import React, { useEffect, useRef, useState } from "react";

type Species = "predator" | "prey";

type Entity = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
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
  safeZone: number;
};

type Result = "predator" | "prey" | null;

type EcosystemAudio = {
  initAudio: () => Promise<AudioContextState | "unavailable" | "interrupted">;
  unlockAudio: () => Promise<AudioContextState | "unavailable" | "interrupted">;
  startAmbience: () => void;
  stopAmbience: () => void;
  playCollision: (intensity: number, size: number) => void;
  setMuted: (value: boolean) => void;
};

const MAX_ENTITIES = 180;
const MAX_SAFE_ZONES = 6;
const MAX_SPEED = 95;
const WALL_RESTITUTION = 0.92;
const COUNTER_UPDATE_INTERVAL = 0.22;
const SIMULATION_SPEED = 2;
const SURVIVAL_SECONDS = 60;
const PREY_PANIC_RADIUS = 58;
const PREDATOR_ATTRACTION_RADIUS = 135;
const COLLISION_RESTITUTION = 0.95;
const PREDATOR_SPEED_MULTIPLIER = 3;
const PREY_SPEED_MULTIPLIER = 2;

let ecosystemAudioContext: AudioContext | null = null;

const defaultSetup: SetupConfig = {
  prey: 30,
  predator: 5,
  safeZone: 3,
};

const setupLimits: Record<
  keyof SetupConfig,
  { label: string; min: number; max: number }
> = {
  prey: { label: "Prey", min: 5, max: 80 },
  predator: { label: "Predators", min: 1, max: 20 },
  safeZone: { label: "Safe Zones", min: 1, max: 6 },
};

const speciesColors: Record<Species, string> = {
  predator: "#ef4444",
  prey: "#3b82f6",
};

const createBlankEntity = (id: number): Entity => ({
  id,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  radius: 6,
  mass: 1,
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

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const createEcosystemAudio = (): EcosystemAudio => {
  let audio: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let ambienceGain: GainNode | null = null;
  let ambienceFilter: BiquadFilterNode | null = null;
  let noiseSource: AudioBufferSourceNode | null = null;
  let noiseGain: GainNode | null = null;
  let noiseFilter: BiquadFilterNode | null = null;
  let lfo: OscillatorNode | null = null;
  let lfoGain: GainNode | null = null;
  let muted = false;
  let unlocked = false;
  let lastCollisionAt = 0;
  let collisionWindowStart = 0;
  let collisionCount = 0;
  const oscillators: OscillatorNode[] = [];

  const ensureAudio = () => {
    if (audio) return audio;
    const audioWindow = window as Window &
      typeof globalThis & {
        webkitAudioContext?: typeof AudioContext;
      };
    const AudioContextClass =
      audioWindow.AudioContext || audioWindow.webkitAudioContext;
    if (!AudioContextClass) return null;

    ecosystemAudioContext = ecosystemAudioContext || new AudioContextClass();
    audio = ecosystemAudioContext;
    masterGain = audio.createGain();
    masterGain.gain.value = muted ? 0 : 0.72;
    masterGain.connect(audio.destination);
    return audio;
  };

  const startAmbience = () => {
    if (!audio || audio.state !== "running" || !masterGain || ambienceGain) {
      return;
    }

    const now = audio.currentTime;
    ambienceGain = audio.createGain();
    ambienceFilter = audio.createBiquadFilter();
    lfo = audio.createOscillator();
    lfoGain = audio.createGain();

    ambienceGain.gain.setValueAtTime(0.0001, now);
    ambienceGain.gain.setTargetAtTime(0.2, now, 2.2);
    ambienceFilter.type = "lowpass";
    ambienceFilter.frequency.value = 1650;
    ambienceFilter.Q.value = 0.35;

    lfo.type = "sine";
    lfo.frequency.value = 0.055;
    lfoGain.gain.value = 0.032;
    lfo.connect(lfoGain);
    lfoGain.connect(ambienceGain.gain);

    const tones = [
      { frequency: 65.41, type: "sine" as OscillatorType, gain: 0.28 },
      { frequency: 130.81, type: "triangle" as OscillatorType, gain: 0.16 },
      { frequency: 164.81, type: "sine" as OscillatorType, gain: 0.12 },
      { frequency: 196, type: "triangle" as OscillatorType, gain: 0.09 },
      { frequency: 261.63, type: "sine" as OscillatorType, gain: 0.055 },
    ];

    for (let i = 0; i < tones.length; i++) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = tones[i].type;
      osc.frequency.value = tones[i].frequency;
      osc.detune.value = i % 2 === 0 ? -4 + i : 3 - i;
      gain.gain.value = tones[i].gain;
      osc.connect(gain);
      gain.connect(ambienceFilter);
      osc.start(now);
      oscillators.push(osc);
    }

    const noiseBuffer = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) {
      channel[i] = (Math.random() * 2 - 1) * 0.18;
    }
    noiseSource = audio.createBufferSource();
    noiseGain = audio.createGain();
    noiseFilter = audio.createBiquadFilter();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;
    noiseGain.gain.value = 0.01;
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 1400;
    noiseFilter.Q.value = 0.6;
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ambienceFilter);
    noiseSource.start(now);

    ambienceFilter.connect(ambienceGain);
    ambienceGain.connect(masterGain);
    lfo.start(now);
  };

  const stopAmbience = () => {
    const now = audio?.currentTime ?? 0;
    ambienceGain?.gain.setTargetAtTime(0.0001, now, 0.35);
    for (let i = 0; i < oscillators.length; i++) {
      const oscillator = oscillators[i];
      try {
        oscillator.stop(now + 0.45);
      } catch {
        // Already stopped.
      }
      oscillator.onended = () => oscillator.disconnect();
    }
    oscillators.length = 0;

    try {
      noiseSource?.stop(now + 0.45);
    } catch {
      // Already stopped.
    }
    try {
      lfo?.stop(now + 0.45);
    } catch {
      // Already stopped.
    }

    window.setTimeout(() => {
      noiseSource?.disconnect();
      noiseGain?.disconnect();
      noiseFilter?.disconnect();
      lfo?.disconnect();
      lfoGain?.disconnect();
      ambienceFilter?.disconnect();
      ambienceGain?.disconnect();
      noiseSource = null;
      noiseGain = null;
      noiseFilter = null;
      lfo = null;
      lfoGain = null;
      ambienceFilter = null;
      ambienceGain = null;
    }, 520);
  };

  const unlockAudio = async () => {
    try {
      const ctx = ensureAudio();
      if (!ctx) return "unavailable";
      if (ctx.state !== "running") {
        await ctx.resume();
      }
      unlocked = ctx.state === "running";
      if (unlocked && !muted) startAmbience();
      return ctx.state;
    } catch {
      unlocked = false;
      return "interrupted";
    }
  };

  const playCollision = (intensity: number, size: number) => {
    if (!audio || !masterGain || audio.state !== "running" || muted || !unlocked) {
      return;
    }

    const now = audio.currentTime;
    const impact = clamp(intensity, 0, 1);
    if (impact < 0.24) return;

    if (now - collisionWindowStart >= 1) {
      collisionWindowStart = now;
      collisionCount = 0;
    }
    if (collisionCount >= 5 || now - lastCollisionAt < 0.09) return;
    collisionCount += 1;
    lastCollisionAt = now;

    const sizeTone = clamp(size / 26, 0, 1);
    const frequency =
      780 - sizeTone * 360 + impact * 140 + (Math.random() - 0.5) * 55;
    const duration = 0.07 + impact * 0.07;
    const peak = 0.026 + impact * 0.072;

    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    const osc = audio.createOscillator();
    const click = audio.createOscillator();
    const clickGain = audio.createGain();

    filter.type = "bandpass";
    filter.frequency.value = frequency * 1.25;
    filter.Q.value = 1.2;
    osc.type = "triangle";
    osc.frequency.value = frequency;
    click.type = "sine";
    click.frequency.value = frequency * 1.9;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    clickGain.gain.setValueAtTime(0.0001, now);
    clickGain.gain.exponentialRampToValueAtTime(peak * 0.42, now + 0.004);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.038);

    osc.frequency.exponentialRampToValueAtTime(
      Math.max(80, frequency * 0.72),
      now + duration,
    );
    osc.connect(gain);
    gain.connect(filter);
    filter.connect(masterGain);
    click.connect(clickGain);
    clickGain.connect(masterGain);

    osc.start(now);
    click.start(now);
    osc.stop(now + duration + 0.015);
    click.stop(now + 0.045);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      filter.disconnect();
    };
    click.onended = () => {
      click.disconnect();
      clickGain.disconnect();
    };
  };

  const setMuted = (value: boolean) => {
    muted = value;
    if (masterGain && audio) {
      masterGain.gain.setTargetAtTime(value ? 0 : 0.72, audio.currentTime, 0.08);
    }
    if (value) {
      stopAmbience();
    } else if (unlocked && audio?.state === "running") {
      startAmbience();
    }
  };

  return {
    initAudio: unlockAudio,
    unlockAudio,
    startAmbience,
    stopAmbience,
    playCollision,
    setMuted,
  };
};

const bounceWalls = (entity: Entity, arena: Arena) => {
  let impact = 0;
  if (entity.x - entity.radius < 0) {
    impact = Math.max(impact, Math.abs(entity.vx));
    entity.x = entity.radius;
    entity.vx = Math.abs(entity.vx) * WALL_RESTITUTION;
  } else if (entity.x + entity.radius > arena.width) {
    impact = Math.max(impact, Math.abs(entity.vx));
    entity.x = arena.width - entity.radius;
    entity.vx = -Math.abs(entity.vx) * WALL_RESTITUTION;
  }

  if (entity.y - entity.radius < 0) {
    impact = Math.max(impact, Math.abs(entity.vy));
    entity.y = entity.radius;
    entity.vy = Math.abs(entity.vy) * WALL_RESTITUTION;
  } else if (entity.y + entity.radius > arena.height) {
    impact = Math.max(impact, Math.abs(entity.vy));
    entity.y = arena.height - entity.radius;
    entity.vy = -Math.abs(entity.vy) * WALL_RESTITUTION;
  }

  return impact;
};

const EcosystemArena = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<EcosystemAudio | null>(null);
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
  const elapsedTimeRef = useRef(0);
  const setupConfigRef = useRef<SetupConfig>(defaultSetup);
  const startSimulationRef = useRef<(() => void) | null>(null);
  const renderArenaRef = useRef<(() => void) | null>(null);
  const [setupOpen, setSetupOpen] = useState(true);
  const [setupConfig, setSetupConfig] = useState<SetupConfig>(defaultSetup);
  const [timeLeft, setTimeLeft] = useState(SURVIVAL_SECONDS);
  const [result, setResult] = useState<Result>(null);
  const [counts, setCounts] = useState<PopulationCounts>({
    predator: 0,
    prey: 0,
    safeZone: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    audioRef.current = audioRef.current ?? createEcosystemAudio();

    const random = () => {
      seedRef.current = (seedRef.current * 1664525 + 1013904223) >>> 0;
      return seedRef.current / 0xffffffff;
    };

    const randomBetween = (min: number, max: number) =>
      min + random() * (max - min);

    const applyCanvasScale = () => {
      const { dpr } = arenaRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };

    const getSpawnRadius = (species: Species) => {
      const isMobile = arenaRef.current.width < 640;
      if (species === "predator") {
        return randomBetween(isMobile ? 7 : 9, isMobile ? 9 : 11);
      }
      return randomBetween(isMobile ? 4 : 5, isMobile ? 5 : 6);
    };

    const getPreyBaseRadius = () => (arenaRef.current.width < 640 ? 4.5 : 5.5);

    const getMaxPredatorRadius = () => getPreyBaseRadius() * 4.5;

    const getPredatorGrowth = (predator: Entity) => {
      const baseRadius = getPreyBaseRadius() * 1.75;
      const maxRadius = getMaxPredatorRadius();
      return Math.max(
        0,
        Math.min(1, (predator.radius - baseRadius) / (maxRadius - baseRadius)),
      );
    };

    const getPredatorMaxSpeed = (predator: Entity) =>
      MAX_SPEED *
      PREDATOR_SPEED_MULTIPLIER *
      (1 - getPredatorGrowth(predator) * 0.32);

    const getPredatorTurnScale = (predator: Entity) =>
      1 - getPredatorGrowth(predator) * 0.46;

    const spawnSafeZone = (index: number) => {
      const zone = safeZonesRef.current[index];
      const radius = getPreyBaseRadius() * 16;
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
          species === "predator"
            ? randomBetween(20, 36) * PREDATOR_SPEED_MULTIPLIER
            : randomBetween(18, 44) * PREY_SPEED_MULTIPLIER;

        entity.x = x;
        entity.y = y;
        entity.vx = Math.cos(angle) * speed;
        entity.vy = Math.sin(angle) * speed;
        entity.radius = getSpawnRadius(species);
        entity.mass =
          species === "predator"
            ? Math.max(1.7, entity.radius / getPreyBaseRadius())
            : 1;
        entity.energy = species === "predator" ? 90 : 62;
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
      arenaRef.current = { width, height, dpr };
      applyCanvasScale();
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
      for (let i = 0; i < config.safeZone; i++) spawnSafeZone(i);
      elapsedTimeRef.current = 0;
      setTimeLeft(SURVIVAL_SECONDS);
      setResult(null);
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

    const nearestPrey = (predator: Entity, maxDistance: number) => {
      let nearest: Entity | null = null;
      let nearestDistanceSq = maxDistance * maxDistance;
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

    const addRandomMotion = (
      entity: Entity,
      dt: number,
      strength: number,
      impulseChance: number,
    ) => {
      const driftAngle =
        entity.angle + Math.sin(entity.age * 1.8 + entity.id * 4.73) * 1.15;
      entity.vx += Math.cos(driftAngle) * strength * 0.28 * dt;
      entity.vy += Math.sin(driftAngle) * strength * 0.28 * dt;

      if (random() < impulseChance * dt) {
        const angle = randomBetween(0, Math.PI * 2);
        const impulse = randomBetween(strength * 0.25, strength * 0.7);
        entity.vx += Math.cos(angle) * impulse;
        entity.vy += Math.sin(angle) * impulse;
        entity.angle = angle;
      }
    };

    const stepPredator = (entity: Entity, dt: number) => {
      const agility = getPredatorTurnScale(entity);
      addRandomMotion(
        entity,
        dt,
        20 * agility * PREDATOR_SPEED_MULTIPLIER,
        0.75 * agility,
      );

      const prey = nearestPrey(entity, PREDATOR_ATTRACTION_RADIUS);
      if (prey) {
        const dx = prey.x - entity.x;
        const dy = prey.y - entity.y;
        const distance = Math.hypot(dx, dy) || 1;
        const falloff = 1 - distance / PREDATOR_ATTRACTION_RADIUS;
        const pull = 11 * falloff * (1 - getPredatorGrowth(entity) * 0.2);
        entity.vx += (dx / distance) * pull * dt;
        entity.vy += (dy / distance) * pull * dt;
      }

      entity.energy = Math.max(1, entity.energy - 0.35 * dt);
    };

    const stepPrey = (entity: Entity, dt: number) => {
      addRandomMotion(
        entity,
        dt,
        (isInsideSafeZone(entity) ? 17 : 24) * PREY_SPEED_MULTIPLIER,
        1.05,
      );

      const threat = nearestPredator(entity, PREY_PANIC_RADIUS);
      if (threat) {
        const dx = entity.x - threat.x;
        const dy = entity.y - threat.y;
        const distance = Math.hypot(dx, dy) || 1;
        const panic = 32 * (1 - distance / PREY_PANIC_RADIUS);
        entity.vx += (dx / distance) * panic * dt;
        entity.vy += (dy / distance) * panic * dt;
      }

      entity.energy += 2.4 * dt;
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
          const overlap = minDist - dist;
          const bounceScale = 1 + getPredatorGrowth(predator) * 0.65;
          const impact = Math.max(0, -(predator.vx * nx + predator.vy * ny));
          predator.x = zone.x + nx * (minDist + overlap * 0.18);
          predator.y = zone.y + ny * (minDist + overlap * 0.18);

          const dot = predator.vx * nx + predator.vy * ny;
          if (dot < 0) {
            predator.vx -= 2.15 * dot * nx * bounceScale;
            predator.vy -= 2.15 * dot * ny * bounceScale;
          }
          predator.vx += nx * overlap * 6 * bounceScale;
          predator.vy += ny * overlap * 6 * bounceScale;
          audioRef.current?.playCollision(impact / 260, predator.radius);
        }
      }
    };

    const growPredator = (predator: Entity) => {
      predator.radius = Math.min(getMaxPredatorRadius(), predator.radius + 0.35);
      predator.energy = Math.min(180, predator.energy + 34);
      predator.mass += 0.14;
    };

    const bounceEntities = (a: Entity, b: Entity, nx: number, ny: number) => {
      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const velocityAlongNormal = rvx * nx + rvy * ny;
      if (velocityAlongNormal > 0) return;

      const invMassA = 1 / Math.max(0.1, a.mass);
      const invMassB = 1 / Math.max(0.1, b.mass);
      const impulse =
        (-(1 + COLLISION_RESTITUTION) * velocityAlongNormal) /
        (invMassA + invMassB);
      const impulseX = impulse * nx;
      const impulseY = impulse * ny;

      a.vx -= impulseX * invMassA;
      a.vy -= impulseY * invMassA;
      b.vx += impulseX * invMassB;
      b.vy += impulseY * invMassB;
    };

    const handleEntityCollisions = () => {
      const entities = entitiesRef.current;
      for (let i = 0; i < entities.length; i++) {
        const a = entities[i];
        if (!a.alive) continue;

        for (let j = i + 1; j < entities.length; j++) {
          const b = entities[j];
          if (!b.alive) continue;

          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const minDistance = a.radius + b.radius;
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq >= minDistance * minDistance) continue;

          const distance = Math.sqrt(distanceSq) || 1;
          const nx = dx / distance;
          const ny = dy / distance;
          const overlap = minDistance - distance;
          const relativeSpeed = Math.abs((b.vx - a.vx) * nx + (b.vy - a.vy) * ny);

          const predator =
            a.species === "predator" ? a : b.species === "predator" ? b : null;
          const prey =
            a.species === "prey" ? a : b.species === "prey" ? b : null;

          if (predator && prey && !isInsideSafeZone(prey)) {
            audioRef.current?.playCollision(
              Math.max(0.48, relativeSpeed / 280),
              predator.radius,
            );
            prey.alive = false;
            growPredator(predator);
            continue;
          }

          const totalMass = a.mass + b.mass;
          const aShare = b.mass / totalMass;
          const bShare = a.mass / totalMass;
          a.x -= nx * overlap * aShare;
          a.y -= ny * overlap * aShare;
          b.x += nx * overlap * bShare;
          b.y += ny * overlap * bShare;
          bounceEntities(a, b, nx, ny);
          audioRef.current?.playCollision(
            relativeSpeed / 280,
            Math.max(a.radius, b.radius),
          );
        }
      }
    };

    const resolveEndCondition = () => {
      const nextCounts = countSpecies();
      if (nextCounts.prey === 0) {
        return { counts: nextCounts, result: "predator" as Result };
      }
      if (elapsedTimeRef.current >= SURVIVAL_SECONDS && nextCounts.prey > 0) {
        return { counts: nextCounts, result: "prey" as Result };
      }

      return { counts: nextCounts, result: null };
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
        } else {
          stepPrey(entity, dt);
        }

        if (!entity.alive) continue;
        entity.vx *= 0.995;
        entity.vy *= 0.995;
        clampSpeed(
          entity,
          entity.species === "predator"
            ? getPredatorMaxSpeed(entity)
            : MAX_SPEED * PREY_SPEED_MULTIPLIER,
        );
        if (entity.species === "predator") {
          entity.angle = Math.atan2(entity.vy, entity.vx);
        }
        entity.x += entity.vx * dt;
        entity.y += entity.vy * dt;
        if (entity.species === "predator") {
          repelPredatorFromSafeZones(entity);
        }
        const wallImpact = bounceWalls(entity, arena);
        audioRef.current?.playCollision(wallImpact / 300, entity.radius);
      }

      handleEntityCollisions();

      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        if (!entity.alive) continue;
        if (entity.species === "predator") {
          repelPredatorFromSafeZones(entity);
        }
        const wallImpact = bounceWalls(entity, arena);
        audioRef.current?.playCollision(wallImpact / 300, entity.radius);
      }
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
        ctx.beginPath();
        ctx.arc(entity.x, entity.y, entity.radius, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
    };

    const drawSafeZone = (zone: SafeZone) => {
      ctx.save();
      ctx.shadowColor = "rgba(74, 222, 128, 0.22)";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "rgba(34, 197, 94, 0.075)";
      ctx.strokeStyle = "rgba(134, 239, 172, 0.48)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(220, 252, 231, 0.5)";
      ctx.font = "700 10px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("SAFE ZONE", zone.x, zone.y);
      ctx.restore();
    };

    const render = () => {
      const arena = arenaRef.current;
      applyCanvasScale();
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
      const rawDt = Math.min(0.033, (timeMs - previous) / 1000);
      const dt = rawDt * SIMULATION_SPEED;
      lastTimeRef.current = timeMs;

      if (runningRef.current) {
        elapsedTimeRef.current += rawDt;
        stepSimulation(dt);
        const nextResult = resolveEndCondition();
        if (nextResult.result) {
          runningRef.current = false;
          setResult(nextResult.result);
          setCounts(nextResult.counts);
        }
      }
      render();

      const time = timeMs / 1000;
      if (
        runningRef.current &&
        time - lastCounterUpdateRef.current > COUNTER_UPDATE_INTERVAL
      ) {
        lastCounterUpdateRef.current = time;
        setCounts(countSpecies());
        setTimeLeft(
          Math.max(0, Math.ceil(SURVIVAL_SECONDS - elapsedTimeRef.current)),
        );
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
      audioRef.current?.stopAmbience();
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

  const unlockAudio = () => {
    void audioRef.current?.unlockAudio();
  };

  const startSimulation = () => {
    unlockAudio();
    setupConfigRef.current = setupConfig;
    startSimulationRef.current?.();
    setSetupOpen(false);
  };

  const reopenSetup = () => {
    runningRef.current = false;
    setResult(null);
    setSetupOpen(true);
    renderArenaRef.current?.();
  };

  const resultLabel =
    result === "predator"
      ? "PREDATORS WON"
      : result === "prey"
        ? "PREY SURVIVED"
        : null;

  return (
    <div className="ecosystem-arena" onPointerDown={unlockAudio}>
      <canvas ref={canvasRef} className="ecosystem-canvas" />
      {!setupOpen ? (
        <div className="ecosystem-timer" aria-live="polite">
          {resultLabel ?? `TIMER: ${timeLeft}`}
        </div>
      ) : null}
      <div className="ecosystem-counters" aria-label="Ecosystem population">
        <div>
          <span>Prey</span>
          <strong>{counts.prey}</strong>
        </div>
        <div>
          <span>Predators</span>
          <strong>{counts.predator}</strong>
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
          width: 100vw;
          height: 100vh;
          min-height: 0;
          transform: none;
          -webkit-transform: none;
        }

        .ecosystem-timer {
          position: fixed;
          top: 18px;
          left: 50%;
          z-index: 5;
          transform: translateX(-50%);
          color: rgba(248, 250, 252, 0.9);
          font-family: var(--font-geist-mono), monospace;
          font-size: 0.86rem;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-align: center;
          text-transform: uppercase;
          pointer-events: none;
          text-shadow:
            0 0 10px rgba(255, 255, 255, 0.2),
            0 1px 8px rgba(0, 0, 0, 0.72);
          white-space: nowrap;
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
          .ecosystem-timer {
            top: 14px;
            font-size: 0.76rem;
          }

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
        }
      `}</style>
    </div>
  );
};

export default EcosystemArena;
