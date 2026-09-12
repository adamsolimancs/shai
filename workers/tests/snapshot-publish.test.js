const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = "https://snapshot-test.invalid";
process.env.SUPABASE_SECRET_KEY = "test-only";
const { publishGameSnapshot } = require("../worker-live");

test("missing snapshot transaction fails without issuing partial table writes", async (t) => {
  const requests = [];
  t.mock.method(global, "fetch", async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function" }), {
      status: 404,
    });
  });
  await assert.rejects(publishGameSnapshot({ game_id: "game-1" }), (error) => {
    assert.match(error.message, /apply the database ingestion migration/);
    assert.match(error.cause.message, /PGRST202/);
    return true;
  });
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).pathname, "/rest/v1/rpc/publish_game_snapshot");
});

test("snapshot publish returns committed RPC player count", async (t) => {
  t.mock.method(global, "fetch", async () =>
    Response.json({ players_upserted: 12 })
  );
  assert.equal(await publishGameSnapshot({ game_id: "game-1" }), 12);
});
