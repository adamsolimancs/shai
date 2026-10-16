"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { acquireCronLease, RENEW, RELEASE } = require("../cron-lease");

function fakeRedis() {
  let value = null;
  let expires = 0;
  return {
    async set(key, owner, options) {
      assert.equal(options.nx, true);
      if (value !== null && expires > Date.now()) return null;
      value = owner;
      expires = Date.now() + options.px;
      return "OK";
    },
    async eval(script, keys, args) {
      if (value !== args[0] || expires <= Date.now()) return 0;
      if (script === RENEW) expires = Date.now() + args[1];
      else { assert.equal(script, RELEASE); value = null; }
      return 1;
    },
    expire() { expires = 0; },
  };
}

test("simultaneous starts grant exactly one owner and release allows a successor", async () => {
  const redis = fakeRedis();
  const leases = await Promise.all(Array.from({ length: 20 }, () => acquireCronLease(redis, "cron")));
  assert.equal(leases.filter(Boolean).length, 1);
  await leases.find(Boolean).release();
  const successor = await acquireCronLease(redis, "cron");
  assert.ok(successor);
  await successor.release();
});

test("expired owner's release cannot delete successor's lease", async () => {
  const redis = fakeRedis();
  const old = await acquireCronLease(redis, "cron");
  redis.expire();
  const successor = await acquireCronLease(redis, "cron");
  await old.release();
  assert.equal(await acquireCronLease(redis, "cron"), null);
  await successor.release();
});

test("missing Redis and acquisition errors fail closed", async () => {
  await assert.rejects(acquireCronLease(null, "cron"), /requires Redis/);
  await assert.rejects(acquireCronLease({ set: async () => { throw new Error("offline"); } }, "cron"), /offline/);
});

test("renewal preserves exclusivity and ownership loss invokes fatal handler", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const redis = fakeRedis();
  const errors = [];
  const lease = await acquireCronLease(redis, "cron", { ttlMs: 120, onLost: (error) => errors.push(error) });
  t.mock.timers.tick(40);
  await Promise.resolve();
  t.mock.timers.tick(40);
  await Promise.resolve();
  assert.equal(await acquireCronLease(redis, "cron"), null);
  redis.expire();
  const successor = await acquireCronLease(redis, "cron");
  t.mock.timers.tick(40);
  await Promise.resolve();
  assert.match(errors[0].message, /ownership lost/);
  await lease.release();
  assert.equal(await acquireCronLease(redis, "cron"), null);
  await successor.release();
});

test("hung renewal triggers watchdog before lease expiry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const redis = fakeRedis();
  const errors = [];
  await acquireCronLease(redis, "cron", { ttlMs: 120, onLost: (error) => errors.push(error) });
  redis.eval = () => new Promise(() => {});
  t.mock.timers.tick(108);
  assert.match(errors[0].message, /timed out/);
});
