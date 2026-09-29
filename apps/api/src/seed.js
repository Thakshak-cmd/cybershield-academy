import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { isTier, isTopLevelSkill, isValidator } from "@cybershield/shared";
import { connect, disconnect } from "./db.js";
import { Challenge } from "./models/index.js";

/**
 * Load challenge definitions from content/challenges into the database.
 *
 * Validates each against the shared taxonomy on the way in. A typo in a skill or
 * tier would otherwise reach the policy as an unknown skill, where it becomes a
 * mastery bucket nobody ever practises rather than an error.
 *
 * Content lives in version control as the source of truth; the collection is a
 * cache of it. Upserting by `id` keeps the operation repeatable, so running it
 * twice is not an error and editing a challenge file then re-seeding is the normal
 * authoring loop.
 */
const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "../../../content/challenges");

/** The BKT prior a learner starts from. Kept in step with LITERATURE_PRIORS. */
const PRIOR_MASTERY = 0.15;

export async function seed() {
  const files = readdirSync(contentDir).filter(f => f.endsWith(".json"));
  const results = [];

  for (const file of files) {
    const def = JSON.parse(readFileSync(join(contentDir, file), "utf8"));
    if (!def.id) throw new Error(`${file} has no id`);
    if (!isTopLevelSkill(def.skill)) {
      throw new Error(`${file} has skill "${def.skill}", which is not in the taxonomy`);
    }
    if (!isTier(def.tier)) {
      throw new Error(`${file} has tier "${def.tier}", which is not in the taxonomy`);
    }
    if (!isValidator(def.validator)) {
      throw new Error(`${file} has validator "${def.validator}", which is not in the taxonomy`);
    }
    await Challenge.findOneAndUpdate({ id: def.id }, def, { upsert: true, new: true });
    results.push(def);
  }

  assertReachable(results);
  return results.map(d => d.id);
}

/**
 * Every skill must have a way in.
 *
 * A learner starts at the BKT prior (0.15). If a skill's cheapest challenge needs
 * more mastery than that, and nothing unlocks it, the adaptive layer correctly
 * reports that there is nothing to serve -- and the learner sees an empty screen
 * on their first visit with no way forward.
 *
 * This was a real bug: the catalogue held one challenge requiring 0.30, so every
 * new user was stranded immediately. Unit tests missed it because their fixture
 * trees always included a drill at 0.0; only running the whole stack surfaced it.
 *
 * @param {{ id: string, skill: string, masteryRequired?: number, requires?: string|null }[]} defs
 */
function assertReachable(defs) {
  const bySkill = new Map();
  for (const d of defs) {
    if (!bySkill.has(d.skill)) bySkill.set(d.skill, []);
    bySkill.get(d.skill).push(d);
  }

  for (const [skill, items] of bySkill) {
    const entry = items.find(d => (d.masteryRequired ?? 0) <= PRIOR_MASTERY && !d.requires);
    if (!entry) {
      throw new Error(
        `No entry point for "${skill}": every challenge needs mastery above the ` +
        `starting prior of ${PRIOR_MASTERY}, or has a prerequisite. A new learner ` +
        `would be served nothing. Give one challenge masteryRequired <= ${PRIOR_MASTERY} ` +
        `and no "requires".`
      );
    }
  }

  // A prerequisite naming a challenge that is not being seeded silently locks
  // everything downstream of it.
  const ids = new Set(defs.map(d => d.id));
  for (const d of defs) {
    if (d.requires && !ids.has(d.requires)) {
      throw new Error(`"${d.id}" requires "${d.requires}", which does not exist`);
    }
  }
}

// Compared as URLs, not by pasting the path after "file://": a path with a space
// in it is percent-encoded in import.meta.url, so the naive check never matched
// and running this directly did nothing, silently.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await connect();
  const ids = await seed();
  console.log(`seeded ${ids.length} challenge(s): ${ids.join(", ")}`);
  await disconnect();
}
