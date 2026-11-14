const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, chmodSync, rmSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { isDue, loadEnvironment, validateCredentials, run, execute } = require("../self-hosted/run");
const { render } = require("../self-hosted/render-service");
const { prepare } = require("../self-hosted/prepare-runtime");

function environment(t, content = "DATABASE_URL=postgresql://fixture:fixture@localhost/test\nUPSTASH_REDIS_REST_URL=https://redis.invalid\nUPSTASH_REDIS_REST_TOKEN=fixture-token\n") {
  const dir = mkdtempSync(path.join(tmpdir(), "shai-self-hosted-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "worker.env");
  writeFileSync(file, content, { mode: 0o600 });
  return file;
}

test("scheduled runs follow New York boundaries independent of host timezone", () => {
  for (const [date, expected] of [
    ["2026-10-26T06:55:00Z", true], // 02:55 EDT
    ["2026-10-26T07:00:00Z", true], // 03:00
    ["2026-10-26T07:05:00Z", false],
    ["2026-10-26T10:00:00Z", true],
    ["2026-10-26T18:55:00Z", false],
    ["2026-10-26T19:00:00Z", true],
    ["2026-11-02T07:55:00Z", true], // 02:55 EST after DST change
    ["2026-11-02T08:05:00Z", false],
  ]) assert.equal(isDue(new Date(date)), expected, date);
});

test("private file wins over inherited deployment credentials and fixes season/history policy", t => {
  const file = environment(t);
  const env = loadEnvironment(file, "/private/python", { DATABASE_URL: "wrong-target", NBA_SEASON: "2020-21", PATH: "/usr/bin" });
  assert.equal(new URL(env.DATABASE_URL).hostname, "localhost");
  assert.equal(env.PYTHON_BIN, "/private/python");
  assert.equal(env.NBA_SEASON, "2026-27");
  assert.equal(env.HISTORIC_SEASONS_BACK, "0");
  assert.equal(env.PLAYERS_HISTORIC_MODE, "off");
  assert.equal(env.NBA_TIME_ZONE, "America/New_York");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(loadEnvironment(environment(t, ""), "/private/python", { DATABASE_URL: "wrong-target" }).DATABASE_URL, undefined);
});

test("unsafe environment permissions and malformed configuration fail closed", t => {
  const file = environment(t);
  chmodSync(file, 0o644);
  assert.throws(() => loadEnvironment(file, "/private/python"), /private regular file/);
  assert.throws(() => loadEnvironment("relative.env", "/private/python"), /absolute/);
  assert.throws(() => validateCredentials({ DATABASE_URL: "https://example.com" }), /PostgreSQL DATABASE_URL/);
  assert.throws(() => validateCredentials({ DATABASE_URL: "postgresql://localhost/test" }), /Shared Upstash/);
});

test("off-hours do not load credentials or launch a process", async () => {
  const result = await run({ date: new Date("2026-10-26T12:05:00Z"),
    executeCommand: () => { throw new Error("must not execute"); }, log: () => {} });
  assert.equal(result, 0);
});

test("read-only preflight uses the pinned Python and only --check-sources, without DB credentials", async t => {
  const calls = [];
  const result = await run({ envFile: environment(t, ""), python: "/private/python", check: true,
    date: new Date("2026-10-26T12:05:00Z"), inherited: {},
    executeCommand: async (command, args, env) => { calls.push({ command, args, env }); return 0; } });
  assert.equal(result, 0);
  assert.equal(calls[0].command, "/private/python");
  assert.match(calls[0].args[1], /1\.11\.4/);
  assert.equal(calls[1].args.at(-1), "--check-sources");
  assert.equal(calls[1].env.DATABASE_URL, undefined);
});

test("manual once bypasses the schedule, retains lease credentials, and propagates ingestion failure", async t => {
  const calls = [];
  assert.equal(await run({ envFile: environment(t), python: "/private/python", once: true,
    date: new Date("2026-10-26T12:05:00Z"), inherited: {},
    executeCommand: async (command, args, env) => { calls.push({ command, args, env }); return calls.length === 1 ? 0 : 1; },
  }), 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args.length, 1);
  assert.match(calls[1].args[0], /bootstrap\.js$/);
  assert.equal(calls[1].env.UPSTASH_REDIS_REST_TOKEN, "fixture-token");
});

test("a runtime failure prevents ingestion and source failure remains nonzero", async t => {
  let calls = 0;
  assert.equal(await run({ envFile: environment(t), python: "/private/python", once: true,
    executeCommand: async () => { calls++; return 7; } }), 7);
  assert.equal(calls, 1);
  calls = 0;
  assert.equal(await run({ envFile: environment(t), python: "/private/python", check: true,
    executeCommand: async () => ++calls === 1 ? 0 : 1 }), 1);
});

test("real child failure and timeout are propagated and signal listeners are removed", async () => {
  const signals = new EventEmitter();
  assert.equal(await execute(process.execPath, ["-e", "process.exit(7)"], {}, { signals }), 7);
  const errors = [];
  assert.equal(await execute(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {},
    { signals, timeoutMs: 100, killAfterMs: 100, logError: message => errors.push(message) }), 124);
  assert.equal(errors.length, 1);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
  assert.equal(signals.listenerCount("SIGINT"), 0);
});

test("service termination is forwarded to the actual child and removes signal handlers", async () => {
  const signals = new EventEmitter();
  const result = execute(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {}, { signals });
  signals.emit("SIGTERM");
  assert.equal(await result, 143);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
  assert.equal(signals.listenerCount("SIGINT"), 0);
});

const settings = { node: "/opt/Node Runtime/bin/node", python: "/opt/worker/bin/python",
  envFile: "/private/worker.env", root: "/opt/shai & basketball", logDir: "/private/logs" };

test("macOS service uses absolute argument paths, calendar scheduling and no embedded credentials", () => {
  const files = render({ ...settings, platform: "macos" });
  const plist = files["com.shai.ingestion.plist"];
  assert.match(plist, /shai &amp; basketball/);
  assert.equal((plist.match(/<key>Minute<\/key>/g) || []).length, 12);
  assert.match(plist, /<integer>55<\/integer>/);
  assert.match(plist, /<string>--<\/string><string>[^<]+\/workers\/self-hosted\/run\.js<\/string>/);
  assert.match(plist, /--env-file/);
  assert.doesNotMatch(plist, /DATABASE_URL|UPSTASH|--once|KeepAlive|EnvironmentVariables/);
});

test("Linux service quotes argument boundaries and escapes systemd expansions", () => {
  const files = render({ ...settings, node: '/opt/a%u/$user/"node"', platform: "linux" });
  assert.match(files["shai-ingestion.service"], /Type=oneshot/);
  assert.match(files["shai-ingestion.service"], /a%%u\/\$\$user\/\\"node\\"/);
  assert.match(files["shai-ingestion.service"], /"--" "[^"\n]+\/workers\/self-hosted\/run\.js"/);
  assert.match(files["shai-ingestion.service"], /KillMode=control-group/);
  assert.match(files["shai-ingestion.timer"], /Persistent=true/);
  assert.throws(() => render({ ...settings, root: "/tmp/a\nExecStart=bad", platform: "linux" }), /control characters/);
  assert.throws(() => render({ ...settings, platform: "windows" }), /macos or linux/);
});

test("release preparation excludes development edits and secrets, fingerprints the launcher and refuses overwrite", t => {
  const dir = mkdtempSync(path.join(tmpdir(), "shai-release-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, "repo");
  mkdirSync(path.join(repo, "workers/self-hosted"), { recursive: true });
  const git = args => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git(["init", "-q"]);
  writeFileSync(path.join(repo, "workers/bootstrap.js"), "committed worker");
  writeFileSync(path.join(repo, "workers/self-hosted/run.js"), "committed launcher");
  git(["add", "workers"]);
  git(["-c", "user.name=Test Fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"]);
  writeFileSync(path.join(repo, "workers/bootstrap.js"), "development edit");
  writeFileSync(path.join(repo, "workers/self-hosted/run.js"), "development launcher edit");
  writeFileSync(path.join(repo, "workers/worker.env"), "private fixture credentials");
  const options = { root: repo, outputDir: path.join(dir, "releases") };
  const result = prepare(options);
  assert.equal(readFileSync(path.join(result.release, "workers/bootstrap.js"), "utf8"), "committed worker");
  assert.equal(existsSync(path.join(result.release, "workers/worker.env")), false);
  assert.equal(readFileSync(path.join(result.release, "workers/self-hosted/run.js"), "utf8"), "committed launcher");
  const manifest = JSON.parse(readFileSync(path.join(result.release, "release.json")));
  assert.equal(manifest.source_commit, git(["rev-parse", "HEAD"]).toString().trim());
  assert.equal(manifest.launcher_sha256.length, 64);
  assert.throws(() => prepare(options), /EEXIST/);
  assert.equal(readFileSync(path.join(result.release, "workers/bootstrap.js"), "utf8"), "committed worker");
});
