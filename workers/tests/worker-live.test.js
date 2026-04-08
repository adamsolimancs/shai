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
    next_run_after: null,
    window: null,
  });
  assert.deepEqual(
    worker.parseCronBudgetCursor({
      date: "2024-10-10",
      runs: 1,
      next_run_after: "2024-10-10T10:00:00.000Z",
      window: "in",
    }),
    {
      date: "2024-10-10",
      runs: 1,
      next_run_after: Date.parse("2024-10-10T10:00:00.000Z"),
      window: "in",
    }
  );
  assert.deepEqual(worker.parseCronBudgetCursor(null), {
    date: null,
    runs: 0,
    next_run_after: null,
    window: null,
  });
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

test("buildSupportedSeasons uses configured year range", () => {
  assert.deepEqual(
    worker.buildSupportedSeasons({
      startYear: 2024,
      date: new Date("2026-04-08T00:00:00Z"),
    }),
    ["2024-25", "2025-26", "2026-27"],
  );
});

test("normalizeActiveFlag handles nba roster statuses", () => {
  assert.equal(worker.normalizeActiveFlag("Active"), "true");
  assert.equal(worker.normalizeActiveFlag("Inactive"), "false");
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
    start_time: null,
    home_team_id: null,
    home_team_name: null,
    home_team_score: null,
    away_team_id: null,
    away_team_name: null,
    away_team_score: null,
    season: 2024,
  });
});

test("normalizeLeagueStanding enriches rows with team directory data", () => {
  const teamsById = new Map([[1, { team_id: 1, abbreviation: "NYK", city: "New York", name: "Knicks" }]]);
  assert.deepEqual(
    worker.normalizeLeagueStanding(
      {
        TeamID: 1,
        TeamCity: "New York",
        TeamName: "Knicks",
        Conference: "East",
        PlayoffRank: "2",
        Division: "Atlantic",
        DivisionRank: "1",
        WINS: "50",
        LOSSES: "32",
        WinPCT: "0.610",
        ConferenceGamesBack: "2.0",
        DivisionGamesBack: "0.0",
        Record: "50-32",
        HOME: "28-13",
        ROAD: "22-19",
        L10: "7-3",
        strCurrentStreak: "W3",
      },
      teamsById,
    ),
    {
      team_id: 1,
      team_name: "Knicks",
      team_city: "New York",
      team_slug: null,
      team_abbreviation: "NYK",
      conference: "East",
      conference_rank: 2,
      division: "Atlantic",
      division_rank: 1,
      wins: 50,
      losses: 32,
      win_pct: 0.61,
      games_back: 2,
      division_games_back: 0,
      record: "50-32",
      home_record: "28-13",
      road_record: "22-19",
      last_ten: "7-3",
      streak: "W3",
    },
  );
});

test("normalizeServingTeamStatsRow fills team abbreviation from team directory", () => {
  const teamsById = new Map([[1, { team_id: 1, abbreviation: "NYK", name: "Knicks" }]]);
  assert.deepEqual(
    worker.normalizeServingTeamStatsRow(
      {
        TEAM_ID: 1,
        TEAM_NAME: "Knicks",
        GP: 82,
        W: 50,
        L: 32,
        W_PCT: 0.61,
        PTS: 115.2,
        FG_PCT: 0.472,
        REB: 44.1,
        AST: 27.3,
        STL: 7.9,
        BLK: 4.7,
        TOV: 12.4,
        PLUS_MINUS: 4.1,
      },
      teamsById,
    ),
    {
      team_id: 1,
      team_abbreviation: "NYK",
      team_name: "Knicks",
      games_played: 82,
      wins: 50,
      losses: 32,
      win_pct: 0.61,
      points: 115.2,
      field_goal_pct: 0.472,
      rebounds: 44.1,
      assists: 27.3,
      steals: 7.9,
      blocks: 4.7,
      turnovers: 12.4,
      plus_minus: 4.1,
    },
  );
});

test("normalizePlayerInfoRow maps common player info payload", () => {
  const normalized = worker.normalizePlayerInfoRow({
    PERSON_ID: "2544",
    FIRST_NAME: "LeBron",
    LAST_NAME: "James",
    DISPLAY_FIRST_LAST: "LeBron James",
    POSITION: "F",
    JERSEY: "23",
    BIRTHDATE: "1984-12-30T00:00:00",
    SCHOOL: "St. Vincent-St. Mary HS",
    COUNTRY: "USA",
    SEASON_EXP: "21",
    ROSTERSTATUS: "Active",
    FROM_YEAR: "2003",
    TO_YEAR: "2026",
    TEAM_ID: "1610612747",
    TEAM_NAME: "Lakers",
    TEAM_ABBREVIATION: "LAL",
  });

  assert.equal(normalized.player_id, "2544");
  assert.equal(normalized.display_name, "LeBron James");
  assert.equal(normalized.birthdate, "1984-12-30");
  assert.equal(normalized.team_abbreviation, "LAL");
  assert.equal(typeof normalized.updated_at, "string");
});

test("normalizePlayerStatsSnapshotRow normalizes serving payload", () => {
  const normalized = worker.normalizePlayerStatsSnapshotRow({
    PLAYER_ID: "201939",
    PLAYER_NAME: "Stephen Curry",
    TEAM_ID: "1610612744",
    TEAM_ABBREVIATION: "GSW",
    PTS: "29.4",
    REB: "5.1",
    AST: "6.3",
    MIN: "34.2",
  });

  assert.deepEqual(normalized, {
    player_id: 201939,
    player_name: "Stephen Curry",
    team_id: 1610612744,
    team_abbreviation: "GSW",
    points: 29.4,
    rebounds: 5.1,
    assists: 6.3,
    minutes: 34.2,
  });
});

test("mapTeamHistoryRow normalizes year-by-year payload", () => {
  const mapped = worker.mapTeamHistoryRow(
    {
      TEAM_ID: "1610612747",
      TEAM_CITY: "Los Angeles",
      TEAM_NAME: "Lakers",
      YEAR: "2023-24",
      GP: "82",
      WINS: "47",
      LOSSES: "35",
      WIN_PCT: "0.573",
      CONF_RANK: "8",
      DIV_RANK: "3",
      PO_WINS: "1",
      PO_LOSSES: "4",
      NBA_FINALS_APPEARANCE: "N/A",
      PTS: "9558",
      FG_PCT: "0.499",
      FG3_PCT: "0.377",
    },
    "Regular Season",
    "Totals"
  );

  assert.equal(mapped.team_id, 1610612747);
  assert.equal(mapped.season, "2023-24");
  assert.equal(mapped.finals_result, null);
  assert.equal(mapped.points, 9558);
  assert.equal(typeof mapped.updated_at, "string");
});

test("mapLeagueLeaderRow preserves stat category specific value", () => {
  const mapped = worker.mapLeagueLeaderRow(
    {
      PLAYER_ID: "201939",
      RANK: "1",
      PLAYER: "Stephen Curry",
      TEAM_ID: "1610612744",
      TEAM: "GSW",
      GP: "70",
      MIN: "34.1",
      PTS: "29.4",
    },
    "2025-26",
    "Regular Season",
    "PerGame",
    "PTS"
  );

  assert.equal(mapped.player_id, "201939");
  assert.equal(mapped.rank, 1);
  assert.equal(mapped.stat_value, 29.4);
  assert.equal(mapped.team_abbreviation, "GSW");
  assert.equal(typeof mapped.updated_at, "string");
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
