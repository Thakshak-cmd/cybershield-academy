// @ts-check
import { Router } from "express";
import jwt from "jsonwebtoken";
import { SCHEMA_VERSION } from "@cybershield/shared";
import { User } from "../models/index.js";
import { append as defaultAppend } from "../telemetry.js";
import {
  TOKEN_TTL, burnComparableTime, checkPassword, hashPassword,
  newSessionId, newSubjectId, normaliseHandle, tokenClaims, verifyPassword
} from "../auth-logic.js";

/**
 * Failed logins are counted on the account and enforced with a lockout.
 *
 * Rate limiting by IP in process memory does not work here: every serverless
 * invocation may be a fresh container, so a counter in a module variable resets
 * constantly and protects nothing. Counting against the stored user is the only
 * state that reliably persists.
 *
 * The trade-off is that an attacker who knows a handle can lock its owner out.
 * A short window rather than an indefinite lock keeps that to a nuisance, and it
 * is the right side of the trade for a platform where the alternative is an
 * unlimited online guessing budget.
 */
const MAX_FAILURES = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * @param {{ append?: typeof defaultAppend }} [deps]
 */
export function createAuthRouter(deps = {}) {
  const router = Router();
  const append = deps.append ?? defaultAppend;

  function issue(user) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET is not set");
    const sessionId = newSessionId();
    const token = jwt.sign(
      tokenClaims({
        subjectId: user.subjectId,
        sessionId,
        isStudyParticipant: user.isStudyParticipant
      }),
      secret,
      { expiresIn: TOKEN_TTL }
    );
    return { token, sessionId };
  }

  /** POST /api/auth/register */
  router.post("/auth/register", async (req, res, next) => {
    try {
      const { handle: rawHandle, password, studyCode } = req.body ?? {};

      const handleCheck = normaliseHandle(rawHandle);
      if (!handleCheck.ok) return res.status(400).json({ error: handleCheck.error });

      const passwordCheck = checkPassword(password);
      if (!passwordCheck.ok) return res.status(400).json({ error: passwordCheck.error });

      // Participants are enrolled with a code handed out in person, so a stranger
      // cannot mark themselves as study data and contaminate the results.
      const expected = process.env.STUDY_ENROLMENT_CODE;
      const isStudyParticipant = !!expected && studyCode === expected;

      const user = {
        handle: handleCheck.handle,
        passwordHash: await hashPassword(password),
        subjectId: newSubjectId(),
        isStudyParticipant,
        createdAt: new Date()
      };

      try {
        await User.create(user);
      } catch (err) {
        // The unique index is what actually prevents duplicates; checking first
        // and then inserting leaves a race between the two.
        if (/** @type {any} */ (err).code === 11000) {
          return res.status(409).json({ error: "That handle is taken." });
        }
        throw err;
      }

      const { token, sessionId } = issue(user);
      await append(user.subjectId, [sessionEvent("session.started", user, sessionId)]);

      res.status(201).json({
        token,
        handle: user.handle,
        isStudyParticipant
      });
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/auth/login */
  router.post("/auth/login", async (req, res, next) => {
    try {
      const { handle: rawHandle, password } = req.body ?? {};

      const handleCheck = normaliseHandle(rawHandle);
      if (!handleCheck.ok || typeof password !== "string") {
        // Deliberately the same message as a wrong password. Saying "no such
        // handle" would confirm which accounts exist.
        return res.status(401).json({ error: "That handle and password don't match." });
      }

      const user = await User.findOne({ handle: handleCheck.handle });

      if (!user) {
        // Spend comparable time so response latency does not reveal whether the
        // handle is registered.
        await burnComparableTime(password);
        return res.status(401).json({ error: "That handle and password don't match." });
      }

      if (user.lockedUntil && user.lockedUntil > new Date()) {
        const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
        return res.status(429).json({
          error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`
        });
      }

      const ok = await verifyPassword(password, user.passwordHash);

      if (!ok) {
        const failures = (user.failedLogins ?? 0) + 1;
        const update = { failedLogins: failures };
        if (failures >= MAX_FAILURES) {
          update.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
          update.failedLogins = 0;
        }
        await User.updateOne({ _id: user._id }, { $set: update });
        return res.status(401).json({ error: "That handle and password don't match." });
      }

      if (user.failedLogins || user.lockedUntil) {
        await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: null } });
      }

      const { token, sessionId } = issue(user);
      await append(user.subjectId, [sessionEvent("session.started", user, sessionId)]);

      res.json({
        token,
        handle: user.handle,
        isStudyParticipant: user.isStudyParticipant
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/auth/logout
   *
   * Records the end of the session. The token is not revoked -- there is no
   * server-side session list to remove it from, and a short expiry is the
   * mitigation. Saying so plainly beats implying a revocation that does not
   * happen; session boundaries are needed for the engagement metrics regardless.
   */
  router.post("/auth/logout", async (req, res, next) => {
    try {
      const { subjectId, sessionId, isStudyParticipant } = req.auth;
      await append(subjectId, [{
        schemaVersion: SCHEMA_VERSION,
        subjectId, sessionId,
        occurredAt: new Date(),
        isStudyParticipant,
        type: "session.ended",
        payload: {}
      }]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/auth/me — who the caller is, without revealing the handle in the token. */
  router.get("/auth/me", async (req, res, next) => {
    try {
      const user = await User.findOne(
        { subjectId: req.auth.subjectId },
        { handle: 1, isStudyParticipant: 1, createdAt: 1 }
      ).lean();
      if (!user) return res.status(404).json({ error: "No such account." });
      res.json({
        handle: /** @type {any} */ (user).handle,
        isStudyParticipant: /** @type {any} */ (user).isStudyParticipant,
        subjectId: req.auth.subjectId
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function sessionEvent(type, user, sessionId) {
  return {
    schemaVersion: SCHEMA_VERSION,
    subjectId: user.subjectId,
    sessionId,
    occurredAt: new Date(),
    isStudyParticipant: !!user.isStudyParticipant,
    type,
    payload: {}
  };
}
