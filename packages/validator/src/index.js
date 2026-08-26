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

/**
 * Validate a multi-stage challenge.
 *
 * A boss is several files patched against one incident rather than one file
 * patched in isolation -- which is the point of it. A learner who has memorised
 * "use a parameterised query" for the login screen has to recognise that the
 * review renderer needs something different, and that the address endpoint needs
 * something different again. That recognition is the transfer this is testing,
 * and it only exists when the stages sit inside a single encounter.
 *
 * Each stage is validated independently, because a stage is exactly the shape
 * `validate` already understands: rules plus meta.
 *
 * @param {{ stages: any[] }} challenge
 * @param {Record<string, string>} sources  patch per stage id; a missing stage
 *   scores as unattempted rather than throwing, since a learner will submit
 *   partway through
 */
export function validateStages(challenge, sources) {
  const stages = (challenge.stages || []).map(stage => {
    const source = sources?.[stage.id];
    if (typeof source !== "string" || !source.trim()) {
      const count = kind => stage.rules.filter(id => getRule(id).kind === kind).length;
      return {
        stageId: stage.id,
        component: stage.component,
        skill: stage.skill,
        attempted: false,
        passed: false,
        parseError: null,
        security: { passed: 0, total: count("security"), results: [] },
        functional: { passed: 0, total: count("functional"), results: [] },
        failedRules: []
      };
    }
    return { stageId: stage.id, component: stage.component, skill: stage.skill,
             attempted: true, ...validate(stage, source) };
  });

  return {
    passed: stages.length > 0 && stages.every(s => s.passed),
    stages,
    // Which parts of the system are still compromised. The interface draws the
    // breach from this, so an unattempted stage counts as compromised -- ignoring
    // it would show a system that looks safe because nobody has looked at it yet.
    compromised: stages.filter(s => !s.passed).map(s => s.component),
    secured: stages.filter(s => s.passed).map(s => s.component)
  };
}
