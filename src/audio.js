import { app } from './runtime.js';

// Sons (procéduraux, Web Audio)
let actx = null;
function audio() {
  if (app.muted) return null;
  try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) { return null; }
  return actx;
}
function tone(freq, dur, type, vol, when) {
  const ctx = audio(); if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type || 'sine'; o.frequency.value = freq;
  const t0 = ctx.currentTime + (when || 0);
  g.gain.setValueAtTime(vol || 0.15, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + dur);
}
const SFX = {
  step: () => tone(520, 0.05, 'triangle', 0.06),
  coin: () => { tone(1046, 0.12, 'sine', 0.12); tone(1568, 0.25, 'sine', 0.1, 0.07); },
  pay: () => { tone(330, 0.15, 'sawtooth', 0.06); tone(220, 0.25, 'sawtooth', 0.06, 0.1); },
  card: () => { tone(660, 0.08, 'triangle', 0.08); tone(880, 0.12, 'triangle', 0.08, 0.08); tone(1100, 0.2, 'triangle', 0.08, 0.16); },
  dice: () => {
    const ctx = audio(); if (!ctx) return;
    for (let i = 0; i < 6; i++) tone(200 + Math.random() * 400, 0.04, 'square', 0.04, i * 0.09);
  },
  bad: () => { tone(160, 0.3, 'sawtooth', 0.08); tone(120, 0.4, 'sawtooth', 0.08, 0.15); },
  win: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35, 'triangle', 0.1, i * 0.12)); },
  // gain d'or : cascade de pièces ; perte : coup sourd + pièces qui tombent
  gain: (big) => { const n = big ? 6 : 3; for (let i = 0; i < n; i++) { tone(1200 + i * 180, 0.1, 'sine', 0.1, i * 0.06); tone(1800 + i * 200, 0.18, 'triangle', 0.05, i * 0.06 + 0.03); } },
  loss: (big) => { tone(110, 0.35, 'sawtooth', big ? 0.14 : 0.09); tone(80, 0.5, 'triangle', big ? 0.14 : 0.08, 0.05); for (let i = 0; i < (big ? 4 : 2); i++) tone(900 - i * 120, 0.08, 'square', 0.03, 0.25 + i * 0.07); },
  turn: () => { tone(660, 0.12, 'triangle', 0.12); tone(880, 0.14, 'triangle', 0.12, 0.12); tone(1320, 0.4, 'sine', 0.12, 0.24); },
  soft: () => tone(700, 0.08, 'sine', 0.04),
  land: () => { tone(300, 0.08, 'triangle', 0.08); tone(420, 0.12, 'triangle', 0.06, 0.04); },
};


export { SFX };
