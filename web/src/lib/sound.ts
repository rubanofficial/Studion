/**
 * Sound.
 *
 * Generated, not streamed. Every ambience here is synthesised from noise through
 * filters, which means:
 *
 *   - **No external API and no audio files.** The app works offline, on a plane,
 *     on a metered connection, with no licensing exposure.
 *   - **No autoplay problem.** Nothing is created until the user presses play, so
 *     the browser never blocks it and the user never gets a surprise.
 *   - **It stops cleanly.** Suspending the context is instant and complete, which
 *     matters because a focus tool that keeps making noise is worse than useless.
 *
 * The palette is deliberately small and calm. Rain is filtered white noise; brown
 * noise is integrated white noise; "cafe" is brown noise with a slowly wandering
 * band-pass to suggest a room; "forest" is high-passed noise with slow amplitude
 * drift. None of them loop audibly, because none of them are loops.
 *
 * The completion chime is a short two-note figure with a soft attack, because the
 * end of a session should feel like a bell in another room, not an alarm.
 */

export type Ambience = 'none' | 'rain' | 'cafe' | 'forest' | 'white' | 'brown' | 'lofi';

interface AmbienceHandle {
  stop: () => void;
  setVolume: (value: number) => void;
}

let context: AudioContext | null = null;
let current: AmbienceHandle | null = null;
let currentKind: Ambience = 'none';
let masterVolume = 0.5;

/** Create or resume the context. Must be called from a user gesture. */
function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  if (!context) context = new Ctor();
  if (context.state === 'suspended') void context.resume();
  return context;
}

/** Two seconds of looping noise. Reused by every generator. */
function noiseBuffer(audio: AudioContext, kind: 'white' | 'brown'): AudioBuffer {
  const length = audio.sampleRate * 2;
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);

  if (kind === 'white') {
    for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
    return buffer;
  }

  // Brown noise: integrated white noise with a leak so it cannot drift to DC.
  let last = 0;
  for (let index = 0; index < length; index += 1) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[index] = last * 3.5;
  }
  return buffer;
}

function loopSource(audio: AudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

/**
 * Build the graph for one ambience.
 *
 * Each returns a stop function so the caller never has to know the node shape.
 */
function build(audio: AudioContext, kind: Ambience, gain: GainNode): () => void {
  const disposers: Array<() => void> = [];

  if (kind === 'white' || kind === 'brown') {
    const source = loopSource(audio, noiseBuffer(audio, kind === 'white' ? 'white' : 'brown'));
    source.connect(gain);
    source.start();
    disposers.push(() => {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      source.disconnect();
    });
  }

  if (kind === 'rain') {
    // White noise through a low-pass, plus a slow LFO on the cutoff so the rain
    // "breathes" instead of hissing at a fixed pitch.
    const source = loopSource(audio, noiseBuffer(audio, 'white'));
    const lowpass = audio.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 5200;
    lowpass.Q.value = 0.4;

    const lfo = audio.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = audio.createGain();
    lfoGain.gain.value = 900;
    lfo.connect(lfoGain).connect(lowpass.frequency);

    source.connect(lowpass).connect(gain);
    source.start();
    lfo.start();
    disposers.push(() => {
      try {
        source.stop();
        lfo.stop();
      } catch {
        /* already stopped */
      }
      source.disconnect();
      lowpass.disconnect();
      lfo.disconnect();
    });
  }

  if (kind === 'cafe') {
    // Brown noise as "room tone", band-passed and slowly swept, plus a second
    // detuned layer so the texture is not a single static band.
    const room = loopSource(audio, noiseBuffer(audio, 'brown'));
    const roomFilter = audio.createBiquadFilter();
    roomFilter.type = 'bandpass';
    roomFilter.frequency.value = 620;
    roomFilter.Q.value = 0.7;

    const drift = audio.createOscillator();
    drift.frequency.value = 0.03;
    const driftGain = audio.createGain();
    driftGain.gain.value = 220;
    drift.connect(driftGain).connect(roomFilter.frequency);

    const chatter = loopSource(audio, noiseBuffer(audio, 'brown'));
    const chatterFilter = audio.createBiquadFilter();
    chatterFilter.type = 'bandpass';
    chatterFilter.frequency.value = 1800;
    chatterFilter.Q.value = 1.2;
    const chatterGain = audio.createGain();
    chatterGain.gain.value = 0.25;

    room.connect(roomFilter).connect(gain);
    chatter.connect(chatterFilter).connect(chatterGain).connect(gain);

    room.start();
    chatter.start();
    drift.start();
    disposers.push(() => {
      for (const source of [room, chatter, drift]) {
        try {
          source.stop();
        } catch {
          /* already stopped */
        }
      }
      room.disconnect();
      roomFilter.disconnect();
      chatter.disconnect();
      chatterFilter.disconnect();
      chatterGain.disconnect();
      drift.disconnect();
      driftGain.disconnect();
    });
  }

  if (kind === 'forest') {
    // High-passed noise for leaves, with an amplitude drift that suggests distance.
    const leaves = loopSource(audio, noiseBuffer(audio, 'white'));
    const highpass = audio.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 2200;

    const sway = audio.createGain();
    sway.gain.value = 0.4;
    const swayLfo = audio.createOscillator();
    swayLfo.frequency.value = 0.07;
    const swayDepth = audio.createGain();
    swayDepth.gain.value = 0.3;
    swayLfo.connect(swayDepth).connect(sway.gain);

    leaves.connect(highpass).connect(sway).connect(gain);
    leaves.start();
    swayLfo.start();
    disposers.push(() => {
      for (const source of [leaves, swayLfo]) {
        try {
          source.stop();
        } catch {
          /* already stopped */
        }
      }
      leaves.disconnect();
      highpass.disconnect();
      sway.disconnect();
      swayLfo.disconnect();
      swayDepth.disconnect();
    });
  }

  if (kind === 'lofi') {
    // A warm low drone with a slow tremolo. Not music — the harmonic skeleton of
    // it, quiet enough to ignore.
    const master = audio.createGain();
    master.gain.value = 0.5;

    const tremolo = audio.createGain();
    tremolo.gain.value = 0.75;
    const tremoloLfo = audio.createOscillator();
    tremoloLfo.frequency.value = 0.22;
    const tremoloDepth = audio.createGain();
    tremoloDepth.gain.value = 0.2;
    tremoloLfo.connect(tremoloDepth).connect(tremolo.gain);

    const tones = [110, 165, 220, 277.18].map((frequency, index) => {
      const oscillator = audio.createOscillator();
      oscillator.type = index % 2 === 0 ? 'sine' : 'triangle';
      oscillator.frequency.value = frequency;
      const voiceGain = audio.createGain();
      voiceGain.gain.value = 0.22 / (index + 1);
      oscillator.connect(voiceGain).connect(master);
      oscillator.start();
      return { oscillator, voiceGain };
    });

    const hiss = loopSource(audio, noiseBuffer(audio, 'brown'));
    const hissGain = audio.createGain();
    hissGain.gain.value = 0.05;
    hiss.connect(hissGain).connect(master);
    hiss.start();

    master.connect(tremolo).connect(gain);
    tremoloLfo.start();
    disposers.push(() => {
      for (const { oscillator } of tones) {
        try {
          oscillator.stop();
        } catch {
          /* already stopped */
        }
        oscillator.disconnect();
      }
      try {
        hiss.stop();
        tremoloLfo.stop();
      } catch {
        /* already stopped */
      }
      master.disconnect();
      tremolo.disconnect();
      tremoloLfo.disconnect();
      tremoloDepth.disconnect();
      hiss.disconnect();
      hissGain.disconnect();
    });
  }

  return () => disposers.forEach((dispose) => dispose());
}

/**
 * Start (or switch to) an ambience.
 *
 * Called from a click handler, never automatically. Switching kinds tears the old
 * graph down completely rather than cross-fading, so there is never a moment with
 * two generators running.
 */
export function playAmbience(kind: Ambience, volume = masterVolume): void {
  const audio = ensureContext();
  if (!audio) return;

  if (kind === 'none') {
    stopAmbience();
    return;
  }

  if (current && currentKind === kind) {
    current.setVolume(volume);
    return;
  }

  stopAmbience();

  const gain = audio.createGain();
  // A gentle fade-in: starting a noise generator at full level is startling.
  gain.gain.setValueAtTime(0, audio.currentTime);
  gain.gain.linearRampToValueAtTime(volume, audio.currentTime + 1.2);
  gain.connect(audio.destination);

  const dispose = build(audio, kind, gain);
  currentKind = kind;
  masterVolume = volume;

  current = {
    stop: () => {
      gain.gain.cancelScheduledValues(audio.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, audio.currentTime);
      gain.gain.linearRampToValueAtTime(0, audio.currentTime + 0.5);
      // Give the fade time to finish before tearing nodes down.
      window.setTimeout(() => {
        dispose();
        gain.disconnect();
      }, 600);
    },
    setVolume: (value) => {
      masterVolume = value;
      gain.gain.cancelScheduledValues(audio.currentTime);
      gain.gain.linearRampToValueAtTime(value, audio.currentTime + 0.2);
    },
  };
}

export function stopAmbience(): void {
  current?.stop();
  current = null;
  currentKind = 'none';
}

export function setAmbienceVolume(volume: number): void {
  masterVolume = Math.min(1, Math.max(0, volume));
  current?.setVolume(masterVolume);
}

/** What is playing right now — used to re-arm the UI after a reload. */
export function currentAmbience(): Ambience {
  return currentKind;
}

/**
 * The session-complete chime.
 *
 * Two notes a fifth apart, sine waves, short. It is the only sound the app makes
 * on its own, and it is suppressed entirely when the user turns chimes off.
 */
export function playChime(volume = masterVolume, variant: 'complete' | 'break' = 'complete'): void {
  const audio = ensureContext();
  if (!audio) return;

  const notes = variant === 'complete' ? [523.25, 783.99] : [392.0, 523.25];
  const start = audio.currentTime + 0.02;

  notes.forEach((frequency, index) => {
    const oscillator = audio.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;

    const gain = audio.createGain();
    const at = start + index * 0.18;
    const peak = Math.min(0.35, volume * 0.4);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);

    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + 1.2);
  });
}

/**
 * Release the audio context.
 *
 * iOS limits how many contexts a page may create, so anything that discards the
 * app (a hard sign-out) should call this rather than leaving a suspended context
 * behind.
 */
export function releaseAudio(): void {
  stopAmbience();
  if (!context) return;
  void context.close().catch(() => {});
  context = null;
}
