#!/usr/bin/env node
"use strict";

const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { parseArgs } = require("node:util");

const LABEL = "com.shai.ingestion";
const ROOT = path.resolve(__dirname, "../..");
const escapeXml = value => value.replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[char]);
const unitQuote = value => '"' + value.replaceAll("\\", "\\\\")
  .replaceAll('"', '\\"').replaceAll("%", "%%") + '"';

function render({ platform, node, python, envFile, root = ROOT, logDir }) {
  for (const value of [node, python, envFile, root, logDir]) {
    if (typeof value !== "string" || !path.isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value)) {
      throw new Error("Service paths must be absolute and contain no control characters");
    }
  }
  // Keep the launcher's --env-file argument outside Node's option parsing.
  const args = [node, "--", path.join(root, "workers/self-hosted/run.js"),
    "--env-file", envFile, "--python", python];
  if (platform === "macos") return {
    [`${LABEL}.plist`]: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${escapeXml(arg)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${escapeXml(root)}</string>
<key>StartCalendarInterval</key><array>${Array.from({ length: 12 }, (_, i) => `<dict><key>Minute</key><integer>${i * 5}</integer></dict>`).join("")}</array>
<key>RunAtLoad</key><true/>
<key>ProcessType</key><string>Background</string>
<key>ExitTimeOut</key><integer>20</integer>
<key>StandardOutPath</key><string>${escapeXml(path.join(logDir, "ingestion.log"))}</string>
<key>StandardErrorPath</key><string>${escapeXml(path.join(logDir, "ingestion-error.log"))}</string>
</dict></plist>
`,
  };
  if (platform === "linux") return {
    "shai-ingestion.service": `[Unit]
Description=ShAI current-season NBA ingestion

[Service]
Type=oneshot
ExecStart=:${args.map(unitQuote).join(" ")}
TimeoutStartSec=21min
TimeoutStopSec=20s
KillMode=control-group
UMask=0077
NoNewPrivileges=yes
`,
    "shai-ingestion.timer": `[Unit]
Description=Check ShAI ingestion schedule every five minutes

[Timer]
OnCalendar=*-*-* *:0/5:00
Persistent=true
AccuracySec=1s
Unit=shai-ingestion.service

[Install]
WantedBy=timers.target
`,
  };
  throw new Error("Choose --platform macos or linux");
}

function main() {
  const { values } = parseArgs({ options: {
    platform: { type: "string" }, python: { type: "string" }, "env-file": { type: "string" },
    "output-dir": { type: "string" }, "log-dir": { type: "string" },
    node: { type: "string", default: process.execPath }, root: { type: "string", default: ROOT },
  } });
  if (!values["output-dir"] || !path.isAbsolute(values["output-dir"])) {
    throw new Error("An absolute --output-dir is required; rendering never installs or enables services");
  }
  const files = render({ platform: values.platform, node: values.node, python: values.python,
    envFile: values["env-file"], root: values.root, logDir: values["log-dir"] });
  mkdirSync(values["output-dir"], { recursive: true, mode: 0o700 });
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(values["output-dir"], name);
    writeFileSync(target, content, { mode: 0o600, flag: "wx" });
    console.log(target);
  }
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { render, LABEL };
