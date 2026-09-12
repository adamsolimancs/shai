"use strict";

const { randomUUID } = require("node:crypto");

const RENEW = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

// Lease errors must stop the process: merely rejecting a promise leaves in-flight
// ingestion running. The watchdog also covers a hung renewal request.
async function acquireCronLease(redis, key, {
  ttlMs = 120000,
  onLost = (error) => { console.error(error); process.exit(1); },
} = {}) {
  if (!redis) throw new Error("Cron ingestion requires Redis for its exclusive lease");
  const owner = randomUUID();
  const started = Date.now();
  const acquired = await redis.set(key, owner, { nx: true, px: ttlMs });
  if (acquired !== "OK") {
    if (acquired === null) return null;
    throw new Error("Unexpected cron lease acquisition response");
  }
  let stopped = false;
  let renewal;
  let watchdog;
  const lose = (error) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(renewal);
    clearTimeout(watchdog);
    onLost(error);
  };
  const arm = (requestStarted) => {
    clearTimeout(watchdog);
    const remaining = ttlMs - (Date.now() - requestStarted) - Math.ceil(ttlMs / 10);
    if (remaining <= 0) throw new Error("Cron lease expired before confirmation");
    watchdog = setTimeout(() => lose(new Error("Cron lease renewal timed out")), remaining);
    renewal = setTimeout(() => {
      void (async () => {
        const renewalStarted = Date.now();
        try {
          const result = await redis.eval(RENEW, [key], [owner, ttlMs]);
          if (stopped) return;
          if (result !== 1) throw new Error("Cron lease ownership lost");
          arm(renewalStarted);
        } catch (error) { lose(error); }
      })();
    }, Math.min(ttlMs / 3, remaining / 2));
  };
  arm(started);
  return {
    async release() {
      stopped = true;
      clearTimeout(renewal);
      clearTimeout(watchdog);
      // Atomic owner comparison makes release safe even after expiry/reacquire.
      await redis.eval(RELEASE, [key], [owner]);
    },
  };
}

module.exports = { acquireCronLease, RENEW, RELEASE };
