#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, writeFileSync, rmSync } = require("node:fs");
const path = require("node:path");
const { parseArgs } = require("node:util");

// The launcher and worker must come from the same revision.
function prepare({ root = path.resolve(__dirname, "../.."), outputDir, ref = "HEAD" }) {
  if (!path.isAbsolute(root) || !outputDir || !path.isAbsolute(outputDir)) {
    throw new Error("Use absolute repository and output paths");
  }
  const commit = execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`],
    { cwd: root, encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("Could not resolve a commit");
  const launcher = execFileSync("git", ["show", `${commit}:workers/self-hosted/run.js`], { cwd: root, stdio: "pipe" });
  const launcherSha256 = createHash("sha256").update(launcher).digest("hex");
  const release = path.join(outputDir, `${commit.slice(0, 12)}-${launcherSha256.slice(0, 12)}`);
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  // Never replace an active release or mix files from different source revisions.
  mkdirSync(release, { mode: 0o700 });
  try {
    const archive = execFileSync("git", ["archive", "--format=tar", commit, "workers"],
      { cwd: root, maxBuffer: 20 * 1024 * 1024 });
    execFileSync("tar", ["-xf", "-", "-C", release], { input: archive });
    const manifest = { source_commit: commit, launcher_sha256: launcherSha256,
      prepared_at: new Date().toISOString() };
    writeFileSync(path.join(release, "release.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
    return { release, ...manifest };
  } catch (error) {
    rmSync(release, { recursive: true, force: true });
    throw error;
  }
}

if (require.main === module) {
  try {
    const { values } = parseArgs({ options: {
      "output-dir": { type: "string" }, ref: { type: "string", default: "HEAD" },
    } });
    console.log(JSON.stringify(prepare({ outputDir: values["output-dir"], ref: values.ref })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepare };
