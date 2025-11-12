"""Thin wrapper around nba_api with caching, retries, and normalization."""

from __future__ import annotations

import asyncio
import logging
import math
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any, TypeVar, cast

from fastapi import HTTPException, status
from nba_api.stats.endpoints import (
    boxscoreadvancedv2,
    boxscorefourfactorsv2,
    boxscoretraditionalv2,
    commonallplayers,
    leaguedashplayerstats,
    leaguedashteamstats,
    leaguegamefinder,
    playercareerstats,
    playergamelog,
    shotchartdetail,
)
from pydantic import ValidationError

from ..cache import CacheBackend
from ..config import Settings
from ..resolvers import NameResolver, Resolution
from ..schemas import (
    BoxScoreLine,
    CacheMeta,
    Game,
    MetaResponse,
    Player,
    PlayerCareerStatsRow,
    PlayerGameLog,
    PlayerStatsRow,
    ResolutionPayload,
    ResolveResult,
    ShotLocation,
    Team,
    TeamGameRow,
    TeamStatsRow,
)
from ..utils import paginate, validate_season

logger = logging.getLogger(__name__)


DIRECTORY_TTL = 60 * 60 * 24
AGGREGATE_TTL = 60 * 60 * 6
GAMES_TTL = 60 * 60 * 2
SHOTS_TTL = 60 * 60 * 12


class UpstreamError(HTTPException):
    """Raised when nba_api consistently fails."""

    def __init__(self, message: str):
        super().__init__(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "UPSTREAM_ERROR", "message": message, "retryable": True},
        )


@dataclass
class ServiceResult:
    data: Any
    cache: CacheMeta


TData = TypeVar("TData")


class NBAStatsClient:
    """High-level service that fronts nba_api endpoints."""

    def __init__(self, settings: Settings, cache: CacheBackend, resolver: NameResolver):
        self.settings = settings
        self.cache = cache
        self.resolver = resolver
        self._last_refresh: dict[str, datetime | None] = {}

    async def get_meta(self) -> MetaResponse:
        seasons = self._supported_seasons()
        return MetaResponse(
            service="nba-data-api",
            version="v1",
            supported_seasons=seasons,
            last_cache_refresh={k: v for k, v in self._last_refresh.items()},
        )

    async def get_teams(self, season: str) -> ServiceResult:
        season = validate_season(season)
        key = f"teams:{season}"

        def fetch() -> list[dict[str, Any]]:
            endpoint = leaguedashteamstats.LeagueDashTeamStats(
                season=season,
                measure_type_detailed_defense="Base",
                per_mode_detailed="PerGame",
            )
            df = endpoint.get_data_frames()[0]
            rows: list[dict[str, Any]] = []
            for row in cast(list[dict[str, Any]], df.to_dict("records")):
                team_id = row.get("TEAM_ID")
                if not team_id:
                    continue
                abbreviation = row.get("TEAM_ABBREVIATION") or row.get("TEAM") or row.get("TEAM_NAME") or ""
                name = row.get("TEAM_NAME") or abbreviation or "Unknown"
                rows.append(
                    {
                        "id": int(team_id),
                        "abbreviation": str(abbreviation or "UNK"),
                        "city": row.get("TEAM_CITY") or "",
                        "name": str(name),
                        "conference": row.get("TEAM_CONFERENCE"),
                        "division": row.get("TEAM_DIVISION"),
                    }
                )
            return rows

        data, cache_meta = await self._cached_call(key, DIRECTORY_TTL, fetch)
        return ServiceResult([Team(**item) for item in data], cache_meta)

    async def get_players(
        self, season: str, active: bool | None, search: str | None, page: int, page_size: int
    ) -> tuple[list[Player], CacheMeta, dict[str, Any]]:
        season = validate_season(season)
        key = f"players:{season}"

        def fetch() -> list[dict[str, Any]]:
            df = self._load_players_frame(season)
            rows = []
            for row in cast(list[dict[str, Any]], df.to_dict("records")):
                first_name = row.get("FIRST_NAME") or row.get("DISPLAY_FIRST_LAST") or ""
                last_name = row.get("LAST_NAME") or ""
                full_name = row.get("DISPLAY_FIRST_LAST") or f"{first_name} {last_name}".strip()
                rows.append(
                    {
                        "id": int(row["PERSON_ID"]),
                        "first_name": str(first_name),
                        "last_name": str(last_name),
                        "full_name": str(full_name),
                        "team_id": row.get("TEAM_ID"),
                        "team_abbreviation": row.get("TEAM_ABBREVIATION"),
                        "is_active": bool(row.get("ROSTERSTATUS") in {"Active", "1", 1}),
                    }
                )
            return rows

        data, cache_meta = await self._cached_call(key, DIRECTORY_TTL, fetch)
        filtered = data
        if active is not None:
            filtered = [row for row in filtered if row["is_active"] is active]
        if search:
            lowered = search.lower()
            filtered = [row for row in filtered if lowered in row["full_name"].lower()]
        paginated, pagination = paginate(filtered, page=page, page_size=page_size)
        players = [Player(**item) for item in paginated]
        return players, cache_meta, pagination.model_dump()

    async def get_games(
        self,
        season: str,
        team_id: int | None,
        team_abbr: str | None,
        date_from: date | None,
        date_to: date | None,
        per_team: bool,
    ) -> ServiceResult:
        season = validate_season(season)
        key = f"games:{season}"

        def fetch() -> list[dict[str, Any]]:
            endpoint = leaguegamefinder.LeagueGameFinder(
                season_nullable=season,
                league_id_nullable="00",
            )
            df = endpoint.get_data_frames()[0]
            return cast(list[dict[str, Any]], df.to_dict("records"))

        raw_rows, cache_meta = await self._cached_call(key, GAMES_TTL, fetch)

        if per_team:
            filtered_rows = self._filter_games(raw_rows, team_id, team_abbr, date_from, date_to)
            normalized = [TeamGameRow(**self._normalize_team_row(row)) for row in filtered_rows]
            return ServiceResult(normalized, cache_meta)

        deduped = self._dedupe_games(raw_rows)
        filtered = self._filter_game_rows(deduped, team_id, team_abbr, date_from, date_to)
        games = [Game(**row) for row in filtered]
        return ServiceResult(games, cache_meta)

    async def get_player_gamelog(
        self,
        player_id: int,
        season: str,
        date_from: date | None,
        date_to: date | None,
    ) -> ServiceResult:
        season = validate_season(season)
        key = f"player_gamelog:{player_id}:{season}:{date_from}:{date_to}"

        def fetch() -> list[dict[str, Any]]:
            endpoint = playergamelog.PlayerGameLog(
                player_id=player_id,
                season=season,
                date_from_nullable=date_from.isoformat() if date_from else "",
                date_to_nullable=date_to.isoformat() if date_to else "",
            )
            df = endpoint.get_data_frames()[0]
            return cast(list[dict[str, Any]], df.to_dict("records"))

        rows, cache_meta = await self._cached_call(key, GAMES_TTL, fetch)
        logs: list[PlayerGameLog] = []
        for row in rows:
            try:
                normalized = self._normalize_player_log(row)
                logs.append(PlayerGameLog(**normalized))
            except (KeyError, TypeError, ValueError, ValidationError) as exc:
                logger.warning("Skipping malformed player log row", extra={"error": str(exc), "row": row})
                continue
        return ServiceResult(logs, cache_meta)

    async def get_player_career_stats(self, player_id: int) -> ServiceResult:
        key = f"player_career:{player_id}"

        def fetch() -> list[dict[str, Any]]:
            endpoint = playercareerstats.PlayerCareerStats(player_id=player_id)
            df = endpoint.get_data_frames()[0]
            return cast(list[dict[str, Any]], df.to_dict("records"))

        rows, cache_meta = await self._cached_call(key, AGGREGATE_TTL, fetch)
        stats = [self._normalize_career_row(row) for row in rows]
        return ServiceResult([PlayerCareerStatsRow(**item) for item in stats], cache_meta)

    async def get_boxscore(self, game_id: str, kind: str) -> ServiceResult:
        key = f"boxscore:{kind}:{game_id}"

        endpoint_cls = {
            "traditional": boxscoretraditionalv2.BoxScoreTraditionalV2,
            "advanced": boxscoreadvancedv2.BoxScoreAdvancedV2,
            "four_factors": boxscorefourfactorsv2.BoxScoreFourFactorsV2,
        }.get(kind)

        if not endpoint_cls:
            raise HTTPException(status_code=400, detail={"code": "INVALID_KIND", "message": "Invalid boxscore kind."})

        def fetch() -> list[dict[str, Any]]:
            endpoint = endpoint_cls(game_id=game_id)
            df = endpoint.player_stats.get_data_frame()
            return cast(list[dict[str, Any]], df.to_dict("records"))

        rows, cache_meta = await self._cached_call(key, GAMES_TTL, fetch)
        lines = [self._normalize_boxscore(row) for row in rows]
        return ServiceResult([BoxScoreLine(**item) for item in lines], cache_meta)

    async def get_shots(
        self,
        player_id: int,
        season: str,
        team_id: int | None,
        date_from: date | None,
        date_to: date | None,
    ) -> ServiceResult:
        season = validate_season(season)
        key = f"shots:{player_id}:{season}:{team_id}:{date_from}:{date_to}"

        def fetch() -> list[dict[str, Any]]:
            endpoint = shotchartdetail.ShotChartDetail(
                player_id=player_id,
                team_id=team_id or 0,
                season_nullable=season,
                season_type_all_star="Regular Season",
                context_measure_simple="FGA",
                date_from_nullable=date_from.isoformat() if date_from else "",
                date_to_nullable=date_to.isoformat() if date_to else "",
            )
            df = endpoint.shot_chart_detail.get_data_frame()
            return cast(list[dict[str, Any]], df.to_dict("records"))

        rows, cache_meta = await self._cached_call(key, SHOTS_TTL, fetch)
        shots = [self._normalize_shot(row) for row in rows]
        return ServiceResult([ShotLocation(**item) for item in shots], cache_meta)

    async def get_team_stats(self, season: str, measure: str, per_mode: str) -> ServiceResult:
        season = validate_season(season)
        if season not in self._supported_seasons():
            logger.warning(
                "Season %s not yet supported; skipping team stats fetch.",
                season,
            )
            return ServiceResult([], CacheMeta(hit=False, stale=True))
        key = f"team_stats:{season}:{measure}:{per_mode}"

        def fetch() -> list[dict[str, Any]]:
            endpoint = leaguedashteamstats.LeagueDashTeamStats(
                season=season,
                measure_type_detailed_defense=measure,
                per_mode_detailed=per_mode,
            )
            df = endpoint.get_data_frames()[0]
            return cast(list[dict[str, Any]], df.to_dict("records"))

        try:
            rows, cache_meta = await self._cached_call(key, AGGREGATE_TTL, fetch)
        except Exception as exc:  # pragma: no cover - defensive guard for flaky upstream seasons
            logger.warning(
                "team stats fetch failed; returning empty result",
                extra={"season": season, "measure": measure, "per_mode": per_mode, "error": str(exc)},
            )
            return ServiceResult([], CacheMeta(hit=False, stale=True))
        stats: list[TeamStatsRow] = []
        for row in rows:
            try:
                normalized = self._normalize_team_stats(row)
                stats.append(TeamStatsRow(**normalized))
            except (KeyError, TypeError, ValueError, ValidationError) as exc:
                logger.warning("Skipping malformed team stats row", extra={"error": str(exc), "row": row})
                continue
        return ServiceResult(stats, cache_meta)

    async def get_player_stats(
        self,
        season: str,
        measure: str,
        per_mode: str,
        team_id: int | None,
        page: int,
        page_size: int,
    ) -> tuple[list[PlayerStatsRow], CacheMeta, dict[str, Any]]:
        season = validate_season(season)
        key = f"player_stats:{season}:{measure}:{per_mode}:{team_id}"

        def fetch() -> list[dict[str, Any]]:
            endpoint = leaguedashplayerstats.LeagueDashPlayerStats(
                season=season,
                measure_type_detailed_defense=measure,
                per_mode_detailed=per_mode,
                team_id_nullable=team_id,
            )
            df = endpoint.get_data_frames()[0]
            return cast(list[dict[str, Any]], df.to_dict("records"))

        rows, cache_meta = await self._cached_call(key, AGGREGATE_TTL, fetch)
        normalized = [self._normalize_player_stats(row) for row in rows]
        paged, pagination = paginate(normalized, page=page, page_size=page_size)
        stats = [PlayerStatsRow(**item) for item in paged]
        return stats, cache_meta, pagination.model_dump()

    async def resolve(self, player: str | None, team: str | None) -> ResolveResult:
        player_result = self._resolution_payload(self.resolver.resolve_player(player) if player else None)
        team_result = self._resolution_payload(self.resolver.resolve_team(team) if team else None)
        return ResolveResult(player=player_result, team=team_result)

    async def refresh_hot_keys(self) -> None:
        for season in self._supported_seasons()[-5:]:
            await asyncio.gather(
                self.get_teams(season),
                self.get_players(season, active=None, search=None, page=1, page_size=10),
            )

    def _load_players_frame(self, season: str):
        try:
            endpoint = commonallplayers.CommonAllPlayers(season=season, is_only_current_season=0)
            return endpoint.get_data_frames()[0]
        except Exception as exc:
            logger.warning("CommonAllPlayers failed for %s; retrying without season. err=%s", season, exc)
            fallback = commonallplayers.CommonAllPlayers(is_only_current_season=0)
            return fallback.get_data_frames()[0]

    async def _cached_call(
        self,
        key: str,
        ttl: int,
        fetcher: Callable[[], TData],
    ) -> tuple[TData, CacheMeta]:
        cached = await self.cache.get(key)
        if cached is not None:
            return cast(TData, cached), CacheMeta(hit=True, stale=False)
        try:
            data = await self._run_with_retry(fetcher)
        except Exception as exc:
            fallback = await self.cache.get_stale(key)
            if fallback is not None:
                return cast(TData, fallback), CacheMeta(hit=True, stale=True)
            raise UpstreamError("NBA stats service unavailable") from exc
        await self.cache.set(key, data, ttl)
        self._last_refresh[key] = datetime.now(tz=UTC)
        return data, CacheMeta(hit=False, stale=False)

    async def _run_with_retry(self, fetcher: Callable[[], TData]) -> TData:
        delay = self.settings.upstream_retry_backoff_seconds
        last_error: Exception | None = None
        for attempt in range(self.settings.upstream_retry_attempts):
            try:
                loop = asyncio.get_running_loop()
                return await loop.run_in_executor(None, fetcher)
            except Exception as exc:
                last_error = exc
                await asyncio.sleep(delay)
                delay *= 2
        raise last_error if last_error else RuntimeError("Unknown upstream failure")

    def _supported_seasons(self) -> list[str]:
        current_year = datetime.now().year
        seasons = []
        start = self.settings.supported_season_start_year
        for year in range(start, current_year + 1):
            seasons.append(f"{year}-{str((year + 1) % 100).zfill(2)}")
        return seasons

    def _dedupe_games(self, rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
        games: dict[str, dict[str, Any]] = {}
        for row in rows:
            game_id = row["GAME_ID"]
            entry = games.setdefault(
                game_id,
                {
                    "game_id": game_id,
                    "date": datetime.strptime(row["GAME_DATE"], "%Y-%m-%d").date(),
                    "season": row.get("SEASON_ID"),
                    "home_team_id": None,
                    "home_team_name": None,
                    "home_team_abbreviation": None,
                    "home_team_score": None,
                    "away_team_id": None,
                    "away_team_name": None,
                    "away_team_abbreviation": None,
                    "away_team_score": None,
                    "status": row.get("WL"),
                },
            )
            matchup = row.get("MATCHUP", "")
            is_home = " vs. " in matchup
            parsed = self._parse_matchup(matchup)
            team_abbr_source = row.get("TEAM_ABBREVIATION") or row.get("TEAM_NAME") or ""
            team_abbr = str(team_abbr_source).upper().split()[-1]
            if parsed and team_abbr:
                home_abbr, away_abbr = parsed
                if team_abbr == home_abbr:
                    is_home = True
                elif team_abbr == away_abbr:
                    is_home = False
            team_name = row.get("TEAM_NAME") or row.get("TEAM_ABBREVIATION")
            record = {
                "team_id": row.get("TEAM_ID"),
                "team_name": team_name,
                "score": row.get("PTS") or 0,
            }
            if is_home:
                entry["home_team_id"] = record["team_id"]
                entry["home_team_name"] = record["team_name"]
                entry["home_team_abbreviation"] = row.get("TEAM_ABBREVIATION")
                entry["home_team_score"] = record["score"]
            else:
                entry["away_team_id"] = record["team_id"]
                entry["away_team_name"] = record["team_name"]
                entry["away_team_abbreviation"] = row.get("TEAM_ABBREVIATION")
                entry["away_team_score"] = record["score"]
        normalized = [
            entry
            for entry in games.values()
            if entry["home_team_id"] is not None and entry["away_team_id"] is not None
        ]
        return normalized

    def _parse_matchup(self, matchup: str) -> tuple[str, str] | None:
        matchup_upper = matchup.upper()
        if " VS. " in matchup_upper:
            home, away = matchup_upper.split(" VS. ", 1)
            return home.strip(), away.strip()
        if " @ " in matchup_upper:
            away, home = matchup_upper.split(" @ ", 1)
            return home.strip(), away.strip()
        if " AT " in matchup_upper:
            away, home = matchup_upper.split(" AT ", 1)
            return home.strip(), away.strip()
        return None

    def _filter_game_rows(
        self,
        rows: Iterable[dict[str, Any]],
        team_id: int | None,
        team_abbr: str | None,
        date_from: date | None,
        date_to: date | None,
    ) -> list[dict[str, Any]]:
        filtered = []
        for row in rows:
            if team_id and team_id not in (row["home_team_id"], row["away_team_id"]):
                continue
            if team_abbr:
                abbr = team_abbr.lower()
                home_abbr = (row.get("home_team_abbreviation") or "").lower()
                away_abbr = (row.get("away_team_abbreviation") or "").lower()
                if abbr not in {home_abbr, away_abbr}:
                    continue
            if date_from and row["date"] < date_from:
                continue
            if date_to and row["date"] > date_to:
                continue
            filtered.append(row)
        return filtered

    def _normalize_team_row(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "game_id": row["GAME_ID"],
            "date": datetime.strptime(row["GAME_DATE"], "%Y-%m-%d").date(),
            "team_id": row["TEAM_ID"],
            "team_abbreviation": row["TEAM_ABBREVIATION"],
            "opponent_team_id": row.get("OPPONENT_TEAM_ID"),
            "matchup": row["MATCHUP"],
            "result": row["WL"],
            "points": row["PTS"],
        }

    def _filter_games(
        self,
        rows: Iterable[dict[str, Any]],
        team_id: int | None,
        team_abbr: str | None,
        date_from: date | None,
        date_to: date | None,
    ) -> list[dict[str, Any]]:
        filtered = []
        for row in rows:
            if team_id and row.get("TEAM_ID") != team_id:
                continue
            if team_abbr and row.get("TEAM_ABBREVIATION", "").lower() != team_abbr.lower():
                continue
            game_date = datetime.strptime(row["GAME_DATE"], "%Y-%m-%d").date()
            if date_from and game_date < date_from:
                continue
            if date_to and game_date > date_to:
                continue
            filtered.append(row)
        return filtered

    def _normalize_player_log(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "game_id": row["GAME_ID"],
            "game_date": datetime.strptime(row["GAME_DATE"], "%Y-%m-%d").date(),
            "matchup": row["MATCHUP"],
            "team_abbreviation": row["TEAM_ABBREVIATION"],
            "minutes": self._safe_float(row.get("MIN")),
            "points": self._safe_float(row.get("PTS")),
            "rebounds": self._safe_float(row.get("REB")),
            "assists": self._safe_float(row.get("AST")),
            "steals": self._safe_float(row.get("STL")),
            "blocks": self._safe_float(row.get("BLK")),
            "turnovers": self._safe_float(row.get("TOV")),
            "plus_minus": self._safe_float(row.get("PLUS_MINUS")),
        }

    def _normalize_boxscore(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "player_id": int(row["PLAYER_ID"]),
            "player_name": row["PLAYER_NAME"],
            "team_id": int(row["TEAM_ID"]),
            "team_abbreviation": row["TEAM_ABBREVIATION"],
            "minutes": self._safe_float(row.get("MIN")),
            "points": self._safe_float(row.get("PTS")),
            "rebounds": self._safe_float(row.get("REB")),
            "assists": self._safe_float(row.get("AST")),
            "steals": self._safe_float(row.get("STL")),
            "blocks": self._safe_float(row.get("BLK")),
            "turnovers": self._safe_float(row.get("TO")),
            "fouls": self._safe_float(row.get("PF")),
            "plus_minus": self._safe_float(row.get("PLUS_MINUS")),
        }

    def _normalize_shot(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "game_id": row["GAME_ID"],
            "x": self._safe_float(row.get("LOC_X")),
            "y": self._safe_float(row.get("LOC_Y")),
            "zone_range": row.get("SHOT_ZONE_RANGE"),
            "zone_basic": row.get("SHOT_ZONE_BASIC"),
            "shot_made": bool(row.get("SHOT_MADE_FLAG")),
            "period": int(row.get("PERIOD", 0)),
            "minutes_remaining": int(row.get("MINUTES_REMAINING", 0)),
            "seconds_remaining": int(row.get("SECONDS_REMAINING", 0)),
        }

    def _normalize_team_stats(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "team_id": int(row["TEAM_ID"]),
            "team_abbreviation": row["TEAM_ABBREVIATION"],
            "team_name": row["TEAM_NAME"],
            "games_played": int(row.get("GP", 0)),
            "wins": int(row.get("W", 0)),
            "losses": int(row.get("L", 0)),
            "win_pct": self._safe_float(row.get("W_PCT")),
            "points": self._safe_float(row.get("PTS")),
            "field_goal_pct": self._safe_float(row.get("FG_PCT")),
            "rebounds": self._safe_float(row.get("REB")),
            "assists": self._safe_float(row.get("AST")),
            "steals": self._safe_float(row.get("STL")),
            "blocks": self._safe_float(row.get("BLK")),
            "turnovers": self._safe_float(row.get("TOV")),
            "plus_minus": self._safe_float(row.get("PLUS_MINUS")),
        }

    def _normalize_player_stats(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "player_id": int(row["PLAYER_ID"]),
            "player_name": row["PLAYER_NAME"],
            "team_id": row.get("TEAM_ID"),
            "team_abbreviation": row.get("TEAM_ABBREVIATION"),
            "points": self._safe_float(row.get("PTS")),
            "rebounds": self._safe_float(row.get("REB")),
            "assists": self._safe_float(row.get("AST")),
            "minutes": self._safe_float(row.get("MIN")),
        }

    def _normalize_career_row(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "season_id": row.get("SEASON_ID"),
            "team_id": row.get("TEAM_ID"),
            "team_abbreviation": row.get("TEAM_ABBREVIATION"),
            "player_age": self._safe_float(row.get("PLAYER_AGE")),
            "games_played": self._safe_int(row.get("GP")),
            "games_started": self._safe_int(row.get("GS")),
            "minutes": self._safe_float(row.get("MIN")),
            "points": self._safe_float(row.get("PTS")),
            "rebounds": self._safe_float(row.get("REB")),
            "assists": self._safe_float(row.get("AST")),
            "steals": self._safe_float(row.get("STL")),
            "blocks": self._safe_float(row.get("BLK")),
            "field_goal_pct": self._safe_float(row.get("FG_PCT")) if row.get("FG_PCT") is not None else None,
            "three_point_pct": self._safe_float(row.get("FG3_PCT")) if row.get("FG3_PCT") is not None else None,
            "free_throw_pct": self._safe_float(row.get("FT_PCT")) if row.get("FT_PCT") is not None else None,
        }

    def _resolution_payload(self, resolution: Resolution | None) -> ResolutionPayload | None:
        if not resolution:
            return None
        return ResolutionPayload(
            id=resolution.id,
            name=resolution.name,
            abbreviation=resolution.abbreviation,
            confidence=resolution.confidence,
        )

    def _safe_float(self, value: Any) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return 0.0

        if math.isnan(number) or math.isinf(number):
            return 0.0

        return number

    def _safe_int(self, value: Any) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0
