// @ts-check

/**
 * Badges.
 *
 * The approved proposal (section 4.3) lists these as a core mechanic and names
 * two of them. Until now the schema had a `badges` array, the event contract had
 * a `badge.earned` type, and nothing ever wrote either.
 *
 * Each badge states what earns it as a predicate over the learner's history, so
 * awarding is a pure function of the event log rather than a side effect anyone
 * has to remember to trigger. That also means the whole set can be recomputed
 * from the log if the rules change, which matters because they will.
 */

/**
 * @typedef {object} EarnedState
 * @property {string[]} cleared            challenge ids cleared
 * @property {Record<string, number>} mastery
 * @property {{ id: string, skill: string, isBoss?: boolean, isDrill?: boolean }[]} catalogue
 * @property {number} unaidedFirstAttempts  solves with no hints, first try
 */

/**
 * @typedef {object} Badge
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} art          key into BADGE_ART
 * @property {string} [skill]
 * @property {(state: EarnedState) => boolean} earned
 */

/**
 * Every real challenge in a skill, cleared.
 *
 * Drills are excluded. They are repeatable practice, and "every forgery challenge
 * cleared" should mean the learner closed every hole, not that they also pointed
 * at every line in every warm-up.
 */
const clearedWholeSkill = skill => (/** @type {EarnedState} */ state) => {
  const inSkill = state.catalogue.filter(c => c.skill === skill && !c.isBoss && !c.isDrill);
  return inSkill.length > 0 && inSkill.every(c => state.cleared.includes(c.id));
};

/** @type {Badge[]} */
export const BADGES = [
  {
    id: "first-patch",
    name: "First Patch",
    description: "Closed your first hole.",
    art: "patch",
    // A real challenge, not a drill: pointing at a line is spotting a hole, not
    // closing one, and the badge says the latter.
    earned: s => s.catalogue.some(c => !c.isDrill && !c.isBoss && s.cleared.includes(c.id))
  },
  {
    id: "sqli-defender",
    name: "SQLi Defender",
    description: "Every injection challenge cleared.",
    art: "database",
    skill: "sqli",
    earned: clearedWholeSkill("sqli")
  },
  {
    id: "xss-guardian",
    name: "XSS Guardian",
    description: "Every scripting challenge cleared.",
    art: "browser",
    skill: "xss",
    earned: clearedWholeSkill("xss")
  },
  {
    id: "csrf-warden",
    name: "CSRF Warden",
    description: "Every forgery challenge cleared.",
    art: "forgery",
    skill: "csrf",
    earned: clearedWholeSkill("csrf")
  },
  {
    id: "unaided",
    name: "No Hints Needed",
    description: "Three solved first time, without asking.",
    art: "star",
    // Deliberately counts unaided first attempts rather than solves. A learner
    // who was shown the answer has not demonstrated the thing being rewarded --
    // the same distinction BKT draws for its training signal.
    earned: s => s.unaidedFirstAttempts >= 3
  },
  {
    id: "aurora-held",
    name: "Aurora Held",
    description: "The whole chain broken, every link.",
    art: "crown",
    earned: s => s.catalogue.some(c => c.isBoss && s.cleared.includes(c.id))
  }
];

const BY_ID = new Map(BADGES.map(b => [b.id, b]));

/** @param {string} id */
export function getBadge(id) {
  return BY_ID.get(id) ?? null;
}

/**
 * Which badges the learner has earned, given everything they have done.
 *
 * Returns the full earned set, not the new ones. The caller diffs against what
 * is already recorded, so a badge can never be awarded twice and a rule change
 * can backfill for learners who already qualified.
 *
 * @param {EarnedState} state
 * @returns {string[]}
 */
export function earnedBadges(state) {
  return BADGES.filter(b => {
    try {
      return b.earned(state);
    } catch {
      // A badge whose predicate throws must not take the whole award pass with
      // it -- the learner would silently stop earning anything.
      return false;
    }
  }).map(b => b.id);
}
