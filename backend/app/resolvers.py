"""Name resolution utilities for players and teams."""

from __future__ import annotations

import asyncio
import logging
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from rapidfuzz import fuzz, process

from .cache import CacheBackend
from .supabase import SupabaseClient

logger = logging.getLogger(__name__)

try:
    from nba_api.stats.endpoints import commonallplayers as commonallplayers_module
    from nba_api.stats.endpoints import franchisehistory as franchisehistory_module
except Exception:  # pragma: no cover - nba_api only required at runtime
    commonallplayers_module = None
    franchisehistory_module = None


def _normalize(value: str) -> str:
    return (
        unicodedata.normalize("NFKD", value)
        .encode("ascii", "ignore")
        .decode("ascii")
        .strip()
        .lower()
    )


@dataclass
class Resolution:
    """Represents a fuzzy lookup result."""

    id: int | None
    name: str | None
    abbreviation: str | None = None
    confidence: float = 0.0


class NameResolver:
    """Resolves free-form player or team names into canonical IDs."""

    CACHE_KEY = "resolver:data"

    def __init__(self, cache: CacheBackend, supabase: SupabaseClient | None = None):
        self.cache = cache
        self.supabase = supabase
        self.players: dict[str, dict[str, Any]] = {}
        self.teams: dict[str, dict[str, Any]] = {}
        self.last_refreshed: datetime | None = None

    async def initialize(self) -> None:
        cached = await self.cache.get_stale(self.CACHE_KEY)
        if cached:
            self.players = cached.get("players", {})
            self.teams = cached.get("teams", {})
            ts = cached.get("last_refreshed")
            if ts:
                self.last_refreshed = datetime.fromisoformat(ts)
        await self.refresh()

    async def refresh(self) -> None:
        try:
            if self.supabase:
                data = await self._fetch_from_db()
            else:
                data = await asyncio.get_running_loop().run_in_executor(None, self._fetch_latest)
        except Exception:
            logger.exception("resolver refresh failed; falling back to cached data")
            return
        self.players = data["players"]
        self.teams = data["teams"]
        self.last_refreshed = datetime.now(tz=UTC)
        payload = {
            "players": self.players,
            "teams": self.teams,
            "last_refreshed": self.last_refreshed.isoformat(),
        }
        await self.cache.set(self.CACHE_KEY, payload, ttl=60 * 60 * 24)

    def _fetch_latest(self) -> dict[str, dict[str, Any]]:
        if not commonallplayers_module or not franchisehistory_module:
            raise RuntimeError("nba_api is required to refresh resolver data")
        players_endpoint = commonallplayers_module.CommonAllPlayers(is_only_current_season=0)
        teams_endpoint = franchisehistory_module.FranchiseHistory()
        players_df = players_endpoint.get_data_frames()[0]
        teams_df = teams_endpoint.get_data_frames()[0]
        players = {}
        for row in players_df.to_dict("records"):
            key = _normalize(row.get("DISPLAY_FIRST_LAST", ""))
            players[key] = {
                "id": int(row.get("PERSON_ID")),
                "name": row.get("DISPLAY_FIRST_LAST"),
                "team_id": row.get("TEAM_ID"),
            }
        teams = {}
        for row in teams_df.to_dict("records"):
            display = f"{row.get('TEAM_CITY', '')} {row.get('TEAM_NAME', '')}".strip()
            key = _normalize(display)
            abbreviation = (
                row.get("TEAM_ABBREVIATION")
                or row.get("TRICODE")
                or row.get("ABBREVIATION")
            )
            teams[key] = {
                "id": int(row.get("TEAM_ID")),
                "name": display,
                "abbreviation": abbreviation,
            }
            if row.get("TEAM_NAME"):
                teams[_normalize(row["TEAM_NAME"])] = teams[key]
            if abbreviation:
                teams[_normalize(abbreviation)] = teams[key]
        return {"players": players, "teams": teams}

    async def _fetch_from_db(self) -> dict[str, dict[str, Any]]:
        if not self.supabase:
            raise RuntimeError("Supabase client unavailable")
        players_rows = await self.supabase.select_all("players", order="full_name.asc")
        teams_rows = await self.supabase.select_all("teams", order="name.asc")
        players = {}
        for row in players_rows:
            name = row.get("full_name") or ""
            key = _normalize(str(name))
            if not key:
                continue
            players[key] = {
                "id": int(row.get("id")),
                "name": name,
                "team_id": row.get("team_id"),
            }
        teams = {}
        for row in teams_rows:
            display = f"{row.get('city', '')} {row.get('name', '')}".strip()
            key = _normalize(display)
            abbreviation = row.get("abbreviation")
            teams[key] = {
                "id": int(row.get("id")),
                "name": display,
                "abbreviation": abbreviation,
            }
            if row.get("name"):
                teams[_normalize(str(row["name"]))] = teams[key]
            if abbreviation:
                teams[_normalize(str(abbreviation))] = teams[key]
        return {"players": players, "teams": teams}

    def resolve_player(self, query: str) -> Resolution | None:
        if not query:
            return None
        normalized = _normalize(query)
        if normalized in self.players:
            record = self.players[normalized]
            return Resolution(id=record["id"], name=record["name"], confidence=1.0)
        tokens = [token for token in normalized.split() if token]
        if tokens:
            best: tuple[float, dict[str, Any]] | None = None
            for key, record in self.players.items():
                name_tokens = key.split()
                if normalized in name_tokens:
                    score = 0.95
                elif all(token in name_tokens for token in tokens):
                    score = 0.9
                elif key.startswith(normalized):
                    score = 0.85
                elif normalized in key:
                    score = 0.75
                else:
                    continue
                if not best or score > best[0]:
                    best = (score, record)
            if best:
                return Resolution(
                    id=best[1]["id"],
                    name=best[1]["name"],
                    confidence=best[0],
                )
        choices = list(self.players.keys())
        match = process.extractOne(normalized, choices, scorer=fuzz.WRatio)
        if not match:
            return None
        best_key, score, _ = match
        record = self.players[best_key]
        return Resolution(id=record["id"], name=record["name"], confidence=score / 100.0)

    def resolve_team(self, query: str) -> Resolution | None:
        if not query:
            return None
        normalized = _normalize(query)
        if normalized in self.teams:
            record = self.teams[normalized]
            return Resolution(
                id=record["id"],
                name=record["name"],
                abbreviation=record.get("abbreviation"),
                confidence=1.0,
            )
        choices = list(self.teams.keys())
        match = process.extractOne(normalized, choices, scorer=fuzz.WRatio)
        if not match:
            return None
        best_key, score, _ = match
        record = self.teams[best_key]
        return Resolution(
            id=record["id"],
            name=record["name"],
            abbreviation=record.get("abbreviation"),
            confidence=score / 100.0,
        )
