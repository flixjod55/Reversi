/* Tiny WebAudio synth for UI/game SFX — no audio assets needed. */

let ctx = null;
let enabled = true;

export function setSound(on) {
  enabled = !!on;
}

function ac() {
  if (!enabled) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ freq = 440, end = freq, dur = 0.1, type = 'sine', vol = 0.15, delay = 0 }) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, end), t0 + dur);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sfx = {
  place() {
    tone({ freq: 320, end: 180, dur: 0.09, type: 'triangle', vol: 0.22 });
  },
  flip() {
    tone({ freq: 520, end: 700, dur: 0.07, type: 'sine', vol: 0.12 });
  },
  invalid() {
    tone({ freq: 160, end: 120, dur: 0.14, type: 'square', vol: 0.08 });
  },
  message() {
    tone({ freq: 660, dur: 0.08, type: 'sine', vol: 0.12 });
    tone({ freq: 880, dur: 0.09, type: 'sine', vol: 0.1, delay: 0.09 });
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'triangle', vol: 0.16, delay: i * 0.11 }));
  },
  lose() {
    [392, 330, 262].forEach((f, i) => tone({ freq: f, dur: 0.2, type: 'triangle', vol: 0.14, delay: i * 0.14 }));
  },
  tap() {
    tone({ freq: 700, end: 500, dur: 0.05, type: 'sine', vol: 0.08 });
  },
  mission() {
    tone({ freq: 784, dur: 0.1, type: 'sine', vol: 0.14 });
    tone({ freq: 1175, dur: 0.14, type: 'sine', vol: 0.12, delay: 0.1 });
  },
};
