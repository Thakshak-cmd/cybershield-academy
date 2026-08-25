/**
 * Skill taxonomy.
 *
 * BKT runs over TopLevelSkill only. SubSkill is recorded on every event for
 * descriptive analysis but is too sparse to model — see docs/telemetry-model.md.
 */

export const TOP_LEVEL_SKILLS = ['sqli', 'xss', 'csrf'] as const;
export type TopLevelSkill = (typeof TOP_LEVEL_SKILLS)[number];

export const SUB_SKILLS = [
  'sqli.parameterised-query',
  'sqli.input-validation',
  'sqli.least-privilege',
  'xss.output-encoding',
  'xss.sanitisation',
  'xss.csp',
  'csrf.token',
  'csrf.samesite',
] as const;
export type SubSkill = (typeof SUB_SKILLS)[number];

/** Sub-skills roll up to their top-level skill by prefix, so this stays consistent by construction. */
export function topLevelOf(subSkill: SubSkill): TopLevelSkill {
  return subSkill.split('.')[0] as TopLevelSkill;
}

export const TIERS = ['beginner', 'intermediate', 'advanced'] as const;
export type Tier = (typeof TIERS)[number];

/**
 * How a submitted patch is judged. Beginner/intermediate challenges use static
 * analysis; only the advanced tier executes code in a container.
 * See docs/deviations-from-proposal.md for why this is tiered.
 */
export const VALIDATORS = ['ast-diff', 'rule-set', 'container-exec'] as const;
export type Validator = (typeof VALIDATORS)[number];
