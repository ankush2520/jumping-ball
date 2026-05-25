"use client";

import React, { useEffect, useRef, useState } from "react";

type GravityBall = {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  color: string;
  glow: string;
  slowTime: number;
};

type ExplosionParticle = {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  radius: number;
  color: string;
};

type TrailParticle = {
  active: boolean;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  radius: number;
  color: string;
};

type ShockwaveRing = {
  active: boolean;
  x: number;
  y: number;
  age: number;
  duration: number;
  maxRadius: number;
  width: number;
  alpha: number;
};

type HudStats = {
  mass: number;
  stability: number;
  charge: number;
  stage: string;
};

type BlackHole = {
  x: number;
  y: number;
  radius: number;
  targetRadius: number;
  strength: number;
  mass: number;
  rotationAngle: number;
  rotationSpeed: number;
};

type Arena = {
  width: number;
  height: number;
  dpr: number;
};

type PhysicsScale = {
  mobileScale: number;
  speedScale: number;
  gravityScale: number;
  growthScale: number;
  visualScale: number;
  blackHoleVisualScale: number;
  explosionScale: number;
  calmDuration: number;
  awakeningDuration: number;
  minCycleTime: number;
};

type CycleState = {
  phase: "calm" | "awakening" | "active" | "collapse" | "explosion";
  phaseStartedAt: number;
  shockwaveAt: number;
};

const performanceMode = true;
const MAX_BALLS = 40;
const MAX_EXPLOSION_PARTICLES = 70;
const MAX_TRAIL_PARTICLES = 120;
const MAX_SHOCKWAVES = 3;
const BALL_COUNT = Math.min(26, MAX_BALLS);
const BALL_SPEED_SCALE = 0.6;
const MIN_RADIUS = 7;
const MAX_RADIUS = 19;
const BASE_HOLE_RADIUS = 18;
const BASE_GRAVITY = 52000;
const WALL_RESTITUTION = 0.94;
const BALL_RESTITUTION = 0.9;
const MAX_SPEED = 880;
const MIN_SPEED = 70;
const SUPERNOVA_COLLAPSE_STAGE = 0.5;
const SUPERNOVA_IGNITION_STAGE = 0.12;
const SUPERNOVA_BLOOM_FADE_STAGE = 0.9;
const SUPERNOVA_RETURN_STAGE = 0.4;
const COLLAPSE_PAUSE = SUPERNOVA_COLLAPSE_STAGE;
const EXPLOSION_TIME =
  SUPERNOVA_IGNITION_STAGE +
  SUPERNOVA_BLOOM_FADE_STAGE +
  SUPERNOVA_RETURN_STAGE;
const DESKTOP_CALM_PHASE = 3.5;
const DESKTOP_AWAKENING_PHASE = 4.5;
const MOBILE_CALM_PHASE = 5;
const MOBILE_AWAKENING_PHASE = 6.5;
const EXPLOSION_PARTICLE_COUNT = performanceMode ? 58 : 70;
const MOBILE_EXPLOSION_PARTICLE_COUNT = 35;
const EXPLOSION_LAUNCH_SCALE = 1.85;
const SHAKE_DURATION = 0.3;
const TARGET_FPS = performanceMode ? 45 : 60;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
const DESKTOP_DPR_CAP = 1.5;
const MOBILE_DPR_CAP = 3;
const HUD_UPDATE_INTERVAL = 0.18;

const palette = [
  { color: "#67e8f9", glow: "rgba(103, 232, 249, 0.62)" },
  { color: "#60a5fa", glow: "rgba(96, 165, 250, 0.58)" },
  { color: "#a78bfa", glow: "rgba(167, 139, 250, 0.58)" },
  { color: "#22d3ee", glow: "rgba(34, 211, 238, 0.56)" },
  { color: "#f0abfc", glow: "rgba(240, 171, 252, 0.5)" },
];

const getHungerStage = (absorbedCount: number) => {
  if (absorbedCount >= 20) return "Critical";
  if (absorbedCount >= 14) return "Voracious";
  if (absorbedCount >= 8) return "Hungry";
  if (absorbedCount >= 3) return "Awake";
  return "Dormant";
};

const randomBetween = (min: number, max: number) =>
  min + Math.random() * (max - min);

class SoundManager {
  private audio: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private humGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private humOscillators: OscillatorNode[] = [];
  private musicOscillators: OscillatorNode[] = [];
  private musicTimer: number | null = null;
  private musicStep = 0;
  private muted = false;
  private unlocked = false;
  private testBeepPlayed = false;
  private lastAbsorbAt = 0;
  private lastCollisionAt = 0;

  async initAudio() {
    try {
      if (this.audio?.state === "closed") {
        this.audio = null;
        this.masterGain = null;
        this.unlocked = false;
      }

      if (!this.audio) {
        const audioWindow = window as Window &
          typeof globalThis & {
            webkitAudioContext?: typeof AudioContext;
          };
        const AudioContextClass =
          audioWindow.AudioContext || audioWindow.webkitAudioContext;
        if (!AudioContextClass) {
          console.warn("Web Audio API unavailable");
          return "unavailable";
        }
        this.audio = new AudioContextClass();
        console.log("AudioContext created");
        this.masterGain = this.audio.createGain();
        this.masterGain.gain.value = this.muted ? 0 : 0.55;
        this.masterGain.connect(this.audio.destination);
      }

      if (this.audio.state !== "running") {
        await this.audio.resume();
      }

      console.log("AudioContext resumed");
      this.unlocked = this.audio.state === "running";
      if (this.unlocked) {
        this.muted = false;
        if (this.masterGain) {
          this.masterGain.gain.setTargetAtTime(
            0.55,
            this.audio.currentTime,
            0.02,
          );
        }
        this.playTestBeep();
        this.startHum();
        this.startMusic();
      } else {
        console.warn("Audio did not start:", this.audio.state);
      }
      return this.audio.state;
    } catch (error) {
      console.error("Audio init failed", error);
      this.unlocked = false;
      return "interrupted";
    }
  }

  isUnlocked() {
    return this.unlocked;
  }

  isMuted() {
    return this.muted;
  }

  isRunning() {
    return this.unlocked && this.audio?.state === "running";
  }

  getAudioState() {
    return this.audio?.state ?? "closed";
  }

  startHum() {
    if (
      !this.audio ||
      this.audio.state !== "running" ||
      !this.masterGain ||
      this.muted ||
      this.humOscillators.length
    ) {
      return;
    }

    this.humGain = this.audio.createGain();
    this.humGain.gain.value = this.muted ? 0 : 0.04;
    this.humGain.connect(this.masterGain);

    const low = this.audio.createOscillator();
    low.type = "sine";
    low.frequency.value = 42;
    low.connect(this.humGain);
    low.start();

    const air = this.audio.createOscillator();
    air.type = "triangle";
    air.frequency.value = 84;
    air.connect(this.humGain);
    air.start();

    this.humOscillators = [low, air];
    console.log("Ambient hum started");
  }

  stopHum() {
    for (let i = 0; i < this.humOscillators.length; i++) {
      this.humOscillators[i].stop();
      this.humOscillators[i].disconnect();
    }
    this.humOscillators = [];
    this.humGain?.disconnect();
    this.humGain = null;
  }

  startMusic() {
    if (
      !this.audio ||
      this.audio.state !== "running" ||
      !this.masterGain ||
      this.muted ||
      this.musicOscillators.length
    ) {
      return;
    }

    this.musicGain = this.audio.createGain();
    this.musicGain.gain.value = this.muted ? 0 : 0.11;
    this.musicGain.connect(this.masterGain);

    for (let i = 0; i < 5; i++) {
      const osc = this.audio.createOscillator();
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.frequency.value = 55;
      osc.detune.value = (i - 2) * 3;
      osc.connect(this.musicGain);
      osc.start();
      this.musicOscillators.push(osc);
    }

    this.scheduleMusicChord();
    this.musicTimer = window.setInterval(() => {
      this.scheduleMusicChord();
    }, 7800);
    console.log("Background music started");
  }

  stopMusic() {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    for (let i = 0; i < this.musicOscillators.length; i++) {
      this.musicOscillators[i].stop();
      this.musicOscillators[i].disconnect();
    }
    this.musicOscillators = [];
    this.musicGain?.disconnect();
    this.musicGain = null;
  }

  setMuted(value: boolean) {
    this.muted = value;
    if (this.masterGain && this.audio) {
      const gain = value ? 0 : 0.55;
      this.masterGain.gain.setTargetAtTime(gain, this.audio.currentTime, 0.04);
    }
    if (value) {
      this.stopHum();
      this.stopMusic();
    } else if (this.unlocked && this.audio?.state === "running") {
      this.startHum();
      this.startMusic();
    }
  }

  updateHum(massRatio: number) {
    if (!this.audio || !this.humGain || this.muted) return;
    const time = this.audio.currentTime;
    this.humGain.gain.setTargetAtTime(0.036 + massRatio * 0.05, time, 0.18);
    if (this.humOscillators[0]) {
      this.humOscillators[0].frequency.setTargetAtTime(38 + massRatio * 18, time, 0.24);
    }
    if (this.humOscillators[1]) {
      this.humOscillators[1].frequency.setTargetAtTime(78 + massRatio * 24, time, 0.24);
    }
  }

  playAbsorb(massRatio: number) {
    if (!this.audio || this.audio.state !== "running" || !this.masterGain) {
      console.log("Absorb sound blocked because audio is locked");
      return;
    }
    if (this.muted) return;
    const now = this.audio.currentTime;
    if (now - this.lastAbsorbAt < 0.045) return;
    this.lastAbsorbAt = now;
    console.log("Playing absorb sound");

    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(240 + massRatio * 140, now);
    osc.frequency.exponentialRampToValueAtTime(54 + massRatio * 42, now + 0.3);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.36);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  playCollision(intensity: number) {
    if (!this.audio || !this.masterGain || this.muted || intensity < 0.34) return;
    const now = this.audio.currentTime;
    if (now - this.lastCollisionAt < 0.075) return;
    this.lastCollisionAt = now;

    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.type = "triangle";
    osc.frequency.value = 420 + intensity * 360;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.012 + intensity * 0.018, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.09);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  playSupernova() {
    if (
      !this.audio ||
      this.audio.state !== "running" ||
      !this.masterGain ||
      this.muted
    ) {
      return;
    }
    const now = this.audio.currentTime;
    console.log("Playing supernova sound");

    const bass = this.audio.createOscillator();
    const bassGain = this.audio.createGain();
    bass.type = "triangle";
    bass.frequency.setValueAtTime(55, now);
    bass.frequency.exponentialRampToValueAtTime(28, now + 0.6);
    bassGain.gain.setValueAtTime(0.0001, now);
    bassGain.gain.exponentialRampToValueAtTime(0.42, now + 0.025);
    bassGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);
    bass.connect(bassGain);
    bassGain.connect(this.masterGain);
    bass.start(now);
    bass.stop(now + 0.65);

    const crack = this.audio.createOscillator();
    const crackGain = this.audio.createGain();
    crack.type = "sawtooth";
    crack.frequency.setValueAtTime(620, now);
    crack.frequency.exponentialRampToValueAtTime(1200, now + 0.12);
    crackGain.gain.setValueAtTime(0.0001, now);
    crackGain.gain.exponentialRampToValueAtTime(0.09, now + 0.012);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    crack.connect(crackGain);
    crackGain.connect(this.masterGain);
    crack.start(now);
    crack.stop(now + 0.13);

    const noiseLength = Math.max(1, Math.floor(this.audio.sampleRate * 0.8));
    const noiseBuffer = this.audio.createBuffer(
      1,
      noiseLength,
      this.audio.sampleRate,
    );
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseLength; i++) {
      channel[i] = Math.random() * 2 - 1;
    }
    const noise = this.audio.createBufferSource();
    const noiseFilter = this.audio.createBiquadFilter();
    const noiseGain = this.audio.createGain();
    noise.buffer = noiseBuffer;
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.setValueAtTime(980, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(180, now + 0.8);
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.24, now + 0.04);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.82);

    bass.onended = () => {
      bass.disconnect();
      bassGain.disconnect();
    };
    crack.onended = () => {
      crack.disconnect();
      crackGain.disconnect();
    };
    noise.onended = () => {
      noise.disconnect();
      noiseFilter.disconnect();
      noiseGain.disconnect();
    };
  }

  dispose() {
    this.stopHum();
    this.stopMusic();
    void this.audio?.close();
    this.audio = null;
    this.masterGain = null;
    this.unlocked = false;
  }

  private scheduleMusicChord() {
    if (!this.audio || !this.musicGain || this.musicOscillators.length === 0) {
      return;
    }

    const chords = [
      [55, 82.41, 110, 164.81, 220],
      [49, 73.42, 98, 146.83, 196],
      [41.2, 61.74, 82.41, 123.47, 164.81],
      [46.25, 69.3, 92.5, 138.59, 185],
    ];
    const chord = chords[this.musicStep % chords.length];
    const time = this.audio.currentTime;

    this.musicGain.gain.setTargetAtTime(0.13, time, 1.6);
    for (let i = 0; i < this.musicOscillators.length; i++) {
      this.musicOscillators[i].frequency.setTargetAtTime(
        chord[i],
        time,
        2.4,
      );
    }
    this.musicStep += 1;
  }

  private playTestBeep() {
    if (
      !this.audio ||
      !this.masterGain ||
      this.muted ||
      this.testBeepPlayed
    ) {
      return;
    }

    this.testBeepPlayed = true;
    const now = this.audio.currentTime;
    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.type = "sine";
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.12);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
}

const createBlankBall = (): GravityBall => ({
  active: false,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  radius: MIN_RADIUS,
  mass: MIN_RADIUS * MIN_RADIUS,
  color: palette[0].color,
  glow: palette[0].glow,
  slowTime: 0,
});

const createBlankExplosionParticle = (): ExplosionParticle => ({
  active: false,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  life: 0,
  maxLife: 1,
  radius: 1,
  color: "rgba(125, 249, 255, ALPHA)",
});

const createBlankTrailParticle = (): TrailParticle => ({
  active: false,
  x: 0,
  y: 0,
  life: 0,
  maxLife: 1,
  radius: 1,
  color: "rgba(125, 249, 255, ALPHA)",
});

const createBlankShockwave = (): ShockwaveRing => ({
  active: false,
  x: 0,
  y: 0,
  age: 0,
  duration: 0.68,
  maxRadius: 0,
  width: 8,
  alpha: 0.5,
});

const clampSpeed = (ball: GravityBall) => {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed <= MAX_SPEED) return;
  const scale = MAX_SPEED / speed;
  ball.vx *= scale;
  ball.vy *= scale;
};

const enforceMinimumSpeed = (
  ball: GravityBall,
  blackHole: BlackHole,
  dt: number,
  minSpeedScale = 1,
) => {
  const minSpeed = MIN_SPEED * minSpeedScale;
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed >= minSpeed) {
    ball.slowTime = 0;
    return;
  }

  const dx = blackHole.x - ball.x;
  const dy = blackHole.y - ball.y;
  const distance = Math.hypot(dx, dy) || 1;
  const nx = dx / distance;
  const ny = dy / distance;
  const directionX = speed > 0.001 ? ball.vx / speed : -ny;
  const directionY = speed > 0.001 ? ball.vy / speed : nx;
  const boostScale = minSpeed / Math.max(speed, 1);

  ball.vx = directionX * speed * boostScale;
  ball.vy = directionY * speed * boostScale;
  ball.slowTime += dt;

  if (ball.slowTime > 0.5) {
    const impulse = minSpeed * 0.42;
    const massScale = blackHole.radius / BASE_HOLE_RADIUS;
    ball.vx += (-ny * 0.75 - nx * 0.25) * impulse * massScale;
    ball.vy += (nx * 0.75 - ny * 0.25) * impulse * massScale;
    ball.slowTime = 0;
  }
};

const createBlackHole = (arena: Arena, balls: GravityBall[] = []): BlackHole => {
  const isMobile = arena.width < 600;
  const initialRadius = randomBetween(isMobile ? 5 : 8, isMobile ? 7 : 12);
  const minX = arena.width * (isMobile ? 0.3 : 0.25);
  const maxX = arena.width * (isMobile ? 0.7 : 0.75);
  const minY = arena.height * (isMobile ? 0.28 : 0.25);
  const maxY = arena.height * (isMobile ? 0.72 : 0.75);
  const backButtonSafeX = 190;
  const backButtonSafeY = 82;
  let x = arena.width / 2;
  let y = arena.height / 2;

  for (let attempt = 0; attempt < 10; attempt++) {
    const candidateX = randomBetween(minX, maxX);
    const candidateY = randomBetween(minY, maxY);
    let isSafe = true;

    if (candidateX < backButtonSafeX && candidateY < backButtonSafeY) {
      isSafe = false;
    }

    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      if (!ball.active) continue;
      if (Math.hypot(candidateX - ball.x, candidateY - ball.y) < 95) {
        isSafe = false;
        break;
      }
    }

    x = candidateX;
    y = candidateY;
    if (isSafe) break;
  }

  return {
    x,
    y,
    radius: initialRadius,
    targetRadius: initialRadius,
    strength: BASE_GRAVITY * 0.05,
    mass: 1,
    rotationAngle: randomBetween(0, Math.PI * 2),
    rotationSpeed: randomBetween(0.42, 0.52),
  };
};

const resetOrbitBall = (
  ball: GravityBall,
  arena: Arena,
  index: number,
  speedScale: number,
) => {
  const radius = randomBetween(MIN_RADIUS, MAX_RADIUS);
  const angle = randomBetween(0, Math.PI * 2);
  const orbitRadius = randomBetween(
    Math.min(arena.width, arena.height) * 0.22,
    Math.min(arena.width, arena.height) * 0.45,
  );
  const speed = randomBetween(120, 285);
  const tone = palette[index % palette.length];

  ball.active = true;
  ball.x = arena.width / 2 + Math.cos(angle) * orbitRadius;
  ball.y = arena.height / 2 + Math.sin(angle) * orbitRadius;
  ball.vx =
    (Math.cos(angle + Math.PI / 2) * speed + randomBetween(-90, 90)) *
    BALL_SPEED_SCALE *
    speedScale;
  ball.vy =
    (Math.sin(angle + Math.PI / 2) * speed + randomBetween(-90, 90)) *
    BALL_SPEED_SCALE *
    speedScale;
  ball.radius = radius;
  ball.mass = radius * radius;
  ball.color = tone.color;
  ball.glow = tone.glow;
  ball.slowTime = 0;
};

const resetExplosionBall = (
  ball: GravityBall,
  arena: Arena,
  index: number,
  speedScale: number,
  explosionScale: number,
  originX = arena.width / 2,
  originY = arena.height / 2,
) => {
  const radius = randomBetween(MIN_RADIUS, MAX_RADIUS);
  const angle = (index / BALL_COUNT) * Math.PI * 2 + randomBetween(-0.16, 0.16);
  const speed = randomBetween(430, 760);
  const tone = palette[index % palette.length];

  ball.active = true;
  ball.x = originX + Math.cos(angle) * (BASE_HOLE_RADIUS + radius + 4);
  ball.y = originY + Math.sin(angle) * (BASE_HOLE_RADIUS + radius + 4);
  ball.vx =
      (Math.cos(angle) * speed + randomBetween(-70, 70)) *
      BALL_SPEED_SCALE *
      EXPLOSION_LAUNCH_SCALE *
      speedScale *
      explosionScale;
  ball.vy =
    (Math.sin(angle) * speed + randomBetween(-70, 70)) *
    BALL_SPEED_SCALE *
    EXPLOSION_LAUNCH_SCALE *
    speedScale *
    explosionScale;
  ball.radius = radius;
  ball.mass = radius * radius;
  ball.color = tone.color;
  ball.glow = tone.glow;
  ball.slowTime = 0;
};

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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

const resolveWallCollision = (ball: GravityBall, arena: Arena) => {
  if (ball.x - ball.radius < 0) {
    ball.x = ball.radius;
    ball.vx = Math.abs(ball.vx) * WALL_RESTITUTION;
  } else if (ball.x + ball.radius > arena.width) {
    ball.x = arena.width - ball.radius;
    ball.vx = -Math.abs(ball.vx) * WALL_RESTITUTION;
  }

  if (ball.y - ball.radius < 0) {
    ball.y = ball.radius;
    ball.vy = Math.abs(ball.vy) * WALL_RESTITUTION;
  } else if (ball.y + ball.radius > arena.height) {
    ball.y = arena.height - ball.radius;
    ball.vy = -Math.abs(ball.vy) * WALL_RESTITUTION;
  }
};

const resolveBallCollision = (ballA: GravityBall, ballB: GravityBall) => {
  const dx = ballB.x - ballA.x;
  const dy = ballB.y - ballA.y;
  const distance = Math.hypot(dx, dy) || 1;
  const minDistance = ballA.radius + ballB.radius;

  if (distance >= minDistance) return 0;

  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = minDistance - distance;
  const totalMass = ballA.mass + ballB.mass;

  ballA.x -= nx * overlap * (ballB.mass / totalMass);
  ballA.y -= ny * overlap * (ballB.mass / totalMass);
  ballB.x += nx * overlap * (ballA.mass / totalMass);
  ballB.y += ny * overlap * (ballA.mass / totalMass);

  const relativeVx = ballB.vx - ballA.vx;
  const relativeVy = ballB.vy - ballA.vy;
  const velocityAlongNormal = relativeVx * nx + relativeVy * ny;

  if (velocityAlongNormal > 0) return 0;
  const impact = Math.min(1, Math.abs(velocityAlongNormal) / 260);

  const impulse =
    (-(1 + BALL_RESTITUTION) * velocityAlongNormal) /
    (1 / ballA.mass + 1 / ballB.mass);

  ballA.vx -= (impulse * nx) / ballA.mass;
  ballA.vy -= (impulse * ny) / ballA.mass;
  ballB.vx += (impulse * nx) / ballB.mass;
  ballB.vy += (impulse * ny) / ballB.mass;

  clampSpeed(ballA);
  clampSpeed(ballB);
  return impact;
};

const drawBackground = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  time: number,
  blackHole: BlackHole,
  alpha = 1,
) => {
  const { width, height } = arena;
  const massGlow = Math.min(1, (blackHole.mass - 1) / BALL_COUNT);
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
  ctx.fillStyle = `rgba(0, 0, 0, ${darkening * alpha})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
};

const drawBlackHole = (
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
  const coreRadius = blackHole.radius * visualScale;
  const ringRadius = coreRadius * (1.82 + pulse * 0.06);
  const glowScale = 0.72 + visualScale * 0.28 + awakeningPulse;
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

  const distortion = ctx.createRadialGradient(0, 0, coreRadius * 0.95, 0, 0, coreRadius * 3.35);
  distortion.addColorStop(0, "rgba(0, 0, 0, 0)");
  distortion.addColorStop(0.48, `rgba(255, 255, 255, ${0.065 + massRatio * 0.06})`);
  distortion.addColorStop(0.54, `rgba(125, 249, 255, ${0.028 + massRatio * 0.04})`);
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
    ctx.arc(Math.cos(angle) * radius, Math.sin(angle) * radius, size, 0, Math.PI * 2);
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

const drawExplosion = (
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
      ctx.arc(
        ring.x,
        ring.y,
        ring.maxRadius * progress,
        0,
        Math.PI * 2,
      );
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
      isRedMood
        ? "rgba(255, 60, 90, 0)"
        : "rgba(90, 240, 255, 0)",
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

const drawBall = (
  ctx: CanvasRenderingContext2D,
  ball: GravityBall,
  visualScale: number,
) => {
  const radius = ball.radius * visualScale;
  const glowAlpha = 0.55 + visualScale * 0.45;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  if (!performanceMode || ball.radius > 14) {
    ctx.shadowColor = ball.glow;
    ctx.shadowBlur = radius * (performanceMode ? 0.52 : 1.2) * glowAlpha;
  }

  if (performanceMode && ball.radius <= 14) {
    ctx.fillStyle = ball.color;
  } else {
    const body = ctx.createRadialGradient(
      ball.x - radius * 0.34,
      ball.y - radius * 0.42,
      radius * 0.1,
      ball.x,
      ball.y,
      radius,
    );
    body.addColorStop(0, "rgba(255, 255, 255, 1)");
    body.addColorStop(0.14, "rgba(224, 250, 255, 0.92)");
    body.addColorStop(0.34, ball.color);
    body.addColorStop(1, "rgba(2, 6, 23, 0.9)");
    ctx.fillStyle = body;
  }

  ctx.beginPath();
  ctx.arc(ball.x, ball.y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = !performanceMode || ball.radius > 14 ? radius * 0.26 : 0;
  ctx.strokeStyle = ball.glow;
  ctx.lineWidth = Math.max(0.7, 1.15 * visualScale);
  ctx.stroke();
  ctx.restore();
};

const drawTrails = (
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

const Circle = () => {
  const [hudStats, setHudStats] = useState<HudStats>({
    mass: 1,
    stability: 100,
    charge: 0,
    stage: "Dormant",
  });
  const [showSoundPrompt, setShowSoundPrompt] = useState(true);
  const gravityWellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const soundRef = useRef<SoundManager | null>(null);
  const ballsRef = useRef<GravityBall[]>(
    Array.from({ length: MAX_BALLS }, createBlankBall),
  );
  const explosionParticlesRef = useRef<ExplosionParticle[]>(
    Array.from({ length: MAX_EXPLOSION_PARTICLES }, createBlankExplosionParticle),
  );
  const trailParticlesRef = useRef<TrailParticle[]>(
    Array.from({ length: MAX_TRAIL_PARTICLES }, createBlankTrailParticle),
  );
  const shockwavesRef = useRef<ShockwaveRing[]>(
    Array.from({ length: MAX_SHOCKWAVES }, createBlankShockwave),
  );
  const blackHoleRef = useRef<BlackHole | null>(null);
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
        arena.width < 600 ? MOBILE_EXPLOSION_PARTICLE_COUNT : EXPLOSION_PARTICLE_COUNT;

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
      const maxDimension = Math.max(arenaRef.current.width, arenaRef.current.height);
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
      blackHoleRef.current = createBlackHole(
        arenaRef.current,
        ballsRef.current,
      );
      cycleRef.current = {
        phase: "calm",
        phaseStartedAt: performance.now() / 1000,
        shockwaveAt: -Infinity,
      };
    };

    const absorbBall = (blackHole: BlackHole, ball: GravityBall) => {
      const scale = getPhysicsScale(arenaRef.current);
      ball.active = false;
      blackHole.mass += 1;
      blackHole.targetRadius +=
        Math.max(2.2, ball.radius * 0.24) * scale.growthScale;
      blackHole.strength += (19000 + ball.mass * 14) * scale.growthScale;
      soundRef.current?.playAbsorb(Math.min(1, (blackHole.mass - 1) / BALL_COUNT));
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

    const stepPhysics = (dt: number, time: number) => {
      const arena = arenaRef.current;
      const blackHole = blackHoleRef.current;
      const cycle = cycleRef.current;
      if (!blackHole) return;
      const scale = getPhysicsScale(arena);
      const phaseAge = time - cycle.phaseStartedAt;
      const awakeningProgress =
        cycle.phase === "awakening"
          ? Math.min(1, phaseAge / scale.awakeningDuration)
          : cycle.phase === "active" || cycle.phase === "collapse"
            ? 1
            : 0;
      const gravityMultiplier =
        cycle.phase === "calm"
          ? 0.05
          : cycle.phase === "awakening"
            ? 0.05 + awakeningProgress * 0.4
            : 1;
      const absorptionEnabled =
        cycle.phase === "active" ||
        (cycle.phase === "awakening" && awakeningProgress >= 0.7);

      blackHole.rotationAngle =
        (blackHole.rotationAngle + blackHole.rotationSpeed * dt) %
        (Math.PI * 2);
      blackHole.radius += (blackHole.targetRadius - blackHole.radius) * 0.055;

      if (cycle.phase === "collapse") {
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
          blackHoleRef.current = createBlackHole(
            arenaRef.current,
            ballsRef.current,
          );
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
      for (let i = 0; i < balls.length; i++) {
        const ball = balls[i];
        if (!ball.active) continue;

        const dx = blackHole.x - ball.x;
        const dy = blackHole.y - ball.y;
        const actualDistance = Math.hypot(dx, dy) || 1;
        const nx = dx / actualDistance;
        const ny = dy / actualDistance;
        const influenceRadius =
          blackHole.radius * 7 * scale.gravityScale * gravityMultiplier;
        const absorbRadius = blackHole.radius + ball.radius * 0.5;

        if (
          absorptionEnabled &&
          actualDistance < absorbRadius
        ) {
          absorbBall(blackHole, ball);
          continue;
        }

        if (actualDistance < influenceRadius) {
          const cycleAge = time - cycle.phaseStartedAt;
          const earlyCycleDamping =
            cycle.phase === "active" && cycleAge < scale.minCycleTime
              ? 0.55 + 0.45 * (cycleAge / scale.minCycleTime)
              : 1;
          const normalizedDistance = Math.min(
            1,
            Math.max(0, actualDistance / influenceRadius),
          );
          const innerPull = 1 - normalizedDistance;
          const tx = -ny;
          const ty = nx;
          const mobileOrbitScale = arena.width < 600 ? 0.74 : 1;
          const baseForce =
            blackHole.strength *
            (blackHole.radius / BASE_HOLE_RADIUS) *
            scale.gravityScale *
            gravityMultiplier *
            earlyCycleDamping;
          const orbitStrength =
            (42 + blackHole.mass * 2.8) *
            (0.35 + normalizedDistance * 0.95) *
            gravityMultiplier *
            mobileOrbitScale *
            dt;
          const inwardStrength =
            baseForce *
            (0.08 + innerPull * innerPull * 0.92) *
            (arena.width < 600 ? 0.72 : 1) *
            dt *
            0.0065;

          ball.vx += tx * orbitStrength + nx * inwardStrength;
          ball.vy += ty * orbitStrength + ny * inwardStrength;
          ball.vx *= 0.998;
          ball.vy *= 0.998;

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

        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
        resolveWallCollision(ball, arena);

        if (absorptionEnabled) {
          const postMoveDistance = Math.hypot(
            ball.x - blackHole.x,
            ball.y - blackHole.y,
          );
          if (postMoveDistance < absorbRadius) {
            absorbBall(blackHole, ball);
            continue;
          }
        }

        enforceMinimumSpeed(ball, blackHole, dt, scale.speedScale);
        clampSpeed(ball);

        if (
          absorptionEnabled &&
          Math.hypot(ball.x - blackHole.x, ball.y - blackHole.y) <
            absorbRadius
        ) {
          absorbBall(blackHole, ball);
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
        enforceMinimumSpeed(ball, blackHole, dt, scale.speedScale);
        clampSpeed(ball);
      }

      if (
        cycle.phase === "active" &&
        activeCount === 0
      ) {
        cycleRef.current = {
          phase: "collapse",
          phaseStartedAt: time,
          shockwaveAt: cycle.shockwaveAt,
        };
      }
    };

    const updateHud = (time: number) => {
      const blackHole = blackHoleRef.current;
      const cycle = cycleRef.current;
      if (!blackHole || time - lastHudUpdateRef.current < HUD_UPDATE_INTERVAL) {
        return;
      }

      lastHudUpdateRef.current = time;
      const absorbedCount = Math.max(0, Math.round(blackHole.mass - 1));
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

      setHudStats({
        mass: absorbedCount,
        stability,
        charge,
        stage: getHungerStage(absorbedCount),
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
      const cycle = cycleRef.current;
      if (!blackHole) return;
      const renderScale = getPhysicsScale(arena);

      const time = timeMs / 1000;
      const previous = lastTimeRef.current || timeMs;
      const dt = Math.min((timeMs - previous) / 1000, 0.032);
      lastTimeRef.current = timeMs;

      const collapseAge =
        cycle.phase === "collapse" ? time - cycle.phaseStartedAt : 0;
      const explosionAge = time - cycle.shockwaveAt;
      const isMobile = arena.width < 600;
      const shake =
        Math.max(0, 1 - collapseAge / COLLAPSE_PAUSE) *
          (cycle.phase === "collapse" ? (isMobile ? 2.5 : 4.5) : 0) +
        Math.max(0, 1 - explosionAge / SHAKE_DURATION) * (isMobile ? 4 : 8);
      const shakeX = shake ? randomBetween(-shake, shake) : 0;
      const shakeY = shake ? randomBetween(-shake, shake) : 0;

      ctx.setTransform(arena.dpr, 0, 0, arena.dpr, shakeX, shakeY);
      ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = "rgba(3, 7, 18, 0.18)";
      ctx.fillRect(-shakeX, -shakeY, arena.width + 24, arena.height + 24);
      drawBackground(ctx, arena, time, blackHole, 0.24);

      stepPhysics(dt, time);
      updateHud(time);
      soundRef.current?.updateHum(Math.min(1, (blackHole.mass - 1) / BALL_COUNT));
      drawTrails(ctx, trailParticlesRef.current, dt, renderScale.visualScale);
      for (let i = 0; i < ballsRef.current.length; i++) {
        const ball = ballsRef.current[i];
        if (ball.active) drawBall(ctx, ball, renderScale.visualScale);
      }
      drawBlackHole(
        ctx,
        blackHole,
        time,
        cycleRef.current,
        renderScale.blackHoleVisualScale,
      );
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
    window.addEventListener("resize", resetArena);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      removeUnlockListeners();
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
        : hudStats.stage === "Critical" || hudStats.charge >= 76
          ? "CRITICAL MASS"
          : hudStats.charge >= 60
            ? `SUPERNOVA ${roundedMobileCharge}%`
            : "";
  return (
    <div
      ref={gravityWellRef}
      className="gravity-well"
    >
      <canvas ref={canvasRef} className="gravity-canvas" />
      {showSoundPrompt ? (
        <div className="sound-prompt" aria-hidden="true">
          Tap to enable sound
        </div>
      ) : null}
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
      {mobileStatus ? (
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
        }

        .gravity-canvas {
          display: block;
          width: 100%;
          height: 100%;
        }

        .gravity-stats {
          position: fixed;
          left: 16px;
          bottom: 16px;
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
      `}</style>
    </div>
  );
};

export default Circle;
