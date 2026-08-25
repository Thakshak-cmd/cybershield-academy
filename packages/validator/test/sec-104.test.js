import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../src/index.js";

const challenge = JSON.parse(
  readFileSync(new URL("../../../content/challenges/sec-104.json", import.meta.url), "utf8")
);

/**
 * These are the three patches shown in the interaction prototype. There the scores
 * were hardcoded; here they must fall out of the validator. If a change to the rules
 * makes a naive patch pass, that is a pedagogical regression, not just a test break.
 */
const PATCHES = {
  stripQuotes: `
    app.post('/api/login', async (req, res) => {
      const { email, password } = req.body;
      const safe = email.replace(/'/g, '');
      const sql = \`SELECT id, role FROM users WHERE email = '\${safe}'\`;
      const [user] = await db.query(sql);
      if (user) req.session.userId = user.id;
    });`,

  keywordBlocklist: `
    app.post('/api/login', async (req, res) => {
      const { email, password } = req.body;
      if (/\\b(OR|UNION|SELECT|--)\\b/i.test(email)) {
        return res.status(400).send('Invalid input');
      }
      const sql = \`SELECT id, role FROM users WHERE email = '\${email}'\`;
      const [user] = await db.query(sql);
      if (user) req.session.userId = user.id;
    });`,

  parameterised: `
    app.post('/api/login', async (req, res) => {
      const { email, password } = req.body;
      const sql = 'SELECT id, role FROM users WHERE email = ? AND password_hash = ?';
      const [user] = await db.query(sql, [email, sha256(password)]);
      if (user) req.session.userId = user.id;
    });`
};

describe("SEC-104 validation", () => {
  test("the parameterised query passes both suites", () => {
    const r = validate(challenge, PATCHES.parameterised);
    assert.equal(r.passed, true);
    assert.deepEqual(r.failedRules, []);
    assert.equal(r.security.passed, r.security.total);
    assert.equal(r.functional.passed, r.functional.total);
  });

  test("stripping quotes still injects, and mangles a real address", () => {
    const r = validate(challenge, PATCHES.stripQuotes);
    assert.equal(r.passed, false);
    // Fails on security because the value is still spliced into the statement...
    assert.ok(r.failedRules.includes("sqli.no-string-interpolation"));
    assert.ok(r.failedRules.includes("sqli.uses-parameterised-query"));
    // ...and on function because o'brien@aurora.shop no longer matches.
    assert.ok(r.failedRules.includes("input.preserved-verbatim"));
    assert.ok(r.functional.passed < r.functional.total);
  });

  test("a keyword blocklist still injects, and locks out Orwell", () => {
    const r = validate(challenge, PATCHES.keywordBlocklist);
    assert.equal(r.passed, false);
    assert.ok(r.failedRules.includes("sqli.no-string-interpolation"));
    assert.ok(r.failedRules.includes("input.no-content-blocklist"));
    // The distinguishing point: it does NOT rewrite the value, unlike stripQuotes.
    assert.ok(!r.failedRules.includes("input.preserved-verbatim"));
  });

  test("the two naive patches fail for different reasons", () => {
    const a = new Set(validate(challenge, PATCHES.stripQuotes).failedRules);
    const b = new Set(validate(challenge, PATCHES.keywordBlocklist).failedRules);
    const onlyA = [...a].filter(x => !b.has(x));
    const onlyB = [...b].filter(x => !a.has(x));
    assert.ok(onlyA.length > 0 && onlyB.length > 0,
      "each wrong answer must be wrong in its own way, or the feedback teaches nothing");
  });

  test("deleting the endpoint does not count as a fix", () => {
    const r = validate(challenge, "app.post('/api/login', async (req, res) => res.sendStatus(410));");
    assert.equal(r.passed, false);
    assert.ok(r.failedRules.includes("sql.queries-expected-table"));
  });

  test("unparseable code returns a verdict, not a crash", () => {
    const r = validate(challenge, "const sql = 'SELECT * FROM users WHERE");
    assert.equal(r.passed, false);
    assert.ok(r.parseError, "an unparseable submission must report where it broke");
    assert.equal(r.parseError.line, 1);
    assert.deepEqual(r.failedRules, ["submission.parse-error"]);
  });

  test("a parse error still reports honest suite totals", () => {
    const r = validate(challenge, "const sql = 'SELECT * FROM users WHERE");
    // Totals are rendered as "n/m" and recorded in telemetry, so they must reflect
    // the real shape of the challenge even when nothing could be evaluated.
    assert.equal(r.security.total, 2);
    assert.equal(r.functional.total, 3);
    assert.equal(r.security.passed, 0);
    assert.equal(r.functional.passed, 0);
  });

  test("no rule leaks the submitted source into its evidence", () => {
    const marker = "SECRET_LEARNER_TOKEN_42";
    const r = validate(challenge, `
      const ${marker} = 1;
      const sql = \`SELECT id FROM users WHERE email = '\${email}'\`;
      await db.query(sql);`);
    const blob = JSON.stringify(r);
    assert.ok(!blob.includes(marker),
      "evidence strings must not echo learner code -- see docs/telemetry-model.md");
  });
});
