"use client";

import React, { useEffect, useRef, useState } from "react";

type Country = {
  name: string;
  flag: string;
  color: string;
};

type Result = {
  country: Country;
  time: number | null;
};

type Arena = {
  x: number;
  y: number;
  radius: number;
  canvasWidth: number;
  canvasHeight: number;
};

type Ball = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  escaped: boolean;
  stuck: boolean;
};

type TrailPoint = {
  x: number;
  y: number;
};

type RoundUi = {
  phase: "intro" | "playing" | "complete";
  countryIndex: number;
  elapsed: number;
  message: string;
};

type ChallengeAudio = {
  unlock: () => Promise<void>;
  playRoundStart: () => void;
  playBounce: () => void;
  playEscape: () => void;
  playVictory: () => void;
  dispose: () => void;
};

const COUNTRY_POOL: Country[] = [
  { name: "India", flag: "🇮🇳", color: "#f97316" },
  { name: "USA", flag: "🇺🇸", color: "#38bdf8" },
  { name: "Japan", flag: "🇯🇵", color: "#f8fafc" },
  { name: "Brazil", flag: "🇧🇷", color: "#22c55e" },
  { name: "Germany", flag: "🇩🇪", color: "#facc15" },
  { name: "France", flag: "🇫🇷", color: "#60a5fa" },
  { name: "Canada", flag: "🇨🇦", color: "#ef4444" },
  { name: "Australia", flag: "🇦🇺", color: "#2563eb" },
  { name: "South Korea", flag: "🇰🇷", color: "#f8fafc" },
  { name: "Italy", flag: "🇮🇹", color: "#22c55e" },
  { name: "Spain", flag: "🇪🇸", color: "#facc15" },
  { name: "Mexico", flag: "🇲🇽", color: "#16a34a" },
  { name: "Argentina", flag: "🇦🇷", color: "#7dd3fc" },
  { name: "China", flag: "🇨🇳", color: "#ef4444" },
  { name: "United Kingdom", flag: "🇬🇧", color: "#60a5fa" },
  { name: "South Africa", flag: "🇿🇦", color: "#22c55e" },
  { name: "Netherlands", flag: "🇳🇱", color: "#f97316" },
  { name: "Sweden", flag: "🇸🇪", color: "#38bdf8" },
  { name: "Norway", flag: "🇳🇴", color: "#ef4444" },
  { name: "Turkey", flag: "🇹🇷", color: "#dc2626" },
  { name: "Egypt", flag: "🇪🇬", color: "#f8fafc" },
];

const COUNTRY_COUNT = 5;

const ROUND_LIMIT = 4;
const GAP_SIZE_RATIO = 0.0536;
const GAP_ROTATION_SPEED = 0.7;
const BALL_SPEED_RATIO = 2;
const MAX_DT = 1 / 30;
const TRAIL_MAX_POINTS = 100;
const TRAIL_FADE_SPEED = 0.42;

const COUNTRY_TRAIL_COLORS: Record<string, string> = {
  India: "#ff9f45",
  USA: "#7dd3fc",
  Japan: "#f9a8d4",
  Brazil: "#86efac",
  Germany: "#f6c453",
  France: "#93c5fd",
  Canada: "#fb7185",
  Australia: "#818cf8",
  "South Korea": "#c4b5fd",
  Italy: "#4ade80",
  Spain: "#fbbf24",
  Mexico: "#34d399",
  Argentina: "#67e8f9",
  China: "#f87171",
  "United Kingdom": "#60a5fa",
  "South Africa": "#a3e635",
  Netherlands: "#fb923c",
  Sweden: "#38bdf8",
  Norway: "#f43f5e",
  Turkey: "#ef4444",
  Egypt: "#fca5a5",
};

let sharedAudioContext: AudioContext | null = null;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const hexToRgba = (hex: string, alpha: number) => {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
};

const getTrailColor = (country: Country) =>
  COUNTRY_TRAIL_COLORS[country.name] ?? country.color;

const getRandomCountries = () =>
  [...COUNTRY_POOL].sort(() => Math.random() - 0.5).slice(0, COUNTRY_COUNT);

const normalizeAngle = (angle: number) => {
  const full = Math.PI * 2;
  return ((angle % full) + full) % full;
};

const angleDistance = (first: number, second: number) => {
  const diff = Math.abs(normalizeAngle(first) - normalizeAngle(second));
  return Math.min(diff, Math.PI * 2 - diff);
};

const resizeCanvas = (canvas: HTMLCanvasElement): Arena => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  const ctx = canvas.getContext("2d");
  const isMobile = width < 680;
  const topReserve = isMobile ? 120 : 110;
  const bottomReserve = isMobile ? 118 : 74;
  const availableHeight = Math.max(260, height - topReserve - bottomReserve);
  const diameter = clamp(
    Math.min(width * 0.82, availableHeight * 0.98) * 0.82,
    210,
    560,
  );
  const radius = diameter / 2;
  const x = width / 2;
  const y = topReserve + availableHeight / 2;

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  if (ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
  }

  return { x, y, radius, canvasWidth: width, canvasHeight: height };
};

const createAudio = (): ChallengeAudio => {
  let audio: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let lastBounceAt = 0;
  const calmPianoNotes = [261.63, 293.66, 329.63, 392, 440, 523.25];

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
    masterGain.gain.value = 0.32;
    masterGain.connect(audio.destination);
    return audio;
  };

  const tone = (
    frequency: number,
    duration: number,
    gainValue: number,
    type: OscillatorType = "sine",
  ) => {
    const context = ensureAudio();
    if (!context || context.state !== "running" || !masterGain) return;

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(80, frequency * 0.78),
      now + duration,
    );
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainValue, now + 0.01);
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

  const playCalmPiano = (frequency: number) => {
    const context = ensureAudio();
    if (!context || context.state !== "running" || !masterGain) return;

    const now = context.currentTime;
    const outputGain = context.createGain();
    const filter = context.createBiquadFilter();
    const harmonics = [
      { ratio: 1, gain: 0.15 },
      { ratio: 2, gain: 0.06 },
      { ratio: 3, gain: 0.024 },
    ];

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(3000, now);
    filter.frequency.exponentialRampToValueAtTime(1100, now + 0.45);
    outputGain.gain.setValueAtTime(0.0001, now);
    outputGain.gain.linearRampToValueAtTime(0.34, now + 0.008);
    outputGain.gain.exponentialRampToValueAtTime(0.11, now + 0.08);
    outputGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);
    outputGain.connect(filter);
    filter.connect(masterGain);

    harmonics.forEach((harmonic, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = index === 0 ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(
        frequency * harmonic.ratio * (0.998 + Math.random() * 0.004),
        now,
      );
      gain.gain.setValueAtTime(harmonic.gain, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48 + index * 0.04);
      oscillator.connect(gain);
      gain.connect(outputGain);
      oscillator.start(now);
      oscillator.stop(now + 0.68);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    });

    window.setTimeout(() => {
      outputGain.disconnect();
      filter.disconnect();
    }, 760);
  };

  return {
    unlock: async () => {
      const context = ensureAudio();
      if (!context) return;
      if (context.state === "suspended") {
        await context.resume();
      }
    },
    playRoundStart: () => {
      tone(260, 0.16, 0.09, "triangle");
      window.setTimeout(() => tone(390, 0.18, 0.08, "triangle"), 42);
    },
    playBounce: () => {
      const context = ensureAudio();
      if (!context) return;
      const now = context.currentTime;
      if (now - lastBounceAt < 0.06) return;
      lastBounceAt = now;
      playCalmPiano(
        calmPianoNotes[Math.floor(Math.random() * calmPianoNotes.length)],
      );
    },
    playEscape: () => {
      [523.25, 659.25, 783.99, 1046.5].forEach((note, index) => {
        window.setTimeout(() => tone(note, 0.22, 0.09, "triangle"), index * 70);
      });
    },
    playVictory: () => {
      [392, 493.88, 587.33, 783.99].forEach((note, index) => {
        window.setTimeout(() => tone(note, 0.32, 0.1, "triangle"), index * 90);
      });
    },
    dispose: () => {
      masterGain?.disconnect();
      masterGain = null;
      audio = null;
    },
  };
};

const getBallRadius = (arena: Arena) => clamp(arena.radius * 0.063, 10, 17);

const getHudTop = (arena: Arena) =>
  Math.round(arena.y - arena.radius - getBallRadius(arena) * 4 - 86);

const getStartTop = (arena: Arena) =>
  Math.round(arena.y + arena.radius + getBallRadius(arena) * 1.55);

const createBall = (arena: Arena): Ball => {
  const radius = getBallRadius(arena);
  const spawnAngle = Math.random() * Math.PI * 2;
  const spawnRadius = Math.sqrt(Math.random()) * (arena.radius - radius * 2.4);

  return {
    x: arena.x + Math.cos(spawnAngle) * spawnRadius,
    y: arena.y + Math.sin(spawnAngle) * spawnRadius,
    vx: 0,
    vy: 0,
    radius,
    escaped: false,
    stuck: false,
  };
};

const isAngleInsideGap = (angle: number, gapCenter: number, gapSize: number) =>
  angleDistance(angle, gapCenter) <= gapSize / 2;

const preserveSpeed = (ball: Ball, arena: Arena, multiplier = 1) => {
  const speed = arena.radius * BALL_SPEED_RATIO * multiplier;
  const current = Math.hypot(ball.vx, ball.vy) || 1;
  ball.vx = (ball.vx / current) * speed;
  ball.vy = (ball.vy / current) * speed;
};

const getLaunchAngleAwayFromExit = () => {
  const exitAngle = 0;
  let angle = Math.random() * Math.PI * 2;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    angle = Math.random() * Math.PI * 2;
    if (angleDistance(angle, exitAngle) > Math.PI / 3) {
      return angle;
    }
  }

  return Math.PI + (Math.random() - 0.5) * Math.PI;
};

const applyRandomBounce = (ball: Ball, angleRange = 0.6) => {
  const angle = (Math.random() - 0.5) * angleRange; // random small rotation
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const vx = ball.vx * cos - ball.vy * sin;
  const vy = ball.vx * sin + ball.vy * cos;
  ball.vx = vx;
  ball.vy = vy;
};

const resolveCountryCollisions = (
  balls: Array<Ball | null>,
  activeIndex: number,
  arena: Arena,
  playBounce: () => void,
) => {
  const activeBall = balls[activeIndex];
  if (!activeBall || activeBall.escaped || activeBall.stuck) return;

  balls.forEach((otherBall, index) => {
    if (index === activeIndex || !otherBall || otherBall.escaped) return;

    const dx = activeBall.x - otherBall.x;
    const dy = activeBall.y - otherBall.y;
    const minDistance = activeBall.radius + otherBall.radius;
    const distanceSq = dx * dx + dy * dy;

    if (distanceSq <= 0 || distanceSq >= minDistance * minDistance) return;

    const distance = Math.sqrt(distanceSq);
    const nx = dx / distance;
    const ny = dy / distance;
    const overlap = minDistance - distance;
    const velocityAlongNormal = activeBall.vx * nx + activeBall.vy * ny;

    activeBall.x += nx * (overlap + 0.8);
    activeBall.y += ny * (overlap + 0.8);

    if (velocityAlongNormal < 0) {
      activeBall.vx -= 2 * velocityAlongNormal * nx;
      activeBall.vy -= 2 * velocityAlongNormal * ny;
      preserveSpeed(activeBall, arena);
      applyRandomBounce(activeBall, 1.2);
      playBounce();
    }
  });
};

const drawArena = (
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  gapCenter: number,
  gapSize: number,
  balls: Array<Ball | null>,
  activeIndex: number,
  exitOrder: Result[],
  countries: Country[],
  escapePulse: number,
  trails: TrailPoint[][],
  trailFades: number[],
) => {
  ctx.clearRect(0, 0, arena.canvasWidth, arena.canvasHeight);
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, arena.canvasWidth, arena.canvasHeight);

  const bg = ctx.createRadialGradient(
    arena.x,
    arena.y,
    arena.radius * 0.1,
    arena.x,
    arena.y,
    arena.radius * 1.3,
  );
  bg.addColorStop(0, "rgba(34, 211, 238, 0.1)");
  bg.addColorStop(0.62, "rgba(15, 23, 42, 0.2)");
  bg.addColorStop(1, "rgba(2, 6, 23, 0)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, arena.canvasWidth, arena.canvasHeight);

  ctx.save();
  ctx.beginPath();
  ctx.arc(arena.x, arena.y, arena.radius - 3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(15, 23, 42, 0.36)";
  ctx.fill();
  ctx.restore();

  const start = gapCenter + gapSize / 2;
  const end = gapCenter - gapSize / 2 + Math.PI * 2;

  ctx.save();
  ctx.shadowColor = "rgba(125, 211, 252, 0.42)";
  ctx.shadowBlur = 18;
  ctx.strokeStyle = "rgba(148, 163, 184, 0.78)";
  ctx.lineWidth = clamp(arena.radius * 0.013, 3, 6);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(arena.x, arena.y, arena.radius, start, end, false);
  ctx.stroke();
  ctx.restore();

  // exit gap intentionally left empty (no glow)

  const drawTrailPass = (
    glow: boolean,
    trail: TrailPoint[],
    trailBall: Ball,
    color: string,
    fade: number,
  ) => {
    if (trail.length <= 1 || fade <= 0) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = color;

    if (trail.length === 2) {
      const width = trailBall.radius * 0.7;
      const opacity = 0.28 * fade;
      ctx.lineWidth = glow ? width * 1.7 : width * 0.58;
      ctx.shadowBlur = glow ? width * 2 : 0;
      ctx.strokeStyle = hexToRgba(color, glow ? opacity * 0.42 : opacity);
      ctx.beginPath();
      ctx.moveTo(trail[0].x, trail[0].y);
      ctx.lineTo(trail[1].x, trail[1].y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    for (let index = 1; index < trail.length - 1; index += 1) {
      const previous = trail[index - 1];
      const current = trail[index];
      const next = trail[index + 1];
      const startPoint = {
        x: (previous.x + current.x) / 2,
        y: (previous.y + current.y) / 2,
      };
      const endPoint = {
        x: (current.x + next.x) / 2,
        y: (current.y + next.y) / 2,
      };
      const progress = index / Math.max(1, trail.length - 1);
      const width = trailBall.radius * (0.1 + progress * 0.6);
      const opacity = progress ** 0.85 * 0.28 * fade;

      ctx.lineWidth = glow ? width * 1.7 : width * 0.58;
      ctx.shadowBlur = glow ? width * 2 : 0;
      ctx.strokeStyle = hexToRgba(color, glow ? opacity * 0.42 : opacity);
      ctx.beginPath();
      ctx.moveTo(startPoint.x, startPoint.y);
      ctx.quadraticCurveTo(current.x, current.y, endPoint.x, endPoint.y);
      ctx.stroke();
    }

    ctx.restore();
  };

  trails.forEach((trail, trailIndex) => {
    const trailBall = balls[trailIndex];
    const trailCountry = countries[trailIndex];
    if (!trailBall || !trailCountry || trail.length <= 1) return;

    const color = getTrailColor(trailCountry);
    const fade = trailFades[trailIndex] ?? 1;
    drawTrailPass(true, trail, trailBall, color, fade);
    drawTrailPass(false, trail, trailBall, color, fade);
  });

  balls.forEach((ball, index) => {
    if (!ball || ball.escaped) return;

    const country = countries[index];
    if (!country) return;
    const isActive = activeIndex < 0 || index === activeIndex;
    const alpha = 1;
    const pulse = isActive ? 1 + escapePulse * 0.22 : 1;
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.scale(pulse, pulse);
    ctx.globalAlpha = alpha;
    ctx.shadowColor = country.color;
    ctx.shadowBlur = isActive ? 18 + escapePulse * 30 : 8;
    ctx.beginPath();
    ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(248, 250, 252, 0.96)";
    ctx.fill();
    ctx.clip();
    ctx.font = `${ball.radius * 2.05}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(country.flag, 0, 1);
    ctx.restore();

    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.scale(pulse, pulse);
    ctx.globalAlpha = alpha;
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });
};

const CountryEscapeChallenge = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<ChallengeAudio | null>(null);
  const animationRef = useRef<number | null>(null);
  const arenaRef = useRef<Arena | null>(null);
  const ballsRef = useRef<Array<Ball | null>>([]);
  const countriesRef = useRef<Country[]>(getRandomCountries());
  const gapAngleRef = useRef(0);
  const roundStartedAtRef = useRef(0);
  const lastFrameAtRef = useRef(0);
  const resultsRef = useRef<Result[]>([]);
  const activeIndexRef = useRef(0);
  const phaseRef = useRef<RoundUi["phase"]>("intro");
  const escapePulseRef = useRef(0);
  const trailsRef = useRef<TrailPoint[][]>([]);
  const trailFadesRef = useRef<number[]>([]);
  const [ui, setUi] = useState<RoundUi>({
    phase: "intro",
    countryIndex: 0,
    elapsed: 0,
    message: "",
  });
  const [results, setResults] = useState<Result[]>([]);
  const [countries, setCountries] = useState<Country[]>(countriesRef.current);
  const [resultsPos, setResultsPos] = useState<{ left: number; top: number }>(
    () => ({
      left: 16,
      top: Math.floor(
        (typeof window !== "undefined" ? window.innerHeight : 600) / 2,
      ),
    }),
  );
  const [startTop, setStartTop] = useState(0);
  const [hudTop, setHudTop] = useState(0);

  if (audioRef.current === null) {
    audioRef.current = createAudio();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const updateUi = (next: Partial<RoundUi>) => {
      setUi((current) => ({ ...current, ...next }));
    };

    const activateBall = (index: number, arena: Arena) => {
      let ball = ballsRef.current[index];
      // create ball for this slot if missing
      if (!ball) {
        ball = createBall(arena);
        ballsRef.current[index] = ball;
      }
      if (ball.escaped || ball.stuck) return false;

      const speed = arena.radius * BALL_SPEED_RATIO;
      const angle = getLaunchAngleAwayFromExit();
      activeIndexRef.current = index;
      if (!trailsRef.current[index]?.length) {
        trailsRef.current[index] = [{ x: ball.x, y: ball.y }];
      }
      trailFadesRef.current[index] = 1;
      ball.vx = Math.cos(angle) * speed;
      ball.vy = Math.sin(angle) * speed;
      roundStartedAtRef.current = performance.now();
      updateUi({
        phase: "playing",
        countryIndex: index,
        elapsed: ROUND_LIMIT,
        message: "",
      });
      return true;
    };

    const advanceTurn = (arena: Arena, fromIndex = activeIndexRef.current) => {
      for (let offset = 1; offset <= ballsRef.current.length; offset += 1) {
        const nextIndex = (fromIndex + offset) % ballsRef.current.length;
        const candidate = ballsRef.current[nextIndex];
        if (!candidate || (!candidate.escaped && !candidate.stuck)) {
          if (activateBall(nextIndex, arena)) return;
        }
      }

      phaseRef.current = "complete";
      updateUi({
        phase: "complete",
        elapsed: 0,
        message: "",
      });
      audioRef.current?.playVictory();
    };

    const recordEscape = (index: number, elapsed: number) => {
      const country = countriesRef.current[index];
      if (!country) return;
      const result: Result = {
        country,
        time: elapsed,
      };

      resultsRef.current = [...resultsRef.current, result];
      setResults([...resultsRef.current]);
      escapePulseRef.current = 1;
      void country;
      audioRef.current?.playEscape();
    };

    const stepRace = (arena: Arena, dt: number, elapsed: number) => {
      const gapSize = Math.PI * 2 * GAP_SIZE_RATIO;
      const activeIndex = activeIndexRef.current;
      const ball = ballsRef.current[activeIndex];

      if (!ball || ball.escaped || ball.stuck) {
        advanceTurn(arena, activeIndex);
        return;
      }

      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      trailsRef.current[activeIndex] = [
        ...(trailsRef.current[activeIndex] ?? []),
        { x: ball.x, y: ball.y },
      ].slice(-TRAIL_MAX_POINTS);
      trailFadesRef.current[activeIndex] = 1;

      const dx = ball.x - arena.x;
      const dy = ball.y - arena.y;
      const distanceFromCenter = Math.hypot(dx, dy) || 1;
      const angle = Math.atan2(dy, dx);
      const insideGap = isAngleInsideGap(angle, gapAngleRef.current, gapSize);

      if (insideGap && distanceFromCenter - ball.radius > arena.radius) {
        ball.escaped = true;
        recordEscape(activeIndex, elapsed);
        advanceTurn(arena, activeIndex);
        return;
      }

      if (distanceFromCenter + ball.radius >= arena.radius && !insideGap) {
        const nx = dx / distanceFromCenter;
        const ny = dy / distanceFromCenter;
        const velocityAlongNormal = ball.vx * nx + ball.vy * ny;

        if (velocityAlongNormal > 0) {
          ball.vx -= 2 * velocityAlongNormal * nx;
          ball.vy -= 2 * velocityAlongNormal * ny;
          preserveSpeed(ball, arena);
          applyRandomBounce(ball, 1.2);
          audioRef.current?.playBounce();
        }

        ball.x = arena.x + nx * (arena.radius - ball.radius - 0.5);
        ball.y = arena.y + ny * (arena.radius - ball.radius - 0.5);
      }

      resolveCountryCollisions(ballsRef.current, activeIndex, arena, () =>
        audioRef.current?.playBounce(),
      );

      if (elapsed >= ROUND_LIMIT) {
        ball.vx = 0;
        ball.vy = 0;
        ball.stuck = true;
        advanceTurn(arena, activeIndex);
      }
    };

    const draw = (time: number) => {
      const arena = arenaRef.current;
      if (!arena) return;

      const dt = Math.min((time - lastFrameAtRef.current) / 1000, MAX_DT);
      lastFrameAtRef.current = time;
      escapePulseRef.current = Math.max(0, escapePulseRef.current - dt * 1.8);
      gapAngleRef.current = normalizeAngle(
        gapAngleRef.current + dt * GAP_ROTATION_SPEED,
      );
      const currentActiveIndex =
        phaseRef.current === "playing" ? activeIndexRef.current : -1;
      trailFadesRef.current = trailFadesRef.current.map((fade, index) => {
        const trail = trailsRef.current[index];
        const ball = ballsRef.current[index];
        if (!trail?.length || !ball) return 0;
        if (index === currentActiveIndex && !ball.escaped && !ball.stuck) {
          return 1;
        }
        return Math.max(0, fade - dt * TRAIL_FADE_SPEED);
      });

      if (phaseRef.current === "playing") {
        const elapsed = (time - roundStartedAtRef.current) / 1000;
        stepRace(arena, dt, elapsed);
        setUi((current) =>
          current.phase === "playing"
            ? { ...current, elapsed: Math.max(0, ROUND_LIMIT - elapsed) }
            : current,
        );
      }

      drawArena(
        ctx,
        arena,
        gapAngleRef.current,
        Math.PI * 2 * GAP_SIZE_RATIO,
        ballsRef.current,
        phaseRef.current === "playing" ? activeIndexRef.current : -1,
        resultsRef.current,
        countriesRef.current,
        escapePulseRef.current,
        trailsRef.current,
        trailFadesRef.current,
      );

      animationRef.current = requestAnimationFrame(draw);
    };

    const handleResize = () => {
      const arena = resizeCanvas(canvas);
      arenaRef.current = arena;
      // preserve existing balls but ensure array length matches countries
      const newBalls = new Array(countriesRef.current.length)
        .fill(null)
        .map((_, i) => ballsRef.current[i] ?? null);
      ballsRef.current = newBalls;
      // position results panel to the right side of the arena
      setResultsPos({
        left: Math.round(arena.x + arena.radius + 12),
        top: Math.round(arena.y),
      });
      setStartTop(getStartTop(arena));
      setHudTop(getHudTop(arena));
    };

    const unlockSound = () => {
      void audioRef.current?.unlock();
    };

    arenaRef.current = resizeCanvas(canvas);
    ballsRef.current = new Array(countriesRef.current.length).fill(null);
    trailsRef.current = new Array(countriesRef.current.length).fill(null).map(
      () => [],
    );
    trailFadesRef.current = new Array(countriesRef.current.length).fill(0);
    setResultsPos({
      left: Math.round(arenaRef.current.x + arenaRef.current.radius + 12),
      top: Math.round(arenaRef.current.y),
    });
    setStartTop(getStartTop(arenaRef.current));
    setHudTop(getHudTop(arenaRef.current));
    lastFrameAtRef.current = performance.now();
    window.addEventListener("resize", handleResize);
    window.addEventListener("pointerdown", unlockSound, { passive: true });
    window.addEventListener("keydown", unlockSound);
    animationRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("pointerdown", unlockSound);
      window.removeEventListener("keydown", unlockSound);
      audioRef.current?.dispose();
    };
  }, []);

  const startChallenge = () => {
    void audioRef.current?.unlock();
    const arena = arenaRef.current;
    if (!arena) return;

    resultsRef.current = [];
    setResults([]);
    const nextCountries = getRandomCountries();
    countriesRef.current = nextCountries;
    setCountries(nextCountries);
    ballsRef.current = new Array(nextCountries.length).fill(null);
    trailsRef.current = new Array(nextCountries.length).fill(null).map(
      () => [],
    );
    trailFadesRef.current = new Array(nextCountries.length).fill(0);
    phaseRef.current = "playing";
    activeIndexRef.current = 0;
    const first = createBall(arena);
    ballsRef.current[0] = first;
    trailsRef.current[0] = [{ x: first.x, y: first.y }];
    trailFadesRef.current[0] = 1;
    const speed = arena.radius * BALL_SPEED_RATIO;
    const angle = getLaunchAngleAwayFromExit();
    first.vx = Math.cos(angle) * speed;
    first.vy = Math.sin(angle) * speed;
    roundStartedAtRef.current = performance.now();
    escapePulseRef.current = 0;
    setUi({
      phase: "playing",
      countryIndex: 0,
      elapsed: ROUND_LIMIT,
      message: "",
    });
    audioRef.current?.playRoundStart();
  };

  return (
    <div className="country-root">
      <canvas ref={canvasRef} className="country-canvas" />

      <div className="hud" aria-live="polite" style={{ top: `${hudTop}px` }}>
        <h1>How Many Country Balls Can Escape in 4 Seconds?</h1>

        <div className="hud-main">
          <div className="timer" role="timer" aria-live="polite">
            {ui.phase === "complete" ? "0.0" : ui.elapsed.toFixed(1)}s
          </div>
        </div>
      </div>

      <div
        className="results-card"
        aria-hidden={ui.phase === "intro"}
        style={{
          left: `${resultsPos.left}px`,
          top: `${resultsPos.top}px`,
          transform: "translateY(-50%)",
        }}
      >
        <div className="rank-stack" aria-hidden={ui.phase === "intro"}>
          {Array.from({ length: countries.length }).map((_, slotIndex) => {
            const filled = !!results[slotIndex];
            const res = results[slotIndex];
            return (
              <div key={slotIndex} className={`slot ${filled ? "filled" : ""}`}>
                <div className="circle">{filled ? res.country.flag : ""}</div>
                {filled ? (
                  <div className="country-name">{res.country.name}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {ui.phase === "intro" ? (
        <div className="start-panel" style={{ top: `${startTop}px` }}>
          <button type="button" onClick={startChallenge}>
            START
          </button>
        </div>
      ) : null}

      <style jsx>{`
        .country-root {
          position: relative;
          width: 100%;
          height: 100dvh;
          min-height: 100dvh;
          max-height: 100dvh;
          overflow: hidden;
          background: #020617;
          color: #f8fafc;
        }

        .country-canvas {
          width: 100%;
          height: 100dvh;
          min-height: 100dvh;
          max-height: 100dvh;
        }

        .hud {
          position: fixed;
          left: 50%;
          z-index: 6;
          width: min(560px, calc(100% - 40px));
          transform: translateX(-50%);
          pointer-events: none;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          text-align: center;
        }

        .hud h1 {
          margin: 0 auto;
          max-width: 92vw;
          width: min(92vw, 500px);
          font-family: "Geist Mono", "SFMono-Regular", "Roboto Mono", monospace;
          font-size: clamp(1.3rem, 3.6vw, 1.8rem);
          line-height: 1.24;
          font-weight: 900;
          color: #ffffff;
          text-align: center;
          text-shadow:
            0 0 18px rgba(255, 255, 255, 0.12),
            0 10px 28px rgba(2, 6, 23, 0.72);
          word-break: keep-all;
        }

        .hud-main {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .timer {
          font-weight: 900;
          color: #ffffff;
          font-size: clamp(1rem, 4vw, 1.6rem);
          line-height: 1;
          text-shadow: 0 0 10px rgba(255, 255, 255, 0.6);
          padding: 4px 8px;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.02);
          transform: none;
          margin-bottom: 0;
        }

        /* Results stack (left) */
        .results-card {
          position: fixed;
          top: 50%;
          transform: translateY(-50%);
          z-index: 6;
          background: rgba(2, 6, 23, 0.36);
          border: 1px solid rgba(148, 163, 184, 0.08);
          padding: 7px 7px;
          border-radius: 12px;
          min-width: 108px;
          max-width: 150px;
          box-shadow: 0 12px 30px rgba(2, 6, 23, 0.45);
          pointer-events: auto;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .rank-stack {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 3px 0;
          align-items: stretch;
        }

        .slot {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 6px;
          min-height: 28px;
        }

        .circle {
          flex: 0 0 auto;
          width: 28px;
          height: 28px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.12);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.82rem;
          color: rgba(255, 255, 255, 0.9);
          background: rgba(255, 255, 255, 0.02);
        }

        .slot.filled .circle {
          background: rgba(255, 255, 255, 0.96);
          color: #000000;
          border-color: rgba(255, 255, 255, 0.9);
        }

        .country-name {
          min-width: 0;
          max-width: 98px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 0.68rem;
          line-height: 1;
          font-weight: 800;
          color: rgba(248, 250, 252, 0.88);
          text-shadow: 0 1px 8px rgba(2, 6, 23, 0.8);
        }

        .start-panel {
          position: fixed;
          left: 50%;
          z-index: 8;
          transform: translateX(-50%);
          border: 1px solid rgba(148, 163, 184, 0.26);
          background: rgba(2, 6, 23, 0.76);
          box-shadow:
            0 18px 52px rgba(2, 6, 23, 0.48),
            inset 0 1px 0 rgba(255, 255, 255, 0.12);
          backdrop-filter: blur(12px);
        }

        .start-panel {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 18px;
          min-height: 60px;
          padding: 8px 14px;
          border-radius: 8px;
        }

        button {
          min-height: 44px;
          padding: 0 20px;
          border: 1px solid rgba(34, 197, 94, 0.5);
          border-radius: 8px;
          background: rgba(22, 163, 74, 0.24);
          color: #dcfce7;
          font-weight: 900;
          letter-spacing: 0.1em;
          cursor: pointer;
        }

        @media (max-width: 680px) {
          .hud {
            width: min(90vw, calc(100% - 36px));
          }

          .hud-main {
            flex-direction: column;
            gap: 10px;
            align-items: center;
          }

          .results-card {
            left: 50% !important;
            right: auto !important;
            top: auto !important;
            bottom: 16px !important;
            transform: translateX(-50%) !important;
            width: min(90vw, 360px) !important;
            max-width: calc(100% - 32px);
          }

          .rank-stack {
            flex-direction: row;
            flex-wrap: wrap;
            justify-content: center;
            gap: 10px;
          }

          .slot {
            justify-content: center;
          }

          .country-name {
            display: none;
          }

          .start-panel {
            width: calc(100% - 32px);
            flex-direction: column;
            gap: 10px;
          }
        }
      `}</style>
    </div>
  );
};

export default CountryEscapeChallenge;
