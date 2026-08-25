// @ts-check
import express from "express";
import { connect } from "./db.js";
import { requireAuth } from "./auth.js";
import { attemptRouter } from "./routes/attempt.js";
import { createNextRouter } from "./routes/next.js";
import { createAuthRouter } from "./routes/auth.js";

/**
 * Lazily open (or reuse) the pooled connection for this invocation.
 *
 * Mounted after authentication on everything except the two routes that cannot
 * require a token. An unauthenticated caller should be turned away by a signature
 * check, not by a database round trip -- otherwise anyone without a token can make
 * the service open connections on their behalf.
 */
async function withDb(req, res, next) {
  try {
    await connect();
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Registering and signing in cannot require a token, so they are the only paths
 * that reach the database before authentication.
 *
 * An explicit list rather than a prefix match: `/auth/*` would also open up
 * `/auth/me` and `/auth/logout`, which must stay authenticated. That kind of
 * regression is silent -- the routes keep working, they just stop being protected.
 */
const OPEN_PATHS = new Set(["/auth/register", "/auth/login"]);

/**
 * @param {{
 *   mlClient?: import("./ml-client.js").MlClient,
 *   append?: typeof import("./telemetry.js").append,
 *   findChallenge?: (id: string) => Promise<Record<string, any>|null>,
 *   loadState?: (subjectId: string) => Promise<import("./ml-client.js").LearnerState>
 * }} [deps]
 *   Injectable so routes can be exercised without Mongo or a running ML service.
 */
export function createApp(deps = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  // Liveness only, and deliberately before withDb: this answers "is the process
  // up", so making it depend on Mongo would defeat its purpose.
  app.get("/api/health", (req, res) => res.json({ ok: true }));

  const auth = createAuthRouter(deps);

  // withDb runs only for the open paths, never as a blanket /api middleware.
  // Mounting it for everything put the database ahead of the signature check, so
  // an unauthenticated request to any other route failed with a 500 where it
  // should have been refused with a 401.
  app.use("/api", (req, res, next) => {
    if (!OPEN_PATHS.has(req.path)) return next();
    return withDb(req, res, () => auth(req, res, next));
  });

  app.use("/api", requireAuth, withDb, auth);
  app.use("/api", requireAuth, withDb, attemptRouter);
  app.use("/api", requireAuth, withDb, createNextRouter(deps));

  app.use((err, req, res, _next) => {
    // Logged server-side; the caller learns nothing about internals.
    console.error("[api]", err.message);
    res.status(500).json({ error: "Something went wrong on our side." });
  });

  return app;
}
