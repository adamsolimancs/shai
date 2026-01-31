const test = require("node:test");
const assert = require("node:assert/strict");

process.env.CACHE_KEY_PREFIX = "nba:serve:";

const worker = require("../worker-live");

test("normalizeBaseUrl trims and adds scheme", () => {
  assert.equal(worker.normalizeBaseUrl(" example.com/ "), "https://example.com");
  assert.equal(worker.normalizeBaseUrl("http://foo.com/"), "http://foo.com");
  assert.equal(worker.normalizeBaseUrl("'https://bar.com/'"), "https://bar.com");
});

test("parseBoolean respects truthy values", () => {
  assert.equal(worker.parseBoolean("true"), true);
  assert.equal(worker.parseBoolean("0"), false);
  assert.equal(worker.parseBoolean(undefined, true), true);
});

test("toText serializes non-strings", () => {
  assert.equal(worker.toText({ a: 1 }), JSON.stringify({ a: 1 }));
  assert.equal(worker.toText("hi"), "hi");
  assert.equal(worker.toText(null), null);
});

test("seasonToYear handles formats", () => {
  assert.equal(worker.seasonToYear("2024-25"), 2024);
  assert.equal(worker.seasonToYear("2024"), 2024);
  assert.equal(worker.seasonToYear("22024"), 2024);
  assert.equal(worker.seasonToYear(2024.9), 2024);
  assert.equal(worker.seasonToYear(""), null);
});

test("normalizeBooleanText returns normalized strings", () => {
  assert.equal(worker.normalizeBooleanText("YES"), "true");
  assert.equal(worker.normalizeBooleanText("0"), "false");
  assert.equal(worker.normalizeBooleanText("maybe"), "maybe");
});

test("toNumber parses numbers", () => {
  assert.equal(worker.toNumber("12.5"), 12.5);
  assert.equal(worker.toNumber("bad"), null);
});

test("cacheKey builds prefixed keys", () => {
  assert.equal(worker.cacheKey("scoreboard", "2024-10-10"), "nba:serve:scoreboard:2024-10-10");
  assert.equal(worker.cacheKey(), "nba:serve");
});

test("formatDateInTZ and getSeasonForDate", () => {
  const date = new Date("2024-10-15T12:00:00Z");
  assert.equal(worker.formatDateInTZ("UTC", date), "2024-10-15");
  assert.equal(worker.getHourInTZ("UTC", date), 12);
  assert.equal(worker.getSeasonForDate("UTC", date), "2024-25");
  const summer = new Date("2024-07-01T12:00:00Z");
  assert.equal(worker.getSeasonForDate("UTC", summer), "2023-24");
});

test("normalizeHour and isHourInWindow", () => {
  assert.equal(worker.normalizeHour(25), 1);
  assert.equal(worker.normalizeHour(-1), 23);
  assert.equal(worker.isHourInWindow(2, 0, 3), true);
  assert.equal(worker.isHourInWindow(3, 0, 3), false);
  assert.equal(worker.isHourInWindow(23, 22, 2), true);
  assert.equal(worker.isHourInWindow(3, 22, 2), false);
});

test("parseCronBudgetCursor", () => {
  assert.deepEqual(worker.parseCronBudgetCursor({ date: "2024-10-10", runs: "2" }), {
    date: "2024-10-10",
    runs: 2,
  });
  assert.deepEqual(worker.parseCronBudgetCursor(null), { date: null, runs: 0 });
});

test("status helpers", () => {
  assert.equal(worker.isFinalStatus("Final"), true);
  assert.equal(worker.isLiveStatus("Final"), false);
  assert.equal(worker.isLiveStatus("Q3 4:21"), true);
  assert.equal(worker.isLiveStatus("Scheduled"), false);
});

test("season list helpers", () => {
  assert.deepEqual(worker.parseSeasonList("2022-23, 2023-24"), ["2022-23", "2023-24"]);
  assert.deepEqual(worker.normalizeSeasonList(["2023-24", "2022-23", "2023-24"]), [
    "2022-23",
    "2023-24",
  ]);
  assert.equal(worker.seasonsMatch(["2023-24"], ["2023-24"]), true);
  assert.equal(worker.seasonsMatch(["2023-24"], ["2022-23"]), false);
});

test("row mappers normalize payloads", () => {
  assert.deepEqual(worker.mapTeamRow({ team_id: 1, name: "Knicks" }), {
    team_id: 1,
    abbreviation: null,
    city: null,
    name: "Knicks",
    conference: null,
    division: null,
  });
  assert.deepEqual(worker.mapPlayerRow({ player_id: 99, full_name: "Test", is_active: "yes" }), {
    player_id: "99",
    full_name: "Test",
    current_team_id: null,
    is_active: "true",
  });
  assert.deepEqual(worker.mapGameRow({ game_id: "001", date: "2024-10-10" }, "2024-25"), {
    game_id: "001",
    date: "2024-10-10",
    home_team_id: null,
    home_team_name: null,
    home_team_score: null,
    away_team_id: null,
    away_team_name: null,
    away_team_score: null,
    season: 2024,
  });
});

test("applyRanks assigns rank order", () => {
  const rows = [{ points: 10 }, { points: 20 }, { points: null }];
  worker.applyRanks(rows, "points", "rank");
  assert.equal(rows[1].rank, 1);
  assert.equal(rows[0].rank, 2);
  assert.equal(rows[2].rank, undefined);
});

test("computeRetryWaitMs enforces minimum", () => {
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    assert.equal(worker.computeRetryWaitMs(1000, 1), 30000);
    assert.equal(worker.computeRetryWaitMs(40000, 0), 40000);
  } finally {
    Math.random = originalRandom;
  }
});

test("dedupeRowsForConflict removes duplicates", () => {
  const rows = [
    { id: 1, season: "2024" },
    { id: 1, season: "2024" },
    { id: 2, season: "2024" },
  ];
  const deduped = worker.dedupeRowsForConflict(rows, "id,season");
  assert.equal(deduped.length, 2);
});

test("parseCursor and chunkArray", () => {
  assert.deepEqual(worker.parseCursor({ last_cursor: "{\"page\":1}" }), { page: 1 });
  assert.equal(worker.parseCursor({ last_cursor: "invalid" }), null);
  assert.deepEqual(worker.chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});
