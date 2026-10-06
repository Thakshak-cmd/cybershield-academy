#!/usr/bin/env node
// @ts-check

/**
 * Share the platform through a private link, with one command.
 *
 *   npm run share              throwaway database (a demo; nothing kept)
 *   npm run share -- --atlas   the real database in .env.local
 *   npm run share -- --local   everything but the tunnel: check it yourself first
 *
 * Builds the website, starts the BKT service and the share server (website and
 * API on one port, behind a password), then opens a Cloudflare quick tunnel and
 * prints the link and the password. Ctrl+C stops everything.
 *
 * The link is random and changes every run; the password is generated every run
 * unless SHARE_PASSWORD is set. Both are needed to get in. Your Mac has to stay
 * awake and running this for the link to work.
 *
 * Needs cloudflared once: brew install cloudflared
 */

import { spawn, spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ATLAS = process.argv.includes("--atlas");
const LOCAL = process.argv.includes("--local");
const ENV_FILE = join(ROOT, ".env.local");
const UVICORN = join(ROOT, "services/ml/.venv/bin/uvicorn");
const PORT = 4173;
const ML_PORT = 8811;

const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = s => c("1", s), dim = s => c("2", s), red = s => c("31", s), green = s => c("32", s);

/** Readable, unambiguous: no 0/O, 1/l/I. */
function generatePassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const group = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `${group()}-${group()}-${group()}`;
}

function fail(message) {
  console.error(red(message));
  process.exit(1);
}

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
    return (await fetch(url, { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}

async function waitFor(url, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await reachable(url)) return true;
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
}

// ------------------------------------------------------------------ checks

if (!LOCAL && spawnSync("cloudflared", ["--version"], { stdio: "ignore" }).error) {
  fail("cloudflared is not installed. Install it once with:\n\n  brew install cloudflared\n");
}
if (!existsSync(UVICORN)) {
  fail("The BKT service virtualenv is missing:\n\n  cd services/ml && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt\n");
}
if (ATLAS && !existsSync(ENV_FILE)) fail("--atlas needs .env.local with MONGODB_URI set. See .env.example.");
for (const port of [PORT, ML_PORT]) {
  if (!(await portFree(port))) {
    fail(`Port ${port} is already in use: is CyberShield already running?\n  lsof -ti:${port} | xargs kill`);
  }
}

console.log(bold("\nCyberShield Academy · private share\n"));

// ------------------------------------------------------------------ build

console.log(dim("Building the website…"));
const build = spawnSync("npm", ["run", "build", "--silent", "--workspace", "@cybershield/web"], { cwd: ROOT, encoding: "utf8" });
if (build.status !== 0) fail(`The website build failed:\n${build.stdout}${build.stderr}`);

// ------------------------------------------------------------------ start

const password = process.env.SHARE_PASSWORD || generatePassword();
/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
let stopping = false;

function run(name, command, args, env = {}) {
  const child = spawn(command, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
  children.push(child);
  child.on("exit", code => {
    if (stopping) return;
    console.log(red(`\n${name} stopped (code ${code}). Shutting down the rest.`));
    stop(1);
  });
  return child;
}

/** Show a child's output only if it fails to start, so the screen stays readable. */
function capture(child) {
  const lines = [];
  const keep = chunk => { lines.push(...chunk.toString().split("\n").filter(Boolean)); lines.splice(0, Math.max(0, lines.length - 40)); };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  return lines;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 600);
}
process.on("SIGINT", () => { console.log(dim("\nStopping…")); stop(0); });
process.on("SIGTERM", () => stop(0));

console.log(dim("Starting the model service and the server…"));
const ml = run("The model service", UVICORN, ["app:app", "--port", String(ML_PORT), "--app-dir", join(ROOT, "services/ml"),
  "--log-level", "warning", "--loop", "asyncio"]);
const mlLog = capture(ml);

const serverArgs = [...(ATLAS ? [`--env-file=${ENV_FILE}`] : []), join(ROOT, "apps/api/scripts/share-server.js")];
// Only --atlas reads the real database. Without it, a MONGODB_URI exported in
// this shell must not leak through and point the demo at real data.
const serverEnv = { PORT: String(PORT), SHARE_PASSWORD: password, ML_SERVICE_URL: `http://localhost:${ML_PORT}` };
if (!ATLAS) serverEnv.MONGODB_URI = "";
const server = run("The share server", process.execPath, serverArgs, serverEnv);
const serverLog = capture(server);

if (!(await waitFor(`http://localhost:${ML_PORT}/health`, 60))) {
  console.error(mlLog.join("\n"));
  fail("The model service did not start.");
}
if (!(await waitFor(`http://localhost:${PORT}/api/health`, 90))) {
  console.error(serverLog.join("\n"));
  fail("The share server did not start.");
}

// ------------------------------------------------------------------ tunnel

if (LOCAL) {
  console.log(`
  ${bold("Local check")}  ${green(`http://localhost:${PORT}`)}   ${bold("Password")} ${green(password)}
  ${dim("No tunnel: only this Mac can open it. Ctrl+C stops it.")}
`);
  await new Promise(() => {});
}

console.log(dim("Opening the tunnel…"));
const tunnel = run("The tunnel", "cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`]);
const tunnelLog = capture(tunnel);

const url = await new Promise(resolve => {
  const timer = setTimeout(() => resolve(null), 60_000);
  const look = chunk => {
    const match = chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) { clearTimeout(timer); resolve(match[0]); }
  };
  tunnel.stdout?.on("data", look);
  tunnel.stderr?.on("data", look);
});
if (!url) {
  console.error(tunnelLog.join("\n"));
  fail("Cloudflare did not hand out a link. Check your internet connection and try again.");
}

// The link is printed before Cloudflare has finished wiring it up; say so
// rather than letting the first visitor meet an error page.
const live = await waitFor(`${url}/api/health`, 30);

const width = Math.max(url.length, 40) + 14;
const line = "─".repeat(width);
console.log(`
${line}
  ${bold("Link")}       ${green(url)}
  ${bold("Password")}   ${green(password)}
${line}
  ${ATLAS ? red("Real database: visitors' accounts are stored in Atlas.") : dim("Throwaway database: nothing is kept after you stop.")}
  ${ATLAS ? "" : dim("Enrolment code for a study-style account: AURORA-2026")}
  ${live ? "" : dim("The link can take a minute to start working.")}
  Send the link and the password separately if you can.
  Keep this window open and your Mac awake. ${bold("Ctrl+C")} stops it.
`.replace(/\n {2}\n/g, "\n"));
