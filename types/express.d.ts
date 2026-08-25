// Type-only declaration. No runtime, no build step -- it exists so `req.auth` is
// typed on every route instead of being cast in each handler.
import "express";

declare module "express-serve-static-core" {
  interface Request {
    /**
     * The caller's pseudonymous identity, attached by requireAuth.
     *
     * Declared non-optional because app.js mounts requireAuth ahead of every route
     * that reads it -- any handler able to see this property has already passed
     * authentication. The only route mounted before requireAuth is /api/health,
     * which never touches it.
     */
    auth: {
      subjectId: string;
      sessionId: string;
      isStudyParticipant: boolean;
    };
  }
}
