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
    team_details: int = 60 * 60 * 24
    player_gamelog: int = 60 * 60 * 6
    players: int = 60 * 60 * 6
    player_bio: int = 60 * 60 * 24
    player_awards: int = 60 * 60 * 24
    player_stats: int = 60 * 15
    player_info: int = 60 * 60 * 24
    player_career: int = 60 * 60 * 24
    team_history: int = 60 * 60 * 24
    league_leaders: int = 60 * 15
    team_stats: int = 60 * 15
    player_shots: int = 60 * 60 * 6


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


def team_details_key(settings: Settings, team_id: int) -> str:
    return cache_key(settings, "team_details", str(team_id))


def player_gamelog_key(settings: Settings, player_id: int, season: str, season_type: str) -> str:
    season_type = (season_type or "Regular Season").strip()
    return cache_key(settings, "player_gamelog", str(player_id), season, season_type)


def players_key(settings: Settings, season: str, active: bool | None, search: str | None) -> str:
    active_part = "all" if active is None else ("active" if active else "inactive")
    search_part = (search or "").strip().lower()
    return cache_key(settings, "players", season, active_part, search_part or "all")


def player_bio_key(settings: Settings, player_id: int, season: str) -> str:
    return cache_key(settings, "player_bio", str(player_id), season)


def player_awards_key(settings: Settings, player_id: int) -> str:
    return cache_key(settings, "player_awards", str(player_id))


def player_info_key(settings: Settings, player_id: int) -> str:
    return cache_key(settings, "player_info", str(player_id))


def player_career_key(settings: Settings, player_id: int, season_type: str) -> str:
    return cache_key(settings, "player_career", str(player_id), (season_type or "Regular Season"))


def player_shots_key(
    settings: Settings,
    player_id: int,
    season: str,
    team_id: int | None,
    date_from: str | None,
    date_to: str | None,
) -> str:
    team_part = "all" if team_id is None else str(team_id)
    return cache_key(
        settings,
        "player_shots",
        str(player_id),
        season,
        team_part,
        date_from or "all",
        date_to or "all",
    )


def team_history_key(settings: Settings, team_id: int, season_type: str, per_mode: str) -> str:
    return cache_key(settings, "team_history", str(team_id), season_type, per_mode)


def league_leaders_key(
    settings: Settings,
    season: str,
    season_type: str,
    per_mode: str,
    stat_category: str,
    limit: int,
) -> str:
    return cache_key(
        settings,
        "league_leaders",
        season,
        season_type,
        per_mode,
        stat_category,
        str(limit),
    )


def team_stats_key(season: str, measure: str, per_mode: str) -> str:
    return f"team_stats:{season}:{measure}:{per_mode}"


def player_stats_key(
    settings: Settings,
    season: str,
    season_type: str,
    measure: str,
    per_mode: str,
    team_id: int | None,
) -> str:
    team_part = "all" if team_id is None else str(team_id)
    return cache_key(settings, "player_stats", season, season_type, measure, per_mode, team_part)
