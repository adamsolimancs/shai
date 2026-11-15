"use strict";

const { text } = require("node:stream/consumers");
const { Client } = require("pg");

async function publish() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const payload = await text(process.stdin);
  const rows = JSON.parse(payload);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("No player season rows");

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO public.players (player_id, full_name)
       SELECT DISTINCT ON (player_id) player_id, name
       FROM jsonb_to_recordset($1::jsonb) AS incoming(player_id text, name text, season text, season_type text)
       ORDER BY player_id, season DESC, season_type
       ON CONFLICT (player_id) DO NOTHING`,
      [payload],
    );
    const result = await client.query(
      `WITH incoming AS (
         SELECT * FROM jsonb_populate_recordset(NULL::public.player_season_stats, $1::jsonb)
       )
       INSERT INTO public.player_season_stats (
         season, season_type, player_id, team_id, games_played, games_started,
         minutes_pg, points_pg, rebounds_pg, assists_pg, steals_pg, blocks_pg,
         field_goal_pct_pg, three_point_pct_pg, free_throw_pct_pg, true_shooting_pct_pg
       )
       SELECT incoming.season, incoming.season_type, incoming.player_id, teams.team_id,
         incoming.games_played, incoming.games_started, incoming.minutes_pg, incoming.points_pg,
         incoming.rebounds_pg, incoming.assists_pg, incoming.steals_pg, incoming.blocks_pg,
         incoming.field_goal_pct_pg, incoming.three_point_pct_pg,
         incoming.free_throw_pct_pg, incoming.true_shooting_pct_pg
       FROM incoming
       LEFT JOIN public.teams AS teams ON teams.team_id = incoming.team_id
       ON CONFLICT (season, player_id, season_type) DO NOTHING`,
      [payload],
    );
    await client.query("COMMIT");
    console.log(`Inserted ${result.rowCount} of ${rows.length} player season rows`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

publish().catch(error => {
  console.error("Player season backfill failed:", error.code || error.name);
  process.exitCode = 1;
});
