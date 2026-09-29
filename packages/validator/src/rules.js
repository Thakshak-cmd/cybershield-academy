import { findAll, isMethodCall, isInterpolated, looksLikeSql, staticText, identifiersIn,
         buildBindings, resolve, assignmentsTo, carriesAny, calledNames,
         unescapedTaint, objectProp, objectsWithKey, literalValue, arrayStrings,
         allStrings } from "./ast.js";

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

/* --------------------------------------------------------- harden: cookies */

/**
 * Every set of cookie options in the file: the third argument to `res.cookie()`,
 * and the `cookie` block of a session middleware's configuration.
 */
function cookieOptions(ast) {
  const bindings = buildBindings(ast);
  const out = [];
  for (const call of findAll(ast, "CallExpression")) {
    if (isMethodCall(call, "cookie") && call.arguments[2]) {
      const opts = resolve(call.arguments[2], bindings);
      if (opts.type === "ObjectExpression") out.push(opts);
    }
  }
  for (const obj of objectsWithKey(ast, "cookie")) {
    const opts = resolve(objectProp(obj, "cookie"), bindings);
    if (opts && opts.type === "ObjectExpression") out.push(opts);
  }
  return out;
}

/** SameSite as a normalised string: "lax", "strict", "none", or "" when unset. */
function sameSiteOf(opts) {
  const v = literalValue(objectProp(opts, "sameSite"));
  if (v === true) return "strict";        // express treats `true` as Strict
  if (typeof v === "string") return v.toLowerCase();
  return "";
}

Object.assign(RULES, {
  "cookie.samesite-restricted": {
    kind: "security",
    describe: "The session cookie is not sent on requests started by other sites",
    check({ ast }) {
      for (const opts of cookieOptions(ast)) {
        const s = sameSiteOf(opts);
        if (s === "none") {
          return { pass: false, evidence: `SameSite=None at line ${opts.loc.start.line} sends the cookie on cross-site requests, which is exactly what a forged request needs` };
        }
        if (s === "") {
          return { pass: false, evidence: `no SameSite at line ${opts.loc.start.line}, so the behaviour depends on each browser's default rather than on you` };
        }
      }
      return { pass: true };
    }
  },

  "cookie.not-script-readable": {
    kind: "security",
    describe: "Page scripts cannot read the session cookie",
    check({ ast }) {
      for (const opts of cookieOptions(ast)) {
        if (literalValue(objectProp(opts, "httpOnly")) !== true) {
          return { pass: false, evidence: `without httpOnly (line ${opts.loc.start.line}), any script in the page -- including an injected one -- can read the session` };
        }
      }
      return { pass: true };
    }
  },

  "cookie.still-issued": {
    kind: "functional",
    describe: "Customers can still stay signed in",
    check({ ast }) {
      return cookieOptions(ast).length
        ? { pass: true }
        : { pass: false, evidence: "no session cookie is set any more, so nobody can stay signed in" };
    }
  },

  "cookie.survives-email-links": {
    kind: "functional",
    describe: "A customer following a link from their email arrives signed in",
    check({ ast }) {
      for (const opts of cookieOptions(ast)) {
        if (sameSiteOf(opts) === "strict") {
          return { pass: false, evidence: "SameSite=Strict drops the cookie when a customer follows a link from their order email, so they arrive signed out" };
        }
      }
      return { pass: true };
    }
  }
});

/* ------------------------------------------------------------- harden: CSP */

const UNSAFE_SOURCES = ["'unsafe-inline'", "'unsafe-eval'", "*", "data:"];

/** Script sources from a helmet-style `directives` object, falling back to default-src. */
function scriptSources(ast) {
  const bindings = buildBindings(ast);
  const out = [];
  for (const obj of objectsWithKey(ast, "directives")) {
    const d = resolve(objectProp(obj, "directives"), bindings);
    if (!d || d.type !== "ObjectExpression") continue;
    const src = objectProp(d, "scriptSrc") ?? objectProp(d, "script-src")
             ?? objectProp(d, "defaultSrc") ?? objectProp(d, "default-src");
    if (src) out.push({ sources: arrayStrings(resolve(src, bindings)), node: src });
  }
  return out;
}

Object.assign(RULES, {
  "csp.enabled": {
    kind: "security",
    describe: "A Content-Security-Policy is sent",
    check({ ast }) {
      for (const obj of objectsWithKey(ast, "contentSecurityPolicy")) {
        if (literalValue(objectProp(obj, "contentSecurityPolicy")) === false) {
          return { pass: false, evidence: `the policy is switched off entirely at line ${obj.loc.start.line}` };
        }
      }
      return scriptSources(ast).length
        ? { pass: true }
        : { pass: false, evidence: "no script-src or default-src is declared, so nothing restricts where scripts come from" };
    }
  },

  "csp.no-unsafe-sources": {
    kind: "security",
    describe: "The policy does not wave through the scripts it exists to stop",
    check({ ast }) {
      for (const { sources, node } of scriptSources(ast)) {
        const bad = sources.filter(s => UNSAFE_SOURCES.includes(s));
        if (bad.length) {
          return { pass: false, evidence: `${bad.join(" and ")} at line ${node.loc.start.line} lets injected script run, which undoes the policy for exactly the attack it is for` };
        }
      }
      return { pass: true };
    }
  },

  "csp.allows-own-scripts": {
    kind: "functional",
    describe: "Aurora's own scripts still load",
    check({ ast }) {
      for (const { sources, node } of scriptSources(ast)) {
        const ownOk = sources.some(s => s === "'self'" || s.startsWith("'nonce-") || s === "'strict-dynamic'");
        if (!ownOk) {
          return { pass: false, evidence: `script-src at line ${node.loc.start.line} blocks Aurora's own scripts too -- the storefront stops working` };
        }
      }
      return { pass: true };
    }
  }
});

/* ----------------------------------------------------------- harden: grants */

const BLANKET = /GRANT\s+ALL|ALL\s+PRIVILEGES|\bSUPER\b|WITH\s+GRANT\s+OPTION|ON\s+\*\.\*/i;

function grants(ast) {
  return allStrings(ast).filter(s => /\bGRANT\b/i.test(s.text));
}

Object.assign(RULES, {
  "sql.no-blanket-grant": {
    kind: "security",
    describe: "The application's database account can only do what the application does",
    check({ ast }) {
      const blanket = grants(ast).find(g => BLANKET.test(g.text));
      return blanket
        ? { pass: false, evidence: `line ${blanket.node.loc.start.line} gives the app account every privilege, so a single injection can do anything the database can` }
        : { pass: true };
    }
  },

  // Two rules rather than one "grants what the app needs": revoking everything
  // and granting read-only would otherwise fail identically, and the learner
  // could not tell which mistake they had made.
  "sql.app-can-read": privilegeRule("SELECT",
    "The storefront can still read its catalogue",
    "without SELECT, the storefront cannot show its own products"),

  "sql.app-can-write": privilegeRule("INSERT",
    "Checkout can still record an order",
    "without INSERT, checkout cannot record an order")
});

function privilegeRule(privilege, describe, consequence) {
  return {
    kind: "functional",
    describe,
    check({ ast }) {
      const all = grants(ast);
      const blanket = all.some(g => BLANKET.test(g.text));
      const has = blanket || all.some(g => new RegExp(`\\b${privilege}\\b`, "i").test(g.text));
      return has ? { pass: true } : { pass: false, evidence: consequence };
    }
  };
}

/* -------------------------------------------------- sqli: identifiers */

/**
 * Does a request value reach this expression without being vetted?
 *
 * Vetted means checked against a list the author wrote: `COLUMNS[sort]` where
 * COLUMNS is an object literal, or `ALLOWED.includes(sort) ? sort : 'name'`.
 * This is the only way to put an identifier into SQL safely, because a column
 * name cannot be a bound parameter -- `ORDER BY ?` binds a string value, and
 * every row sorts by the same constant.
 */
function unvettedTaint(node, names, bindings, depth = 0) {
  if (!node || depth > 8) return false;
  switch (node.type) {
    case "Identifier": {
      if (names.includes(node.name)) return true;
      const bound = bindings.get(node.name);
      return bound ? unvettedTaint(bound, names, bindings, depth + 1) : false;
    }
    case "MemberExpression": {
      // A lookup into a table the author wrote returns one of the author's values.
      if (node.computed && resolve(node.object, bindings)?.type === "ObjectExpression") return false;
      if (!node.computed && node.property.type === "Identifier" && names.includes(node.property.name)) return true;
      return unvettedTaint(node.object, names, bindings, depth + 1);
    }
    case "ConditionalExpression": {
      if (isAllowlistTest(node.test, bindings)) {
        // Both branches are either literals or the value the test just vetted.
        return [node.consequent, node.alternate].some(b =>
          b.type !== "Literal" && !identifiersIn(node.test).has(b.name ?? "") &&
          unvettedTaint(b, names, bindings, depth + 1));
      }
      return [node.consequent, node.alternate].some(b => unvettedTaint(b, names, bindings, depth + 1));
    }
    case "LogicalExpression":
    case "BinaryExpression":
      return unvettedTaint(node.left, names, bindings, depth + 1)
          || unvettedTaint(node.right, names, bindings, depth + 1);
    case "TemplateLiteral":
      return node.expressions.some(e => unvettedTaint(e, names, bindings, depth + 1));
    case "CallExpression": {
      const viaReceiver = node.callee.type === "MemberExpression"
        && unvettedTaint(node.callee.object, names, bindings, depth + 1);
      return viaReceiver || node.arguments.some(a => unvettedTaint(a, names, bindings, depth + 1));
    }
    default:
      return false;
  }
}

/** `LIST.includes(x)`, `x === 'lit'`, or `x in TABLE` / `Object.hasOwn(TABLE, x)`. */
function isAllowlistTest(test, bindings) {
  if (!test) return false;
  if (test.type === "CallExpression" && isMethodCall(test, "includes")) {
    return resolve(test.callee.object, bindings)?.type === "ArrayExpression";
  }
  if (test.type === "CallExpression" && isMethodCall(test, "hasOwn")) return true;
  if (test.type === "BinaryExpression" && ["===", "=="].includes(test.operator)) {
    return test.left.type === "Literal" || test.right.type === "Literal";
  }
  if (test.type === "BinaryExpression" && test.operator === "in") {
    return resolve(test.right, bindings)?.type === "ObjectExpression";
  }
  if (test.type === "LogicalExpression") {
    return isAllowlistTest(test.left, bindings) && isAllowlistTest(test.right, bindings);
  }
  return false;
}

Object.assign(RULES, {
  "sqli.identifier-allowlisted": {
    kind: "security",
    describe: "A column name from the request only reaches SQL after matching a list you control",
    check({ ast, meta }) {
      const bindings = buildBindings(ast);
      for (const { sql } of sqlArguments(ast, meta.dbMethod)) {
        if (!looksLikeSql(sql)) continue;
        const spliced = isInterpolated(sql) || (sql.type === "BinaryExpression" && sql.operator === "+");
        if (spliced && unvettedTaint(sql, meta.inputNames || [], bindings)) {
          return { pass: false, evidence: `a value from the request is spliced into the statement at line ${sql.loc.start.line} without being checked against the columns you allow` };
        }
      }
      return { pass: true };
    }
  },

  "sql.sort-still-applies": {
    kind: "functional",
    describe: "Sorting still sorts",
    check({ ast, meta }) {
      for (const { sql } of sqlArguments(ast, meta.dbMethod)) {
        const text = staticText(sql);
        if (/ORDER\s+BY\s*(\?|\$\d)/i.test(text)) {
          return { pass: false, evidence: "ORDER BY ? binds the column name as a string value, so every row sorts by the same constant and the sort does nothing" };
        }
        if (/ORDER\s+BY/i.test(text)) return { pass: true };
      }
      return { pass: false, evidence: "the query no longer sorts at all" };
    }
  }
});

/* -------------------------------------------------------- xss: URL schemes */

const URL_SINK_PROPS = ["href", "src", "action", "formAction"];

Object.assign(RULES, {
  "xss.url-scheme-allowlisted": {
    kind: "security",
    describe: "A link from user content can only be http or https",
    check({ ast, meta }) {
      const bindings = buildBindings(ast);
      const names = meta.inputNames || [];
      const reaches =
        URL_SINK_PROPS.some(p => assignmentsTo(ast, p).some(a => carriesAny(a.right, names, bindings))) ||
        findAll(ast, "CallExpression").some(c =>
          isMethodCall(c, "setAttribute") &&
          URL_SINK_PROPS.includes(String(literalValue(c.arguments[0]))) &&
          carriesAny(c.arguments[1], names, bindings));
      if (!reaches) return { pass: true };

      const strings = allStrings(ast).map(s => s.text.trim().toLowerCase());
      const regexes = findAll(ast, "Literal").filter(l => l.regex).map(l => l.regex.pattern);
      const allowlisted =
        strings.some(t => /^https?:(\/\/)?$/.test(t)) ||
        regexes.some(r => /\^\(?https\??/.test(r) || /\^https/.test(r));
      if (allowlisted) return { pass: true };

      const blocklisted = strings.some(t => t.includes("javascript"));
      return {
        pass: false,
        evidence: blocklisted
          ? "blocking the word javascript misses JaVaScRiPt:, java\\tscript: and data: -- list the schemes you allow, not the ones you fear"
          : "a link can be javascript:..., and clicking it runs the attacker's code with the customer's session"
      };
    }
  },

  "output.link-still-works": {
    kind: "functional",
    describe: "The seller's website is still a working link",
    check({ ast, meta }) {
      const bindings = buildBindings(ast);
      const names = meta.inputNames || [];
      const linked =
        URL_SINK_PROPS.some(p => assignmentsTo(ast, p).some(a => carriesAny(a.right, names, bindings))) ||
        findAll(ast, "CallExpression").some(c =>
          isMethodCall(c, "setAttribute") && carriesAny(c.arguments[1], names, bindings));
      return linked
        ? { pass: true }
        : { pass: false, evidence: "the website is no longer linked -- the feature is gone, not fixed" };
    }
  }
});

export function getRule(id) {
  const rule = RULES[id];
  if (!rule) throw new Error(`Unknown rule: ${id}`);
  return rule;
}
