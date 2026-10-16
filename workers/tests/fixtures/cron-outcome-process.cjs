// Execute the real CLI entry point with service boundaries replaced by local fixtures.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const filename = path.resolve(__dirname, "../../worker-live.js");
const source = fs.readFileSync(filename, "utf8").replace(/^#![^\n]*\n/, "");
const injection = `
startWorker = () => {};
CONFIG.workerMode = "cron";
CONFIG.cronMaxRuntimeMs = 60000;
// Lease behavior has separate contention tests; isolate task outcome behavior here.
runCron = runCronWithLease;
shouldStartCronRun = async () => ({ allowed: true, date: "2026-09-07", runs: 0, inWindow: true });
getIngestionState = async (entity) => {
  if (process.env.CRON_FIXTURE === "gate-failure" && entity === "scoreboard") {
    throw new Error("simulated state read failure");
  }
  return ["scoreboard", "teams"].includes(entity) ? null : { last_success_at: new Date().toISOString() };
};
shouldRunMaintenanceTask = () => false;
getSeason = async () => "2026-27";
fetchGames = async () => {
  if (process.env.CRON_FIXTURE === "failed") throw new Error("simulated failed refresh");
  if (process.env.CRON_FIXTURE === "budget") throw new CronBudgetError("simulated budget expiry");
  return [];
};
writeCache = async () => {};
supabaseUpsertRaw = async (table, rows) => {
  if (table === "ingestion_state") {
    require("node:fs").appendFileSync(process.env.CRON_STATE_FILE, rows.map(row => JSON.stringify(row) + "\\n").join(""));
  }
};
refreshTeams = async () => withIngestionState("teams", async () => {
  if (process.env.CRON_FIXTURE === "batch-failure") {
    await runWithConcurrency([1, 2], 1, async (item) => {
      if (item === 1) throw new Error("simulated item failure");
      require("node:fs").appendFileSync(process.env.CRON_STATE_FILE, JSON.stringify({ entity: "batch_item_2", status: "ok" }) + "\\n");
    });
  }
});
`;
const fixtureModule = { exports: {} };
const fixtureRequire = createRequire(filename);
fixtureRequire.main = fixtureModule;
const execute = vm.runInThisContext(
  `(function(require, module, exports, __filename, __dirname) {\n${source.replace("if (require.main === module) {", `${injection}\nif (require.main === module) {`)}\n})`,
  { filename }
);
execute(fixtureRequire, fixtureModule, fixtureModule.exports, filename, path.dirname(filename));
