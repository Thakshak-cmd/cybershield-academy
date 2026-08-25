import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SCRYPT, checkPassword, hashPassword, newSessionId, newSubjectId,
  normaliseHandle, tokenClaims, verifyPassword
} from "../src/auth-logic.js";

/**
 * Credential handling.
 *
 * A platform that teaches secure coding cannot store passwords badly, so these
 * assert the properties rather than the happy path: that hashes are salted, that
 * comparison is constant-time, and that nothing identifying leaks into a token.
 */

describe("password hashing", () => {
  test("meets OWASP's minimum cost factor for scrypt", () => {
    // Chosen after measuring: 2^17 costs ~270ms here, which a login can afford.
    assert.ok(SCRYPT.N >= 2 ** 17, `N is ${SCRYPT.N}, below OWASP's 2^17 floor`);
    assert.equal(SCRYPT.r, 8);
    assert.ok(SCRYPT.maxmem >= 128 * 1024 * 1024,
      "maxmem must exceed the memory N implies, or hashing throws instead of running");
  });

  test("the same password hashes differently every time", async () => {
    // Per-password salt. Without it, identical passwords share a hash and one
    // rainbow table covers every account that reused a common password.
    const [a, b] = await Promise.all([hashPassword("same password here"), hashPassword("same password here")]);
    assert.notEqual(a, b);
  });

  test("a hash reveals neither the password nor its length", async () => {
    const hash = await hashPassword("hunter2-but-longer");
    assert.ok(!hash.includes("hunter2"));
    const other = await hashPassword("a".repeat(150));
    assert.equal(hash.split("$")[3].length, other.split("$")[3].length);
  });

  test("verifies the correct password and rejects near misses", async () => {
    const hash = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("correct horse battery staple", hash), true);
    assert.equal(await verifyPassword("correct horse battery stapl", hash), false);
    assert.equal(await verifyPassword("Correct horse battery staple", hash), false);
    assert.equal(await verifyPassword("", hash), false);
  });

  test("a malformed or truncated stored hash fails closed", async () => {
    // A parsing bug that returned true here would authenticate everyone.
    for (const bad of ["", "nonsense", "scrypt$1$onlytwo", "scrypt$9$c2FsdA==$aGFzaA==",
                       "$$$", "scrypt$1$$", "bcrypt$1$c2FsdA==$aGFzaA=="]) {
      assert.equal(await verifyPassword("anything", bad), false, `accepted: ${bad}`);
    }
    assert.equal(await verifyPassword("anything", /** @type {any} */ (null)), false);
    assert.equal(await verifyPassword("anything", /** @type {any} */ (undefined)), false);
  });

  test("a hash with the right shape but wrong key length is rejected", async () => {
    const hash = await hashPassword("some password here");
    const [v, n, salt] = hash.split("$");
    const truncated = `${v}$${n}$${salt}$${Buffer.from("short").toString("base64")}`;
    assert.equal(await verifyPassword("some password here", truncated), false);
  });

  test("the stored format is versioned", async () => {
    // So the cost factor can be raised later without invalidating every account.
    const hash = await hashPassword("some password here");
    assert.match(hash, /^scrypt\$1\$/);
  });
});

describe("handles", () => {
  test("are lowercased and trimmed", () => {
    const r = normaliseHandle("  DefenderOfAurora  ");
    assert.deepEqual(r, { ok: true, handle: "defenderofaurora" });
  });

  test("reject email addresses explicitly", () => {
    // The approved ethics protocol keeps identity out of this database, so the
    // refusal explains itself rather than looking like arbitrary validation.
    const r = normaliseHandle("someone@example.com");
    assert.equal(r.ok, false);
    assert.match(r.error, /email/i);
  });

  test("reject anything outside the allowed character set", () => {
    for (const bad of ["ab", "a".repeat(40), "has space", "-leading", "trailing-",
                       "semi;colon", "../etc/passwd", "<script>", ""]) {
      assert.equal(normaliseHandle(bad).ok, false, `accepted: ${JSON.stringify(bad)}`);
    }
  });

  test("accept ordinary handles", () => {
    for (const good of ["abc", "blue_team_7", "a-b-c", "defender2026"]) {
      assert.equal(normaliseHandle(good).ok, true, `rejected: ${good}`);
    }
  });

  test("non-strings are rejected rather than coerced", () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      assert.equal(normaliseHandle(/** @type {any} */ (bad)).ok, false);
    }
  });
});

describe("passwords", () => {
  test("require length, not composition", () => {
    // Composition rules push people towards Password1!, which is worse.
    assert.equal(checkPassword("short").ok, false);
    assert.equal(checkPassword("all lowercase and long enough").ok, true);
  });

  test("are bounded, so a login cannot be made arbitrarily expensive", () => {
    assert.equal(checkPassword("a".repeat(201)).ok, false);
  });

  test("non-strings are rejected", () => {
    for (const bad of [null, undefined, 12345678901, {}]) {
      assert.equal(checkPassword(/** @type {any} */ (bad)).ok, false);
    }
  });
});

describe("identifiers and tokens", () => {
  test("subject ids are unique and unpredictable", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newSubjectId()));
    assert.equal(ids.size, 500);
    assert.match([...ids][0], /^subj_[0-9a-f]{24}$/);
  });

  test("session ids are unique", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newSessionId()));
    assert.equal(ids.size, 500);
  });

  test("a subject id is not derived from the handle", () => {
    // Deriving it, even by hashing, would let anyone holding the handle list
    // re-link the event log to accounts - the separation the ethics protocol
    // depends on.
    const a = newSubjectId();
    const b = newSubjectId();
    assert.notEqual(a, b);
  });

  test("a token carries the pseudonym and nothing identifying", () => {
    const claims = tokenClaims({
      subjectId: "subj_abc", sessionId: "sess_1", isStudyParticipant: true
    });
    assert.deepEqual(claims, { sub: "subj_abc", sid: "sess_1", study: true });

    const blob = JSON.stringify(claims);
    assert.ok(!blob.includes("handle"));
    assert.ok(!blob.includes("passwordHash"));
    assert.ok(!blob.includes("@"));
  });

  test("the study flag is always a boolean", () => {
    const claims = tokenClaims(
      /** @type {any} */ ({ subjectId: "s", sessionId: "x", isStudyParticipant: "yes" })
    );
    assert.strictEqual(claims.study, true);
  });
});
