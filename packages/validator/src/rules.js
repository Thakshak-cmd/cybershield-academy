import { findAll, isMethodCall, isInterpolated, looksLikeSql, staticText, identifiersIn,
         buildBindings, resolve } from "./ast.js";

/**
 * A rule is a named, reusable structural check over a submission.
 *
 * `kind` decides which suite it belongs to, and the two suites pull in opposite
 * directions on purpose: a patch has to close the hole (security) *and* leave the
 * feature working (functional). That tension is the whole puzzle -- see
 * docs/game-design.md section 2.
 *
 * Rule ids surface in telemetry as `failedRules[]`, so they are stable identifiers,
 * not prose. Renaming one invalidates comparison against earlier study data.
 */

/**
 * Every node that plausibly carries SQL into a database call.
 *
 * The first argument is resolved through local bindings, because the statement is
 * nearly always assembled into a variable before it is passed to the driver.
 */
function sqlArguments(ast, dbMethod) {
  const bindings = buildBindings(ast);
  const out = [];
  for (const call of findAll(ast, "CallExpression")) {
    if (!isMethodCall(call, dbMethod)) continue;
    if (!call.arguments.length) continue;
    const raw = call.arguments[0];
    out.push({ call, sql: resolve(raw, bindings), raw });
  }
  return out;
}

export const RULES = {
  "sqli.no-string-interpolation": {
    kind: "security",
    describe: "SQL is built without splicing user input into the statement text",
    check({ ast, meta }) {
      const offenders = [];
      for (const { sql } of sqlArguments(ast, meta.dbMethod)) {
        if (!looksLikeSql(sql)) continue;
        // Template literal with filled slots, or string concatenation -- both splice.
        const spliced =
          isInterpolated(sql) ||
          (sql.type === "BinaryExpression" && sql.operator === "+");
        if (!spliced) continue;
        const names = identifiersIn(sql);
        const tainted = meta.inputNames.filter(n => names.has(n));
        offenders.push({ line: sql.loc.start.line, tainted });
      }
      return offenders.length
        ? { pass: false, evidence: `user input is spliced into the query text at line ${offenders[0].line}` }
        : { pass: true };
    }
  },

  "sqli.uses-parameterised-query": {
    kind: "security",
    describe: "The database call binds values as parameters rather than as text",
    check({ ast, meta }) {
      const calls = sqlArguments(ast, meta.dbMethod);
      if (!calls.length) {
        return { pass: false, evidence: `no ${meta.dbMethod}() call found` };
      }
      const parameterised = calls.some(({ call, sql }) => {
        if (!looksLikeSql(sql)) return false;
        if (call.arguments.length < 2) return false;
        const params = call.arguments[1];
        return params.type === "ArrayExpression" || params.type === "Identifier";
      });
      return parameterised
        ? { pass: true }
        : { pass: false, evidence: "values are not bound as query parameters" };
    }
  },

  "input.preserved-verbatim": {
    kind: "functional",
    describe: "User input reaches the query unmodified",
    check({ ast, meta }) {
      // Rewriting input to make it "safe" also rewrites legitimate values.
      // o'brien@aurora.shop stops matching the moment an apostrophe is stripped.
      const MUTATORS = ["replace", "replaceAll", "split", "slice", "substring", "normalize"];
      for (const call of findAll(ast, "CallExpression")) {
        for (const m of MUTATORS) {
          if (!isMethodCall(call, m)) continue;
          const target = call.callee.object;
          if (target.type === "Identifier" && meta.inputNames.includes(target.name)) {
            return {
              pass: false,
              evidence: `${target.name}.${m}() rewrites the value a real user typed (line ${call.loc.start.line})`
            };
          }
        }
      }
      return { pass: true };
    }
  },

  "input.no-content-blocklist": {
    kind: "functional",
    describe: "Legitimate values are not rejected for containing reserved words",
    check({ ast, meta }) {
      // A keyword blocklist locks out real people: "Orwell" contains OR.
      const KEYWORDS = /\b(or|and|union|select|insert|update|delete|drop)\b|--/i;
      for (const re of findAll(ast, "Literal")) {
        if (!re.regex) continue;
        if (KEYWORDS.test(re.regex.pattern)) {
          return {
            pass: false,
            evidence: `the pattern ${re.raw} also matches legitimate values such as "Orwell" (line ${re.loc.start.line})`
          };
        }
      }
      for (const call of findAll(ast, "CallExpression")) {
        if (!isMethodCall(call, "includes") && !isMethodCall(call, "indexOf")) continue;
        const arg = call.arguments[0];
        const text = staticText(arg);
        if (text && KEYWORDS.test(text)) {
          return {
            pass: false,
            evidence: `rejecting input containing "${text}" also rejects legitimate values (line ${call.loc.start.line})`
          };
        }
      }
      return { pass: true };
    }
  },

  "sql.queries-expected-table": {
    kind: "functional",
    describe: "The endpoint still queries the table it is supposed to",
    check({ ast, meta }) {
      if (!meta.expectedTable) return { pass: true };
      const found = sqlArguments(ast, meta.dbMethod)
        .some(({ sql }) => new RegExp(`\\b${meta.expectedTable}\\b`, "i").test(staticText(sql)));
      return found
        ? { pass: true }
        : { pass: false, evidence: `no query against "${meta.expectedTable}" remains -- the feature is gone, not fixed` };
    }
  }
};

export function getRule(id) {
  const rule = RULES[id];
  if (!rule) throw new Error(`Unknown rule: ${id}`);
  return rule;
}
