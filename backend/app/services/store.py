"""DB-backed fetch helpers for serving cache endpoints."""

from __future__ import annotations

import json
from datetime import date, datetime
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


def _parse_list(value: Any) -> list[str]:
    parsed = _parse_json(value, [])
    if isinstance(parsed, list):
        cleaned: list[str] = []
        for item in parsed:
            if item is None:
                continue
            text = str(item).strip()
            if text:
                cleaned.append(text)
        return cleaned
    if isinstance(parsed, str):
        cleaned = parsed.strip()
        return [cleaned] if cleaned else []
    if parsed is None:
        return []
    return [str(parsed)]


def _parse_dict(value: Any) -> dict[str, str]:
    parsed = _parse_json(value, {})
    if not isinstance(parsed, dict):
        return {}
    cleaned: dict[str, str] = {}
    for key, item in parsed.items():
        if item is None:
            continue
        text = str(item).strip()
        if text:
            cleaned[str(key)] = text
    return cleaned


def _parse_game_date(value: Any) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        cleaned = value.strip()
        if "T" in cleaned:
            cleaned = cleaned.split("T", maxsplit=1)[0]
        try:
            return date.fromisoformat(cleaned)
        except ValueError:
            return None
    return None


def _coerce_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _coerce_int(value: Any) -> int | None:
    try:
        if value is None or value == "":
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_minutes(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        trimmed = value.strip()
        if not trimmed:
            return 0.0
        if ":" in trimmed:
            parts = trimmed.split(":")
            if len(parts) >= 2:
                try:
                    minutes = int(parts[0])
                    seconds = int(parts[1])
                    if minutes < 0 or seconds < 0:
                        return 0.0
                    return minutes + seconds / 60.0
                except ValueError:
                    return 0.0
        try:
            return float(trimmed)
        except ValueError:
            return 0.0
    return 0.0


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


async def fetch_team_details(
    supabase: SupabaseClient, team_id: int
) -> dict[str, Any] | None:
    team = await supabase.select_one("teams", filters={"team_id": f"eq.{team_id}"})
    if not team:
        return None
    detail = await supabase.select_one(
        "team_details", filters={"team_id": f"eq.{team_id}"}
    )
    detail = detail or {}
    return {
        "team_id": team_id,
        "abbreviation": team.get("abbreviation"),
        "nickname": team.get("name"),
        "city": team.get("city"),
        "year_founded": _coerce_int(detail.get("year_founded")),
        "arena": detail.get("arena"),
        "arena_capacity": _coerce_int(detail.get("arena_capacity")),
        "owner": detail.get("owner"),
        "general_manager": detail.get("general_manager"),
        "head_coach": detail.get("head_coach"),
        "dleague_affiliation": detail.get("dleague_affiliation"),
        "championships": _parse_list(detail.get("championships")),
        "conference_titles": _parse_list(detail.get("conference_titles")),
        "division_titles": _parse_list(detail.get("division_titles")),
        "hall_of_famers": _parse_list(detail.get("hall_of_famers")),
        "retired_numbers": _parse_list(detail.get("retired_numbers")),
        "social_sites": _parse_dict(detail.get("social_sites")),
    }


async def fetch_team_by_abbr(
    supabase: SupabaseClient, abbreviation: str
) -> dict[str, Any] | None:
    abbr = abbreviation.strip().upper()
    return await supabase.select_one("teams", filters={"abbreviation": f"eq.{abbr}"})


def _split_name(full_name: str | None) -> tuple[str, str]:
    if not full_name:
        return "", ""
    parts = full_name.strip().split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


async def fetch_players(
    supabase: SupabaseClient,
    *,
    active: bool | None = None,
    search: str | None = None,
) -> list[dict[str, Any]]:
    filters: dict[str, str] = {}
    if active is not None:
        filters["is_active"] = f"eq.{str(active).lower()}"
    if search:
        filters["full_name"] = f"ilike.*{search.strip()}*"
    rows = await supabase.select_all("players", filters=filters, order="full_name.asc")
    teams = await supabase.select("teams")
    teams_by_id = {
        row.get("team_id"): row for row in teams if row.get("team_id") is not None
    }
    results: list[dict[str, Any]] = []
    for row in rows:
        player_id = _coerce_int(row.get("player_id"))
        if player_id is None:
            continue
        full_name = row.get("full_name") or ""
        first_name, last_name = _split_name(full_name)
        team_id = _coerce_int(row.get("current_team_id"))
        team = teams_by_id.get(team_id) or {}
        is_active = str(row.get("is_active") or "").strip().lower() == "true"
        results.append(
            {
                "id": player_id,
                "first_name": first_name,
                "last_name": last_name,
                "full_name": full_name,
                "team_id": team_id,
                "team_abbreviation": team.get("abbreviation"),
                "is_active": is_active,
            }
        )
    return results


async def fetch_player_bio(
    supabase: SupabaseClient,
    *,
    player_id: int,
) -> dict[str, Any] | None:
    row = await supabase.select_one("players", filters={"player_id": f"eq.{player_id}"})
    if not row:
        return None
    return {
        "height": row.get("height"),
        "weight": _coerce_int(row.get("weight")),
        "draft_year": _coerce_int(row.get("draft_year")),
        "draft_pick": row.get("draft_pick"),
        "college": row.get("college"),
        "country": row.get("country"),
    }


async def fetch_player_awards(
    supabase: SupabaseClient,
    *,
    player_id: int,
) -> list[dict[str, Any]]:
    rows = await supabase.select(
        "player_awards",
        filters={"player_id": f"eq.{player_id}"},
        order="season.desc",
    )
    results: list[dict[str, Any]] = []
    for row in rows:
        results.append(
            {
                "season": row.get("season"),
                "description": row.get("description"),
                "team": row.get("team"),
                "conference": row.get("conference"),
                "award_type": row.get("award_type"),
                "subtype1": row.get("subtype1"),
                "subtype2": row.get("subtype2"),
                "subtype3": row.get("subtype3"),
                "month": row.get("month"),
                "week": row.get("week"),
                "all_nba_team_number": _coerce_int(row.get("all_nba_team_number")),
            }
        )
    return results


async def fetch_player_stats(
    supabase: SupabaseClient,
    *,
    season: str,
    season_type: str,
    team_id: int | None,
) -> list[dict[str, Any]]:
    filters: dict[str, str] = {"season": f"eq.{season}", "season_type": f"eq.{season_type}"}
    if team_id is not None:
        filters["team_id"] = f"eq.{team_id}"
    rows = await supabase.select_all(
        "player_season_stats", filters=filters, order="points_pg.desc"
    )
    players = await supabase.select("players")
    teams = await supabase.select("teams")
    players_by_id = {
        row.get("player_id"): row for row in players if row.get("player_id") is not None
    }
    teams_by_id = {
        row.get("team_id"): row for row in teams if row.get("team_id") is not None
    }
    results: list[dict[str, Any]] = []
    for row in rows:
        player_id = _coerce_int(row.get("player_id"))
        if player_id is None:
            continue
        player = players_by_id.get(row.get("player_id")) or {}
        team_id_value = _coerce_int(row.get("team_id"))
        team = teams_by_id.get(team_id_value) or {}
        results.append(
            {
                "player_id": player_id,
                "player_name": player.get("full_name") or "",
                "team_id": team_id_value,
                "team_abbreviation": team.get("abbreviation"),
                "points": _coerce_float(row.get("points_pg")),
                "rebounds": _coerce_float(row.get("rebounds_pg")),
                "assists": _coerce_float(row.get("assists_pg")),
                "minutes": _coerce_float(row.get("minutes_pg")),
            }
        )
    return results


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
        "assist_pct",
        "assist_to_turnover",
        "rebound_pct",
        "offensive_rebound_pct",
        "defensive_rebound_pct",
        "pace",
        "pace_per40",
        "possessions",
        "pie",
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
                    "assist_pct": player.get("assist_pct"),
                    "assist_to_turnover": player.get("assist_to_turnover"),
                    "rebound_pct": player.get("rebound_pct"),
                    "offensive_rebound_pct": player.get("offensive_rebound_pct"),
                    "defensive_rebound_pct": player.get("defensive_rebound_pct"),
                    "pace": player.get("pace"),
                    "pace_per40": player.get("pace_per40"),
                    "possessions": player.get("possessions"),
                    "pie": player.get("pie"),
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


async def fetch_ingestion_state(
    supabase: SupabaseClient, *, source: str, entity: str
) -> dict[str, Any] | None:
    return await supabase.select_one(
        "ingestion_state", filters={"source": f"eq.{source}", "entity": f"eq.{entity}"}
    )


async def fetch_player_gamelog_from_boxscores(
    supabase: SupabaseClient,
    *,
    player_id: int,
    season: str,
    date_from: date | None,
    date_to: date | None,
) -> list[dict[str, Any]]:
    rows = await supabase.select(
        "boxscore_players",
        filters={"player_id": f"eq.{player_id}"},
    )
    if not rows:
        return []

    game_ids: list[str] = []
    seen_ids: set[str] = set()
    for row in rows:
        game_id = row.get("game_id")
        if not game_id or game_id in seen_ids:
            continue
        seen_ids.add(game_id)
        game_ids.append(game_id)
    if not game_ids:
        return []

    filters: dict[str, str] = {"game_id": f"in.({','.join(game_ids)})"}
    season_year = _season_year(season)
    if season_year is not None:
        filters["season"] = f"eq.{season_year}"
    games = await supabase.select("games", filters=filters)
    if not games:
        return []
    games_by_id = {
        game.get("game_id"): game for game in games if game.get("game_id") is not None
    }

    team_ids: set[int] = set()
    for game in games:
        home_id = _coerce_int(game.get("home_team_id"))
        away_id = _coerce_int(game.get("away_team_id"))
        if home_id is not None:
            team_ids.add(home_id)
        if away_id is not None:
            team_ids.add(away_id)
    teams_by_id: dict[int, dict[str, Any]] = {}
    if team_ids:
        team_filters = {"team_id": f"in.({','.join(str(team_id) for team_id in team_ids)})"}
        teams = await supabase.select("teams", filters=team_filters)
        teams_by_id = {
            _coerce_int(team.get("team_id")): team
            for team in teams
            if team.get("team_id") is not None
        }

    logs: list[dict[str, Any]] = []
    used_games: set[str] = set()
    for row in rows:
        game_id = row.get("game_id")
        if not game_id or game_id in used_games:
            continue
        game = games_by_id.get(game_id)
        if not game:
            continue
        game_date = _parse_game_date(game.get("date") or game.get("game_date"))
        if not game_date:
            continue
        if date_from and game_date < date_from:
            continue
        if date_to and game_date > date_to:
            continue

        team_id = _coerce_int(row.get("team_id"))
        home_id = _coerce_int(game.get("home_team_id"))
        away_id = _coerce_int(game.get("away_team_id"))
        team_abbr = row.get("team_abbreviation")
        if not team_abbr and team_id is not None:
            team_abbr = (teams_by_id.get(team_id) or {}).get("abbreviation")
        home_abbr = (
            (teams_by_id.get(home_id) or {}).get("abbreviation")
            if home_id is not None
            else None
        )
        away_abbr = (
            (teams_by_id.get(away_id) or {}).get("abbreviation")
            if away_id is not None
            else None
        )

        is_home: bool | None = None
        if team_id is not None and home_id is not None and team_id == home_id:
            is_home = True
        elif team_id is not None and away_id is not None and team_id == away_id:
            is_home = False
        elif team_abbr and home_abbr and str(team_abbr).upper() == str(home_abbr).upper():
            is_home = True
        elif team_abbr and away_abbr and str(team_abbr).upper() == str(away_abbr).upper():
            is_home = False

        opponent = None
        if is_home is True:
            opponent = away_abbr
        elif is_home is False:
            opponent = home_abbr
        else:
            opponent = away_abbr or home_abbr

        prefix = team_abbr or home_abbr or away_abbr or ""
        if prefix and opponent:
            separator = "vs." if is_home is not False else "@"
            matchup = f"{prefix} {separator} {opponent}"
        else:
            matchup = prefix or opponent or ""

        minutes = _parse_minutes(row.get("minutes"))
        points = _coerce_float(row.get("points"))
        rebounds = _coerce_float(row.get("rebounds"))
        assists = _coerce_float(row.get("assists"))
        steals = _coerce_float(row.get("steals"))
        blocks = _coerce_float(row.get("blocks"))
        turnovers = _coerce_float(row.get("turnovers"))
        plus_minus = _coerce_float(row.get("plus_minus"))
        field_goals_made = _coerce_float(row.get("field_goals_made"))
        field_goals_attempted = _coerce_float(row.get("field_goals_attempted"))
        three_point_made = _coerce_float(row.get("three_point_made"))
        three_point_attempted = _coerce_float(row.get("three_point_attempted"))
        field_goal_pct = _coerce_float(row.get("field_goal_pct"))
        three_point_pct = _coerce_float(row.get("three_point_pct"))

        logs.append(
            {
                "game_id": game_id,
                "game_date": game_date,
                "matchup": matchup,
                "team_abbreviation": team_abbr or prefix or "",
                "minutes": minutes,
                "points": points if points is not None else 0.0,
                "rebounds": rebounds if rebounds is not None else 0.0,
                "assists": assists if assists is not None else 0.0,
                "steals": steals,
                "blocks": blocks,
                "turnovers": turnovers,
                "plus_minus": plus_minus,
                "field_goals_made": field_goals_made,
                "field_goals_attempted": field_goals_attempted,
                "three_point_made": three_point_made,
                "three_point_attempted": three_point_attempted,
                "field_goal_pct": field_goal_pct,
                "three_point_pct": three_point_pct,
            }
        )
        used_games.add(game_id)

    logs.sort(
        key=lambda item: item.get("game_date") or date.min,
        reverse=True,
    )
    return logs
