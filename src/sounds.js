// Wooden "tak" sounds made with the Web Audio API (no sound files needed).
let ctx = null;
let enabled = true;

export function setSounds(on) {
  enabled = on;
}

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// iPhones only allow sound after a touch, so wake the audio up on the first one.
for (const ev of ['pointerdown', 'touchstart', 'keydown']) {
  window.addEventListener(ev, () => audio(), { once: true, passive: true });
}

// One knock: a short click of filtered noise plus a low body thump.
function knock(at, { pitch = 1, gain = 0.9 } = {}) {
  const a = ctx;
  const len = Math.floor(a.sampleRate * 0.05);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
  const noise = a.createBufferSource();
  noise.buffer = buf;
  const band = a.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1900 * pitch;
  band.Q.value = 1.4;
  const ng = a.createGain();
  ng.gain.value = gain;
  noise.connect(band).connect(ng).connect(a.destination);
  noise.start(at);

  const osc = a.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(230 * pitch, at);
  osc.frequency.exponentialRampToValueAtTime(110 * pitch, at + 0.08);
  const og = a.createGain();
  og.gain.setValueAtTime(0.0001, at);
  og.gain.exponentialRampToValueAtTime(0.55 * gain, at + 0.004);
  og.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
  osc.connect(og).connect(a.destination);
  osc.start(at);
  osc.stop(at + 0.1);
}

function chime(at, freqs, gain = 0.12) {
  freqs.forEach((f, i) => {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = ctx.createGain();
    const t = at + i * 0.09;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.4);
  });
}

// kind: 'move' | 'capture' | 'check' | 'castle' | 'win' | 'lose'
export function play(kind) {
  if (!enabled || !audio()) return;
  const t = ctx.currentTime + 0.005;
  if (kind === 'move') knock(t);
  else if (kind === 'capture') { knock(t, { pitch: 0.85, gain: 1 }); knock(t + 0.06, { pitch: 1.1, gain: 0.7 }); }
  else if (kind === 'castle') { knock(t); knock(t + 0.11, { pitch: 1.05 }); }
  else if (kind === 'check') { knock(t, { gain: 1 }); chime(t + 0.02, [880], 0.07); }
  else if (kind === 'win') chime(t, [523, 659, 784]);
  else if (kind === 'lose') chime(t, [392, 330, 262]);
}

export function moveSound(move) {
  if (move.san.includes('+')) return play('check');
  if (move.san.startsWith('O-O')) return play('castle');
  if (move.captured) return play('capture');
  return play('move');
}
