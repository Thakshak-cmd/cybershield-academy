import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "test-secret-not-a-real-key";
delete process.env.MONGODB_URI;

const { createNextRouter } = await import("../src/routes/next.js");
const { MlServiceError, createMlClient } = await import("../src/ml-client.js");
const express = (await import("express")).default;

let mlBehaviour = "ok";
/** @type {import("../src/ml-client.js").MlClient} */
const fakeMl = {
  async recommend() {
    if (mlBehaviour === "down") throw new MlServiceError("ML service unreachable");
    if (mlBehaviour === "empty") return null;
    if (mlBehaviour === "unknown") {
      return { challengeId: "does-not-exist", skill: "sqli", pMastery: 0.4,
               policy: /** @type {const} */ ("bkt-adaptive"), reason: "r",
               mastery: /** @type {Record<string, number>} */ ({ sqli: 0.4 }),
               unlocked: [], capstoneUnlocked: false };
    }
    return {
      challengeId: "sec-104", skill: "sqli", pMastery: 0.42,
      policy: /** @type {const} */ ("bkt-adaptive"), reason: "sqli is weakest at 0.42",
      mastery: /** @type {Record<string, number>} */ ({ sqli: 0.42, xss: 0.15, csrf: 0.15 }),
      unlocked: ["sec-104"], capstoneUnlocked: false
    };
  },
  async mastery() {
    if (mlBehaviour === "down") throw new MlServiceError("ML service unreachable");
    return {
      mastery: /** @type {Record<string, number>} */ ({ sqli: 0.42 }),
      unlocked: ["sec-101"],
      capstoneUnlocked: false
    };
  }
};

/**
 * The route is exercised against a fake ML client and a stubbed model layer, so
 * neither Mongo nor a running Python service is needed. What is being tested is the
 * route's own behaviour: what it records, what it hides, and how it fails.
 */

const CHALLENGE = {
  id: "sec-104",
  title: "Login bypass",
  skill: "sqli",
  subSkill: "sqli.parameterised-query",
  tier: "intermediate",
  format: "patch",
  brief: "Someone reached admin without a password.",
  vulnerable: "const sql = `SELECT ...`;",
  rules: ["sqli.no-string-interpolation", "sqli.uses-parameterised-query"],
  attackSuite: [{ payload: "admin' OR '1'='1' --" }, { payload: "1 OR 1=1" }],
  functionalSuite: [{ value: "alice@aurora.shop" }],
  hints: ["one", "two", "three"],
  meta: { dbMethod: "query" }
};

let appended = [];
let serverRef, base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, nxt) => {
    req.auth = { subjectId: "subj_1", sessionId: "sess_1", isStudyParticipant: true };
    nxt();
  });
  app.use("/api", createNextRouter({
    mlClient: fakeMl,
    append: async (_subjectId, events) => {
      appended.push(...events);
      return events.map((e, i) => ({ ...e, seq: i + 1 }));
    },
    findChallenge: async id => (id === CHALLENGE.id ? { ...CHALLENGE } : null),
    loadState: async () => ({
      observations: [],
      candidates: [{ challenge_id: "sec-101", skill: "sqli", mastery_required: 0 }],
      cleared: [],
      unlocked: []
    }),
    loadProgress: async () => ({ xp: 120, badges: [] }),
    loadTitles: async () => ({ "sec-101": { title: "The product search box", tier: "beginner" } }),
    loadEvents: async () => []
  }));
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

  serverRef = app.listen(0);
  await new Promise(r => serverRef.once("listening", r));
  const addr = /** @type {import("node:net").AddressInfo} */ (serverRef.address());
  base = `http://localhost:${addr.port}`;
});

after(() => serverRef.close());
beforeEach(() => { appended = []; });

describe("GET /api/next", () => {
  test("records that the recommendation was served", async () => {
    mlBehaviour = "ok";
    const r = await fetch(base + "/api/next");
    assert.equal(r.status, 200);

    const served = appended.filter(e => e.type === "recommendation.served");
    assert.equal(served.length, 1);
    assert.equal(served[0].payload.challengeId, "sec-104");
    assert.equal(served[0].payload.pMastery, 0.42);
    assert.equal(served[0].payload.policy, "bkt-adaptive");
  });

  test("the event carries no wasFollowed field", async () => {
    mlBehaviour = "ok";
    await fetch(base + "/api/next");
    const [served] = appended.filter(e => e.type === "recommendation.served");
    // Storing it would mean editing the event later, which the append-only rule
    // forbids. It is derived by deriveFollowed instead.
    assert.ok(!("wasFollowed" in served.payload));
  });

  test("never ships the rules or the test suites to the learner", async () => {
    mlBehaviour = "ok";
    const body = await (await fetch(base + "/api/next")).json();
    const blob = JSON.stringify(body);

    // Any of these turns the puzzle into a reading exercise, and returning the
    // lean document directly would have leaked all of them.
    assert.ok(!("rules" in body.challenge));
    assert.ok(!("attackSuite" in body.challenge));
    assert.ok(!("functionalSuite" in body.challenge));
    assert.ok(!("hints" in body.challenge));
    assert.ok(!blob.includes("no-string-interpolation"));
    assert.ok(!blob.includes("OR '1'='1'"));
    assert.ok(!blob.includes("Pass the SQL"));

    // Counts are fine: the interface needs "0/2 repelled" without naming them.
    assert.equal(body.challenge.attackCount, 2);
    assert.equal(body.challenge.hintCount, 3);
  });

  test("a downed ML service is 503, not 500", async () => {
    mlBehaviour = "down";
    const r = await fetch(base + "/api/next");
    assert.equal(r.status, 503);
    const body = await r.json();
    assert.match(body.error, /adaptive layer/i);
    // Nothing was served, so nothing may be recorded as served.
    assert.equal(appended.length, 0);
  });

  test("exhausted content is a normal response, not an error", async () => {
    mlBehaviour = "empty";
    const r = await fetch(base + "/api/next");
    assert.equal(r.status, 200);
    assert.equal((await r.json()).challenge, null);
    assert.equal(appended.length, 0);
  });

  test("a recommendation the content store does not have fails loudly", async () => {
    mlBehaviour = "unknown";
    const r = await fetch(base + "/api/next");
    assert.equal(r.status, 500);
    // Model and content are out of sync; recording a serve for a challenge the
    // learner never saw would corrupt the follow-rate measurement.
    assert.equal(appended.length, 0);
  });
});

describe("spot items over the wire", () => {
  test("ship how many lines to pick, never which, and never the decoys", async () => {
    mlBehaviour = "ok";
    const spot = {
      id: "spot-x", title: "Which line?", skill: "sqli", tier: "beginner", format: "spot",
      vulnerable: "a\nb\nc", flawedLines: [2], decoyLines: { 1: "reads only", 3: "sound" },
      hints: ["h"], attackSuite: [], functionalSuite: []
    };
    const app = express();
    app.use((req, _res, nxt) => { req.auth = { subjectId: "s", sessionId: "x", isStudyParticipant: false }; nxt(); });
    app.use("/api", createNextRouter({
      mlClient: fakeMl,
      append: async (_s, ev) => ev.map((e, i) => ({ ...e, seq: i + 1 })),
      findChallenge: async () => spot,
      loadState: async () => ({ observations: [], candidates: [], cleared: [], unlocked: [] })
    }));
    const srv = app.listen(0);
    await new Promise(r => srv.once("listening", r));
    const port = /** @type {import("node:net").AddressInfo} */ (srv.address()).port;
    const body = await (await fetch(`http://localhost:${port}/api/challenges/spot-x/start`, { method: "POST" })).json();
    srv.close();

    assert.equal(body.challenge.flawedCount, 1);
    const blob = JSON.stringify(body);
    // Either of these would let a learner find the answer by elimination.
    assert.ok(!blob.includes("flawedLines"));
    assert.ok(!blob.includes("decoyLines"));
    assert.ok(!blob.includes("reads only"));
  });
});

describe("POST /api/challenges/:id/start", () => {
  test("records the start", async () => {
    const r = await fetch(base + "/api/challenges/sec-104/start", { method: "POST" });
    assert.equal(r.status, 200);
    const started = appended.filter(e => e.type === "challenge.started");
    assert.equal(started.length, 1);
    assert.equal(started[0].payload.challengeId, "sec-104");
    assert.equal(started[0].payload.skill, "sqli");
  });

  test("an unknown challenge is 404 and records nothing", async () => {
    const r = await fetch(base + "/api/challenges/nope/start", { method: "POST" });
    assert.equal(r.status, 404);
    assert.equal(appended.length, 0);
  });

  test("starting also hides the answers", async () => {
    const body = await (await fetch(base + "/api/challenges/sec-104/start", { method: "POST" })).json();
    assert.ok(!("rules" in body.challenge));
    assert.ok(!("attackSuite" in body.challenge));
  });
});

/** @type {import("../src/ml-client.js").LearnerState} */
const EMPTY_STATE = { observations: [], candidates: [], cleared: [], unlocked: [] };

describe("GET /api/progress", () => {
  test("returns mastery, the tree and what is cleared", async () => {
    mlBehaviour = "ok";
    const body = await (await fetch(base + "/api/progress")).json();
    assert.equal(typeof body.mastery, "object");
    assert.ok(Array.isArray(body.nodes));
    assert.ok(Array.isArray(body.cleared));
    assert.equal(body.degraded, false);
  });

  test("never ships challenge content with the tree", async () => {
    mlBehaviour = "ok";
    const blob = JSON.stringify(await (await fetch(base + "/api/progress")).json());
    // A tree carrying full challenge documents would hand over every locked
    // challenge in advance, answers included.
    assert.ok(!blob.includes("vulnerable"));
    assert.ok(!blob.includes("attackSuite"));
    assert.ok(!blob.includes("no-string-interpolation"));
  });

  test("still shows earned progress when the model is unavailable", async () => {
    mlBehaviour = "down";
    const res = await fetch(base + "/api/progress");
    // Cleared challenges and XP are facts from the log, not predictions. An error
    // page here would hide progress the learner actually earned.
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.degraded, true);
    assert.ok(Array.isArray(body.nodes));
  });
});

describe("ml client", () => {
  test("refuses to guess a base URL", async () => {
    delete process.env.ML_SERVICE_URL;
    await assert.rejects(() => createMlClient().recommend(EMPTY_STATE), /ML_SERVICE_URL is not set/);
  });

  test("204 means no content left, not a failure", async () => {
    const client = createMlClient({
      baseUrl: "http://ml.test",
      fetchImpl: async () => new Response(null, { status: 204 })
    });
    assert.equal(await client.recommend(EMPTY_STATE), null);
  });

  test("a slow service times out rather than hanging the request", async () => {
    const client = createMlClient({
      baseUrl: "http://ml.test",
      timeoutMs: 20,
      fetchImpl: (_url, opts) => new Promise((_resolve, reject) => {
        /** @type {AbortSignal} */ (opts.signal).addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      })
    });
    await assert.rejects(() => client.recommend(EMPTY_STATE), /did not respond within 20ms/);
  });

  test("sends the learner state as a POST body", async () => {
    /** @type {{ method: string|undefined, body: any }[]} */
    const calls = [];
    const client = createMlClient({
      baseUrl: "http://ml.test",
      fetchImpl: async (_url, opts) => {
        calls.push({ method: opts.method, body: JSON.parse(String(opts.body)) });
        return Response.json({ challenge_id: "a", skill: "sqli", p_mastery: 0.2,
                               policy: "bkt-adaptive", reason: "r", mastery: {}, unlocked: [] });
      }
    });
    await client.recommend({
      observations: [{ skill: "sqli", correct: true }],
      candidates: [{ challenge_id: "a", skill: "sqli" }],
      cleared: ["b"], unlocked: ["a"]
    });
    assert.equal(calls.length, 1, "fetchImpl must have been called exactly once");
    assert.equal(calls[0].method, "POST");
    // The service is stateless, so everything it needs must be in the body.
    assert.deepEqual(calls[0].body.observations, [{ skill: "sqli", correct: true }]);
    assert.deepEqual(calls[0].body.cleared, ["b"]);
    assert.deepEqual(calls[0].body.unlocked, ["a"]);
  });

  test("maps the service's snake_case payload to the API's shape", async () => {
    const client = createMlClient({
      baseUrl: "http://ml.test",
      fetchImpl: async () => Response.json({
        challenge_id: "xss.a", skill: "xss", p_mastery: 0.31,
        policy: "bkt-adaptive", reason: "xss is weakest at 0.31",
        mastery: { xss: 0.31 }, unlocked: ["xss.a"], capstone_unlocked: false
      })
    });
    const rec = await client.recommend(EMPTY_STATE);
    assert.ok(rec, "a 200 response must produce a recommendation");
    assert.equal(rec.challengeId, "xss.a");
    assert.equal(rec.pMastery, 0.31);
  });
});
