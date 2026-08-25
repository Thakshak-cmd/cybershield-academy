import { parse } from "./ast.js";
import { getRule } from "./rules.js";

export { RULES } from "./rules.js";
export { parse } from "./ast.js";

/**
 * Validate a submitted patch against a challenge definition.
 *
 * Returns a structured verdict -- never the learner's raw code. Only rule ids and
 * generated evidence strings leave this function, which is what lets the telemetry
 * model record `failedRules[]` without storing whatever a participant typed
 * (docs/telemetry-model.md, "What is deliberately NOT recorded").
 */
export function validate(challenge, source) {
  const parsed = parse(source);

  if (!parsed.ok) {
    // Nothing can be evaluated, but the suite totals must still be truthful --
    // they are rendered as "n/m" and recorded in study telemetry.
    const count = kind => challenge.rules.filter(id => getRule(id).kind === kind).length;
    return {
      passed: false,
      parseError: parsed.error,
      security: { passed: 0, total: count("security"), results: [] },
      functional: { passed: 0, total: count("functional"), results: [] },
      failedRules: ["submission.parse-error"]
    };
  }

  const ctx = { ast: parsed.ast, source, meta: challenge.meta };
  const results = challenge.rules.map(id => {
    const rule = getRule(id);
    let outcome;
    try {
      outcome = rule.check(ctx);
    } catch (err) {
      // A rule that throws must not pass silently, or a crashing check would
      // read as a clean patch.
      outcome = { pass: false, evidence: `rule could not be evaluated: ${err.message}` };
    }
    return {
      id,
      kind: rule.kind,
      describe: rule.describe,
      pass: outcome.pass,
      evidence: outcome.evidence || null
    };
  });

  const bucket = kind => {
    const rs = results.filter(r => r.kind === kind);
    return { passed: rs.filter(r => r.pass).length, total: rs.length, results: rs };
  };

  const security = bucket("security");
  const functional = bucket("functional");

  return {
    passed: results.every(r => r.pass),
    parseError: null,
    security,
    functional,
    failedRules: results.filter(r => !r.pass).map(r => r.id)
  };
}
