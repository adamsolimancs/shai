"""DB-backed fetch helpers for serving cache endpoints."""

from __future__ import annotations

import json
from datetime import date
from typing import Any

from ..supabase import SupabaseClient


def _season_year(season: str) -> int | None:
    if not season:
        return None
    try:
        return int(str(season).split("-", maxsplit=1)[0])
    except (TypeError, ValueError):
        return None


def _parse_json(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return default
    return default


async def fetch_teams(supabase: SupabaseClient) -> list[dict[str, Any]]:
    rows = await supabase.select("teams")
    return [
        {
            "id": row.get("team_id"),
            "abbreviation": row.get("abbreviation"),
            "city": row.get("city"),
            "name": row.get("name"),
            "conference": row.get("conference"),
            "division": row.get("division"),
        }
        for row in rows
    ]


async def fetch_league_standings(
    supabase: SupabaseClient, season: str
) -> list[dict[str, Any]]:
    standings = await supabase.select(
        "league_standings",
        filters={"season": f"eq.{season}"},
        order="conference_rank.asc",
    )
    teams = await supabase.select("teams")
    teams_by_id = {
        row.get("team_id"): row for row in teams if row.get("team_id") is not None
    }
    results: list[dict[str, Any]] = []
    for row in standings:
        team = teams_by_id.get(row.get("team_id")) or {}
        results.append(
            {
                "team_id": row.get("team_id"),
                "team_name": team.get("name") or "",
                "team_city": team.get("city") or "",
                "team_slug": None,
                "team_abbreviation": team.get("abbreviation"),
                "conference": row.get("conference"),
                "conference_rank": row.get("conference_rank"),
                "division": row.get("division"),
                "division_rank": row.get("division_rank"),
                "wins": row.get("wins"),
                "losses": row.get("losses"),
                "win_pct": row.get("win_pct"),
                "games_back": row.get("games_back"),
                "division_games_back": row.get("division_games_back"),
                "record": row.get("record"),
                "home_record": row.get("home_record"),
                "road_record": row.get("road_record"),
                "last_ten": row.get("last_ten"),
                "streak": row.get("streak"),
            }
        )
    return results


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
        return []

    season_year = _season_year(season)
    filters: dict[str, str] = {}
    if season_year is not None:
        filters["season"] = f"eq.{season_year}"
    if date_from:
        filters["date"] = f"gte.{date_from.isoformat()}"
    if date_to:
        filters["date"] = f"lte.{date_to.isoformat()}"
    rows = await supabase.select("games", filters=filters, order="date.asc")
    if team_abbr and not team_id:
        team = await fetch_team_by_abbr(supabase, team_abbr)
        team_id = team.get("team_id") if team else None
    if team_id:
        rows = [
            row
            for row in rows
            if row.get("home_team_id") == team_id or row.get("away_team_id") == team_id
        ]
    for row in rows:
        row["season"] = season
    return rows


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
    advanced_fields = (
        "offensive_rating",
        "defensive_rating",
        "net_rating",
        "usage_pct",
        "true_shooting_pct",
        "effective_fg_pct",
    )
    for player in players:
        traditional.append(
            {
                "player_id": player.get("player_id"),
                "player_name": player.get("player_name"),
                "team_id": player.get("team_id"),
                "team_abbreviation": player.get("team_abbreviation"),
                "team_city": None,
                "start_position": player.get("start_position"),
                "comment": None,
                "minutes": player.get("minutes"),
                "field_goals_made": player.get("field_goals_made"),
                "field_goals_attempted": player.get("field_goals_attempted"),
                "field_goal_pct": player.get("field_goal_pct"),
                "three_point_made": player.get("three_point_made"),
                "three_point_attempted": player.get("three_point_attempted"),
                "three_point_pct": player.get("three_point_pct"),
                "free_throws_made": player.get("free_throws_made"),
                "free_throws_attempted": player.get("free_throws_attempted"),
                "free_throw_pct": player.get("free_throw_pct"),
                "offensive_rebounds": player.get("offensive_rebounds"),
                "defensive_rebounds": player.get("defensive_rebounds"),
                "rebounds": player.get("rebounds"),
                "assists": player.get("assists"),
                "steals": player.get("steals"),
                "blocks": player.get("blocks"),
                "turnovers": player.get("turnovers"),
                "fouls": player.get("fouls"),
                "points": player.get("points"),
                "plus_minus": player.get("plus_minus"),
            }
        )
        if any(player.get(field) is not None for field in advanced_fields):
            advanced.append(
                {
                    "player_id": player.get("player_id"),
                    "player_name": player.get("player_name"),
                    "team_id": player.get("team_id"),
                    "team_abbreviation": player.get("team_abbreviation"),
                    "minutes": player.get("minutes"),
                    "offensive_rating": player.get("offensive_rating"),
                    "defensive_rating": player.get("defensive_rating"),
                    "net_rating": player.get("net_rating"),
                    "usage_pct": player.get("usage_pct"),
                    "true_shooting_pct": player.get("true_shooting_pct"),
                    "effective_fg_pct": player.get("effective_fg_pct"),
                    "assist_pct": None,
                    "assist_to_turnover": None,
                    "rebound_pct": None,
                    "offensive_rebound_pct": None,
                    "defensive_rebound_pct": None,
                    "pace": None,
                    "pace_per40": None,
                    "possessions": None,
                    "pie": None,
                }
            )
    row["officials"] = _parse_json(row.get("officials"), [])
    row["home_team"] = _parse_json(
        row.get("home_team"),
        {"team_id": 0, "score": 0, "is_home": True, "leaders": []},
    )
    row["away_team"] = _parse_json(
        row.get("away_team"),
        {"team_id": 0, "score": 0, "is_home": False, "leaders": []},
    )
    row["line_score"] = _parse_json(row.get("line_score"), [])
    row["team_totals"] = _parse_json(row.get("team_totals"), [])
    row.setdefault("starter_bench", [])
    row["traditional_players"] = traditional
    row["advanced_players"] = advanced
    return row
