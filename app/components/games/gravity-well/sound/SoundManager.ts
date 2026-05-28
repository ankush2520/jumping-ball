type AmbiencePhase =
  | "calm"
  | "awakening"
  | "active"
  | "critical"
  | "collapse"
  | "explosion";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export class SoundManager {
  audio: AudioContext | null = null;
  masterGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private organGain: GainNode | null = null;
  private pulseGain: GainNode | null = null;
  private shimmerGain: GainNode | null = null;
  private shimmerFilter: BiquadFilterNode | null = null;
  private ambienceOscillators: OscillatorNode[] = [];
  private shimmerSource: AudioBufferSourceNode | null = null;
  private pulseTimer: number | null = null;
  private muted = false;
  private unlocked = false;
  private lastAbsorbAt = 0;
  private lastCollisionAt = 0;
  private collisionWindowStart = 0;
  private collisionCount = 0;
  private lastCriticalPulseAt = 0;

  async initAudio() {
    return this.unlockAudio();
  }

  async unlockAudio() {
    try {
      this.ensureAudio();
      if (!this.audio) return "unavailable";

      if (this.audio.state !== "running") {
        await this.audio.resume();
      }

      this.unlocked = this.audio.state === "running";
      if (this.unlocked && this.masterGain) {
        this.masterGain.gain.setTargetAtTime(
          this.muted ? 0 : 0.68,
          this.audio.currentTime,
          0.04,
        );
        this.startAmbience();
      }

      return this.audio.state;
    } catch (error) {
      console.error("Audio unlock failed", error);
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

  startAmbience() {
    if (
      !this.audio ||
      this.audio.state !== "running" ||
      !this.masterGain ||
      this.muted ||
      this.ambienceGain
    ) {
      return;
    }

    const now = this.audio.currentTime;
    this.ambienceGain = this.audio.createGain();
    this.droneGain = this.audio.createGain();
    this.organGain = this.audio.createGain();
    this.pulseGain = this.audio.createGain();
    this.shimmerGain = this.audio.createGain();
    this.shimmerFilter = this.audio.createBiquadFilter();

    this.ambienceGain.gain.setValueAtTime(0.0001, now);
    this.ambienceGain.gain.setTargetAtTime(0.16, now, 1.4);
    this.droneGain.gain.value = 0.32;
    this.organGain.gain.value = 0.18;
    this.pulseGain.gain.value = 0.055;
    this.shimmerGain.gain.value = 0.018;
    this.shimmerFilter.type = "bandpass";
    this.shimmerFilter.frequency.value = 2450;
    this.shimmerFilter.Q.value = 0.55;

    this.droneGain.connect(this.ambienceGain);
    this.organGain.connect(this.ambienceGain);
    this.pulseGain.connect(this.ambienceGain);
    this.shimmerGain.connect(this.ambienceGain);
    this.ambienceGain.connect(this.masterGain);

    const drone = this.audio.createOscillator();
    drone.type = "sine";
    drone.frequency.value = 45;
    drone.connect(this.droneGain);
    drone.start(now);

    const organFundamental = this.audio.createOscillator();
    organFundamental.type = "triangle";
    organFundamental.frequency.value = 90;
    organFundamental.detune.value = -4;
    organFundamental.connect(this.organGain);
    organFundamental.start(now);

    const organFifth = this.audio.createOscillator();
    organFifth.type = "sine";
    organFifth.frequency.value = 135;
    organFifth.detune.value = 3;
    organFifth.connect(this.organGain);
    organFifth.start(now);

    const pulse = this.audio.createOscillator();
    pulse.type = "sine";
    pulse.frequency.value = 45;
    pulse.connect(this.pulseGain);
    pulse.start(now);

    this.ambienceOscillators = [drone, organFundamental, organFifth, pulse];
    this.startShimmer();
    this.startPulseModulation();
  }

  stopAmbience() {
    if (this.pulseTimer !== null) {
      window.clearInterval(this.pulseTimer);
      this.pulseTimer = null;
    }

    for (let i = 0; i < this.ambienceOscillators.length; i++) {
      this.ambienceOscillators[i].stop();
      this.ambienceOscillators[i].disconnect();
    }
    this.ambienceOscillators = [];

    this.shimmerSource?.stop();
    this.shimmerSource?.disconnect();
    this.shimmerSource = null;
    this.shimmerFilter?.disconnect();
    this.shimmerFilter = null;

    this.droneGain?.disconnect();
    this.organGain?.disconnect();
    this.pulseGain?.disconnect();
    this.shimmerGain?.disconnect();
    this.ambienceGain?.disconnect();
    this.droneGain = null;
    this.organGain = null;
    this.pulseGain = null;
    this.shimmerGain = null;
    this.ambienceGain = null;
  }

  setMuted(value: boolean) {
    this.muted = value;
    if (this.masterGain && this.audio) {
      this.masterGain.gain.setTargetAtTime(
        value ? 0 : 0.68,
        this.audio.currentTime,
        0.05,
      );
    }

    if (value) {
      this.stopAmbience();
    } else if (this.unlocked && this.audio?.state === "running") {
      this.startAmbience();
    }
  }

  updateAmbience(massRatio: number, phase: AmbiencePhase) {
    if (!this.audio || !this.ambienceGain || this.muted) return;

    const now = this.audio.currentTime;
    const mass = clamp(massRatio, 0, 1);
    const isCritical = phase === "critical";
    const isCollapse = phase === "collapse";
    const isExplosion = phase === "explosion";
    const tension = isCritical ? 1 : isCollapse ? 0.65 : 0;
    const duck = isCollapse || isExplosion ? 0.58 : 1;
    const baseGain = (0.13 + mass * 0.08 + tension * 0.035) * duck;

    this.ambienceGain.gain.setTargetAtTime(baseGain, now, 0.35);
    this.droneGain?.gain.setTargetAtTime(0.3 + mass * 0.16, now, 0.35);
    this.organGain?.gain.setTargetAtTime(0.15 + mass * 0.08, now, 0.45);
    this.pulseGain?.gain.setTargetAtTime(
      isCritical ? 0.18 : 0.045 + mass * 0.05,
      now,
      0.22,
    );
    this.shimmerGain?.gain.setTargetAtTime(
      isCritical ? 0.028 : 0.012 + mass * 0.012,
      now,
      0.5,
    );

    const root = 45 - mass * 6 - (isCritical ? 3 : 0);
    const frequencies = [root, root * 2, root * 3, root * (isCritical ? 0.92 : 1)];
    for (let i = 0; i < this.ambienceOscillators.length; i++) {
      this.ambienceOscillators[i].frequency.setTargetAtTime(
        frequencies[i],
        now,
        0.65,
      );
    }

    this.shimmerFilter?.frequency.setTargetAtTime(
      isCritical ? 3200 : 2100 + mass * 700,
      now,
      0.8,
    );
  }

  playCollision(intensity: number) {
    if (!this.isPlayable()) return;
    const now = this.audio.currentTime;

    if (now - this.collisionWindowStart >= 1) {
      this.collisionWindowStart = now;
      this.collisionCount = 0;
    }
    if (this.collisionCount >= 8 || now - this.lastCollisionAt < 0.045) return;
    this.collisionCount += 1;
    this.lastCollisionAt = now;

    const impact = clamp(intensity, 0, 1);
    const duration = 0.08 + impact * 0.08;
    const frequency = 650 + impact * 750 + (Math.random() - 0.5) * 90;
    const peak = clamp(0.018 + impact * 0.055, 0.015, 0.075);

    const osc = this.audio.createOscillator();
    const overtone = this.audio.createOscillator();
    const gain = this.audio.createGain();
    const filter = this.audio.createBiquadFilter();

    osc.type = "triangle";
    overtone.type = "sine";
    osc.frequency.setValueAtTime(frequency, now);
    overtone.frequency.setValueAtTime(frequency * 2.01, now);
    filter.type = "highpass";
    filter.frequency.value = 520;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(filter);
    overtone.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    overtone.start(now);
    osc.stop(now + duration + 0.02);
    overtone.stop(now + duration + 0.02);
    osc.onended = () => {
      osc.disconnect();
      overtone.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  playAbsorb(massRatio: number) {
    if (!this.isPlayable()) return;
    const now = this.audio.currentTime;
    if (now - this.lastAbsorbAt < 0.06) return;
    this.lastAbsorbAt = now;

    const mass = clamp(massRatio, 0, 1);
    const duration = 0.48 + mass * 0.22;
    const peak = 0.18 + mass * 0.08;

    const osc = this.audio.createOscillator();
    const bass = this.audio.createOscillator();
    const gain = this.audio.createGain();
    const bassGain = this.audio.createGain();
    const noise = this.createNoiseSource(duration);
    const noiseFilter = this.audio.createBiquadFilter();
    const noiseGain = this.audio.createGain();

    osc.type = "triangle";
    bass.type = "sine";
    osc.frequency.setValueAtTime(180 + mass * 25, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + duration);
    bass.frequency.setValueAtTime(78, now);
    bass.frequency.exponentialRampToValueAtTime(34, now + duration * 0.8);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    bassGain.gain.setValueAtTime(0.0001, now);
    bassGain.gain.exponentialRampToValueAtTime(0.11 + mass * 0.06, now + 0.04);
    bassGain.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.85);

    noiseFilter.type = "lowpass";
    noiseFilter.frequency.setValueAtTime(900, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(300, now + duration);
    noiseFilter.Q.value = 0.9;
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.16 + mass * 0.05, now + 0.04);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    bass.connect(bassGain);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    gain.connect(this.masterGain);
    bassGain.connect(this.masterGain);
    noiseGain.connect(this.masterGain);

    osc.start(now);
    bass.start(now);
    noise.start(now);
    osc.stop(now + duration + 0.04);
    bass.stop(now + duration + 0.04);
    noise.stop(now + duration + 0.04);
    osc.onended = () => {
      osc.disconnect();
      bass.disconnect();
      gain.disconnect();
      bassGain.disconnect();
      noise.disconnect();
      noiseFilter.disconnect();
      noiseGain.disconnect();
    };
  }

  playExplosion() {
    if (!this.isPlayable()) return;
    const now = this.audio.currentTime;
    this.ambienceGain?.gain.setTargetAtTime(0.04, now, 0.08);

    this.playExplosionBass(now);
    this.playExplosionRumble(now);
    this.playExplosionCrack(now);
    this.playExplosionWhoosh(now);
  }

  playCriticalPulse() {
    if (!this.isPlayable()) return;
    const now = this.audio.currentTime;
    if (now - this.lastCriticalPulseAt < 0.58) return;
    this.lastCriticalPulseAt = now;

    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(42, now);
    osc.frequency.exponentialRampToValueAtTime(72, now + 0.14);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.26);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  playSpawn() {
    if (!this.isPlayable()) return;

    const now = this.audio.currentTime;
    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(310, now + 0.24);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.34);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  playMerge() {
    if (!this.isPlayable()) return;

    const now = this.audio.currentTime;
    const osc = this.audio.createOscillator();
    const noise = this.createNoiseSource(0.62);
    const filter = this.audio.createBiquadFilter();
    const gain = this.audio.createGain();
    const noiseGain = this.audio.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(88, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.58);
    filter.type = "lowpass";
    filter.frequency.value = 520;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.58);
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.1, now + 0.03);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);
    osc.connect(gain);
    noise.connect(filter);
    filter.connect(noiseGain);
    gain.connect(this.masterGain);
    noiseGain.connect(this.masterGain);
    osc.start(now);
    noise.start(now);
    osc.stop(now + 0.62);
    noise.stop(now + 0.64);
    osc.onended = () => {
      osc.disconnect();
      noise.disconnect();
      filter.disconnect();
      gain.disconnect();
      noiseGain.disconnect();
    };
  }

  startHum() {
    this.startAmbience();
  }

  stopHum() {
    this.stopAmbience();
  }

  startMusic() {
    this.startAmbience();
  }

  stopMusic() {
    this.stopAmbience();
  }

  updateHum(massRatio: number, critical = false) {
    this.updateAmbience(massRatio, critical ? "critical" : "active");
  }

  playSupernova() {
    this.playExplosion();
  }

  dispose() {
    this.stopAmbience();
    void this.audio?.close();
    this.audio = null;
    this.masterGain = null;
    this.unlocked = false;
  }

  private ensureAudio() {
    if (this.audio?.state === "closed") {
      this.audio = null;
      this.masterGain = null;
      this.unlocked = false;
    }
    if (this.audio) return;

    const audioWindow = window as Window &
      typeof globalThis & {
        webkitAudioContext?: typeof AudioContext;
      };
    const AudioContextClass =
      audioWindow.AudioContext || audioWindow.webkitAudioContext;
    if (!AudioContextClass) return;

    this.audio = new AudioContextClass();
    this.masterGain = this.audio.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 0.68;
    this.masterGain.connect(this.audio.destination);
  }

  private isPlayable(): this is this & {
    audio: AudioContext;
    masterGain: GainNode;
  } {
    return Boolean(
      this.audio &&
        this.audio.state === "running" &&
        this.masterGain &&
        this.unlocked &&
        !this.muted,
    );
  }

  private createNoiseSource(duration: number) {
    if (!this.audio) {
      throw new Error("AudioContext is required before creating noise");
    }

    const length = Math.max(1, Math.floor(this.audio.sampleRate * duration));
    const buffer = this.audio.createBuffer(1, length, this.audio.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      channel[i] = Math.random() * 2 - 1;
    }

    const source = this.audio.createBufferSource();
    source.buffer = buffer;
    return source;
  }

  private startShimmer() {
    if (!this.audio || !this.shimmerFilter || !this.shimmerGain) return;

    const source = this.createNoiseSource(2);
    source.loop = true;
    source.connect(this.shimmerFilter);
    this.shimmerFilter.connect(this.shimmerGain);
    source.start();
    this.shimmerSource = source;
  }

  private startPulseModulation() {
    if (!this.audio || !this.pulseGain) return;

    this.pulseTimer = window.setInterval(() => {
      if (!this.audio || !this.pulseGain || this.muted) return;
      const now = this.audio.currentTime;
      this.pulseGain.gain.cancelScheduledValues(now);
      this.pulseGain.gain.setValueAtTime(this.pulseGain.gain.value, now);
      this.pulseGain.gain.linearRampToValueAtTime(0.12, now + 0.18);
      this.pulseGain.gain.linearRampToValueAtTime(0.035, now + 1.6);
    }, 3600);
  }

  private playExplosionBass(now: number) {
    if (!this.audio || !this.masterGain) return;

    const bass = this.audio.createOscillator();
    const gain = this.audio.createGain();
    bass.type = "sine";
    bass.frequency.setValueAtTime(60, now);
    bass.frequency.exponentialRampToValueAtTime(28, now + 0.8);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.48, now + 0.028);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.86);
    bass.connect(gain);
    gain.connect(this.masterGain);
    bass.start(now);
    bass.stop(now + 0.9);
    bass.onended = () => {
      bass.disconnect();
      gain.disconnect();
    };
  }

  private playExplosionRumble(now: number) {
    if (!this.audio || !this.masterGain) return;

    const rumble = this.createNoiseSource(1.25);
    const filter = this.audio.createBiquadFilter();
    const gain = this.audio.createGain();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(120, now);
    filter.frequency.exponentialRampToValueAtTime(62, now + 1.2);
    filter.Q.value = 1.2;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.34, now + 0.045);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.22);
    rumble.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    rumble.start(now);
    rumble.stop(now + 1.26);
    rumble.onended = () => {
      rumble.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  private playExplosionCrack(now: number) {
    if (!this.audio || !this.masterGain) return;

    const crack = this.createNoiseSource(0.09);
    const filter = this.audio.createBiquadFilter();
    const gain = this.audio.createGain();
    filter.type = "highpass";
    filter.frequency.value = 1800;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    crack.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    crack.start(now);
    crack.stop(now + 0.09);
    crack.onended = () => {
      crack.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  private playExplosionWhoosh(now: number) {
    if (!this.audio || !this.masterGain) return;

    const whoosh = this.createNoiseSource(1.05);
    const filter = this.audio.createBiquadFilter();
    const gain = this.audio.createGain();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.exponentialRampToValueAtTime(1450, now + 0.32);
    filter.frequency.exponentialRampToValueAtTime(220, now + 1);
    filter.Q.value = 0.75;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.26, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.02);
    whoosh.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    whoosh.start(now);
    whoosh.stop(now + 1.06);
    whoosh.onended = () => {
      whoosh.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }
}
