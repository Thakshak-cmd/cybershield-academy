#!/usr/bin/env node
// @ts-check
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { STUDY_DIR, readExport, sealExport } from "./export.mjs";
import { analyse, writeOutputs } from "./analyse.mjs";

/**
 * A dress rehearsal of the analysis, on simulated learners.
 *
 *   npm run study:rehearse
 *
 * Generates event logs in the platform's own shapes for twelve simulated
 * participants, seals them into an export exactly as the real thing is sealed,
 * opens it again, and runs the full analysis -- so every stage is exercised
 * before there is any real data to lose, and the tables the Evaluation chapter
 * will hold can be seen in advance.
 *
 * The answers are drawn from a BKT process, so the model has something real to
 * find. The output says SYNTHETIC at the top and must never be reported.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const P = { init: 0.15, transit: 0.2, guess: 0.2, slip: 0.1 };

/** A small seeded generator, so a rehearsal is repeatable. */
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function catalogue() {
  const dir = join(ROOT, "content/challenges");
  return readdirSync(dir).filter(f => f.endsWith(".json"))
    .map(f => JSON.parse(readFileSync(join(dir, f), "utf8")))
    .map(c => ({ id: c.id, skill: c.skill, isDrill: !!c.isDrill, isBoss: !!c.isBoss,
                 masteryRequired: c.masteryRequired ?? 0, format: c.format }));
}

/** @param {number} n @param {number} seed */
export function simulate(n = 12, seed = 7) {
  const rand = rng(seed);
  const cat = catalogue();
  const ladders = ["sqli", "xss", "csrf"].map(skill =>
    cat.filter(c => c.skill === skill && !c.isBoss).sort((a, b) => a.masteryRequired - b.masteryRequired || a.id.localeCompare(b.id)));
  const order = [];
  for (let i = 0; ladders.some(l => l[i]); i++) for (const l of ladders) if (l[i]) order.push(l[i]);
  const boss = cat.find(c => c.isBoss);

  const events = [];
  for (let k = 0; k < n; k++) {
    const subjectId = `synthetic_${String(k + 1).padStart(2, "0")}`;
    const sessionId = `${subjectId}_s1`;
    let seq = 0;
    let clock = Date.parse("2026-11-16T10:00:00Z") + k * 86400000;
    const emit = (type, payload, seconds = 0) => {
      clock += seconds * 1000;
      events.push({ schemaVersion: 1, subjectId, sessionId, seq: ++seq,
        occurredAt: new Date(clock).toISOString(), isStudyParticipant: true, type, payload });
    };
    const mastered = { sqli: rand() < P.init, xss: rand() < P.init, csrf: rand() < P.init };
    const lessoned = new Set();
    let xp = 0;
    const end = clock + 60 * 60000;

    emit("session.started", {});
    for (const c of [...order, ...(boss ? [boss] : [])]) {
      if (clock > end) break;
      if (c.isBoss && !Object.values(mastered).every(Boolean)) continue;

      const others = order.filter(o => o.id !== c.id);
      const recommended = rand() < 0.9 ? c.id : others[Math.floor(rand() * others.length)].id;
      emit("recommendation.served", { challengeId: recommended, skill: c.skill }, 5);

      if (!c.isBoss && !lessoned.has(c.skill)) {
        const lessonId = `lesson-${c.skill}`;
        const started = clock;
        emit("lesson.started", { lessonId, skill: c.skill, reread: false }, 2);
        const tries = 1 + Math.floor(rand() * 3);
        for (let t = 1; t <= tries; t++) {
          emit("lesson.practised", { lessonId, skill: c.skill, attemptNo: t, passed: t === tries && tries < 3 }, 40 + rand() * 60);
        }
        if (tries === 3) emit("lesson.revealed", { lessonId, skill: c.skill }, 5);
        for (const q of ["q1", "q2"]) emit("lesson.checked", { lessonId, skill: c.skill, questionId: q, correct: rand() < 0.75 }, 15 + rand() * 20);
        emit("lesson.completed", { lessonId, skill: c.skill, durationMs: clock - started, reread: false }, 3);
        lessoned.add(c.skill);
        // Instruction gives one extra chance to learn before the first ticket.
        if (!mastered[c.skill] && rand() < P.transit) mastered[c.skill] = true;
      }

      emit("challenge.started", { challengeId: c.id, skill: c.skill }, 3);
      let hints = 0;
      for (let attemptNo = 1; attemptNo <= 4; attemptNo++) {
        if (attemptNo > 1 && rand() < 0.3) { hints++; emit("hint.requested", { challengeId: c.id, hintLevel: hints, attemptNo }, 10); }
        const know = c.isBoss ? 0.6 : mastered[c.skill] ? 1 - P.slip : P.guess + hints * 0.15;
        const correct = rand() < know;
        const think = c.isDrill ? 20 + rand() * 40 : 60 + rand() * 150;
        emit("challenge.attempted", { challengeId: c.id, skill: c.skill, attemptNo, correct,
          countsForBkt: !c.isBoss && attemptNo === 1 && hints === 0, failedRules: [], durationMs: think * 1000 }, think);
        if (!c.isBoss && !mastered[c.skill] && rand() < P.transit) mastered[c.skill] = true;
        if (correct) {
          const award = c.isBoss ? 400 : hints ? 60 : attemptNo === 1 ? 120 : 40;
          xp += award;
          emit("challenge.completed", { challengeId: c.id, skill: c.skill, totalAttempts: attemptNo, hintsUsed: hints, xpAwarded: award }, 1);
          emit("xp.awarded", { amount: award, runningTotal: xp });
          break;
        }
      }
    }
  }

  return {
    manifest: {
      format: "cybershield-export", version: 1, synthetic: true,
      exportedAt: new Date().toISOString(), scope: "study",
      subjects: n, events: events.length, withdrawnExcluded: 0, perSubject: {}, gaps: []
    },
    catalogue: cat.map(({ id, skill, isDrill, isBoss }) => ({ id, skill, isDrill, isBoss })),
    events
  };
}

/** Plausible outcome scores for the same simulated people. */
function simulatedOutcomes(n, seed = 11) {
  const rand = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const pre = Math.round(2 + rand() * 4);
    return {
      code: `P${String(i + 1).padStart(2, "0")}`,
      pre,
      post: Math.min(10, pre + Math.round(rand() * 4)),
      sus: Math.round((55 + rand() * 35) / 2.5) * 2.5,
      sus_items: null
    };
  });
}

async function main() {
  const passphrase = "rehearsal only, not a real passphrase";
  const data = simulate();
  // Through the real seal and open, so the rehearsal tests the file format too.
  const { file } = await sealExport(data, passphrase);
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const dir = join(STUDY_DIR, "rehearsal");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "rehearsal.csx");
  writeFileSync(path, file);
  const reopened = await readExport(path, passphrase);

  const out = await analyse(reopened, { outcomes: simulatedOutcomes(12), testMax: 10, synthetic: true });
  writeOutputs(dir, out);
  console.log(out.report);
  console.log(`\nRehearsal written to ${dir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err.stack ?? err.message); process.exit(1); });
}
