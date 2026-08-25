#!/usr/bin/env node
// @ts-check

/**
 * Score a patch against a challenge from the command line.
 *
 * This is the authoring loop: writing a challenge means writing rules, and rules
 * are only correct if the wrong answers fail for the right reasons. Being able to
 * check that in a second -- without a database, a browser, or a login -- is what
 * makes authoring twenty challenges tractable (risk R4).
 *
 *   node bin/check.js sec-104              # score the reference patches
 *   node bin/check.js sec-104 my-patch.js  # score a file
 *   cat patch.js | node bin/check.js sec-104 -
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(here, "../../../content/challenges");

const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColour ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = s => c("31", s);
const green = s => c("32", s);
const dim = s => c("2", s);
const bold = s => c("1", s);

/** Reference patches, so `check.js <id>` has something to score out of the box. */
const REFERENCE = {
  "sec-104": {
    "strip single quotes": `
      app.post('/api/login', async (req, res) => {
        const { email, password } = req.body;
        const safe = email.replace(/'/g, '');
        const sql = \`SELECT id, role FROM users WHERE email = '\${safe}'\`;
        const [user] = await db.query(sql);
      });`,
    "blocklist SQL keywords": `
      app.post('/api/login', async (req, res) => {
        const { email, password } = req.body;
        if (/\\b(OR|UNION|SELECT|--)\\b/i.test(email)) {
          return res.status(400).send('Invalid input');
        }
        const sql = \`SELECT id, role FROM users WHERE email = '\${email}'\`;
        const [user] = await db.query(sql);
      });`,
    "parameterised query": `
      app.post('/api/login', async (req, res) => {
        const { email, password } = req.body;
        const sql = 'SELECT id, role FROM users WHERE email = ? AND password_hash = ?';
        const [user] = await db.query(sql, [email, sha256(password)]);
      });`
  }
};

function loadChallenge(id) {
  try {
    return JSON.parse(readFileSync(join(CONTENT, `${id}.json`), "utf8"));
  } catch {
    const available = readdirSync(CONTENT)
      .filter(f => f.endsWith(".json"))
      .map(f => f.replace(/\.json$/, ""));
    console.error(`No challenge "${id}".`);
    console.error(`Available: ${available.join(", ")}`);
    process.exit(1);
  }
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    console.error("Nothing on stdin.");
    process.exit(1);
  }
}

function report(label, challenge, source) {
  const r = validate(challenge, source);
  const tally = b => `${b.passed}/${b.total}`;
  const mark = ok => (ok ? green("PASS") : red("FAIL"));

  console.log(`\n${bold(label)}  ${mark(r.passed)}`);

  if (r.parseError) {
    console.log(`  ${red("x")} could not parse: ${r.parseError.message} (line ${r.parseError.line})`);
    return r;
  }

  /** @type {[string, { passed: number, total: number, results: any[] }][]} */
  const buckets = [["security", r.security], ["functional", r.functional]];
  for (const [name, bucket] of buckets) {
    const allOk = bucket.passed === bucket.total;
    console.log(`  ${name.padEnd(10)} ${allOk ? green(tally(bucket)) : red(tally(bucket))}`);
    for (const res of bucket.results) {
      if (res.pass) {
        console.log(`    ${green("+")} ${dim(res.id)}`);
      } else {
        console.log(`    ${red("-")} ${res.id}`);
        if (res.evidence) console.log(`      ${dim(res.evidence)}`);
      }
    }
  }
  return r;
}

const [, , challengeId, file] = process.argv;

if (!challengeId) {
  console.error("usage: check.js <challengeId> [file|-]");
  process.exit(1);
}

const challenge = loadChallenge(challengeId);
console.log(`${bold(challenge.id)}  ${challenge.title}`);
console.log(dim(`${challenge.skill} / ${challenge.tier} / ${challenge.validator}`));

if (file) {
  const source = file === "-" ? readStdin() : readFileSync(file, "utf8");
  const r = report(file === "-" ? "stdin" : file, challenge, source);
  process.exit(r.passed ? 0 : 1);
} else {
  const refs = REFERENCE[challengeId];
  if (!refs) {
    console.error(`\nNo reference patches for ${challengeId}. Pass a file to score.`);
    process.exit(1);
  }
  console.log(dim("\nScoring reference patches. Exactly one should pass."));
  const results = Object.entries(refs).map(([label, src]) => report(label, challenge, src));
  const passing = results.filter(r => r.passed).length;
  console.log(
    passing === 1
      ? `\n${green("OK")} ${passing} of ${results.length} passed, as expected.`
      : `\n${red("PROBLEM")} ${passing} of ${results.length} passed; exactly 1 should.`
  );
  process.exit(passing === 1 ? 0 : 1);
}
