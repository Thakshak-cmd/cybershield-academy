#!/usr/bin/env node
// @ts-check

/**
 * Start the whole platform with one command.
 *
 * Three processes have to run together -- the BKT service, the API and the front
 * end -- and remembering three terminals in the right order is friction every
 * single time. `concurrently` would do this, but it is a dependency to solve a
 * problem that is fifty lines of child_process, and it would not know how to wait
 * on a health endpoint or explain a missing virtualenv.
 *
 *   npm run dev          throwaway in-memory database
 *   npm run dev:atlas    the real database named in .env.local
 *
 * Ctrl+C stops all three.
 *
 * Named .mjs rather than .js so Node knows it is a module without the workspace
 * root declaring type:module, which would change how every other plain .js file
 * in the repository is interpreted.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UVICORN = join(ROOT, "services/ml/.venv/bin/uvicorn");

const c = (code, s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = s => c("2", s);
const bold = s => c("1", s);
const red = s => c("31", s);
const green = s => c("32", s);

// Against the real database the API reads .env.local and does not seed: the
// challenges are loaded once with `npm run seed`, and reseeding on every start
// would overwrite content mid-study.
const ATLAS = process.argv.includes("--atlas");
const ENV_FILE = join(ROOT, ".env.local");

const SERVICES = [
  {
    name: "ml",
    colour: "35",
    port: 8811,
    health: "http://localhost:8811/health",
    command: UVICORN,
    args: ["app:app", "--port", "8811", "--app-dir", join(ROOT, "services/ml"),
           "--log-level", "warning", "--loop", "asyncio"],
    missing: () =>
      !existsSync(UVICORN) &&
      "The BKT service virtualenv is missing.\n" +
      "  cd services/ml && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt"
  },
  {
    name: "api",
    colour: "36",
    port: 3001,
    health: "http://localhost:3001/api/health",
    command: ATLAS ? process.execPath : "npm",
    args: ATLAS
      ? [`--env-file=${ENV_FILE}`, join(ROOT, "apps/api/src/server.js")]
      : ["run", "dev:memory", "--workspace", "@cybershield/api"],
    missing: () =>
      ATLAS && !existsSync(ENV_FILE) &&
      "--atlas needs .env.local with MONGODB_URI set. See .env.example."
  },
  {
    name: "web",
    colour: "33",
    port: 5173,
    health: "http://localhost:5173",
    command: "npm",
    args: ["run", "dev", "--workspace", "@cybershield/web"]
  }
];

/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
let shuttingDown = false;

/** A port already in use is almost always a leftover from a previous run. */
function portFree(port) {
  return new Promise(resolve => {
    const probe = createServer()
      .once("error", () => resolve(false))
      .once("listening", () => probe.close(() => resolve(true)))
      .listen(port, "127.0.0.1");
  });
}

async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

function start(service) {
  const child = spawn(service.command, service.args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    // Each service is told its own port. An inherited PORT -- which some
    // launchers export for the web server -- would otherwise send the API to
    // the same port as Vite, where it silently loses.
    env: { ...process.env, PORT: String(service.port) }
  });
  children.push(child);

  const tag = c(service.colour, service.name.padEnd(3));
  const relay = stream => {
    let buffer = "";
    stream.on("data", chunk => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        // npm's own lifecycle banner is noise three times over.
        if (!line.trim() || /^> |^npm (warn|notice)/.test(line)) continue;
        console.log(`${tag} ${dim("|")} ${line}`);
      }
    });
  };
  relay(child.stdout);
  relay(child.stderr);

  child.on("exit", code => {
    if (shuttingDown) return;
    // One service dying leaves the others half-working, which is more confusing
    // than stopping outright.
    console.log(`\n${red(`${service.name} exited with code ${code}.`)} Stopping the rest.`);
    shutdown(1);
  });

  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 400);
}

process.on("SIGINT", () => { console.log(dim("\nstopping...")); shutdown(0); });
process.on("SIGTERM", () => shutdown(0));

// --------------------------------------------------------------------------- //

console.log(bold("\nCyberShield Academy\n"));

for (const service of SERVICES) {
  const problem = service.missing?.();
  if (problem) {
    console.error(red(problem));
    process.exit(1);
  }
  if (!(await portFree(service.port))) {
    console.error(red(`Port ${service.port} is already in use (${service.name}).`));
    console.error(dim(`  lsof -ti:${service.port} | xargs kill`));
    process.exit(1);
  }
}

for (const service of SERVICES) start(service);

// Report readiness rather than guessing at a delay: the API seeds a database on
// startup and takes noticeably longer than the other two.
const deadline = Date.now() + 60_000;
const pending = new Set(SERVICES.map(s => s.name));

while (pending.size && Date.now() < deadline && !shuttingDown) {
  for (const service of SERVICES) {
    if (!pending.has(service.name)) continue;
    if (await reachable(service.health)) {
      pending.delete(service.name);
      console.log(`${green("ready")} ${service.name} ${dim(`:${service.port}`)}`);
    }
  }
  if (pending.size) await new Promise(r => setTimeout(r, 400));
}

if (!shuttingDown) {
  if (pending.size) {
    console.log(red(`\nStill waiting on: ${[...pending].join(", ")}`));
  } else {
    console.log(`
${bold("  http://localhost:5173")}

  ${ATLAS
    ? dim("Using the database in .env.local. Everything you do here is kept.")
    : `${dim("Register a handle to begin. Study code:")} ${bold("AURORA-2026")}
  ${dim("The database is in memory and is discarded when this stops.")}`}

  ${dim("Ctrl+C to stop all three.")}
`);
  }
}
