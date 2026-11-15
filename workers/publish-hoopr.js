"use strict";

const { text } = require("node:stream/consumers");
const { Client } = require("pg");

async function publish() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const payload = await text(process.stdin);
  const { observed_at: observedAt, slates } = JSON.parse(payload);
  if (!Number.isFinite(Date.parse(observedAt)) || !slates?.[0]?.games?.length) {
    throw new Error("Invalid hoopR snapshot");
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
  });
  await client.connect();
  try {
    const result = await client.query(
      `INSERT INTO public.api_snapshots (cache_key, payload, observed_at, updated_at)
       VALUES ('hoopr:last-night', $1, $2::timestamptz, $3)
       ON CONFLICT (cache_key) DO UPDATE SET
         payload = EXCLUDED.payload,
         observed_at = EXCLUDED.observed_at,
         updated_at = EXCLUDED.updated_at
       WHERE (api_snapshots.payload::jsonb #>> '{slates,0,date}') <= $4
         AND api_snapshots.observed_at <= EXCLUDED.observed_at`,
      [payload, observedAt, observedAt, slates[0].date],
    );
    console.log(result.rowCount ? `Published validated slates through ${slates[0].date}` : "Kept a newer snapshot");
  } finally {
    await client.end();
  }
}

publish().catch(error => {
  console.error("hoopR publication failed:", error.code || error.name);
  process.exitCode = 1;
});
