const test = require("node:test");
const assert = require("node:assert/strict");

const { publishGameSnapshot, setDatabaseQueryForTests } = require("../worker-live");

test("missing snapshot transaction fails without issuing partial table writes", async () => {
  const requests = [];
  setDatabaseQueryForTests(async (sql, values) => {
    requests.push({ sql, values });
    const error = new Error('function public.publish_game_snapshot does not exist');
    error.code = "42883";
    throw error;
  });
  await assert.rejects(publishGameSnapshot({ game_id: "game-1" }), (error) => {
    assert.match(error.message, /apply the database ingestion migration/);
    assert.match(error.cause.message, /does not exist/);
    return true;
  });
  assert.equal(requests.length, 1);
  assert.match(requests[0].sql, /publish_game_snapshot/);
  assert.equal(requests[0].values.length, 3);
});

test("snapshot publish returns committed RPC player count", async () => {
  setDatabaseQueryForTests(async () => ({ rows: [{ result: { players_upserted: 12 } }] }));
  assert.equal(await publishGameSnapshot({ game_id: "game-1" }), 12);
});
