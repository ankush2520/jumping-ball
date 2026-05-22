let audioCtx: AudioContext | null = null;

const getAudioCtx = () => {
  if (!audioCtx) {
    audioCtx = new (
      window.AudioContext || (window as any).webkitAudioContext
    )();
  }
  return audioCtx;
};

export const playCollisionSound = (intensity = 0.4) => {
  const ctx = getAudioCtx();
  const now = ctx.currentTime;

  const targetVolume = Math.max(0.02, Math.min(0.35, intensity * 0.35));
  const master = ctx.createGain();
  master.gain.value = targetVolume;
  master.connect(ctx.destination);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900 + intensity * 200;
  filter.Q.value = 3;
  filter.connect(master);

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc1.type = "sine";
  osc2.type = "triangle";

  const baseFreq = 280 + intensity * 120;
  osc1.frequency.value = baseFreq;
  osc2.frequency.value = baseFreq * 1.05;

  const g1 = ctx.createGain();
  const g2 = ctx.createGain();
  g1.gain.value = 0.0001;
  g2.gain.value = 0.0001;

  osc1.connect(g1);
  osc2.connect(g2);
  g1.connect(filter);
  g2.connect(filter);

  const attack = 0.02;
  const decay = 0.22 + (1 - intensity) * 0.18;
  g1.gain.setValueAtTime(0.0001, now);
  g1.gain.exponentialRampToValueAtTime(targetVolume, now + attack);
  g1.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);

  g2.gain.setValueAtTime(0.0001, now);
  g2.gain.exponentialRampToValueAtTime(targetVolume * 0.6, now + attack);
  g2.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay + 0.03);

  // gentle detuned glide for a soothing effect
  const glide = baseFreq * 0.02;
  osc2.frequency.setValueAtTime(osc2.frequency.value + glide, now);
  osc2.frequency.exponentialRampToValueAtTime(
    osc2.frequency.value - glide,
    now + attack + decay,
  );

  osc1.start(now);
  osc2.start(now);

  const stopAt = now + attack + decay + 0.05;
  osc1.stop(stopAt);
  osc2.stop(stopAt);
};

export default playCollisionSound;
