const test = require("node:test");
const assert = require("node:assert/strict");

const cacheModulePath = require.resolve("../cache");

function resetCacheModule() {
  delete require.cache[cacheModulePath];
}

test("cache is null when env is missing", () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  resetCacheModule();
  const { cache } = require("../cache");
  assert.equal(cache, null);
});

test("cache initializes when env is present", () => {
  process.env.UPSTASH_REDIS_REST_URL = "https://upstash.example";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";

  const redisPath = require.resolve("@upstash/redis");
  const originalRedis = require.cache[redisPath];
  class FakeRedis {
    constructor(opts) {
      this.opts = opts;
    }
  }
  require.cache[redisPath] = { exports: { Redis: FakeRedis } };

  resetCacheModule();
  const { cache } = require("../cache");
  assert.ok(cache);
  assert.equal(cache.opts.url, "https://upstash.example");
  assert.equal(cache.opts.token, "token");

  if (originalRedis) {
    require.cache[redisPath] = originalRedis;
  } else {
    delete require.cache[redisPath];
  }
});
