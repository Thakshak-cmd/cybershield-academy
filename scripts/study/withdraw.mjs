#!/usr/bin/env node
// @ts-check
import { appendFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { STUDY_DIR, WITHDRAWN_FILE, readWithdrawn } from "./export.mjs";

/**
 * A participant's right to withdraw, as the ethics protocol promises it.
 *
 *   npm run study:withdraw -- --handle night_owl              show what would go
 *   npm run study:withdraw -- --handle night_owl --confirm    delete it
 *   npm run study:withdraw -- --subject subj_ab12 --confirm
 *
 * Deletes the account, every event, the progress projection and the sequence
 * counter. This is the one deliberate exception to the append-only log, and it
 * is irreversible, so it shows its work first and acts only with --confirm.
 *
 * Backups taken before the withdrawal still contain the data. The subject id is
 * therefore recorded in data/study/withdrawn.txt, which the export and the
 * analysis both honour, so an old backup can never put a withdrawn participant
 * back into the results. Deleting those old backup files outright is better
 * still, and the script says so.
 */

/**
 * @param {{ User: any, Event: any, Progress: any, Counter: any }} models
 * @param {{ handle?: string, subjectId?: string, confirm?: boolean, withdrawnFile?: string, now?: Date }} input
 */
export async function withdraw(models, { handle, subjectId, confirm = false, withdrawnFile = WITHDRAWN_FILE, now = new Date() }) {
  const { User, Event, Progress, Counter } = models;
  if (!handle && !subjectId) throw new Error("Say who: --handle <handle> or --subject <subjectId>.");

  const user = handle
    ? await User.findOne({ handle }).lean()
    : await User.findOne({ subjectId }).lean();
  const id = user?.subjectId ?? subjectId;
  if (!id) throw new Error(`No account with handle "${handle}".`);

  const found = {
    account: user ? 1 : 0,
    events: await Event.countDocuments({ subjectId: id }),
    progress: await Progress.countDocuments({ subjectId: id }),
    counter: await Counter.countDocuments({ _id: id })
  };

  if (!confirm) return { subjectId: id, found, deleted: null };

  const deleted = {
    account: (await User.deleteOne({ subjectId: id })).deletedCount,
    events: (await Event.deleteMany({ subjectId: id })).deletedCount,
    progress: (await Progress.deleteMany({ subjectId: id })).deletedCount,
    counter: (await Counter.deleteOne({ _id: id })).deletedCount
  };

  if (!readWithdrawn(withdrawnFile).has(id)) {
    mkdirSync(STUDY_DIR, { recursive: true });
    appendFileSync(withdrawnFile, `${id}\t${now.toISOString()}\n`, { mode: 0o600 });
  }
  return { subjectId: id, found, deleted };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set. Run this through npm run study:withdraw, which reads .env.local.");
  }
  const { connect, disconnect } = await import("../../apps/api/src/db.js");
  const models = await import("../../apps/api/src/models/index.js");
  await connect();
  try {
    const confirm = process.argv.includes("--confirm");
    const r = await withdraw(models, { handle: arg("--handle"), subjectId: arg("--subject"), confirm });
    const f = r.found;
    console.log(`Subject ${r.subjectId}: account ${f.account}, events ${f.events}, progress ${f.progress}, counter ${f.counter}.`);
    if (!r.deleted) {
      console.log("\nNothing deleted. Run again with --confirm to delete all of it. This cannot be undone.");
      return;
    }
    const d = r.deleted;
    console.log(`Deleted: account ${d.account}, events ${d.events}, progress ${d.progress}, counter ${d.counter}.`);
    console.log(`Recorded in ${WITHDRAWN_FILE}, so exports and the analysis will leave them out.`);
    console.log("Backups taken before now still hold their data: delete those files if you can.");
    console.log("Also remove them from your consent record, per the protocol.");
  } finally {
    await disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
