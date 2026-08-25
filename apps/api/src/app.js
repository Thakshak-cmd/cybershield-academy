import express from "express";
import { connect } from "./db.js";
import { requireAuth } from "./auth.js";
import { attemptRouter } from "./routes/attempt.js";

/**
 * Lazily open (or reuse) the pooled connection for this invocation.
 *
 * Deliberately mounted *after* authentication: an unauthenticated caller should be
 * turned away by a signature check, not by a database round trip. Otherwise anyone
 * without a token can make the service open connections on their behalf.
 */
async function withDb(req, res, next) {
  try {
    await connect();
    next();
  } catch (err) {
    next(err);
  }
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  // Liveness only, and deliberately before withDb: this answers "is the process
  // up", so making it depend on Mongo would defeat its purpose.
  app.get("/api/health", (req, res) => res.json({ ok: true }));

  app.use("/api", requireAuth, withDb, attemptRouter);

  app.use((err, req, res, _next) => {
    // Logged server-side; the caller learns nothing about internals.
    console.error("[api]", err.message);
    res.status(500).json({ error: "Something went wrong on our side." });
  });

  return app;
}
