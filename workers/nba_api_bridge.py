#!/usr/bin/env python3
"""Small stdin/stdout bridge that routes requests through the nba_api package."""

from __future__ import annotations

import json
import sys
from typing import Any
from urllib.parse import parse_qsl, urlparse

from nba_api.live.nba.endpoints import scoreboard as live_scoreboard
from nba_api.stats.library.http import NBAStatsHTTP
from nba_api.stats.static import players as static_players
from nba_api.stats.static import teams as static_teams

HTTP_CLIENT = NBAStatsHTTP()


def write_message(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def parse_request_url(url: str) -> tuple[str, dict[str, str]]:
    parsed = urlparse(url)
    endpoint = parsed.path.rstrip("/").split("/")[-1]
    if not endpoint:
        raise ValueError(f"Unable to determine endpoint from URL: {url}")
    parameters = dict(parse_qsl(parsed.query, keep_blank_values=True))
    return endpoint, parameters


def fetch_payload(url: str, timeout_ms: int | None) -> dict[str, Any]:
    endpoint, parameters = parse_request_url(url)
    timeout = (timeout_ms / 1000) if timeout_ms else None
    response = HTTP_CLIENT.send_api_request(
        endpoint=endpoint,
        parameters=parameters,
        timeout=timeout,
        raise_exception_on_error=False,
    )
    if not response.valid_json():
        preview = response.get_response()[:200]
        raise RuntimeError(
            f"InvalidResponse: endpoint={endpoint} url={response.get_url()} body_preview={preview}"
        )
    return response.get_dict()


def handle_request(message: dict[str, Any]) -> Any:
    operation = message.get("op") or "stats_url"
    if operation == "stats_url":
        return fetch_payload(
            str(message["url"]),
            int(message["timeout_ms"]) if message.get("timeout_ms") else None,
        )
    if operation == "static_teams":
        return static_teams.get_teams()
    if operation == "static_players":
        return static_players.get_players()
    if operation == "live_scoreboard":
        return live_scoreboard.ScoreBoard().get_dict()
    raise ValueError(f"Unsupported bridge op: {operation}")


def main() -> int:
    write_message({"ready": True})
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        message = json.loads(line)
        request_id = message.get("id")
        try:
            payload = handle_request(message)
            write_message({"id": request_id, "ok": True, "data": payload})
        except Exception as exc:  # pragma: no cover - exercised by worker integration
            write_message({"id": request_id, "ok": False, "error": f"{type(exc).__name__}: {exc}"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
