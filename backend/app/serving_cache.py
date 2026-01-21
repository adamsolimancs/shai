"""Serving cache keys and TTLs for Redis."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .config import Settings


@dataclass(frozen=True)
class CacheTTLs:
    scoreboard_live: int = 5
    scoreboard_final: int = 60 * 60
    boxscore_live: int = 5
    boxscore_final: int = 60 * 60 * 12
    standings: int = 60 * 15
    teams: int = 60 * 60 * 24
    player_gamelog: int = 60 * 60 * 6


TTLS = CacheTTLs()


def cache_prefix(settings: Settings) -> str:
    return settings.cache_key_prefix.rstrip(":")


def cache_key(settings: Settings, *parts: str) -> str:
    prefix = cache_prefix(settings)
    joined = ":".join(part.strip(":") for part in parts)
    return f"{prefix}:{joined}" if joined else prefix


def scoreboard_key(settings: Settings, game_date: date | str) -> str:
    date_str = game_date if isinstance(game_date, str) else game_date.isoformat()
    return cache_key(settings, "scoreboard", date_str)


def boxscore_key(settings: Settings, game_id: str) -> str:
    return cache_key(settings, "boxscore", game_id)


def standings_key(settings: Settings, season: str, league_id: str, season_type: str) -> str:
    return cache_key(settings, "standings", season, league_id, season_type)


def teams_key(settings: Settings, season: str) -> str:
    return cache_key(settings, "teams", season)


def player_gamelog_key(settings: Settings, player_id: int, season: str, season_type: str) -> str:
    season_type = (season_type or "Regular Season").strip()
    return cache_key(settings, "player_gamelog", str(player_id), season, season_type)
