# Self-hosted live ingestion

The production worker can run as a native user service on a machine with tested
NBA stats access. It uses the existing resumable bootstrap, 2026–27-only data,
shared Upstash lease and transactional Neon publication. It does not execute
GitHub Actions jobs or automatically pull development changes.

The paused Mac service is installed as `com.shai.ingestion`. Its private runtime,
configuration and logs are under `workers/.self-hosted/`; Python is in
`workers/.venv/`. The source commit and launcher hash are recorded in the
release's `release.json`. The first ingestion, service-start and automatic
00:40 Eastern calendar runs succeeded. The Mac service was subsequently disabled
and unloaded. Recurring GitHub ingestion is also disabled. See [PIPELINE.md](../PIPELINE.md)
for verification timestamps and the pause history. Git ignores both private directories.

On October 26, 2026, the Mac passed the stats-based source check: 43 played games,
400 player-stat rows, nine scheduled games and a recent V3 box score. The live CDN
is not required for this source adapter. GitHub-hosted stats and CDN probes failed;
moving the worker does not guarantee that a different network will remain usable.

## Prepare a host

Use Node.js 24+ and a dedicated Python 3.11 virtual environment. From the repo root:

```sh
uv venv --python 3.11 workers/.venv
uv pip install --python workers/.venv/bin/python nba_api==1.11.4
chmod 600 workers/worker.env
```

`workers/worker.env` must contain the same `DATABASE_URL`, `DATABASE_SCHEMA`, Redis
credentials and `CACHE_KEY_PREFIX` as the other production writer. The launcher
requires a private environment file owned by the service user, loads credentials
from that file, and does not fall back to inherited database/Redis credentials.
The file is parsed as environment data; it is never sourced as a shell script.

The launcher fixes the season to 2026–27 and disables historical sweeps. Each run
checks Python 3.11 and nba_api 1.11.4. Absolute Node/Python paths are required by
the service, so shell activation and interactive PATH configuration are unnecessary.

Before installing any recurring service, test NBA access from the actual host:

```sh
node -- workers/self-hosted/run.js \
  --env-file /absolute/path/to/private/worker.env \
  --python /absolute/path/to/workers/.venv/bin/python --check
```

This mode is read-only and checks the bootstrap's game-list, player-stat,
scoreboard and traditional/summary V3 box-score path. It needs no database or
Redis credentials. It exits nonzero on source failures or an inconsistent sample
final box score. Other required stages are validated by the first real ingestion
pass.

## Prepare a release

Deploy a committed worker revision to a separate runtime directory. This keeps
uncommitted development edits out of the live process:

```sh
node workers/self-hosted/prepare-runtime.js \
  --ref COMMIT_SHA --output-dir /absolute/private/releases
```

The JSON result identifies the release directory and source commit. A release
contains the committed `workers/` tree and a manifest. Select a commit that
includes both the worker and `workers/self-hosted/run.js`. Its `release.json`
records the commit, launcher hash and preparation time. Existing release
directories are never overwritten. Install dependencies:

```sh
npm ci --ignore-scripts --prefix /absolute/release/workers
```

Copy the production environment to a private file outside the release and keep
its permissions at 600. Create a private log directory. Confirm the release works:

```sh
node -- /absolute/release/workers/self-hosted/run.js \
  --env-file /absolute/private/worker.env \
  --python /absolute/path/to/workers/.venv/bin/python --once
```

`--once` bypasses the clock gate, preserving checkpoints and the shared lease.
It does not force completed stages to refresh. Confirm `complete: true` and
advancing Neon observations before enabling a service or retiring another writer.

## macOS LaunchAgent

Generate a service definition; rendering does not install or enable it:

```sh
node -- workers/self-hosted/render-service.js --platform macos \
  --root /absolute/release \
  --env-file /absolute/private/worker.env \
  --python /absolute/path/to/workers/.venv/bin/python \
  --log-dir /absolute/private/logs --output-dir /absolute/private/service
plutil -lint /absolute/private/service/com.shai.ingestion.plist
```

The current Node executable is recorded by default; `--node` selects another
absolute executable path. Install as the logged-in user, without sudo:

```sh
mkdir -p "$HOME/Library/LaunchAgents"
install -m 600 /absolute/private/service/com.shai.ingestion.plist \
  "$HOME/Library/LaunchAgents/com.shai.ingestion.plist"
launchctl bootstrap "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/com.shai.ingestion.plist"
launchctl print "gui/$(id -u)/com.shai.ingestion"
```

Launchd checks every five minutes. The launcher permits work from 15:00 through
02:59 America/New_York and at 03:00, 06:00, 09:00 and 12:00 otherwise, independent
of the Mac's timezone. The existing bootstrap checkpoints control which stages
actually fetch. Off-window launches exit successfully without loading credentials.
There is no continuous restart loop. A run exceeding 20 minutes is terminated and
exits nonzero; a subsequent tick can retry unfinished stages.

A LaunchAgent runs while its user is logged in. Sleeping, shutdown, logout or
network loss interrupt updates; this setup does not wake the Mac or prevent sleep.
Missed calendar events are coalesced on wake, then the current clock gate applies.
This is periodic refresh, not a guaranteed always-on live feed.
[Apple launchd guidance](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)

Inspect `ingestion.log`, `ingestion-error.log` in the selected log directory and
the service's last exit code. Logs append across runs; rotate/archive them as
part of host maintenance. A retained old final box score is not evidence that
current source access succeeded. Use Neon observations/checkpoints or the
separate ingestion-health command for freshness and coverage.

### Resuming the paused macOS service

Prepare and check the intended release first. Keep the GitHub writer disabled.
When production ingestion is ready to resume, re-enable the service before
loading its plist, since a disabled service stays disabled across reboots:

```sh
launchctl enable "gui/$(id -u)/com.shai.ingestion"
launchctl bootstrap "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/com.shai.ingestion.plist"
launchctl print "gui/$(id -u)/com.shai.ingestion"
```

Verify an eligible calendar run in the logs, then use the [health report](README.md#read-only-health-and-coverage-report)
to confirm new source observations and checkpoint success. Pausing again uses
`launchctl disable` followed by `launchctl bootout`, with the plist retained.

Stop and remove the service without deleting data:

```sh
launchctl bootout "gui/$(id -u)/com.shai.ingestion"
rm "$HOME/Library/LaunchAgents/com.shai.ingestion.plist"
```

To update, prepare and test a new release, stop the old service, render its new
definition into a fresh directory, replace the installed plist and bootstrap it
again. Re-render if the Node/Python executable paths change. Credentials can be
rotated in the private environment file without changing the plist.

## Linux option

The same renderer accepts `--platform linux` and produces a user-level
`shai-ingestion.service` plus `shai-ingestion.timer`. Copy them into
`~/.config/systemd/user/`, then use `systemctl --user daemon-reload` and
`systemctl --user enable --now shai-ingestion.timer`. For service users that must
continue after logout, configure user lingering according to the host's policy.
The timer coalesces missed starts, and an already active oneshot is not restarted.
Logs are in `journalctl --user -u shai-ingestion.service`.
[systemd service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html),
[systemd timer](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html)

## Validation

`node --test workers/tests/self-hosted.test.js` checks New York/DST schedule
boundaries, credential isolation, private-file enforcement, read-only preflight,
lease configuration, runtime/source/ingestion failure propagation, real child
timeouts, service argument escaping, and release isolation from development edits
and secret files. These tests require no live NBA, Redis or Neon access. The macOS
definition is also checked with the actual `plutil` parser before installation.
