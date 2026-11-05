import { assetUrl } from './assets.js';

const EFFECTS = [
  'slash-light',
  'slash-alt',
  'slash-heavy',
  'hit',
  'hit-heavy',
  'dodge',
  'hurt',
  'warning',
  'water',
  'enemy-impact',
  'wave',
  'clear',
  'victory',
  'defeat',
];
const MUSIC_GAIN = 0.22;

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicBus = null;
  let effectBus = null;
  let voiceBus = null;
  let compressor = null;
  let analyser = null;
  let waveform = null;
  let enabled = true;
  let playing = false;
  let paused = true;
  let current = 'battle';
  let epoch = 0;
  let duckUntil = 0;
  let slash = 0;
  let trackGeneration = 0;

  try {
    enabled = localStorage.getItem('demon-slayer-muted') !== '1';
  } catch {}

  const tracks = new Map();
  const raw = new Map();
  const decoded = new Map();
  const voices = new Set();
  const last = new Map();
  const errors = [];
  const counts = { effects: 0, musicStarts: 0, voiceStarts: 0 };
  const recent = [];

  const voice = new Audio();
  voice.preload = 'auto';
  voice.src = assetUrl('assets/musou/voice/wheel.mp3');

  function error(message) {
    if (!errors.includes(message)) errors.push(message);
  }

  for (const key of ['battle', 'boss']) {
    const media = new Audio();
    media.preload = 'metadata';
    media.loop = true;
    media.src = assetUrl(`assets/musou/audio/${key}.mp3`);
    media.addEventListener('error', () => error(`Music load failed: ${key}`));
    tracks.set(key, { media, gain: null, source: null });
  }

  function initialize() {
    if (ctx) return;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    ctx = new AudioContextCtor();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.7 : 0;
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -8;
    compressor.knee.value = 9;
    compressor.ratio.value = 5;
    master.connect(compressor);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    waveform = new Float32Array(512);
    compressor.connect(analyser);
    analyser.connect(ctx.destination);

    musicBus = ctx.createGain();
    musicBus.gain.value = MUSIC_GAIN;
    musicBus.connect(master);

    effectBus = ctx.createGain();
    effectBus.gain.value = 0.62;
    effectBus.connect(master);

    voiceBus = ctx.createGain();
    voiceBus.gain.value = 0.85;
    voiceBus.connect(master);
    ctx.createMediaElementSource(voice).connect(voiceBus);

    for (const track of tracks.values()) {
      track.gain = ctx.createGain();
      track.gain.gain.value = 0;
      track.gain.connect(musicBus);
      track.source = ctx.createMediaElementSource(track.media);
      track.source.connect(track.gain);
    }
  }

  function unlock() {
    initialize();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => error('Audio resume blocked'));
    }
  }

  function loadRaw(name) {
    if (!raw.has(name)) {
      raw.set(
        name,
        fetch(assetUrl(`assets/musou/audio/${name}.mp3`))
          .then(r => {
            if (!r.ok) throw Error(`HTTP ${r.status}`);
            return r.arrayBuffer();
          })
          .catch(e => {
            error(`SFX load failed: ${name} ${e.message}`);
            return null;
          }),
      );
    }
    return raw.get(name);
  }

  function buffer(name) {
    if (!decoded.has(name)) {
      decoded.set(
        name,
        loadRaw(name)
          .then(data => (data && ctx ? ctx.decodeAudioData(data.slice(0)) : null))
          .catch(e => {
            error(`SFX decode failed: ${name} ${e.message}`);
            return null;
          }),
      );
    }
    return decoded.get(name);
  }

  function playEffect(name, volume = 1, rate = 1, gap = 0.065) {
    if (!ctx || !enabled || paused) return;
    if (ctx.state === 'suspended') {
      ctx
        .resume()
        .then(() => playEffect(name, volume, rate, gap))
        .catch(() => error('SFX resume blocked'));
      return;
    }
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - (last.get(name) ?? -100) < gap) return;
    last.set(name, now);
    const generation = epoch;
    buffer(name).then(data => {
      if (!data || generation !== epoch || !enabled || paused || ctx.state !== 'running') return;
      if (voices.size >= 10) {
        const oldest = voices.values().next().value;
        try {
          oldest.stop();
        } catch {}
        voices.delete(oldest);
      }
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = data;
      source.playbackRate.value = rate;
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(effectBus);
      voices.add(source);
      source.onended = () => {
        voices.delete(source);
        source.disconnect();
        gain.disconnect();
      };
      source.start();
      counts.effects++;
      recent.push(name);
      if (recent.length > 32) recent.shift();
    });
  }

  function stopEffects() {
    epoch++;
    for (const source of voices) {
      try {
        source.stop();
      } catch {}
    }
    voices.clear();
    voice.pause();
  }

  function music() {
    if (!ctx || !enabled || !playing || paused) return;
    const generation = ++trackGeneration;
    for (const [key, track] of tracks) {
      track.gain.gain.cancelScheduledValues(ctx.currentTime);
      track.gain.gain.setTargetAtTime(key === current ? 1 : 0, ctx.currentTime, 0.2);
      if (key === current) {
        if (track.media.paused) {
          counts.musicStarts++;
          track.media.play().catch(e => {
            if (generation === trackGeneration && enabled && playing && !paused && e.name !== 'AbortError') {
              error(`Music play failed: ${e.name}`);
            }
          });
        }
      } else {
        setTimeout(() => {
          if (generation === trackGeneration && key !== current) track.media.pause();
        }, 850);
      }
    }
  }

  function duck(seconds) {
    if (!ctx || !musicBus) return;
    duckUntil = Math.max(duckUntil, ctx.currentTime + seconds);
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(MUSIC_GAIN * 0.28, ctx.currentTime, 0.07);
    const generation = epoch;
    setTimeout(() => {
      if (generation === epoch && ctx && ctx.currentTime >= duckUntil - 0.1) {
        musicBus.gain.setTargetAtTime(MUSIC_GAIN, ctx.currentTime, 0.25);
      }
    }, seconds * 1000 + 30);
  }

  function pause() {
    playing = false;
    paused = true;
    trackGeneration++;
    for (const t of tracks.values()) t.media.pause();
    stopEffects();
  }

  function resume() {
    unlock();
    if (!ctx) return;
    playing = true;
    paused = false;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(MUSIC_GAIN, ctx.currentTime, 0.1);
    music();
  }

  function stop() {
    pause();
    for (const t of tracks.values()) t.media.currentTime = 0;
    voice.currentTime = 0;
    current = 'battle';
    last.clear();
    if (musicBus && ctx) {
      musicBus.gain.cancelScheduledValues(ctx.currentTime);
      musicBus.gain.value = MUSIC_GAIN;
    }
  }

  function toggle() {
    enabled = !enabled;
    try {
      localStorage.setItem('demon-slayer-muted', enabled ? '0' : '1');
    } catch {}
    if (ctx && master) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(enabled ? 0.7 : 0, ctx.currentTime, 0.015);
    }
    if (!enabled) {
      trackGeneration++;
      for (const t of tracks.values()) t.media.pause();
      stopEffects();
    } else if (playing && !paused) {
      unlock();
      if (ctx && musicBus) {
        musicBus.gain.cancelScheduledValues(ctx.currentTime);
        musicBus.gain.setTargetAtTime(MUSIC_GAIN, ctx.currentTime, 0.1);
      }
      music();
    }
    return enabled;
  }

  function event(e) {
    if (e.type === 'wave') {
      unlock();
      playing = true;
      paused = false;
      current = e.wave >= 8 ? 'boss' : 'battle';
      music();
      playEffect('wave', 0.45, 1, 0.5);
      return;
    }
    if (e.type === 'end') {
      playing = false;
      trackGeneration++;
      for (const t of tracks.values()) t.media.pause();
      stopEffects();
      paused = false;
      playEffect(e.victory ? 'victory' : 'defeat', 0.75, 1, 0);
      return;
    }
    if (e.type === 'attack' && e.kind === 'musou') {
      duck(2);
      if (ctx && enabled && !paused) {
        voice.currentTime = 0;
        voice
          .play()
          .then(() => counts.voiceStarts++)
          .catch(err => {
            if (err.name !== 'AbortError') error(`Voice play failed: ${err.name}`);
          });
      }
      return;
    }
    if (e.type === 'musouRelease') {
      playEffect('water', 0.8, 0.85, 0.5);
      return;
    }
    if (e.type === 'impact') {
      playEffect(
        e.heavy ? 'slash-heavy' : e.finisher ? 'slash-alt' : ++slash % 2 ? 'slash-light' : 'slash-alt',
        e.heavy ? 0.6 : e.finisher ? 0.58 : 0.5,
        e.heavy ? 0.9 : e.finisher ? 0.88 : 1,
      );
      playEffect(
        e.heavy || e.finisher ? 'hit-heavy' : 'hit',
        e.heavy ? 0.8 : e.finisher ? 0.72 : 0.65,
        1 + ((slash % 3) - 1) * 0.025,
      );
      return;
    }
    if (e.type === 'swing') {
      playEffect(
        e.heavy ? 'slash-heavy' : e.finisher ? 'slash-alt' : ++slash % 2 ? 'slash-light' : 'slash-alt',
        0.45,
      );
    }
    if (e.type === 'dodge') playEffect('dodge', 0.55, 1, 0.18);
    if (e.type === 'hurt') {
      playEffect('hurt', 0.85, 1, 0.2);
      duck(0.6);
    }
    if (e.type === 'enemyTell') playEffect('warning', 0.25, 1, 1);
    if (e.type === 'enemyStrike') playEffect('enemy-impact', 0.27, 1, 0.25);
    if (e.type === 'waveClear') playEffect('clear', 0.65, 1, 0.5);
  }

  function level() {
    if (!analyser || !waveform) return 0;
    analyser.getFloatTimeDomainData(waveform);
    return Math.sqrt(waveform.reduce((sum, x) => sum + x * x, 0) / waveform.length);
  }

  return {
    unlock,
    event,
    toggle,
    pause,
    resume,
    stop,
    preload: () => Promise.all(EFFECTS.map(loadRaw)),
    get enabled() {
      return enabled;
    },
    stats: () => ({
      rms: level(),
      enabled,
      playing,
      paused,
      context: ctx?.state || 'locked',
      track: current,
      musicGain: musicBus?.gain.value || 0,
      activeEffects: voices.size,
      loadedEffects: decoded.size,
      counts: { ...counts },
      recent: [...recent],
      errors: [...errors],
    }),
  };
}
