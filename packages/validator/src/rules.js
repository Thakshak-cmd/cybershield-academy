import { findAll, isMethodCall, isInterpolated, looksLikeSql, staticText, identifiersIn,
         buildBindings, resolve, assignmentsTo, carriesAny, calledNames,
         unescapedTaint } from "./ast.js";

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

/* ------------------------------------------------------------------- XSS */

/** Sinks that parse their input as markup. Anything tainted reaching one executes. */
const HTML_SINK_PROPS = ["innerHTML", "outerHTML"];
const HTML_SINK_CALLS = ["insertAdjacentHTML", "write", "writeln"];

/** Sinks that treat their input as text, whatever it contains. */
const TEXT_SINK_PROPS = ["textContent", "innerText"];
const TEXT_SINK_CALLS = ["createTextNode", "setAttribute"];

/** Escaping helpers a learner might reasonably reach for. */
const ESCAPERS = ["escapehtml", "escape", "encodehtml", "sanitize", "sanitise", "purify"];

/** @param {string} name */
function isEscaper(name) {
  const lower = (name || "").toLowerCase();
  return ESCAPERS.some(fn => lower.includes(fn));
}

Object.assign(RULES, {
  "xss.no-html-sink": {
    kind: "security",
    describe: "Unescaped user content never reaches a sink that parses it as markup",
    check({ ast, meta }) {
      const bindings = buildBindings(ast);
      const names = meta.inputNames || [];

      // Escaping and then writing markup is a correct defence. Asking only
      // "does input reach innerHTML" would fail the right answer, which teaches
      // the opposite of the lesson.
      for (const prop of HTML_SINK_PROPS) {
        for (const assign of assignmentsTo(ast, prop)) {
          if (unescapedTaint(assign.right, names, bindings, isEscaper)) {
            return {
              pass: false,
              evidence: `unescaped user content is assigned to .${prop} at line ${assign.loc.start.line}, where the browser parses it as markup`
            };
          }
        }
      }

      for (const call of findAll(ast, "CallExpression")) {
        for (const method of HTML_SINK_CALLS) {
          if (!isMethodCall(call, method)) continue;
          if (call.arguments.some(a => unescapedTaint(a, names, bindings, isEscaper))) {
            return {
              pass: false,
              evidence: `unescaped user content is passed to ${method}() at line ${call.loc.start.line}`
            };
          }
        }
      }
      return { pass: true };
    }
  },

  "xss.uses-safe-sink": {
    kind: "security",
    describe: "Content is rendered as text, or encoded before it becomes markup",
    check({ ast, meta }) {
      const bindings = buildBindings(ast);
      const names = meta.inputNames || [];

      const usesTextSink =
        TEXT_SINK_PROPS.some(prop =>
          assignmentsTo(ast, prop).some(a => carriesAny(a.right, names, bindings))) ||
        findAll(ast, "CallExpression").some(call =>
          TEXT_SINK_CALLS.some(m => isMethodCall(call, m)) &&
          call.arguments.some(a => carriesAny(a, names, bindings)));

      const escapes = [...calledNames(ast)].some(isEscaper);

      return usesTextSink || escapes
        ? { pass: true }
        : { pass: false, evidence: "the value is never rendered as text nor encoded on the way out" };
    }
  },

  "output.reaches-the-page": {
    kind: "functional",
    describe: "The content is still displayed",
    check({ ast, meta }) {
      const bindings = buildBindings(ast);
      const names = meta.inputNames || [];
      const sinks = [...HTML_SINK_PROPS, ...TEXT_SINK_PROPS];

      const rendered =
        sinks.some(prop => assignmentsTo(ast, prop).some(a => carriesAny(a.right, names, bindings))) ||
        findAll(ast, "CallExpression").some(call =>
          [...HTML_SINK_CALLS, ...TEXT_SINK_CALLS].some(m => isMethodCall(call, m)) &&
          call.arguments.some(a => carriesAny(a, names, bindings)));

      return rendered
        ? { pass: true }
        : { pass: false, evidence: "the content no longer reaches the page -- the feature is gone, not fixed" };
    }
  },

  "output.no-markup-stripping": {
    kind: "functional",
    describe: "Ordinary punctuation survives",
    check({ ast, meta }) {
      // Deleting angle brackets and ampersands also mangles honest reviews:
      // "great value & fast" and "under <£20" both lose characters.
      const names = meta.inputNames || [];
      const bindings = buildBindings(ast);
      for (const call of findAll(ast, "CallExpression")) {
        if (!isMethodCall(call, "replace") && !isMethodCall(call, "replaceAll")) continue;
        // carriesAny rather than an identifier match: the value is usually reached
        // through a property, as in `review.body.replace(...)`, and matching only
        // bare identifiers quietly misses every one of those.
        if (!carriesAny(call.callee.object, names, bindings)) continue;

        const pattern = call.arguments[0];
        const text = pattern && pattern.regex ? pattern.regex.pattern : staticText(pattern);
        if (/[<>&]|script|lt;|amp;/i.test(text || "")) {
          return {
            pass: false,
            evidence: `stripping ${text ? `"${text}"` : "markup"} also mangles ordinary text such as "great value & fast" (line ${call.loc.start.line})`
          };
        }
      }
      return { pass: true };
    }
  }
});

/* ------------------------------------------------------------------ CSRF */

Object.assign(RULES, {
  "csrf.verifies-token": {
    kind: "security",
    describe: "The request carries a token that is checked against the session",
    check({ ast }) {
      const bindings = buildBindings(ast);
      const source = node => [...identifiersIn(resolve(node, bindings))].join(" ").toLowerCase();

      // A real check compares something the request supplied against something
      // only the session knows.
      for (const cmp of findAll(ast, "BinaryExpression")) {
        if (!["===", "!==", "==", "!="].includes(cmp.operator)) continue;
        const left = source(cmp.left) + " " + memberPath(cmp.left);
        const right = source(cmp.right) + " " + memberPath(cmp.right);
        const pair = [left, right];
        const fromRequest = pair.some(s => /req|request|body|header|query/.test(s) && /csrf|token/.test(s));
        const fromSession = pair.some(s => /session|cookie|store/.test(s) && /csrf|token|secret/.test(s));
        if (fromRequest && fromSession) return { pass: true };
      }

      // Or a helper does it, which is the more usual shape in real code.
      const called = [...calledNames(ast)].join(" ").toLowerCase();
      if (/csrf|verifytoken|checktoken|validatetoken|timingsafeequal/.test(called)) {
        return { pass: true };
      }

      return { pass: false, evidence: "nothing checks a request token against the session" };
    }
  },

  "csrf.not-header-only": {
    kind: "security",
    describe: "Protection does not rest on a header the browser may omit",
    check({ ast }) {
      // Referer is stripped by privacy settings and proxies, so a check that
      // passes when it is absent protects nothing -- and one that fails when it
      // is absent locks out legitimate users.
      const text = findAll(ast, "Literal")
        .map(l => String(l.value ?? "")).join(" ").toLowerCase();
      const mentionsHeader = /referer|referrer|origin/.test(text);
      if (!mentionsHeader) return { pass: true };

      const called = [...calledNames(ast)].join(" ").toLowerCase();
      const alsoChecksToken = /csrf|verifytoken|checktoken|validatetoken/.test(called);
      return alsoChecksToken
        ? { pass: true }
        : {
            pass: false,
            evidence: "the Referer or Origin header is the only barrier, and browsers may not send it at all"
          };
    }
  },

  "csrf.still-performs-the-action": {
    kind: "functional",
    describe: "The endpoint still does what it is for",
    check({ ast, meta }) {
      if (!meta.expectedCall) return { pass: true };
      const called = calledNames(ast);
      return called.has(meta.expectedCall)
        ? { pass: true }
        : {
            pass: false,
            evidence: `${meta.expectedCall}() is gone -- the endpoint is disabled, not protected`
          };
    }
  }
});

/** Dotted path of a member expression, e.g. `req.body.csrfToken`. */
function memberPath(node) {
  const parts = [];
  let cur = node;
  while (cur && cur.type === "MemberExpression") {
    if (cur.property.type === "Identifier") parts.unshift(cur.property.name);
    cur = cur.object;
  }
  if (cur && cur.type === "Identifier") parts.unshift(cur.name);
  return parts.join(".").toLowerCase();
}

export function getRule(id) {
  const rule = RULES[id];
  if (!rule) throw new Error(`Unknown rule: ${id}`);
  return rule;
}
