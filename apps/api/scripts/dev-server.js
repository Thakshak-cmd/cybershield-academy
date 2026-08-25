#!/usr/bin/env node
// @ts-check

/**
 * The API against a throwaway MongoDB, for front-end work.
 *
 * Atlas is not set up yet, and waiting on it would block every screen that needs
 * a real login. This starts an in-process mongod, seeds the challenges, and
 * serves the ordinary app -- so the browser talks to the real routes, the real
 * validator and the real event log. Nothing here is a stub.
 *
 * State is discarded when the process exits, which is the point: every run starts
 * from a clean database.
 *
 *   npm run dev:api
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { randomBytes } from "node:crypto";

const PORT = process.env.PORT || 3001;

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri("cybershield_dev");
process.env.JWT_SECRET ||= randomBytes(32).toString("hex");
process.env.ML_SERVICE_URL ||= "http://localhost:8811";
process.env.STUDY_ENROLMENT_CODE ||= "AURORA-2026";

const { connect } = await import("../src/db.js");
await connect();

const { seed } = await import("../src/seed.js");
const ids = await seed();

const { createApp } = await import("../src/app.js");
const server = createApp().listen(PORT, () => {
  console.log(`api        http://localhost:${PORT}`);
  console.log(`mongodb    in-memory, discarded on exit`);
  console.log(`challenges ${ids.join(", ")}`);
  console.log(`study code ${process.env.STUDY_ENROLMENT_CODE}`);
  console.log(`\nCtrl+C to stop.`);
});

const shutdown = async () => {
  server.close();
  await mongod.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
