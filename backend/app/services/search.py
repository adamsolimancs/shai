"""Search suggestion helpers backed by PostgreSQL or the warm resolver catalog."""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Literal

from rapidfuzz import fuzz

from ..database import DatabaseClient
from ..resolvers import NameResolver
from ..schemas import SearchSuggestion

SearchEntity = Literal["player", "team"]


def _coerce_id(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _slugify(value: str) -> str:
    normalized = (
        unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").lower()
    )
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", normalized))


def _suggestion(
    entity_type: SearchEntity,
    entity_id: int,
    name: str,
    subtitle: str | None = None,
) -> SearchSuggestion:
    url = f"/players/{entity_id}" if entity_type == "player" else f"/teams/{_slugify(name)}"
    return SearchSuggestion(
        type=entity_type,
        id=entity_id,
        name=name,
        subtitle=subtitle or None,
        url=url,
    )


async def fetch_search_suggestions(
    supabase: DatabaseClient,
    *,
    query: str,
    limit: int,
) -> list[SearchSuggestion]:
    """Call the indexed search RPC and normalize its rows for the public API."""

    payload = await supabase.rpc(
        "search_suggestions",
        {"p_query": query, "p_limit": limit},
    )
    if not isinstance(payload, list):
        return []

    suggestions: list[SearchSuggestion] = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        raw_entity_type = row.get("entity_type")
        if raw_entity_type == "player":
            entity_type: SearchEntity = "player"
        elif raw_entity_type == "team":
            entity_type = "team"
        else:
            continue
        entity_id = _coerce_id(row.get("entity_id"))
        if entity_id is None:
            continue
        name = str(row.get("display_name") or "").strip()
        if not name:
            continue
        subtitle = str(row.get("secondary_text") or "").strip() or None
        suggestions.append(_suggestion(entity_type, entity_id, name, subtitle))
    return suggestions[:limit]


def _match_score(query: str, candidate: str) -> float:
    normalized = candidate.strip().lower()
    if not normalized:
        return 0.0
    if normalized == query:
        return 4.0
    if normalized.startswith(query):
        return 3.0
    if any(token.startswith(query) for token in normalized.split()):
        return 2.5
    if query in normalized:
        return 2.0
    fuzzy_score = fuzz.WRatio(query, normalized) / 100
    return fuzzy_score if fuzzy_score >= 0.7 else 0.0


def search_resolver_catalog(
    resolver: NameResolver,
    *,
    query: str,
    limit: int,
) -> list[SearchSuggestion]:
    """Search the resolver's warm catalog when the database is unavailable."""

    normalized_query = query.strip().lower()
    ranked: dict[tuple[SearchEntity, int], tuple[float, SearchSuggestion]] = {}

    teams_by_id: dict[int, dict[str, Any]] = {}
    for team in resolver.teams.values():
        team_id = _coerce_id(team.get("id"))
        if team_id is None:
            continue
        teams_by_id[team_id] = team

    for player in resolver.players.values():
        player_id = _coerce_id(player.get("id"))
        if player_id is None:
            continue
        name = str(player.get("name") or "").strip()
        score = _match_score(normalized_query, name)
        if score <= 0:
            continue
        player_team_id = _coerce_id(player.get("team_id"))
        team = teams_by_id.get(player_team_id, {}) if player_team_id is not None else {}
        subtitle = str(team.get("abbreviation") or "").strip() or None
        ranked[("player", player_id)] = (
            score,
            _suggestion("player", player_id, name, subtitle),
        )

    for alias, team in resolver.teams.items():
        team_id = _coerce_id(team.get("id"))
        if team_id is None:
            continue
        name = str(team.get("name") or "").strip()
        score = max(_match_score(normalized_query, name), _match_score(normalized_query, alias))
        if score <= 0:
            continue
        subtitle = str(team.get("abbreviation") or "").strip() or None
        key: tuple[SearchEntity, int] = ("team", team_id)
        previous = ranked.get(key)
        if previous is None or score > previous[0]:
            ranked[key] = (score, _suggestion("team", team_id, name, subtitle))

    ordered = sorted(ranked.values(), key=lambda item: (-item[0], item[1].name.lower()))
    return [suggestion for _, suggestion in ordered[:limit]]
