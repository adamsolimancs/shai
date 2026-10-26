#!/usr/bin/env python3
"""Read-only probes of nba_api's public live CDN, with bounded requests."""

import json
import os
import time

from nba_api.live.nba.endpoints import boxscore, scoreboard


def main():
    game_id = os.environ.get("NBA_PROBE_GAME_ID", "0022600118")
    if not game_id.isdigit() or len(game_id) != 10 or not game_id.startswith("00226"):
        raise ValueError("NBA_PROBE_GAME_ID must identify a 2026-27 regular-season game")
    results = {}
    for name, fetch, validate in [
        ("live_scoreboard", lambda: scoreboard.ScoreBoard(timeout=15).get_dict(),
         lambda data: isinstance(data.get("scoreboard", {}).get("games"), list)),
        ("live_boxscore", lambda: boxscore.BoxScore(game_id, timeout=15).get_dict(),
         lambda data: data.get("game", {}).get("gameId") == game_id),
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
