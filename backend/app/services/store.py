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


def _coerce_key(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _first_non_empty_text(*values: Any) -> str | None:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _normalize_username(value: Any) -> str | None:
    text = _first_non_empty_text(value)
    return text.lower() if text else None


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


async def fetch_league_standings(supabase: SupabaseClient, season: str) -> list[dict[str, Any]]:
    standings = await supabase.select(
        "league_standings",
        filters={"season": f"eq.{season}"},
        order="conference_rank.asc",
    )
    teams = await supabase.select("teams")
    teams_by_id = {row.get("team_id"): row for row in teams if row.get("team_id") is not None}
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


async def fetch_team_details(supabase: SupabaseClient, team_id: int) -> dict[str, Any] | None:
    team = await supabase.select_one("teams", filters={"team_id": f"eq.{team_id}"})
    if not team:
        return None
    detail = await supabase.select_one("team_details", filters={"team_id": f"eq.{team_id}"})
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


async def fetch_team_by_abbr(supabase: SupabaseClient, abbreviation: str) -> dict[str, Any] | None:
    abbr = abbreviation.strip().upper()
    return await supabase.select_one("teams", filters={"abbreviation": f"eq.{abbr}"})


async def fetch_api_snapshot(supabase: SupabaseClient, cache_key: str) -> Any | None:
    row = await supabase.select_one("api_snapshots", filters={"cache_key": f"eq.{cache_key}"})
    if not row:
        return None
    payload = row.get("payload")
    if payload is None:
        return None
    if isinstance(payload, (dict, list)):
        return payload
    if isinstance(payload, str):
        try:
            return json.loads(payload)
        except ValueError:
            return None
    return None


async def fetch_news_articles(
    supabase: SupabaseClient,
    *,
    limit: int,
) -> list[dict[str, Any]]:
    rows = await supabase.select(
        "news_articles",
        order="published_at.desc",
        limit=limit,
    )
    return [
        {
            "id": _first_non_empty_text(row.get("id")) or "",
            "source": _first_non_empty_text(row.get("source")) or "Unknown",
            "title": _first_non_empty_text(row.get("title")) or "Untitled",
            "summary": _first_non_empty_text(row.get("summary")) or "",
            "url": _first_non_empty_text(row.get("url")) or "",
            "published_at": _first_non_empty_text(row.get("published_at"))
            or datetime.utcnow().isoformat(),
            "image_url": _first_non_empty_text(row.get("image_url")),
        }
        for row in rows
        if _first_non_empty_text(row.get("id")) and _first_non_empty_text(row.get("url"))
    ]


async def fetch_user_account_by_auth_user_id(
    supabase: SupabaseClient,
    *,
    auth_user_id: str,
) -> dict[str, Any] | None:
    normalized_auth_user_id = _first_non_empty_text(auth_user_id)
    if not normalized_auth_user_id:
        return None
    row = await supabase.select_one(
        "user_accounts",
        filters={"auth_user_id": f"eq.{normalized_auth_user_id}"},
    )
    if not row:
        return None
    return {
        "auth_user_id": _first_non_empty_text(row.get("auth_user_id")) or "",
        "email": _first_non_empty_text(row.get("email")) or "",
        "name": _first_non_empty_text(row.get("name")),
        "username": _normalize_username(row.get("username")),
    }


async def fetch_user_account_by_username(
    supabase: SupabaseClient,
    *,
    username: str,
) -> dict[str, Any] | None:
    normalized_username = _normalize_username(username)
    if not normalized_username:
        return None
    row = await supabase.select_one(
        "user_accounts",
        filters={"username": f"eq.{normalized_username}"},
    )
    if not row:
        return None
    return {
        "auth_user_id": _first_non_empty_text(row.get("auth_user_id")) or "",
        "email": _first_non_empty_text(row.get("email")) or "",
        "name": _first_non_empty_text(row.get("name")),
        "username": _normalize_username(row.get("username")),
    }


async def upsert_user_account(
    supabase: SupabaseClient,
    *,
    auth_user_id: str,
    email: str,
    name: str | None = None,
    username: str | None = None,
) -> dict[str, Any]:
    normalized_auth_user_id = _first_non_empty_text(auth_user_id)
    normalized_email = _first_non_empty_text(email)
    if not normalized_auth_user_id or not normalized_email:
        raise ValueError("auth_user_id and email are required")

    await supabase.upsert(
        "user_accounts",
        [
            {
                "auth_user_id": normalized_auth_user_id,
                "email": normalized_email.lower(),
                "name": _first_non_empty_text(name),
                "username": _normalize_username(username),
                "updated_at": datetime.utcnow().isoformat(),
            }
        ],
        on_conflict="auth_user_id",
    )

    account = await fetch_user_account_by_auth_user_id(
        supabase,
        auth_user_id=normalized_auth_user_id,
    )
    return account or {
        "auth_user_id": normalized_auth_user_id,
        "email": normalized_email.lower(),
        "name": _first_non_empty_text(name),
        "username": _normalize_username(username),
    }


async def store_api_snapshot(supabase: SupabaseClient, cache_key: str, payload: Any) -> None:
    await supabase.upsert(
        "api_snapshots",
        [
            {
                "cache_key": cache_key,
                "payload": json.dumps(payload, default=str),
                "updated_at": datetime.utcnow().isoformat(),
            }
        ],
        on_conflict="cache_key",
    )


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
    teams_by_id = {row.get("team_id"): row for row in teams if row.get("team_id") is not None}
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


async def fetch_player_info(
    supabase: SupabaseClient,
    *,
    player_id: int,
) -> dict[str, Any] | None:
    row = await supabase.select_one("player_info", filters={"player_id": f"eq.{player_id}"})
    if not row:
        return None
    birthdate = None
    raw_birthdate = _first_non_empty_text(row.get("birthdate"))
    if raw_birthdate:
        normalized_birthdate = raw_birthdate.split("T", maxsplit=1)[0]
        try:
            birthdate = date.fromisoformat(normalized_birthdate)
        except ValueError:
            birthdate = None
    return {
        "player_id": _coerce_int(row.get("player_id")),
        "display_name": _first_non_empty_text(
            row.get("display_name"),
            " ".join(
                part
                for part in [
                    _first_non_empty_text(row.get("first_name")),
                    _first_non_empty_text(row.get("last_name")),
                ]
                if part
            ).strip(),
        )
        or "Unknown",
        "first_name": _first_non_empty_text(row.get("first_name")),
        "last_name": _first_non_empty_text(row.get("last_name")),
        "position": _first_non_empty_text(row.get("position")),
        "jersey": _first_non_empty_text(row.get("jersey")),
        "birthdate": birthdate,
        "school": _first_non_empty_text(row.get("school")),
        "country": _first_non_empty_text(row.get("country")),
        "season_experience": _coerce_int(row.get("season_experience")),
        "roster_status": _first_non_empty_text(row.get("roster_status")),
        "from_year": _coerce_int(row.get("from_year")),
        "to_year": _coerce_int(row.get("to_year")),
        "team_id": _coerce_int(row.get("team_id")),
        "team_name": _first_non_empty_text(row.get("team_name")),
        "team_abbreviation": _first_non_empty_text(row.get("team_abbreviation")),
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


async def fetch_player_career(
    supabase: SupabaseClient,
    *,
    player_id: int,
    season_type: str,
) -> list[dict[str, Any]]:
    rows = await supabase.select_all(
        "player_season_stats",
        filters={
            "player_id": f"eq.{player_id}",
            "season_type": f"eq.{season_type}",
        },
        order="season.desc",
    )
    teams = await supabase.select_all("teams")
    teams_by_id: dict[int, dict[str, Any]] = {}
    for row in teams:
        team_key = _coerce_int(row.get("team_id"))
        if team_key is not None:
            teams_by_id[team_key] = row
    results: list[dict[str, Any]] = []
    for row in rows:
        team_id = _coerce_int(row.get("team_id"))
        team = teams_by_id.get(team_id) or {}
        results.append(
            {
                "season_id": _first_non_empty_text(row.get("season")),
                "team_id": team_id,
                "team_abbreviation": _first_non_empty_text(
                    team.get("abbreviation"),
                    row.get("team_abbreviation"),
                ),
                "player_age": _coerce_float(row.get("player_age")),
                "games_played": _coerce_int(row.get("games_played")) or 0,
                "games_started": _coerce_int(row.get("games_started")) or 0,
                "minutes": _coerce_float(row.get("minutes_pg")) or 0.0,
                "points": _coerce_float(row.get("points_pg")) or 0.0,
                "rebounds": _coerce_float(row.get("rebounds_pg")) or 0.0,
                "assists": _coerce_float(row.get("assists_pg")) or 0.0,
                "steals": _coerce_float(row.get("steals_pg")),
                "blocks": _coerce_float(row.get("blocks_pg")),
                "field_goal_pct": _coerce_float(row.get("field_goal_pct_pg")),
                "three_point_pct": _coerce_float(row.get("three_point_pct_pg")),
                "free_throw_pct": _coerce_float(row.get("free_throw_pct_pg")),
                "true_shooting_pct": _coerce_float(row.get("true_shooting_pct_pg")),
            }
        )
    return [row for row in results if row.get("season_id")]


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
    rows = await supabase.select_all("player_season_stats", filters=filters, order="points_pg.desc")
    players = await supabase.select_all("players")
    try:
        player_info_rows = await supabase.select_all("player_info")
    except Exception:
        player_info_rows = []
    teams = await supabase.select_all("teams")
    players_by_id: dict[str, dict[str, Any]] = {}
    for row in players:
        key = _coerce_key(row.get("player_id") or row.get("id"))
        if key:
            players_by_id[key] = row
    player_info_by_id: dict[str, dict[str, Any]] = {}
    for row in player_info_rows:
        key = _coerce_key(row.get("player_id") or row.get("id"))
        if key:
            player_info_by_id[key] = row
    teams_by_id: dict[int, dict[str, Any]] = {}
    for row in teams:
        team_key = _coerce_int(row.get("team_id"))
        if team_key is not None:
            teams_by_id[team_key] = row
    results: list[dict[str, Any]] = []
    for row in rows:
        player_key = _coerce_key(row.get("player_id"))
        if player_key is None:
            continue
        player_id = _coerce_int(player_key)
        if player_id is None:
            continue
        player = players_by_id.get(player_key) or {}
        player_info = player_info_by_id.get(player_key) or {}
        team_id_value = _coerce_int(row.get("team_id"))
        team = teams_by_id.get(team_id_value) or {}
        points = _coerce_float(row.get("points_pg"))
        if points is None:
            points = _coerce_float(row.get("points"))
        rebounds = _coerce_float(row.get("rebounds_pg"))
        if rebounds is None:
            rebounds = _coerce_float(row.get("rebounds"))
        assists = _coerce_float(row.get("assists_pg"))
        if assists is None:
            assists = _coerce_float(row.get("assists"))
        minutes = _coerce_float(row.get("minutes_pg"))
        if minutes is None:
            minutes = _coerce_float(row.get("minutes"))
        info_first_name = _first_non_empty_text(player_info.get("first_name"))
        info_last_name = _first_non_empty_text(player_info.get("last_name"))
        info_full_name = " ".join(
            part for part in [info_first_name, info_last_name] if part
        ).strip()
        player_name = _first_non_empty_text(
            player.get("full_name"),
            row.get("player_name"),
            player_info.get("display_name"),
            info_full_name,
        )
        results.append(
            {
                "player_id": player_id,
                "player_name": player_name or f"Player {player_id}",
                "team_id": team_id_value,
                "team_abbreviation": team.get("abbreviation") or row.get("team_abbreviation"),
                "points": points if points is not None else 0.0,
                "rebounds": rebounds if rebounds is not None else 0.0,
                "assists": assists if assists is not None else 0.0,
                "minutes": minutes,
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
    season_year = _season_year(season)
    filters: dict[str, str] = {}
    if season_year is not None:
        filters["season"] = f"eq.{season_year}"
    if date_from and date_to:
        filters["and"] = f"(date.gte.{date_from.isoformat()},date.lte.{date_to.isoformat()})"
    elif date_from:
        filters["date"] = f"gte.{date_from.isoformat()}"
    elif date_to:
        filters["date"] = f"lte.{date_to.isoformat()}"
    rows = await supabase.select("games", filters=filters, order="date.asc")
    if date_from or date_to:
        filtered_rows: list[dict[str, Any]] = []
        for row in rows:
            game_date = _parse_game_date(row.get("date") or row.get("game_date"))
            if not game_date:
                continue
            if date_from and game_date < date_from:
                continue
            if date_to and game_date > date_to:
                continue
            filtered_rows.append(row)
        rows = filtered_rows
    if team_abbr and not team_id:
        team = await fetch_team_by_abbr(supabase, team_abbr)
        team_id = team.get("team_id") if team else None
    if team_id:
        rows = [
            row
            for row in rows
            if _coerce_int(row.get("home_team_id")) == team_id
            or _coerce_int(row.get("away_team_id")) == team_id
        ]
    if per_team:
        team_ids: set[int] = set()
        for row in rows:
            home_team_id = _coerce_int(row.get("home_team_id"))
            away_team_id = _coerce_int(row.get("away_team_id"))
            if home_team_id is not None:
                team_ids.add(home_team_id)
            if away_team_id is not None:
                team_ids.add(away_team_id)
        teams_by_id: dict[int, dict[str, Any]] = {}
        if team_ids:
            team_ids_filter = ",".join(str(team_key) for team_key in sorted(team_ids))
            teams = await supabase.select(
                "teams",
                filters={"team_id": f"in.({team_ids_filter})"},
            )
            teams_by_id = {
                team_key: row
                for row in teams
                if (team_key := _coerce_int(row.get("team_id"))) is not None
            }
        per_team_rows: list[dict[str, Any]] = []
        for row in rows:
            game_id = _first_non_empty_text(row.get("game_id"))
            game_date = _parse_game_date(row.get("date") or row.get("game_date"))
            home_team_id = _coerce_int(row.get("home_team_id"))
            away_team_id = _coerce_int(row.get("away_team_id"))
            home_team_name = _first_non_empty_text(row.get("home_team_name"))
            away_team_name = _first_non_empty_text(row.get("away_team_name"))
            home_team = teams_by_id.get(home_team_id) if home_team_id is not None else {}
            away_team = teams_by_id.get(away_team_id) if away_team_id is not None else {}
            home_team_abbr = _first_non_empty_text(
                row.get("home_team_abbreviation"),
                (home_team or {}).get("abbreviation"),
            )
            away_team_abbr = _first_non_empty_text(
                row.get("away_team_abbreviation"),
                (away_team or {}).get("abbreviation"),
            )
            home_score = _coerce_float(row.get("home_team_score"))
            away_score = _coerce_float(row.get("away_team_score"))
            if not game_id or game_date is None:
                continue
            home_label = home_team_abbr or home_team_name or str(home_team_id or "")
            away_label = away_team_abbr or away_team_name or str(away_team_id or "")
            home_result = (
                "W"
                if home_score is not None and away_score is not None and home_score > away_score
                else "L"
                if home_score is not None and away_score is not None and home_score < away_score
                else None
            )
            away_result = (
                "W"
                if home_score is not None and away_score is not None and away_score > home_score
                else "L"
                if home_score is not None and away_score is not None and away_score < home_score
                else None
            )
            if home_team_id is not None:
                per_team_rows.append(
                    {
                        "game_id": game_id,
                        "date": game_date,
                        "team_id": home_team_id,
                        "team_abbreviation": home_team_abbr or home_team_name or "",
                        "opponent_team_id": away_team_id,
                        "matchup": f"{home_label} vs. {away_label}",
                        "result": home_result,
                        "points": home_score or 0.0,
                    }
                )
            if away_team_id is not None:
                per_team_rows.append(
                    {
                        "game_id": game_id,
                        "date": game_date,
                        "team_id": away_team_id,
                        "team_abbreviation": away_team_abbr or away_team_name or "",
                        "opponent_team_id": home_team_id,
                        "matchup": f"{away_label} @ {home_label}",
                        "result": away_result,
                        "points": away_score or 0.0,
                    }
                )
        rows = per_team_rows
    for row in rows:
        row["season"] = season
    return rows


def _build_boxscore_payload(
    row: dict[str, Any] | None,
    players: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not row:
        return None
    payload = dict(row)
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
    payload["officials"] = _parse_json(payload.get("officials"), [])
    payload["home_team"] = _parse_json(
        payload.get("home_team"),
        {"team_id": 0, "score": 0, "is_home": True, "leaders": []},
    )
    payload["away_team"] = _parse_json(
        payload.get("away_team"),
        {"team_id": 0, "score": 0, "is_home": False, "leaders": []},
    )
    payload["line_score"] = _parse_json(payload.get("line_score"), [])
    payload["team_totals"] = _parse_json(payload.get("team_totals"), [])
    payload.setdefault("starter_bench", [])
    payload["traditional_players"] = traditional
    payload["advanced_players"] = advanced
    return payload


async def fetch_boxscore(supabase: SupabaseClient, game_id: str) -> dict[str, Any] | None:
    try:
        snapshot = await supabase.rpc("get_boxscore_snapshot", {"p_game_id": game_id})
    except Exception:
        snapshot = None
    if isinstance(snapshot, dict):
        row = snapshot.get("boxscore")
        if isinstance(row, dict):
            players = snapshot.get("players")
            return _build_boxscore_payload(
                row,
                players if isinstance(players, list) else [],
            )

    row = await supabase.select_one("boxscores", filters={"game_id": f"eq.{game_id}"})
    if not row:
        return None
    players = await supabase.select("boxscore_players", filters={"game_id": f"eq.{game_id}"})
    return _build_boxscore_payload(row, players)


async def fetch_ingestion_state(
    supabase: SupabaseClient, *, source: str, entity: str
) -> dict[str, Any] | None:
    return await supabase.select_one(
        "ingestion_state", filters={"source": f"eq.{source}", "entity": f"eq.{entity}"}
    )


async def fetch_team_history(
    supabase: SupabaseClient,
    *,
    team_id: int,
    season_type: str,
    per_mode: str,
) -> list[dict[str, Any]]:
    rows = await supabase.select_all(
        "team_season_history",
        filters={
            "team_id": f"eq.{team_id}",
            "season_type": f"eq.{season_type}",
            "per_mode": f"eq.{per_mode}",
        },
        order="season.desc",
    )
    return [
        {
            "team_id": _coerce_int(row.get("team_id")),
            "team_city": _first_non_empty_text(row.get("team_city")),
            "team_name": _first_non_empty_text(row.get("team_name")),
            "season": _first_non_empty_text(row.get("season")),
            "games_played": _coerce_int(row.get("games_played")) or 0,
            "wins": _coerce_int(row.get("wins")) or 0,
            "losses": _coerce_int(row.get("losses")) or 0,
            "win_pct": _coerce_float(row.get("win_pct")) or 0.0,
            "conference_rank": _coerce_int(row.get("conference_rank")),
            "division_rank": _coerce_int(row.get("division_rank")),
            "playoff_wins": _coerce_int(row.get("playoff_wins")),
            "playoff_losses": _coerce_int(row.get("playoff_losses")),
            "finals_result": _first_non_empty_text(row.get("finals_result")),
            "points": _coerce_float(row.get("points")),
            "field_goal_pct": _coerce_float(row.get("field_goal_pct")),
            "three_point_pct": _coerce_float(row.get("three_point_pct")),
        }
        for row in rows
        if _first_non_empty_text(row.get("season"))
    ]


async def fetch_league_leaders(
    supabase: SupabaseClient,
    *,
    season: str,
    season_type: str,
    per_mode: str,
    stat_category: str,
) -> list[dict[str, Any]]:
    rows = await supabase.select_all(
        "league_leader_rows",
        filters={
            "season": f"eq.{season}",
            "season_type": f"eq.{season_type}",
            "per_mode": f"eq.{per_mode}",
            "stat_category": f"eq.{stat_category}",
        },
        order="rank.asc",
    )
    return [
        {
            "player_id": _coerce_int(row.get("player_id")),
            "rank": _coerce_int(row.get("rank")) or 0,
            "player_name": _first_non_empty_text(row.get("player_name")) or "Unknown",
            "team_id": _coerce_int(row.get("team_id")),
            "team_abbreviation": _first_non_empty_text(row.get("team_abbreviation")),
            "games_played": _coerce_int(row.get("games_played")) or 0,
            "minutes": _coerce_float(row.get("minutes")),
            "points": _coerce_float(row.get("points")),
            "rebounds": _coerce_float(row.get("rebounds")),
            "assists": _coerce_float(row.get("assists")),
            "steals": _coerce_float(row.get("steals")),
            "blocks": _coerce_float(row.get("blocks")),
            "turnovers": _coerce_float(row.get("turnovers")),
            "efficiency": _coerce_float(row.get("efficiency")),
            "stat_value": _coerce_float(row.get("stat_value")) or 0.0,
            "stat_category": _first_non_empty_text(row.get("stat_category")) or stat_category,
        }
        for row in rows
        if _coerce_int(row.get("player_id")) is not None
    ]


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
    games_by_id = {game.get("game_id"): game for game in games if game.get("game_id") is not None}

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
            (teams_by_id.get(home_id) or {}).get("abbreviation") if home_id is not None else None
        )
        away_abbr = (
            (teams_by_id.get(away_id) or {}).get("abbreviation") if away_id is not None else None
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
