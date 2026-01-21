"""DB-backed fetch helpers for serving cache endpoints."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from ..supabase import SupabaseClient


def _season_for_date(value: date) -> str:
    year = value.year
    month = value.month
    start_year = year if month >= 10 else year - 1
    suffix = str((start_year + 1) % 100).zfill(2)
    return f"{start_year}-{suffix}"


def _parse_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value)).date()
    except ValueError:
        return None


async def fetch_teams(supabase: SupabaseClient) -> list[dict[str, Any]]:
    return await supabase.select("teams")


async def fetch_league_standings(
    supabase: SupabaseClient, season: str
) -> list[dict[str, Any]]:
    return await supabase.select(
        "league_standings",
        filters={"season": f"eq.{season}"},
        order="conference_rank.asc",
    )


async def fetch_team_by_abbr(
    supabase: SupabaseClient, abbreviation: str
) -> dict[str, Any] | None:
    abbr = abbreviation.strip().upper()
    return await supabase.select_one("teams", filters={"abbreviation": f"eq.{abbr}"})


async def fetch_games(
    supabase: SupabaseClient,
    *,
    season: str,
    date_from: date | None,
    date_to: date | None,
    team_id: int | None,
    team_abbr: str | None,
    per_team: bool,
) -> list[dict[str, Any]]:
    if per_team:
        rows = await supabase.select("team_game_logs")
        filtered = []
        for row in rows:
            row_date = _parse_date(row.get("date"))
            if row_date is None:
                continue
            if _season_for_date(row_date) != season:
                continue
            if date_from and row_date < date_from:
                continue
            if date_to and row_date > date_to:
                continue
            if team_id and row.get("team_id") != team_id:
                continue
            if team_abbr and row.get("team_abbreviation") != team_abbr.upper():
                continue
            filtered.append(row)
        return filtered

    filters = {"season": f"eq.{season}"}
    if date_from:
        filters["date"] = f"gte.{date_from.isoformat()}"
    if date_to:
        filters["date"] = f"lte.{date_to.isoformat()}"
    rows = await supabase.select("games", filters=filters, order="date.asc")
    if team_abbr and not team_id:
        team = await fetch_team_by_abbr(supabase, team_abbr)
        team_id = team.get("id") if team else None
    if team_id:
        rows = [
            row
            for row in rows
            if row.get("home_team_id") == team_id or row.get("away_team_id") == team_id
        ]
    return rows


async def fetch_player_gamelog(
    supabase: SupabaseClient,
    *,
    player_id: int,
    season: str,
    season_type: str,
    date_from: date | None,
    date_to: date | None,
) -> list[dict[str, Any]]:
    normalized_season_type = (season_type or "Regular Season").strip().lower()
    rows = await supabase.select("player_game_logs", filters={"player_id": f"eq.{player_id}"})
    filtered = []
    for row in rows:
        row_season_type = (row.get("season_type") or "Regular Season").strip().lower()
        if normalized_season_type != row_season_type:
            continue
        row_date = _parse_date(row.get("game_date"))
        if row_date is None:
            continue
        if _season_for_date(row_date) != season:
            continue
        if date_from and row_date < date_from:
            continue
        if date_to and row_date > date_to:
            continue
        filtered.append(row)
    return filtered


async def fetch_boxscore(
    supabase: SupabaseClient, game_id: str
) -> dict[str, Any] | None:
    row = await supabase.select_one("boxscores", filters={"game_id": f"eq.{game_id}"})
    if not row:
        return None
    players = await supabase.select(
        "boxscore_players", filters={"game_id": f"eq.{game_id}"}
    )
    traditional = []
    advanced = []
    for player in players:
        stat_type = player.get("stat_type")
        payload = {k: v for k, v in player.items() if k not in {"stat_type", "game_id"}}
        if stat_type == "advanced":
            advanced.append(payload)
        else:
            traditional.append(payload)
    row["traditional_players"] = traditional
    row["advanced_players"] = advanced
    return row
