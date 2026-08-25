import jwt from "jsonwebtoken";

/**
 * Attach the caller's pseudonymous identity to the request.
 *
 * The token carries subjectId, never a handle or account id, so nothing downstream
 * -- including anything written to the event log -- can associate behaviour with an
 * account without a deliberate join.
 */
export function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sign in to continue." });

  const secret = process.env.JWT_SECRET;
  if (!secret) return next(new Error("JWT_SECRET is not set"));

  try {
    const claims = jwt.verify(token, secret);
    req.auth = {
      subjectId: claims.sub,
      sessionId: claims.sid,
      isStudyParticipant: !!claims.study
    };
    if (!req.auth.subjectId || !req.auth.sessionId) {
      return res.status(401).json({ error: "Sign in to continue." });
    }
    next();
  } catch {
    return res.status(401).json({ error: "That session has expired. Sign in again." });
  }
}
