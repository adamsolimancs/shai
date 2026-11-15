#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const { readFileSync, statSync } = require("node:fs");
const path = require("node:path");
const { parseArgs, parseEnv } = require("node:util");

const ROOT = path.resolve(__dirname, "../..");
const MAX_RUNTIME_MS = 20 * 60 * 1000;

function isDue(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit", minute: "2-digit",
  }).formatToParts(date);
  const hour = Number(parts.find(part => part.type === "hour").value);
  const minute = Number(parts.find(part => part.type === "minute").value);
  return hour >= 15 || hour < 3 || (hour % 3 === 0 && minute === 0);
}

function loadEnvironment(file, python, inherited = process.env) {
  if (!path.isAbsolute(file) || !path.isAbsolute(python)) {
    throw new Error("Use absolute paths for --env-file and --python");
  }
  const stat = statSync(file);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error("The worker environment must be a private regular file (chmod 600)");
  }
  if (process.getuid && stat.uid !== process.getuid()) {
    throw new Error("The worker environment must belong to the service user");
  }
  // Missing file credentials must not silently fall back to another deployment.
  const base = Object.fromEntries(Object.entries(inherited).filter(([key]) =>
    !key.startsWith("DATABASE_") && !key.startsWith("UPSTASH_")));
  return { ...base, ...parseEnv(readFileSync(file, "utf8")),
    PYTHON_BIN: python, NBA_SEASON: "2026-27", HISTORIC_SEASONS_BACK: "0",
    PLAYERS_HISTORIC_MODE: "off", PLAYERS_HISTORIC_SEASONS_BACK: "0",
    NBA_TIME_ZONE: "America/New_York", STATS_TRANSPORT: "nba_api",
  };
}

function validateCredentials(env) {
  try {
    const target = new URL(env.DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(target.protocol) || !target.hostname) throw new Error();
  } catch { throw new Error("A PostgreSQL DATABASE_URL is required in the worker environment"); }
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error("Shared Upstash Redis credentials are required for the ingestion lease");
  }
}

function execute(command, args, env, {
  timeoutMs = MAX_RUNTIME_MS, killAfterMs = 10000, signals = process, logError = console.error,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env, stdio: "inherit" });
    let timedOut = false;
    let killTimer;
    const stop = signal => {
      child.kill(signal);
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), killAfterMs);
    };
    const terminate = () => stop("SIGTERM");
    const interrupt = () => stop("SIGINT");
    const timeout = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    signals.on("SIGTERM", terminate);
    signals.on("SIGINT", interrupt);
    const cleanup = () => {
      clearTimeout(timeout); clearTimeout(killTimer);
      signals.off("SIGTERM", terminate); signals.off("SIGINT", interrupt);
    };
    child.once("error", error => { cleanup(); reject(error); });
    child.once("close", (code, signal) => {
      cleanup();
      if (timedOut) logError(JSON.stringify({ error: "Worker exceeded its runtime deadline" }));
      resolve(timedOut ? 124 : code ?? (signal === "SIGINT" ? 130 : 143));
    });
  });
}

async function run({ envFile, python, check = false, once = false, date = new Date(),
  executeCommand = execute, inherited = process.env, log = console.log }) {
  if (!check && !once && !isDue(date)) {
    log(JSON.stringify({ status: "skipped", reason: "outside_ingestion_window" }));
    return 0;
  }
  const env = loadEnvironment(envFile, python, inherited);
  if (!check) validateCredentials(env);
  const runtime = await executeCommand(python, ["-c",
    "import sys, importlib.metadata as m; " +
    "sys.exit('Python 3.11 is required') if sys.version_info[:2] != (3, 11) else None; " +
    "sys.exit('nba_api==1.11.4 is required') if m.version('nba_api') != '1.11.4' else None",
  ], env);
  if (runtime !== 0) return runtime;
  return executeCommand(process.execPath,
    [path.join(ROOT, "workers/bootstrap.js"), ...(check ? ["--check-sources"] : [])], env);
}

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node.js 24+ is required");
  const { values } = parseArgs({ options: {
    "env-file": { type: "string" }, python: { type: "string" },
    check: { type: "boolean", default: false }, once: { type: "boolean", default: false },
  } });
  if (!values["env-file"] || !values.python || (values.check && values.once)) {
    throw new Error("Usage: node workers/self-hosted/run.js --env-file /private/worker.env --python /venv/bin/python [--check | --once]");
  }
  process.exitCode = await run({ envFile: values["env-file"], python: values.python,
    check: values.check, once: values.once });
}

if (require.main === module) main().catch(() => {
  // Child processes report their own failures. Do not echo configuration or credential values.
  console.error("Self-hosted worker could not start; check private environment paths, runtime and required credentials.");
  process.exitCode = 1;
});
module.exports = { isDue, loadEnvironment, validateCredentials, execute, run, MAX_RUNTIME_MS };
