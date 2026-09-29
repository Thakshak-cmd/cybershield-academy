// @ts-check

/**
 * Aurora's security posture: the consequence loop.
 *
 * docs/game-design.md section 4 promised that failure would let the breach
 * progress. Until this existed it did not -- a failed patch produced an error
 * panel and nothing in the world changed. Now the company itself reacts: every
 * hole closed raises its posture, and every attempt that leaves a hole open is an
 * incident that drags it down.
 *
 * Incidents fade. Only the most recent attempts count against the score, so a
 * learner who struggles and then recovers watches the posture recover with them.
 * A permanent penalty would make early failure -- which is exactly how anyone
 * learns this material -- into a scar that never heals, and punish the
 * behaviour the platform wants: trying the naive fix and seeing it fail.
 *
 * Derived from the log, never stored, for the same reason as streaks: a stored
 * number that drifted from the history would be a silent lie.
 */

/** Share of the score available from closing ordinary holes. */
const HOLES_WEIGHT = 80;
/** Holding the capstone closes the chain everything else hangs on. */
const CAPSTONE_WEIGHT = 20;
/** How far back an incident still counts. */
const INCIDENT_WINDOW = 8;
const INCIDENT_COST = 3;
const MAX_INCIDENT_COST = 15;

/**
 * @typedef {object} Posture
 * @property {number} score        0-100
 * @property {"under attack"|"exposed"|"holding"|"hardened"} label
 * @property {number} closed       holes closed
 * @property {number} total        holes that exist
 * @property {boolean} capstoneHeld
 * @property {{ challengeId: string, occurredAt: string }[]} incidents  newest first
 */

/**
 * @param {import("./events.js").TelemetryEvent[]} events
 * @param {{ holes: string[], capstones: string[] }} catalogue
 *   holes: ids of every challenge that represents a real hole in Aurora --
 *   not drills, which are practice, and not the capstone, which is weighted
 *   on its own
 * @returns {Posture}
 */
export function derivePosture(events, { holes, capstones }) {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);

  const cleared = new Set(
    ordered.filter(e => e.type === "challenge.completed").map(e => e.payload.challengeId)
  );
  const closed = holes.filter(id => cleared.has(id)).length;
  const capstoneHeld = capstones.some(id => cleared.has(id));

  // Only attempts on real holes can be incidents. Pointing at the wrong line in a
  // drill leaves nothing open; shipping a patch that fails does.
  const real = new Set([...holes, ...capstones]);
  const attempts = ordered.filter(e => e.type === "challenge.attempted" && real.has(e.payload.challengeId));
  const recent = attempts.slice(-INCIDENT_WINDOW);
  const incidents = recent
    .filter(e => e.payload.correct === false)
    .map(e => ({ challengeId: e.payload.challengeId, occurredAt: new Date(e.occurredAt).toISOString() }))
    .reverse();

  const base = holes.length ? Math.round(HOLES_WEIGHT * closed / holes.length) : 0;
  const penalty = Math.min(MAX_INCIDENT_COST, incidents.length * INCIDENT_COST);
  const score = clamp(base + (capstoneHeld ? CAPSTONE_WEIGHT : 0) - penalty, 0, 100);

  return { score, label: labelFor(score), closed, total: holes.length, capstoneHeld, incidents: incidents.slice(0, 5) };
}

/**
 * Posture before and after the most recent attempt, so the interface can say
 * what that attempt did to the company rather than only where it now stands.
 *
 * @param {import("./events.js").TelemetryEvent[]} events
 * @param {{ holes: string[], capstones: string[] }} catalogue
 */
export function postureChange(events, catalogue) {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const lastAttempt = ordered.map(e => e.type).lastIndexOf("challenge.attempted");
  const after = derivePosture(ordered, catalogue);
  if (lastAttempt < 0) return { ...after, delta: 0, incident: false };
  const before = derivePosture(ordered.slice(0, lastAttempt), catalogue);
  // Reported separately from the delta: a learner already at zero cannot lose
  // any more score, but the failure still happened to the company, and that is
  // exactly when -- early on -- the consequence most needs to be visible.
  const last = ordered[lastAttempt];
  const real = [...catalogue.holes, ...catalogue.capstones].includes(last.payload.challengeId);
  return { ...after, delta: after.score - before.score, incident: real && last.payload.correct === false };
}

/** @param {number} score */
function labelFor(score) {
  if (score < 25) return "under attack";
  if (score < 50) return "exposed";
  if (score < 75) return "holding";
  return "hardened";
}

/** @param {number} n @param {number} lo @param {number} hi */
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
