export class SoundManager {
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
  private lastCriticalPulseAt = 0;

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

  updateHum(massRatio: number, critical = false) {
    if (!this.audio || !this.humGain || this.muted) return;
    const time = this.audio.currentTime;
    const boost = critical ? 0.05 : 0;
    this.humGain.gain.setTargetAtTime(
      0.036 + massRatio * 0.05 + boost,
      time,
      0.18,
    );
    if (this.humOscillators[0]) {
      this.humOscillators[0].frequency.setTargetAtTime(
        38 + massRatio * 18 + (critical ? 12 : 0),
        time,
        0.24,
      );
    }
    if (this.humOscillators[1]) {
      this.humOscillators[1].frequency.setTargetAtTime(
        78 + massRatio * 24 + (critical ? 18 : 0),
        time,
        0.24,
      );
    }
  }

  playCriticalPulse() {
    if (!this.audio || this.audio.state !== "running" || !this.masterGain)
      return;
    if (this.muted) return;
    const now = this.audio.currentTime;
    if (now - this.lastCriticalPulseAt < 0.58) return;
    this.lastCriticalPulseAt = now;

    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(48, now);
    osc.frequency.exponentialRampToValueAtTime(74, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.24);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
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

  playSpawn() {
    if (!this.audio || this.audio.state !== "running" || !this.masterGain) {
      return;
    }
    if (this.muted) return;

    const now = this.audio.currentTime;
    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.22);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.3);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  playMerge() {
    if (!this.audio || this.audio.state !== "running" || !this.masterGain) {
      return;
    }
    if (this.muted) return;

    const now = this.audio.currentTime;
    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(86, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.42);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.5);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  playCollision(intensity: number) {
    if (!this.audio || !this.masterGain || this.muted || intensity < 0.34)
      return;
    const now = this.audio.currentTime;
    if (now - this.lastCollisionAt < 0.075) return;
    this.lastCollisionAt = now;

    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.type = "triangle";
    osc.frequency.value = 420 + intensity * 360;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
      0.012 + intensity * 0.018,
      now + 0.01,
    );
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
      this.musicOscillators[i].frequency.setTargetAtTime(chord[i], time, 2.4);
    }
    this.musicStep += 1;
  }

  private playTestBeep() {
    if (!this.audio || !this.masterGain || this.muted || this.testBeepPlayed) {
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

