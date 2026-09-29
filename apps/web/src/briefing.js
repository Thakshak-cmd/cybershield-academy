// @ts-check

/**
 * What Marcus says when the learner signs in.
 *
 * Composed from the learner's own record rather than written as a script, so it
 * never claims something happened that did not. The fiction is allowed to
 * frame the facts; it is not allowed to invent them -- a participant who reads
 * "your last fix held" after a failure has been told something false by the
 * thing being evaluated.
 *
 * A pure function of the progress payload, so the wording can be tested without
 * rendering anything.
 */

/** How Aurora's staff talk about each skill. Matches the title screen. */
export const SKILL_PHRASES = {
  sqli: "injected queries",
  xss: "injected scripts",
  csrf: "forged requests"
};

/**
 * @typedef {object} BriefingInput
 * @property {string} handle
 * @property {Record<string, number>} mastery
 * @property {boolean} capstoneUnlocked
 * @property {boolean} [degraded]
 * @property {{ capstoneHeld?: boolean } | undefined} [posture]
 * @property {{ kind: string, challengeId?: string, correct?: boolean }[]} [recent]
 * @property {Record<string, { title: string }>} [titles]
 * @property {{ id: string, isDrill?: boolean, isBoss?: boolean }[]} [nodes]
 */

/**
 * @param {BriefingInput} data
 * @returns {{ lines: string[], capstoneCall: boolean }}
 */
export function composeBriefing(data) {
  const recent = data.recent ?? [];
  const attempts = recent.filter(r => r.kind === "attempt");
  const last = attempts[0];
  const title = id => data.titles?.[id ?? ""]?.title;
  const node = id => data.nodes?.find(n => n.id === id);

  /** @type {string[]} */
  const lines = [];

  lines.push(attempts.length === 0
    ? `First shift, ${data.handle}? Welcome to the Blue Team.`
    : `Welcome back, ${data.handle}.`);

  const held = !!data.posture?.capstoneHeld;
  const capstoneCall = data.capstoneUnlocked && !held;

  if (held) {
    lines.push("Aurora held. The chain is broken everywhere it ran, so anything from here is keeping your hand in.");
  } else if (capstoneCall) {
    lines.push("You're ready for the big one. The three footholds were one attack all along, and the Aurora Breach is open whenever you are.");
  } else if (!last) {
    lines.push(
      "Aurora Store has three kinds of hole an attacker already knows about: the queries " +
      "behind the customer database, the pages the storefront renders, and the forms that change accounts."
    );
  } else if (last.correct) {
    const t = title(last.challengeId);
    lines.push(t ? `Your fix to "${t}" held. Good.` : "Your last fix held. Good.");
  } else {
    const t = title(last.challengeId);
    const drill = node(last.challengeId)?.isDrill;
    // A missed drill left nothing open; saying the attacker still has a way in
    // would be the invention this function exists to avoid.
    lines.push(drill
      ? `The last one${t ? `, "${t}",` : ""} got past you. It was practice, so nothing's open because of it.`
      : `Your last patch${t ? ` to "${t}"` : ""} didn't hold. The attacker still has a way in there.`);
  }

  // Without the model there is no evidence about which skill is weakest, so
  // say nothing rather than guess.
  if (!held && !data.degraded) {
    const skills = Object.keys(SKILL_PHRASES).filter(s => s in data.mastery);
    if (skills.length) {
      const values = skills.map(s => data.mastery[s]);
      const weakest = skills.reduce((a, b) => (data.mastery[b] < data.mastery[a] ? b : a));
      // On a tie -- every new learner starts on one -- naming a "weakest" skill
      // would just be naming whichever came first in the list.
      lines.push(Math.max(...values) - Math.min(...values) < 0.01
        ? "No read yet on where you're strongest. The first few tickets will tell us."
        : `Right now we're thinnest on ${SKILL_PHRASES[weakest]}. The next ticket is picked with that in mind.`);
    }
  }

  return { lines, capstoneCall };
}

/**
 * "4m ago", "3h ago", "2d ago". Coarse on purpose: the log is for orientation,
 * not an audit.
 *
 * @param {string} iso
 * @param {number} [now]
 */
export function ago(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
