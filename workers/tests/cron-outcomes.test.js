const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function runFixture(t, scenario) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cron-outcomes-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateFile = path.join(dir, "states.jsonl");
  const result = spawnSync(process.execPath, [path.join(__dirname, "fixtures/cron-outcome-process.cjs")], {
    env: { ...process.env, CRON_FIXTURE: scenario, CRON_STATE_FILE: stateFile, WORKER_MODE: "cron" },
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.error, undefined);
  assert.ok(fs.existsSync(stateFile), result.stderr || result.stdout);
  const rows = fs.readFileSync(stateFile, "utf8").trim().split("\n").map(JSON.parse);
  const final = rows.filter((row) => row.entity === "cron_budget").at(-1);
  return { ...result, rows, final, outcomes: JSON.parse(final.last_cursor).task_outcomes };
}

test("failed refresh persists failure, continues independent tasks, and exits nonzero", (t) => {
  const result = runFixture(t, "failed");
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.final.status, "failed");
  assert.equal(result.final.last_success_at, undefined);
  assert.match(result.final.last_error, /scoreboard: simulated failed refresh/);
  assert.equal(result.rows.findLast((row) => row.entity === "scoreboard").status, "failed");
  assert.equal(result.rows.findLast((row) => row.entity === "teams").status, "ok");
  assert.equal(result.outcomes.find((row) => row.entity === "scoreboard").status, "failed");
  assert.equal(result.outcomes.find((row) => row.entity === "teams").status, "ok");
});

test("successful and interval-skipped refreshes persist success and exit zero", (t) => {
  const result = runFixture(t, "ok");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.final.status, "ok");
  assert.ok(result.final.last_success_at);
  assert.equal(result.final.last_error, null);
  assert.deepEqual(result.outcomes.find((row) => row.entity === "players"), {
    entity: "players", status: "skipped", reason: "maintenance_budget",
  });
  assert.equal(result.outcomes.find((row) => row.entity === "boxscores_live").status, "skipped");
});

test("task gate errors fail the run without suppressing independent refreshes", (t) => {
  const result = runFixture(t, "gate-failure");
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.final.status, "failed");
  assert.match(result.final.last_error, /simulated state read failure/);
  assert.equal(result.outcomes.find((row) => row.entity === "teams").status, "ok");
});

test("budget expiry persists failure, stops remaining tasks, and exits nonzero", (t) => {
  const result = runFixture(t, "budget");
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.final.status, "failed");
  assert.match(result.final.last_error, /simulated budget expiry/);
  assert.deepEqual(result.outcomes.find((row) => row.entity === "teams"), {
    entity: "teams", status: "not_started", reason: "budget_exhausted",
  });
});

test("cron item failures finish independent batch items and fail the aggregate run", (t) => {
  const result = runFixture(t, "batch-failure");
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.final.status, "failed");
  assert.match(result.final.last_error, /teams: Concurrency batch had 1 failures/);
  assert.equal(result.rows.find((row) => row.entity === "batch_item_2").status, "ok");
});
