#!/usr/bin/env python3
"""Run the actual bootstrap/store against disposable, socket-only PostgreSQL."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "database"))
from build_baseline import render


def main():
    # Never inherit deployment connection strings/cache credentials into tests.
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(("PG", "DATABASE_", "UPSTASH_"))}
    with tempfile.TemporaryDirectory(prefix="shai-bootstrap-db-", dir="/tmp") as directory:
        data = str(Path(directory) / "data")
        def run(args, **kwargs):
            result = subprocess.run(args, env=env, text=True, capture_output=True, **kwargs)
            if result.returncode:
                raise RuntimeError(result.stdout + result.stderr)
            return result.stdout
        run(["initdb", "-D", data, "-A", "trust", "-U", "postgres", "--no-locale"])
        run(["pg_ctl", "-D", data, "-l", str(Path(directory) / "postgres.log"),
             "-o", f"-h '' -k {directory}", "-w", "start"])
        try:
            run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-h", directory,
                 "-U", "postgres", "postgres"], input=render())
            print(run(["node", str(ROOT / "workers/integration/bootstrap-fixture.cjs"), directory]))
        finally:
            run(["pg_ctl", "-D", data, "-m", "immediate", "-w", "stop"])


if __name__ == "__main__":
    main()
