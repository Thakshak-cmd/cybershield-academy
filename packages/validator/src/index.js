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

/**
 * Score a spot-the-flaw answer.
 *
 * The learner picks a line rather than writing a patch. The verdict shape matches
 * `validate` -- a security suite and a functional suite -- so the interface, the
 * telemetry and BKT treat it exactly like any other attempt. The security suite
 * is "found the flaw"; the functional suite is "did not accuse innocent code",
 * which keeps the two-suite tension even here: clicking every line is not an
 * answer.
 *
 * A challenge may name several flawed lines (a multi-line template literal, say).
 * Any one of them is a hit; the learner is not being asked to enumerate.
 *
 * @param {{ flawedLines: number[], vulnerable: string, decoyLines?: Record<number, string> }} challenge
 * @param {number[]} selected  1-based line numbers the learner chose
 */
export function validateSpot(challenge, selected) {
  const chosen = [...new Set((selected || []).map(Number).filter(Number.isInteger))];
  const flawed = new Set(challenge.flawedLines || []);
  const lineCount = (challenge.vulnerable || "").split("\n").length;

  const outOfRange = chosen.filter(n => n < 1 || n > lineCount);
  const hits = chosen.filter(n => flawed.has(n));
  const misses = chosen.filter(n => !flawed.has(n) && n >= 1 && n <= lineCount);

  const found = hits.length > 0;
  // More than one wrong accusation, or wrong accusations outnumbering hits,
  // means the learner is guessing rather than reading.
  const precise = misses.length === 0;

  /** Why a particular wrong line was tempting, if the author said so. */
  const decoy = n => challenge.decoyLines?.[n] ?? null;

  const security = [{
    id: "spot.found-the-flaw",
    kind: "security",
    describe: "The line that lets the attack in is identified",
    pass: found,
    evidence: found ? null
      : chosen.length === 0 ? "no line was chosen"
      : `line${chosen.length > 1 ? "s" : ""} ${chosen.join(", ")} ${chosen.length > 1 ? "are" : "is"} not where the input becomes dangerous`
  }];

  const functional = [{
    id: "spot.no-false-accusation",
    kind: "functional",
    describe: "Sound code is not flagged as the problem",
    pass: precise,
    evidence: precise ? null
      : misses.map(n => decoy(n) ? `line ${n}: ${decoy(n)}` : `line ${n} is sound`).join("; ")
  }];

  if (outOfRange.length) {
    functional.push({
      id: "spot.line-exists",
      kind: "functional",
      describe: "Chosen lines exist",
      pass: false,
      evidence: `line${outOfRange.length > 1 ? "s" : ""} ${outOfRange.join(", ")} not in the snippet`
    });
  }

  const all = [...security, ...functional];
  const bucket = list => ({ passed: list.filter(r => r.pass).length, total: list.length, results: list });

  return {
    passed: all.every(r => r.pass),
    parseError: null,
    security: bucket(security),
    functional: bucket(functional),
    failedRules: all.filter(r => !r.pass).map(r => r.id)
  };
}

/**
 * Score a code review.
 *
 * A teammate proposes a fix; the learner approves it, or rejects it and says why.
 * Judging a fix is a different skill from writing one -- and in practice the more
 * common one, since most code a developer ships past was written by someone else.
 *
 * The verdict keeps the two suites. Merging an unsafe fix fails the security suite;
 * rejecting a sound one fails the functional suite, because a correct patch held in
 * review leaves the hole open while the team argues. For an unsafe fix, rejecting
 * it for the wrong reason also fails: "this is wrong" without knowing why is a
 * guess, and the next patch the same reviewer approves will prove it.
 *
 * @param {{ sound: boolean, correctReason?: string,
 *           reasonExplanations?: Record<string, string> }} challenge
 * @param {{ decision?: string, reason?: string }} answer
 */
export function validateReview(challenge, answer) {
  const decision = answer?.decision;
  const reason = answer?.reason;
  const approved = decision === "approve";
  const rejected = decision === "reject";
  const explain = id => challenge.reasonExplanations?.[id] ?? null;

  const security = [{
    id: "review.no-unsafe-merge",
    kind: "security",
    describe: "An unsafe fix is not approved",
    pass: !(approved && !challenge.sound),
    evidence: approved && !challenge.sound
      ? "this patch still lets the attack in, and approving it ships it"
      : null
  }];

  const functional = [{
    id: "review.no-sound-rejection",
    kind: "functional",
    describe: "A correct fix is not held back",
    pass: !(rejected && challenge.sound),
    evidence: rejected && challenge.sound
      ? (explain(reason) ?? "this patch is correct") + " -- holding it back leaves the hole open"
      : null
  }];

  if (!challenge.sound) {
    const named = rejected && reason === challenge.correctReason;
    functional.push({
      id: "review.names-the-flaw",
      kind: "functional",
      describe: "The rejection names what is actually wrong",
      pass: named,
      evidence: named ? null
        : !rejected ? "the flaw was not identified"
        : !reason ? "a rejection needs a reason"
        : explain(reason) ?? "that is not what makes this patch unsafe"
    });
  }

  if (!approved && !rejected) {
    security[0].pass = false;
    security[0].evidence = "no decision was made";
  }

  const all = [...security, ...functional];
  const bucket = list => ({ passed: list.filter(r => r.pass).length, total: list.length, results: list });
  return {
    passed: all.every(r => r.pass),
    parseError: null,
    security: bucket(security),
    functional: bucket(functional),
    failedRules: all.filter(r => !r.pass).map(r => r.id)
  };
}
