// @ts-check
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * promisify loses scrypt's options overload, so the promisified form is declared
 * explicitly rather than casting at each of the three call sites.
 *
 * @type {(password: string|Buffer, salt: string|Buffer, keylen: number,
 *         options: import("node:crypto").ScryptOptions) => Promise<Buffer>}
 */
const scryptAsync = /** @type {any} */ (promisify(scrypt));

/**
 * Credential handling, as pure functions.
 *
 * Kept away from Express and Mongo so the security-relevant behaviour -- how
 * passwords are stored, how comparison is done, what a token may carry -- is
 * testable directly rather than through a request.
 */

/**
 * scrypt parameters.
 *
 * Argon2id is the current first recommendation, but every Node binding for it is
 * a native module, which means compilation in the deployment image. scrypt is
 * OWASP-acceptable, ships in the standard library, and adds no supply-chain
 * surface -- which matters more than usual for a platform about secure coding.
 *
 * N=2^17 is OWASP's stated minimum for scrypt: 128MB and about 270ms per hash on
 * this hardware. Measured before choosing rather than assumed -- 2^16 was the
 * first guess, and finding it cost only 136ms meant the recommended parameter was
 * affordable after all.
 *
 * Serverless memory is per-invocation, not shared, so 128MB sits comfortably
 * inside a 1024MB function even with the whole study cohort signing in at once.
 * The figures, and the fact that they were measured, belong in the dissertation
 * rather than appearing as a magic number.
 */
export const SCRYPT = Object.freeze({
  N: 2 ** 17,
  r: 8,
  p: 1,
  keyLength: 64,
  // Node's default maxmem is 32MB, which N=2^17 exceeds -- without this, hashing
  // throws outright rather than running slowly, and only once the cost factor is
  // raised, which is exactly when nobody is looking for a new failure mode.
  maxmem: 256 * 1024 * 1024
});

const HASH_VERSION = "scrypt$1";

/**
 * Hash a password for storage.
 *
 * The salt is random per password and stored alongside the hash. The version
 * prefix means parameters can be raised later without invalidating every existing
 * credential: a login can detect an old prefix and re-hash on success.
 *
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, SCRYPT.keyLength, SCRYPT);
  return `${HASH_VERSION}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/**
 * Verify a password against a stored hash.
 *
 * Comparison is constant-time. A plain `===` on the derived keys leaks how much
 * of the hash matched through timing, which is the classic way a comparison that
 * "obviously works" turns out not to.
 *
 * @param {string} password
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  // "scrypt", "1", salt, hash
  if (parts.length !== 4 || `${parts[0]}$${parts[1]}` !== HASH_VERSION) return false;

  const salt = Buffer.from(parts[2], "base64");
  const expected = Buffer.from(parts[3], "base64");
  if (expected.length !== SCRYPT.keyLength) return false;

  const derived = await scryptAsync(password, salt, SCRYPT.keyLength, SCRYPT);
  return timingSafeEqual(derived, expected);
}

/**
 * Do the work of a verification without having a user.
 *
 * Called when a handle does not exist, so that a login attempt against an unknown
 * account takes about as long as one against a real account. Returning early
 * instead would turn response time into a user-enumeration oracle: an attacker
 * could discover which handles are registered without ever guessing a password.
 *
 * @param {string} password
 */
export async function burnComparableTime(password) {
  const salt = randomBytes(16);
  await scryptAsync(password, salt, SCRYPT.keyLength, SCRYPT);
  return false;
}

/* ------------------------------------------------------------------ handles */

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9_-]{1,30})[a-z0-9]$/;

/**
 * Validate a handle.
 *
 * Handles are the only identifier a study participant supplies. They are
 * deliberately not email addresses: the approved ethics protocol keeps the
 * mapping from participant to identity in the researcher's separate consent
 * record, so this database must not hold anything that identifies a person.
 *
 * @param {unknown} value
 * @returns {{ ok: true, handle: string } | { ok: false, error: string }}
 */
export function normaliseHandle(value) {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: "Choose a handle." };
  }
  const handle = value.trim().toLowerCase();

  if (handle.includes("@")) {
    return {
      ok: false,
      error: "Use a handle rather than an email address — we deliberately don't store one."
    };
  }
  if (!HANDLE_RE.test(handle)) {
    return {
      ok: false,
      error: "Handles are 3–32 characters: letters, numbers, hyphens and underscores."
    };
  }
  return { ok: true, handle };
}

/** Minimum length only. Composition rules push people towards Password1! */
const MIN_PASSWORD = 10;

/**
 * @param {unknown} value
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function checkPassword(value) {
  if (typeof value !== "string" || !value) {
    return { ok: false, error: "Choose a password." };
  }
  if (value.length < MIN_PASSWORD) {
    return { ok: false, error: `Passwords need at least ${MIN_PASSWORD} characters.` };
  }
  // scrypt handles long input fine, but an unbounded password is an easy way to
  // make the server do arbitrary work.
  if (value.length > 200) {
    return { ok: false, error: "That password is too long." };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------- tokens */

/**
 * A subject identifier: opaque, random, and unrelated to the handle.
 *
 * Deriving it from the handle -- even by hashing -- would make the event log
 * linkable back to an account by anyone holding the handle list, which is exactly
 * the separation the ethics protocol depends on.
 */
export function newSubjectId() {
  return `subj_${randomBytes(12).toString("hex")}`;
}

export function newSessionId() {
  return `sess_${randomUUID()}`;
}

/**
 * The claims a token may carry.
 *
 * Only the pseudonym, the session and the study flag. Putting the handle in here
 * would mean every request -- and anything that logs a decoded token -- carried
 * an identifier the rest of the system is built to avoid.
 *
 * @param {{ subjectId: string, sessionId: string, isStudyParticipant: boolean }} user
 */
export function tokenClaims({ subjectId, sessionId, isStudyParticipant }) {
  return { sub: subjectId, sid: sessionId, study: !!isStudyParticipant };
}

/** Sessions expire. A token that never expires is a permanent credential. */
export const TOKEN_TTL = "12h";
