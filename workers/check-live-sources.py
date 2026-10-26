#!/usr/bin/env python3
"""Read-only probes of nba_api's public sources, with bounded requests."""

from datetime import datetime
import json
import os
from pathlib import Path
import platform
import ssl
import subprocess
import tempfile
import time
from zoneinfo import ZoneInfo

from nba_api.live.nba.endpoints import boxscore, scoreboard
from nba_api.live.nba.library.http import NBALiveHTTP
from nba_api.stats.endpoints import scoreboardv3
from nba_api.stats.library.http import STATS_HEADERS


def summarize_network(metrics, exit_code, headers, body, error=""):
    response_headers = {}
    for line in headers.splitlines():
        if line.startswith("HTTP/"):
            response_headers = {}
        elif ":" in line:
            name, value = line.split(":", 1)
            response_headers[name.lower()] = value.strip()
    try:
        json.loads(body)
        valid_json = True
    except (ValueError, UnicodeDecodeError):
        valid_json = False
    status = int(metrics.get("response_code", metrics.get("http_code", 0)))
    return {
        "exit_code": exit_code,
        "http_status": status or None,
        "dns_seconds": metrics.get("time_namelookup", 0),
        "tcp_seconds": metrics.get("time_connect", 0),
        "tls_seconds": metrics.get("time_appconnect", 0),
        "first_byte_seconds": metrics.get("time_starttransfer", 0),
        "total_seconds": metrics.get("time_total", 0),
        "remote_ip": metrics.get("remote_ip"),
        "tls_verify_result": metrics.get("ssl_verify_result"),
        "bytes_received": metrics.get("size_download", 0),
        "content_type": response_headers.get("content-type"),
        "content_encoding": response_headers.get("content-encoding"),
        "server": response_headers.get("server"),
        "valid_json": valid_json,
        # These are public NBA responses. Never print successful full score payloads.
        "body_preview": None if valid_json else " ".join(body.decode("utf-8", errors="replace").split())[:240],
        "error": error[:300] or None,
    }


def probe_network(url, headers, run=subprocess.run):
    with tempfile.TemporaryDirectory(prefix="nba-network-") as directory:
        target = Path(directory)
        args = ["curl", "-q", "--silent", "--show-error", "--location",
                "--proto", "=https", "--proto-redir", "=https",
                "--connect-timeout", "10", "--max-time", "20",
                "--max-filesize", "2097152", "--compressed",
                "--dump-header", str(target / "headers"),
                "--output", str(target / "body"), "--write-out", "%{json}"]
        for key, value in headers.items():
            # Let curl advertise only encodings it can decode. All other SDK
            # headers are retained; no proxy rotation or access-control bypass.
            if key.lower() != "accept-encoding":
                args.extend(["--header", f"{key}: {value}"])
        args.append(url)
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("DATABASE_", "UPSTASH_", "BACKEND_", "SUPABASE_"))}
        result = run(args, capture_output=True, text=True, timeout=25, env=env)
        metrics = json.loads(result.stdout)
        header_file, body_file = target / "headers", target / "body"
        return summarize_network(metrics, result.returncode,
                                 header_file.read_text() if header_file.exists() else "",
                                 body_file.read_bytes() if body_file.exists() else b"",
                                 result.stderr)


def check_network():
    date = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    print(json.dumps({"network_runtime": {"python": platform.python_version(),
                     "openssl": ssl.OPENSSL_VERSION,
                     "proxy_environment_configured": any(os.environ.get(key) for key in
                         ("HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"))}}), flush=True)
    results = []
    for name, url, headers in [
        ("cdn", "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json", NBALiveHTTP.headers),
        ("stats", f"https://stats.nba.com/stats/scoreboardv3?GameDate={date}&LeagueID=00", STATS_HEADERS),
    ]:
        try:
            result = probe_network(url, headers)
        except Exception as error:
            result = {"error_type": type(error).__name__, "http_status": None, "valid_json": False}
        results.append(result)
        print(json.dumps({"network_source": name, **result}), flush=True)
        time.sleep(1.5)
    return all(result.get("http_status") == 200 and result["valid_json"] for result in results)


def main():
    import sys
    if sys.argv[1:] not in ([], ["--network-only"]):
        raise ValueError("Usage: check-live-sources.py [--network-only]")
    if "--network-only" in sys.argv:
        return 0 if check_network() else 1
    game_id = os.environ.get("NBA_PROBE_GAME_ID", "0022600118")
    if not game_id.isdigit() or len(game_id) != 10 or not game_id.startswith("00226"):
        raise ValueError("NBA_PROBE_GAME_ID must identify a 2026-27 regular-season game")
    check_network()
    results = {}
    for name, fetch, validate in [
        ("live_scoreboard", lambda: scoreboard.ScoreBoard(timeout=15).get_dict(),
         lambda data: isinstance(data.get("scoreboard", {}).get("games"), list)),
        ("live_boxscore", lambda: boxscore.BoxScore(game_id, timeout=15).get_dict(),
         lambda data: data.get("game", {}).get("gameId") == game_id),
        ("stats_scoreboard_60s", lambda: scoreboardv3.ScoreboardV3(
            game_date=datetime.now(ZoneInfo("America/New_York")).date().isoformat(),
            timeout=60,
        ).get_dict(), lambda data: isinstance(data.get("scoreboard", {}).get("games"), list)),
    ]:
        started = time.monotonic()
        try:
            payload = fetch()
            if not validate(payload):
                raise ValueError("Missing or mismatched live payload")
            results[name] = {"reachable": True}
        except Exception as error:
            results[name] = {"reachable": False, "error": str(error)}
        results[name]["duration_ms"] = round((time.monotonic() - started) * 1000)
        print(json.dumps({"source": name, **results[name]}), flush=True)
        time.sleep(1.5)
    return 0 if all(result["reachable"] for result in results.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
