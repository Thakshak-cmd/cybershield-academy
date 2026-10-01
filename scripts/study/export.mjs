#!/usr/bin/env node
// @ts-check
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { askPassphrase, decrypt, encrypt } from "./crypt.mjs";

/**
 * Export the study's event log to an encrypted file on this machine.
 *
 *   npm run study:export              study participants only (the research data)
 *   npm run study:export -- --all     every account, for operational debugging
 *
 * What goes in: the events, and the challenge catalogue the analysis needs to
 * interpret them. What never goes in: the users collection. Handles are the one
 * thing in the database a participant chose, so they stay behind; the analysis
 * works on subjectIds, which are random and mean nothing on their own.
 *
 * Anyone listed in data/study/withdrawn.txt is left out even if their events are
 * somehow still in the database.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const STUDY_DIR = join(ROOT, "data/study");
export const WITHDRAWN_FILE = join(STUDY_DIR, "withdrawn.txt");

/** Subject ids that have withdrawn. Read by both the export and the analysis. */
export function readWithdrawn(file = WITHDRAWN_FILE) {
  if (!existsSync(file)) return new Set();
  return new Set(readFileSync(file, "utf8").split("\n")
    .map(l => l.split("\t")[0].trim()).filter(Boolean));
}

/**
 * Gather the export from an open database connection.
 *
 * @param {{ Event: any, Challenge: any }} models
 * @param {{ includeAll?: boolean, withdrawn?: Set<string>, now?: Date }} [options]
 */
export async function collectExport({ Event, Challenge }, { includeAll = false, withdrawn = new Set(), now = new Date() } = {}) {
  const query = includeAll ? {} : { isStudyParticipant: true };
  const raw = await Event.find(query, { _id: 0, __v: 0 }).sort({ subjectId: 1, seq: 1 }).lean();
  const events = raw.filter(e => !withdrawn.has(e.subjectId));

  const catalogue = await Challenge.find({}, {
    _id: 0, id: 1, skill: 1, subSkill: 1, format: 1, tier: 1,
    isDrill: 1, isBoss: 1, masteryRequired: 1, requires: 1
  }).sort({ id: 1 }).lean();

  /** @type {Record<string, number>} */
  const perSubject = {};
  /** @type {string[]} */
  const gaps = [];
  let previous = null;
  for (const e of events) {
    perSubject[e.subjectId] = (perSubject[e.subjectId] ?? 0) + 1;
    const expected = previous?.subjectId === e.subjectId ? previous.seq + 1 : 1;
    if (e.seq !== expected) gaps.push(`${e.subjectId}: expected seq ${expected}, found ${e.seq}`);
    previous = e;
  }

  return {
    manifest: {
      format: "cybershield-export",
      version: 1,
      exportedAt: now.toISOString(),
      scope: includeAll ? "all" : "study",
      subjects: Object.keys(perSubject).length,
      events: events.length,
      withdrawnExcluded: raw.length - events.length,
      perSubject,
      // A gap means events are missing from someone's log. Reported, not fixed:
      // the export is a copy of what is there, and repairing it would be invention.
      gaps
    },
    catalogue,
    events
  };
}

/** @param {object} data */
export async function sealExport(data, passphrase) {
  const plain = Buffer.from(JSON.stringify(data));
  return {
    file: await encrypt(gzipSync(plain), passphrase),
    sha256: createHash("sha256").update(plain).digest("hex")
  };
}

/**
 * Open an export. Used by the analysis, which never touches the database.
 *
 * @param {string} path
 * @param {string} passphrase
 */
export async function readExport(path, passphrase) {
  const data = JSON.parse(gunzipSync(await decrypt(readFileSync(path), passphrase)).toString("utf8"));
  if (data?.manifest?.format !== "cybershield-export") throw new Error("Not a CyberShield export.");
  return data;
}

async function main() {
  const includeAll = process.argv.includes("--all");
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set. Run this through npm run study:export, which reads .env.local.");
  }

  const passphrase = await askPassphrase("Passphrase to encrypt the export with: ");
  const { connect, disconnect } = await import("../../apps/api/src/db.js");
  const models = await import("../../apps/api/src/models/index.js");
  await connect();

  try {
    const data = await collectExport(models, { includeAll, withdrawn: readWithdrawn() });
    const { file, sha256 } = await sealExport(data, passphrase);

    const dir = join(STUDY_DIR, "exports");
    mkdirSync(dir, { recursive: true });
    const stamp = data.manifest.exportedAt.replace(/[-:]/g, "").slice(0, 13);
    const path = join(dir, `cybershield-${data.manifest.scope}-${stamp}.csx`);
    writeFileSync(path, file, { mode: 0o600 });

    const m = data.manifest;
    console.log(`Exported ${m.events} events from ${m.subjects} ${m.scope === "study" ? "participant" : "account"}(s).`);
    if (m.withdrawnExcluded) console.log(`Left out ${m.withdrawnExcluded} event(s) from withdrawn participants.`);
    if (m.gaps.length) {
      console.log(`\nWARNING: ${m.gaps.length} gap(s) in event sequences:`);
      for (const g of m.gaps) console.log(`  ${g}`);
    }
    console.log(`\n${path}`);
    console.log(`sha256 of contents: ${sha256}`);
    console.log("Keep the passphrase somewhere other than this machine. Without it the file cannot be opened.");
  } finally {
    await disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
