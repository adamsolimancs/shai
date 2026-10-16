"use strict";

// Explicit integration check: uses an isolated local Redis Unix socket, never
// environment credentials or deployed services. Requires redis-server/redis-cli.
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { mkdtemp, rm } = require("node:fs/promises");
const { once } = require("node:events");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { acquireCronLease } = require("../cron-lease");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), "nbai-redis-"));
  const socket = path.join(directory, "redis.sock");
  const server = spawn("redis-server", [
    "--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const leases = [];
  try {
    await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error(`Redis startup timed out: ${output}`)), 10000);
      const finish = (error) => { clearTimeout(timer); error ? reject(error) : resolve(); };
      server.on("error", finish);
      server.on("exit", (code) => finish(new Error(`Redis exited (${code}): ${output}`)));
      server.stdout.on("data", (data) => {
        output += data;
        if (output.toLowerCase().includes("ready to accept connections")) finish();
      });
      server.stderr.on("data", (data) => { output += data; });
    });
    const cli = async (...args) => (await promisify(execFile)(
      "redis-cli", ["-s", socket, "--raw", ...args.map(String)], { timeout: 5000 }
    )).stdout.trim();
    const redis = {
      set: async (key, owner, options) => (await cli("SET", key, owner, "NX", "PX", options.px)) || null,
      eval: async (script, keys, args) => Number(await cli("EVAL", script, keys.length, ...keys, ...args)),
    };
    const acquire = async (options) => {
      const lease = await acquireCronLease(redis, "cron", options);
      if (lease) leases.push(lease);
      return lease;
    };
    const starts = await Promise.all(Array.from({ length: 20 }, () => acquire()));
    assert.equal(starts.filter(Boolean).length, 1);
    const original = starts.find(Boolean);
    await cli("PEXPIRE", "cron", 1);
    await sleep(20);
    const successor = await acquire();
    assert.ok(successor);
    await original.release();
    assert.equal(await acquire(), null);
    await successor.release();

    let lost;
    const renewing = await acquire({ ttlMs: 3000, onLost: (error) => { lost = error; } });
    await sleep(3500);
    assert.equal(lost, undefined);
    assert.equal(await acquire(), null, "renewal must keep the lease past its original TTL");
    await cli("SET", "cron", "replacement", "PX", 10000);
    for (let attempt = 0; attempt < 30 && !lost; attempt += 1) await sleep(100);
    assert.match(lost?.message || "", /ownership lost/);
    await renewing.release();
    assert.equal(await cli("GET", "cron"), "replacement");
    console.log("Real Redis lease checks passed: simultaneous starts, renewal, expiry, owner-safe release and loss.");
  } finally {
    await Promise.allSettled(leases.map((lease) => lease.release()));
    if (server.pid && server.exitCode === null) {
      const exited = once(server, "exit");
      server.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
