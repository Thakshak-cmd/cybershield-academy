/**
 * Sound effects, synthesised.
 *
 * Every cue is generated with the Web Audio API rather than played from a file,
 * so there are no audio assets to source, license or attribute -- the same
 * reasoning that made the icons and the boss SVG rather than downloads.
 *
 * Off by default, for three reasons. Study sessions happen in shared rooms.
 * Browsers refuse to start audio before a user gesture anyway, so a sound that
 * plays on page load is a sound that silently fails. And a participant who
 * turned it on while another did not would be a variable in the study, so it is
 * pinned off for them in the same way the palette is pinned.
 */

const STORE_KEY = "cybershield.sound";

/** @type {AudioContext|null} */
let ctx = null;

export function soundEnabled() {
  try { return localStorage.getItem(STORE_KEY) === "on"; } catch { return false; }
}

/** @param {boolean} on */
export function setSoundEnabled(on) {
  try { localStorage.setItem(STORE_KEY, on ? "on" : "off"); } catch { /* private mode */ }
  // Creating the context inside the click that enables sound is what satisfies
  // the browser's autoplay rule; creating it later, on a verdict, would not be.
  if (on) context();
}

function context() {
  if (!ctx) {
    const Ctor = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/**
 * One square-wave note with a short envelope -- the timbre of the era the
 * window chrome borrows from, and quiet enough to be heard twenty times an hour.
 *
 * @param {AudioContext} ac
 * @param {number} freq
 * @param {number} start   seconds from now
 * @param {number} length  seconds
 * @param {OscillatorType} [wave]
 */
function note(ac, freq, start, length, wave = "square") {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = wave;
  osc.frequency.value = freq;
  const t = ac.currentTime + start;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.06, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

const CUES = {
  /** A rising major arpeggio. */
  solve: ac => { note(ac, 523, 0, 0.12); note(ac, 659, 0.09, 0.12); note(ac, 784, 0.18, 0.22); },
  /** Two falling notes, soft. Failure is information here, not punishment. */
  fail: ac => { note(ac, 330, 0, 0.14, "triangle"); note(ac, 247, 0.12, 0.2, "triangle"); },
  /** A brighter flourish for a badge. */
  badge: ac => { [784, 988, 1175, 1568].forEach((f, i) => note(ac, f, i * 0.07, 0.14)); },
  /** A single soft tick. */
  hint: ac => note(ac, 880, 0, 0.06, "sine")
};

/**
 * @param {keyof typeof CUES} cue
 * @param {{ pinnedOff?: boolean }} [opts]
 */
export function play(cue, opts = {}) {
  if (opts.pinnedOff || !soundEnabled()) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    // Not strictly motion, but people who ask for less motion commonly want
    // fewer unrequested sensory events too. Honour it rather than surprise them.
    return;
  }
  const ac = context();
  if (!ac) return;
  try { CUES[cue](ac); } catch { /* audio is never worth an error */ }
}
