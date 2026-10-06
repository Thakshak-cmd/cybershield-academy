#!/usr/bin/env node
// @ts-check

/**
 * The website and the API on one port, behind a password, for sharing through
 * a tunnel. Started by `npm run share`; not used for development or the study.
 *
 * One port because a tunnel exposes one address: the built front end and the API
 * share an origin, so the app's relative /api calls work unchanged.
 *
 * The database is a throwaway in-memory one unless MONGODB_URI is set (the
 * launcher sets it, from .env.local, only with --atlas). A shared demo should not
 * put strangers' accounts into the study database by default.
 */

import express from "express";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const DIST = join(ROOT, "apps/web/dist");
const PORT = Number(process.env.PORT || 4173);
const PASSWORD = process.env.SHARE_PASSWORD;

if (!PASSWORD) throw new Error("SHARE_PASSWORD is not set. Start this through npm run share.");
if (!existsSync(join(DIST, "index.html"))) throw new Error("No website build. Start this through npm run share, which builds it.");

process.env.JWT_SECRET ||= randomBytes(32).toString("hex");
process.env.ML_SERVICE_URL ||= "http://localhost:8811";

let stopDb = async () => {};
const throwaway = !process.env.MONGODB_URI;
if (throwaway) {
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("cybershield_share");
  process.env.STUDY_ENROLMENT_CODE ||= "AURORA-2026";
  stopDb = async () => { await mongod.stop(); };
  const { connect } = await import("../src/db.js");
  await connect();
  const { seed } = await import("../src/seed.js");
  await seed();
} else {
  // The real database is already seeded; seeding here would rewrite content
  // under a study in progress.
  const { connect } = await import("../src/db.js");
  await connect();
}

const { createApp } = await import("../src/app.js");
const { createShareGate } = await import("../src/share-gate.js");

const app = express();
app.disable("x-powered-by");
// The password form posts urlencoded; nothing else here does.
app.use("/__share", express.urlencoded({ extended: false, limit: "2kb" }));
app.use(createShareGate({ password: PASSWORD }).middleware);
app.use(createApp());
app.use(express.static(DIST, { index: false, maxAge: "1h" }));
// The app's own router handles /, /assignment, /manual and the rest.
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(join(DIST, "index.html")));

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`share server on http://localhost:${PORT} (${throwaway ? "throwaway database" : "real database"})`);
});

const shutdown = async () => {
  server.close();
  await stopDb();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
