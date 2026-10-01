import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { encrypt, decrypt } from "../../../scripts/study/crypt.mjs";
import { collectExport, sealExport, readWithdrawn } from "../../../scripts/study/export.mjs";
import { withdraw } from "../../../scripts/study/withdraw.mjs";

/**
 * The study-data tools: the export that backs the study up, and the withdrawal
 * that honours a participant's right to leave. Both against a real mongod,
 * because what matters -- what is left behind after a deletion -- only exists
 * in the database.
 */

const PASS = "correct horse battery staple";

describe("export encryption", () => {
  test("round-trips", async () => {
    const plain = Buffer.from("participant data");
    assert.deepEqual(await decrypt(await encrypt(plain, PASS), PASS), plain);
  });

  test("a wrong passphrase fails rather than producing garbage", async () => {
    const sealed = await encrypt(Buffer.from("x"), PASS);
    await assert.rejects(decrypt(sealed, "not the passphrase at all"), /Could not decrypt/);
  });

  test("an altered file fails", async () => {
    const sealed = await encrypt(Buffer.from("participant data"), PASS);
    sealed[sealed.length - 1] ^= 1;
    await assert.rejects(decrypt(sealed, PASS), /altered or damaged/);
  });

  test("refuses a short passphrase", async () => {
    await assert.rejects(encrypt(Buffer.from("x"), "short"), /at least 12/);
  });
});

/** @type {MongoMemoryServer} */
let mongod;
let models;
let dir;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("cybershield_tools"));
  models = await import("../src/models/index.js");
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all(["User", "Event", "Progress", "Counter", "Challenge"].map(m => models[m].deleteMany({})));
  dir = mkdtempSync(join(tmpdir(), "cybershield-study-"));

  const ev = (subjectId, seq, study, type = "challenge.attempted") => ({
    schemaVersion: 1, subjectId, sessionId: "s", seq, occurredAt: new Date(),
    isStudyParticipant: study, type, payload: { challengeId: "sec-101", correct: true }
  });
  await models.Event.insertMany([
    ev("subj_a", 1, true), ev("subj_a", 2, true),
    ev("subj_b", 1, true), ev("subj_b", 3, true),            // seq 2 is missing
    ev("subj_staff", 1, false)
  ]);
  await models.User.create([
    { handle: "owl", passwordHash: "h", subjectId: "subj_a", isStudyParticipant: true },
    { handle: "lark", passwordHash: "h", subjectId: "subj_b", isStudyParticipant: true }
  ]);
  await models.Progress.create({ subjectId: "subj_a", xp: 120 });
  await models.Counter.create({ _id: "subj_a", seq: 2 });
  await models.Challenge.create({ id: "sec-101", title: "t", skill: "sqli", tier: "beginner",
                                  validator: "ast-diff", vulnerable: "x", rules: [] });
});

describe("the study export", () => {
  test("takes study participants only, and never the accounts", async () => {
    const data = await collectExport(models);
    assert.equal(data.manifest.scope, "study");
    assert.deepEqual(Object.keys(data.manifest.perSubject).sort(), ["subj_a", "subj_b"]);
    const blob = JSON.stringify(data);
    assert.ok(!blob.includes("owl") && !blob.includes("passwordHash"), "handles and hashes stay behind");
    assert.equal(data.catalogue[0].id, "sec-101");
    assert.ok(!("vulnerable" in data.catalogue[0]), "only what the analysis needs");
  });

  test("reports a gap in someone's sequence instead of hiding it", async () => {
    const { manifest } = await collectExport(models);
    assert.deepEqual(manifest.gaps, ["subj_b: expected seq 2, found 3"]);
  });

  test("seals to a file that only the passphrase opens", async () => {
    const { file } = await sealExport(await collectExport(models), PASS);
    assert.ok(!file.includes(Buffer.from("subj_a")), "nothing readable in the file");
  });

  test("leaves out anyone on the withdrawn list", async () => {
    const data = await collectExport(models, { withdrawn: new Set(["subj_b"]) });
    assert.deepEqual(Object.keys(data.manifest.perSubject), ["subj_a"]);
    assert.equal(data.manifest.withdrawnExcluded, 2);
  });
});

describe("withdrawal", () => {
  test("without --confirm it only reports", async () => {
    const file = join(dir, "withdrawn.txt");
    const r = await withdraw(models, { handle: "owl", withdrawnFile: file });
    assert.equal(r.deleted, null);
    assert.deepEqual(r.found, { account: 1, events: 2, progress: 1, counter: 1 });
    assert.equal(await models.Event.countDocuments({ subjectId: "subj_a" }), 2);
    assert.equal(readWithdrawn(file).size, 0);
  });

  test("with --confirm it removes everything of theirs and nobody else's", async () => {
    const file = join(dir, "withdrawn.txt");
    const r = await withdraw(models, { handle: "owl", confirm: true, withdrawnFile: file });
    assert.deepEqual(r.deleted, { account: 1, events: 2, progress: 1, counter: 1 });
    for (const m of ["Event", "Progress"]) {
      assert.equal(await models[m].countDocuments({ subjectId: "subj_a" }), 0, m);
    }
    assert.equal(await models.User.countDocuments({ subjectId: "subj_a" }), 0);
    assert.equal(await models.Counter.countDocuments({ _id: "subj_a" }), 0);
    assert.equal(await models.Event.countDocuments({ subjectId: "subj_b" }), 2, "others untouched");
    assert.ok(readWithdrawn(file).has("subj_a"));
    rmSync(dir, { recursive: true, force: true });
  });

  test("is recorded once, however many times it runs", async () => {
    const file = join(dir, "withdrawn.txt");
    await withdraw(models, { subjectId: "subj_a", confirm: true, withdrawnFile: file });
    await withdraw(models, { subjectId: "subj_a", confirm: true, withdrawnFile: file });
    assert.equal(readFileSync(file, "utf8").trim().split("\n").length, 1);
  });

  test("an unknown handle is an error, not a silent no-op", async () => {
    await assert.rejects(withdraw(models, { handle: "nobody", withdrawnFile: join(dir, "w.txt") }), /No account/);
  });
});
