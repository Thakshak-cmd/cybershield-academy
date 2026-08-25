#!/usr/bin/env node
// @ts-check

/**
 * End-to-end smoke test: real MongoDB, real HTTP, real BKT service.
 *
 * Unit tests verify decisions and integration tests verify persistence, but
 * neither shows the three processes actually talking to each other. This walks a
 * learner through one full loop and prints the event log that resulted.
 *
 * Needs the BKT service running:
 *   cd services/ml && ./.venv/bin/uvicorn app:app --port 8811
 *
 * Then:
 *   node apps/api/scripts/smoke.js
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";

const ML_URL = process.env.ML_SERVICE_URL || "http://localhost:8811";

const c = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
const ok = s => c("32", s);
const bad = s => c("31", s);
const dim = s => c("2", s);
const bold = s => c("1", s);

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ${ok("PASS")} ${label}${detail ? dim(" " + detail) : ""}`);
  } else {
    failures++;
    console.log(`  ${bad("FAIL")} ${label}${detail ? " " + detail : ""}`);
  }
}

async function main() {
  console.log(bold("\nCyberShield backend smoke test\n"));

  // --- BKT service must be up before anything else is worth doing ---
  try {
    const r = await fetch(`${ML_URL}/health`);
    if (!r.ok) throw new Error(`status ${r.status}`);
  } catch (err) {
    console.error(bad(`Cannot reach the BKT service at ${ML_URL}`));
    console.error(dim("  cd services/ml && ./.venv/bin/uvicorn app:app --port 8811"));
    process.exit(1);
  }
  console.log(`${ok("PASS")} BKT service reachable at ${ML_URL}`);

  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("cybershield_smoke");
  process.env.JWT_SECRET = "smoke-test-secret";
  process.env.ML_SERVICE_URL = ML_URL;
  console.log(`${ok("PASS")} MongoDB started`);

  const { connect } = await import("../src/db.js");
  await connect();

  const { Event, Challenge } = await import("../src/models/index.js");
  const { seed } = await import("../src/seed.js");
  const { createApp } = await import("../src/app.js");

  const seeded = await seed();
  console.log(`${ok("PASS")} seeded ${seeded.length} challenge(s): ${seeded.join(", ")}`);

  const server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  const base = `http://localhost:${port}`;

  const token = jwt.sign(
    { sub: "subj_smoke", sid: "sess_smoke", study: true },
    process.env.JWT_SECRET
  );
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  // --- 1. ask what to do next -------------------------------------------
  console.log(bold("\n1. GET /api/next"));
  const nextRes = await fetch(`${base}/api/next`, { headers: auth });
  const next = await nextRes.json();
  check("responds 200", nextRes.status === 200, `got ${nextRes.status}`);
  check("recommends the entry challenge", next.challenge?.id === "sec-101",
        `got ${next.challenge?.id}`);
  check("carries the model's reasoning", !!next.reason, dim(`"${next.reason}"`));
  check("reports mastery", typeof next.mastery?.sqli === "number", dim(`sqli=${next.mastery?.sqli}`));
  check("hides the rules", !("rules" in (next.challenge ?? {})));
  check("hides the attack suite", !("attackSuite" in (next.challenge ?? {})));
  check("hides the hints", !("hints" in (next.challenge ?? {})));

  // --- 2. open it --------------------------------------------------------
  console.log(bold("\n2. POST /api/challenges/sec-101/start"));
  const startRes = await fetch(`${base}/api/challenges/sec-101/start`, { method: "POST", headers: auth });
  check("responds 200", startRes.status === 200, `got ${startRes.status}`);

  // --- 3. submit a bad patch --------------------------------------------
  console.log(bold("\n3. POST attempt - the naive fix"));
  const badPatch = `app.get('/api/search', async (req, res) => {
    const { term } = req.query;
    const safe = term.replace(/'/g, '');
    const sql = \`SELECT id, name, price FROM products WHERE name LIKE '%\${safe}%'\`;
    const rows = await db.query(sql);
  });`;
  const badRes = await fetch(`${base}/api/challenges/sec-101/attempt`, {
    method: "POST", headers: auth, body: JSON.stringify({ source: badPatch, durationMs: 45000 })
  });
  const badBody = await badRes.json();
  check("rejected", badBody.passed === false);
  check("security suite fails", badBody.security.passed < badBody.security.total,
        dim(`${badBody.security.passed}/${badBody.security.total}`));
  check("functional suite fails too", badBody.functional.passed < badBody.functional.total,
        dim(`${badBody.functional.passed}/${badBody.functional.total}`));
  check("names the broken rules", badBody.failedRules.length > 0, dim(badBody.failedRules.join(", ")));
  check("awards no XP", badBody.xpAwarded === 0);
  check("counts toward mastery", badBody.countedForMastery === true);

  // --- 4. submit the correct patch --------------------------------------
  console.log(bold("\n4. POST attempt - the parameterised query"));
  const goodPatch = `app.get('/api/search', async (req, res) => {
    const { term } = req.query;
    const sql = 'SELECT id, name, price FROM products WHERE name LIKE ?';
    const rows = await db.query(sql, [\`%\${term}%\`]);
  });`;
  const goodRes = await fetch(`${base}/api/challenges/sec-101/attempt`, {
    method: "POST", headers: auth, body: JSON.stringify({ source: goodPatch, durationMs: 60000 })
  });
  const goodBody = await goodRes.json();
  check("accepted", goodBody.passed === true);
  check("both suites clean",
        goodBody.security.passed === goodBody.security.total &&
        goodBody.functional.passed === goodBody.functional.total,
        dim(`${goodBody.security.passed}/${goodBody.security.total} and ${goodBody.functional.passed}/${goodBody.functional.total}`));
  check("second attempt earns the retry rate", goodBody.xpAwarded === 25, dim(`got ${goodBody.xpAwarded}`));
  check("does not count toward mastery", goodBody.countedForMastery === false, dim("attempt 2"));

  // --- 5. the log --------------------------------------------------------
  console.log(bold("\n5. The event log"));
  const events = await Event.find({ subjectId: "subj_smoke" }).sort({ seq: 1 }).lean();
  for (const e of events) {
    console.log(dim(`  ${String(e.seq).padStart(2)} ${e.type}`));
  }
  check("sequence is contiguous from 1",
        events.every((e, i) => e.seq === i + 1), dim(`${events.length} events`));
  check("no learner source persisted",
        !JSON.stringify(events).includes("replace(/'/g"));

  const { followRate, deriveFollowed } = await import("@cybershield/shared");
  const followed = deriveFollowed(/** @type {any} */ (events));
  check("the recommendation was followed", followed[0]?.followed === true,
        dim(`recommended ${followed[0]?.recommended}, started ${followed[0]?.started}`));
  check("follow rate computes", followRate(/** @type {any} */ (events)) === 1);

  // --- 6. mastery moved --------------------------------------------------
  console.log(bold("\n6. GET /api/next again"));
  const next2 = await (await fetch(`${base}/api/next`, { headers: auth })).json();
  check("mastery updated after the attempts",
        next2.mastery?.sqli !== next.mastery?.sqli,
        dim(`${next.mastery?.sqli?.toFixed(3)} -> ${next2.mastery?.sqli?.toFixed(3)}`));

  server.close();
  await mongoose.disconnect();
  await mongod.stop();

  console.log(
    failures === 0
      ? ok(`\nAll checks passed.\n`)
      : bad(`\n${failures} check(s) failed.\n`)
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(bad(`\nSmoke test crashed: ${err.message}`));
  console.error(err.stack);
  process.exit(1);
});
