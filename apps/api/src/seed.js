import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { connect, disconnect } from "./db.js";
import { Challenge } from "./models/index.js";

/**
 * Load challenge definitions from content/challenges into the database.
 *
 * Content lives in version control as the source of truth; the collection is a
 * cache of it. Upserting by `id` keeps the operation repeatable, so running it
 * twice is not an error and editing a challenge file then re-seeding is the normal
 * authoring loop.
 */
const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "../../../content/challenges");

export async function seed() {
  const files = readdirSync(contentDir).filter(f => f.endsWith(".json"));
  const results = [];

  for (const file of files) {
    const def = JSON.parse(readFileSync(join(contentDir, file), "utf8"));
    if (!def.id) throw new Error(`${file} has no id`);
    await Challenge.findOneAndUpdate({ id: def.id }, def, { upsert: true, new: true });
    results.push(def.id);
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await connect();
  const ids = await seed();
  console.log(`seeded ${ids.length} challenge(s): ${ids.join(", ")}`);
  await disconnect();
}
