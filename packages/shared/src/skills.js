// @ts-check

/**
 * Skill taxonomy.
 *
 * BKT runs over TopLevelSkill only. SubSkill is recorded on every event for
 * descriptive analysis but is too sparse to model -- see docs/telemetry-model.md.
 */

export const TOP_LEVEL_SKILLS = /** @type {const} */ (["sqli", "xss", "csrf"]);

/** @typedef {(typeof TOP_LEVEL_SKILLS)[number]} TopLevelSkill */

export const SUB_SKILLS = /** @type {const} */ ([
  "sqli.parameterised-query",
  "sqli.input-validation",
  "sqli.least-privilege",
  "xss.output-encoding",
  "xss.sanitisation",
  "xss.csp",
  "csrf.token",
  "csrf.samesite"
]);

/** @typedef {(typeof SUB_SKILLS)[number]} SubSkill */

export const TIERS = /** @type {const} */ (["beginner", "intermediate", "advanced"]);

/** @typedef {(typeof TIERS)[number]} Tier */

/**
 * How a submitted patch is judged. Beginner and intermediate challenges use static
 * analysis; only the advanced tier executes code in a container.
 * See docs/deviations-from-proposal.md D2 for why this is tiered.
 */
export const VALIDATORS = /** @type {const} */ (["ast-diff", "rule-set", "container-exec"]);

/** @typedef {(typeof VALIDATORS)[number]} Validator */

export const FORMATS = /** @type {const} */ (["spot", "patch", "harden", "review"]);

/** @typedef {(typeof FORMATS)[number]} Format */

/**
 * Sub-skills roll up to their top-level skill by prefix, so the two stay consistent
 * by construction rather than by a lookup table someone has to remember to update.
 * @param {SubSkill} subSkill
 * @returns {TopLevelSkill}
 */
export function topLevelOf(subSkill) {
  return /** @type {TopLevelSkill} */ (subSkill.split(".")[0]);
}

/**
 * @param {string} value
 * @returns {value is TopLevelSkill}
 */
export function isTopLevelSkill(value) {
  return /** @type {readonly string[]} */ (TOP_LEVEL_SKILLS).includes(value);
}

/**
 * @param {string} value
 * @returns {value is SubSkill}
 */
export function isSubSkill(value) {
  return /** @type {readonly string[]} */ (SUB_SKILLS).includes(value);
}

/**
 * @param {string} value
 * @returns {value is Tier}
 */
export function isTier(value) {
  return /** @type {readonly string[]} */ (TIERS).includes(value);
}

/**
 * @param {string} value
 * @returns {value is Validator}
 */
export function isValidator(value) {
  return /** @type {readonly string[]} */ (VALIDATORS).includes(value);
}
