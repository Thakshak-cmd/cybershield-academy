#!/usr/bin/env node
// @ts-check
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { askPassphrase } from "./crypt.mjs";
import { STUDY_DIR, readExport, readWithdrawn } from "./export.mjs";
import { bktSequences, describe, participantMetrics } from "./metrics.mjs";

/**
 * Turn an export into the Evaluation chapter's numbers.
 *
 *   npm run study:analyse -- data/study/exports/cybershield-study-....csx
 *   npm run study:analyse -- <export> --outcomes data/study/outcomes.csv --test-max 10
 *
 * Works from the encrypted export only, never the live database, so the
 * analysis is reproducible from a fixed file. Writes, under data/study/analysis
 * (gitignored):
 *
 *   report.md         the tables, ready to adapt for the chapter
 *   participants.csv  one row per participant, for SPSS/Excel/R
 *   results.json      everything, unrounded
 *
 * outcomes.csv holds the scores collected outside the platform, one row per
 * participant: `code,pre,post,sus` -- or `sus1`..`sus10` for the raw answers,
 * which are scored here. The code can be anything; pairing pre with post needs
 * only that both rows belong to the same person.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const METRICS = [
  ["activeMinutes", "Active time (min)"],
  ["sessions", "Sessions"],
  ["challengesCompleted", "Challenges completed"],
  ["holesClosed", "Holes closed (of 13)"],
  ["firstAttemptCorrectRate", "First-attempt correct rate"],
  ["attemptsPerCompletion", "Attempts per completion"],
  ["hintsRequested", "Hints requested"],
  ["medianTimeOnTaskSec", "Median time on task (s)"],
  ["followRate", "Follow-through rate"],
  ["timeToFirstActionSec", "Time to first action (s)"],
  ["lessonsCompleted", "Lessons completed"],
  ["meanLessonMinutes", "Mean lesson time (min)"],
  ["lessonCheckFirstTryRate", "Lesson check, right first time"],
  ["xp", "XP"],
  ["finalPosture", "Final posture (0-100)"]
];

/**
 * @param {any} data  a decrypted export
 * @param {{ outcomes?: any[], testMax?: number|null, synthetic?: boolean, withdrawn?: Set<string> }} [options]
 */
export async function analyse(data, { outcomes = [], testMax = null, synthetic = false, withdrawn = new Set() } = {}) {
  const events = data.events.filter(e => !withdrawn.has(e.subjectId));
  /** @type {Map<string, any[]>} */
  const bySubject = new Map();
  for (const e of events) {
    const list = bySubject.get(e.subjectId) ?? [];
    list.push(e);
    bySubject.set(e.subjectId, list);
  }

  const participants = [...bySubject].map(([subject, evs]) => ({
    subject, ...participantMetrics(evs, data.catalogue)
  }));
  const summary = Object.fromEntries(METRICS.map(([key]) => [key, describe(participants.map(p => p[key]))]));
  const sequences = [...bySubject].flatMap(([subject, evs]) => bktSequences(subject, evs));

  const py = await runPython({ sequences, outcomes, testMax });

  const results = {
    synthetic,
    manifest: { ...data.manifest, analysedAt: new Date().toISOString(), withdrawnAtAnalysis: data.events.length - events.length },
    participants: participants.length,
    capstoneHeld: participants.filter(p => p.capstoneHeld).length,
    summary,
    ...py
  };
  return { results, report: renderReport(results), csv: toCsv(participants) };
}

/** @param {object} request */
function runPython(request) {
  const ml = join(ROOT, "services/ml");
  const venv = join(ml, ".venv/bin/python");
  const python = existsSync(venv) ? venv : "python3";
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-m", "analysis.cli"], { cwd: ml, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", d => { out += d; });
    child.stderr.on("data", d => { err += d; });
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) return reject(new Error(`The Python analysis failed:\n${err}`));
      resolve(JSON.parse(out));
    });
    child.stdin.end(JSON.stringify(request));
  });
}

/** @param {string} path */
export function readOutcomes(path) {
  const [header, ...lines] = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const cols = header.split(",").map(c => c.trim().toLowerCase());
  const num = v => (v === undefined || v.trim() === "" ? null : Number(v));
  return lines.filter(l => l.trim()).map(line => {
    const cells = line.split(",");
    const get = name => cells[cols.indexOf(name)];
    const items = Array.from({ length: 10 }, (_, i) => num(get(`sus${i + 1}`)));
    return {
      code: get("code") ?? get("participant") ?? null,
      pre: num(get("pre")),
      post: num(get("post")),
      sus: num(get("sus")),
      sus_items: items.every(v => v !== null) ? items : null
    };
  });
}

/* ------------------------------------------------------------------ report */

const f = (v, dp = 2) => (v === null || v === undefined ? "–" : typeof v === "number" ? v.toFixed(dp) : String(v));
/** APA style: "p = .042", "p < .001", no leading zero. */
const p = v => (v === null || v === undefined ? "p not computable" : v < 0.001 ? "p < .001" : `p = ${v.toFixed(3).replace(/^0/, "")}`);

/** @param {any} r */
export function renderReport(r) {
  const lines = [];
  if (r.synthetic) {
    lines.push("> **SYNTHETIC DATA. A rehearsal of the pipeline, not study results. Do not report these numbers.**", "");
  }
  lines.push("# CyberShield Academy: study analysis", "");
  lines.push(`Export taken ${r.manifest.exportedAt}; analysed ${r.manifest.analysedAt}.`, "");

  lines.push("## Participants and data", "");
  lines.push(`- Participants: **${r.participants}**`);
  lines.push(`- Events analysed: ${r.manifest.events - (r.manifest.withdrawnAtAnalysis ?? 0)}`);
  lines.push(`- Withdrawn participants excluded: ${(r.manifest.withdrawnExcluded ?? 0) + (r.manifest.withdrawnAtAnalysis ?? 0)} event(s)`);
  lines.push(`- Sequence gaps found at export: ${r.manifest.gaps?.length ?? 0}`);
  lines.push(`- Capstone held: ${r.capstoneHeld} of ${r.participants}`, "");

  lines.push("## Engagement", "");
  lines.push("| Measure | n | Mean | SD | Median | Min | Max |", "|---|---|---|---|---|---|---|");
  for (const [key, label] of METRICS) {
    const d = r.summary[key];
    lines.push(`| ${label} | ${d.n} | ${f(d.mean)} | ${f(d.sd)} | ${f(d.median)} | ${f(d.min)} | ${f(d.max)} |`);
  }
  lines.push("", "Active time runs from the first to the last event of each session, so it includes any idle time within a session.", "");

  const m = r.model;
  lines.push("## Adaptive model (BKT)", "");
  lines.push(`Scored on ${m.literature_priors.n} unaided first attempts from ${m.learners} learners ` +
    `(${m.sequences} learner–skill sequences; median ${f(m.observations_per_sequence.median, 0)} attempts each). ` +
    "Every answer is predicted before the model sees it.", "");
  lines.push("| Parameters | AUC | RMSE | Accuracy | Majority-class accuracy |", "|---|---|---|---|---|");
  const row = (label, x) => `| ${label} | ${f(x.auc, 3)} | ${f(x.rmse, 3)} | ${f(x.accuracy, 3)} | ${f(x.majority_class_accuracy, 3)} |`;
  lines.push(row("Literature priors (as run in the study)", m.literature_priors));
  lines.push(row("Fitted by EM, leave-one-learner-out", m.fitted_leave_one_out), "");
  lines.push("By skill, literature priors:", "", "| Skill | n | AUC | RMSE |", "|---|---|---|---|");
  for (const [skill, x] of Object.entries(m.per_skill)) lines.push(`| ${skill} | ${x.n} | ${f(x.auc, 3)} | ${f(x.rmse, 3)} |`);
  lines.push("");
  lines.push("AUC above 0.5 is the claim that matters: the model ranks likely-correct answers above likely-wrong ones. " +
    "Accuracy means little unless it beats the majority-class baseline.");
  if (m.fit_warnings.length) {
    lines.push("", "Fitting warnings:", ...m.fit_warnings.map(w => `- ${w}`));
  }
  lines.push("");

  const o = r.outcomes;
  if (o?.knowledge) {
    const k = o.knowledge, w = k.wilcoxon;
    lines.push("## Knowledge (pre/post)", "");
    lines.push("| | n | Mean | SD | Median |", "|---|---|---|---|---|");
    for (const [label, d] of [["Pre", k.pre], ["Post", k.post], ["Change", k.change]]) {
      lines.push(`| ${label} | ${d.n} | ${f(d.mean)} | ${f(d.sd)} | ${f(d.median)} |`);
    }
    lines.push("", `Wilcoxon signed-rank (exact, two-sided): W+ = ${f(w.w_plus, 1)}, W− = ${f(w.w_minus, 1)}, ` +
      `n = ${w.n} (${w.n_zero} unchanged), ${p(w.p_value)}, rank-biserial r = ${f(w.rank_biserial)}.`);
    if (k.normalised_gain) {
      lines.push(`Normalised gain (Hake): class ⟨g⟩ = ${f(k.normalised_gain.class_gain)}, ` +
        `mean individual g = ${f(k.normalised_gain.mean_individual_gain)}` +
        (k.normalised_gain.undefined ? ` (${k.normalised_gain.undefined} at full marks beforehand, no individual gain)` : "") + ".");
    }
    lines.push("");
  }
  if (o?.sus) {
    const s = o.sus;
    lines.push("## Usability (SUS)", "");
    lines.push(`n = ${s.n}, mean ${f(s.mean, 1)} (SD ${f(s.sd, 1)}), median ${f(s.median, 1)}, range ${f(s.min, 1)}–${f(s.max, 1)}. ` +
      `${s.above_benchmark} of ${s.n} above the benchmark of ${s.benchmark}. ` +
      `Against the benchmark: Wilcoxon ${p(s.wilcoxon_vs_benchmark.p_value)}.`, "");
  }
  if (!o) lines.push("_No outcomes file given: pre/post and SUS not analysed._", "");
  return lines.join("\n");
}

function toCsv(participants) {
  if (!participants.length) return "";
  const keys = Object.keys(participants[0]);
  const cell = v => (v === null || v === undefined ? "" : String(v));
  return [keys.join(","), ...participants.map(p => keys.map(k => cell(p[k])).join(","))].join("\n") + "\n";
}

/** @param {string} dir @param {{ results: any, report: string, csv: string }} out */
export function writeOutputs(dir, out) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report.md"), out.report, { mode: 0o600 });
  writeFileSync(join(dir, "participants.csv"), out.csv, { mode: 0o600 });
  writeFileSync(join(dir, "results.json"), JSON.stringify(out.results, null, 2), { mode: 0o600 });
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith("--") && !/^\d+$/.test(a) && a.endsWith(".csx"));
  if (!file) throw new Error("Which export? npm run study:analyse -- data/study/exports/<file>.csx");
  const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

  const data = await readExport(file, await askPassphrase("Export passphrase: "));
  const outcomesPath = opt("--outcomes");
  const out = await analyse(data, {
    outcomes: outcomesPath ? readOutcomes(outcomesPath) : [],
    testMax: opt("--test-max") ? Number(opt("--test-max")) : null,
    withdrawn: readWithdrawn()
  });
  const dir = join(STUDY_DIR, "analysis", basename(file, ".csx"));
  writeOutputs(dir, out);
  console.log(out.report);
  console.log(`\nWritten to ${dir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
