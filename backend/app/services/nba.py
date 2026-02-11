"""Thin wrapper around nba_api with caching, retries, and normalization."""

from __future__ import annotations

import asyncio
import logging
import math
import re
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any, TypeVar, cast

import requests
from fastapi import HTTPException, status
from nba_api.stats.endpoints import (
    boxscoreadvancedv2,
    boxscoreadvancedv3,
    boxscoresummaryv2,
    boxscoretraditionalv2,
    commonallplayers,
    commonplayerinfo,
    leaguedashplayerbiostats,
    leaguedashplayerstats,
    leaguedashteamstats,
    leaguegamefinder,
    leagueleaders,
    leaguestandingsv3,
    playerawards,
    playercareerstats,
    playergamelog,
    shotchartdetail,
    teamdetails,
    teamyearbyyearstats,
)
from pydantic import ValidationError

from ..cache import CacheBackend
from ..config import Settings
from ..resolvers import NameResolver, Resolution
from ..schemas import (
    BoxScoreGame,
    CacheMeta,
    Game,
    LeagueLeaderRow,
    LeagueStanding,
    MetaResponse,
    Player,
    PlayerAward,
    PlayerBio,
    PlayerCareerStatsRow,
    PlayerGameLog,
    PlayerInfo,
    PlayerStatsRow,
    ResolutionPayload,
    ResolveResult,
    ShotLocation,
    Team,
    TeamDetail,
    TeamGameRow,
    TeamSeasonHistoryRow,
    TeamStatsRow,
)
from ..utils import paginate, validate_season

logger = logging.getLogger(__name__)

# Explicit headers for stats.nba.com to avoid CDN blocks.
NBA_STATS_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.nba.com",
    "Referer": "https://www.nba.com/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0 Safari/537.36"
    ),
    "x-nba-stats-origin": "stats",
    "x-nba-stats-token": "true",
}


DIRECTORY_TTL = 60 * 60 * 24
AGGREGATE_TTL = 60 * 60 * 6
GAMES_TTL = 60 * 60 * 2
SHOTS_TTL = 60 * 60 * 12

LEAGUE_LEADER_STAT_FIELDS: dict[str, str] = {
    "PTS": "PTS",
    "REB": "REB",
    "AST": "AST",
    "STL": "STL",
    "BLK": "BLK",
    "TOV": "TOV",
    "EFF": "EFF",
    "MIN": "MIN",
    "FG_PCT": "FG_PCT",
    "FG3_PCT": "FG3_PCT",
    "FT_PCT": "FT_PCT",
}


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
        # Stats.nba.com endpoints are sluggish; keep a generous timeout floor.
        self._stats_timeout = max(self.settings.upstream_timeout_seconds, 60.0)

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
                abbreviation = (
                    row.get("TEAM_ABBREVIATION") or row.get("TEAM") or row.get("TEAM_NAME") or ""
                )
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

        deduped = self._dedupe_games(raw_rows, season)
        filtered = self._filter_game_rows(deduped, team_id, team_abbr, date_from, date_to)
        games: list[Game] = []
        for row in filtered:
            try:
                games.append(Game(**row))
            except ValidationError as exc:
                logger.warning(
                    "Skipping malformed game row",
                    extra={"error": str(exc), "game_id": row.get("game_id"), "row": row},
                )
        return ServiceResult(games, cache_meta)

    async def get_league_standings(
        self,
        league_id: str,
        season: str,
        season_type: str,
    ) -> ServiceResult:
        season = validate_season(season)
        league_id = league_id or "00"
        season_type = (season_type or "Regular Season").strip()
        key = f"league_standings:{league_id}:{season}:{season_type}"

        def fetch() -> list[dict[str, Any]]:
            endpoint = leaguestandingsv3.LeagueStandingsV3(
                league_id=league_id,
                season=season,
                season_type=season_type,
            )
            df = endpoint.standings.get_data_frame()
            return cast(list[dict[str, Any]], df.to_dict("records"))

        rows, cache_meta = await self._cached_call(key, AGGREGATE_TTL, fetch)
        standings: list[LeagueStanding] = []
        for row in rows:
            try:
                normalized = self._normalize_league_standing(row)
                standings.append(LeagueStanding(**normalized))
            except (KeyError, TypeError, ValueError, ValidationError) as exc:
                logger.warning(
                    "Skipping malformed league standing row",
                    extra={"error": str(exc), "row": row},
                )
                continue
        standings.sort(
            key=lambda item: ((item.conference or "").lower(), item.conference_rank or 999)
        )
        return ServiceResult(standings, cache_meta)

    async def get_player_gamelog(
        self,
        player_id: int,
        season: str,
        season_type: str,
        date_from: date | None,
        date_to: date | None,
    ) -> ServiceResult:
        season = validate_season(season)
        season_type = (season_type or "Regular Season").strip()
        key = f"player_gamelog:{player_id}:{season}:{season_type}:{date_from}:{date_to}"

        def fetch() -> list[dict[str, Any]]:
            endpoint = playergamelog.PlayerGameLog(
                player_id=player_id,
                season=season,
                season_type_all_star=season_type,
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
                logger.warning(
                    "Skipping malformed player log row",
                    extra={"error": str(exc), "row": row},
                )
                continue
        return ServiceResult(logs, cache_meta)

    async def get_player_career_stats(self, player_id: int, season_type: str) -> ServiceResult:
        season_type = (season_type or "Regular Season").strip()
        key = f"player_career:{player_id}:{season_type}"
        dataset_name = (
            "SeasonTotalsPostSeason"
            if season_type.lower() == "playoffs"
            else "SeasonTotalsRegularSeason"
        )

        def fetch() -> list[dict[str, Any]]:
            endpoint = playercareerstats.PlayerCareerStats(player_id=player_id)
            payload = endpoint.get_dict()
            result_sets = payload.get("resultSets", [])
            for result_set in result_sets:
                if result_set.get("name") != dataset_name:
                    continue
                headers = result_set.get("headers", [])
                rows = result_set.get("rowSet") or result_set.get("data") or []
                return [dict(zip(headers, row, strict=False)) for row in rows if headers and row]
            return []

        rows, cache_meta = await self._cached_call(key, AGGREGATE_TTL, fetch)
        stats = [self._normalize_career_row(row) for row in rows]
        return ServiceResult([PlayerCareerStatsRow(**item) for item in stats], cache_meta)

    async def get_player_awards(self, player_id: int) -> ServiceResult:
        key = f"player_awards:{player_id}"

        def fetch() -> list[dict[str, Any]]:
            endpoint = playerawards.PlayerAwards(player_id=player_id)
            df = endpoint.get_data_frames()[0]
            return cast(list[dict[str, Any]], df.to_dict("records"))

        rows, cache_meta = await self._cached_call(key, AGGREGATE_TTL, fetch)
        awards: list[PlayerAward] = []
        for row in rows:
            try:
                normalized = self._normalize_player_award(row)
                awards.append(PlayerAward(**normalized))
            except (KeyError, TypeError, ValueError, ValidationError) as exc:
                logger.warning(
                    "Skipping malformed player award row",
                    extra={"error": str(exc), "row": row},
                )
                continue
        return ServiceResult(awards, cache_meta)

    async def get_player_bio(self, player_id: int, season: str) -> ServiceResult:
        season = validate_season(season)
        key = f"player_bio:{season}"

        def fetch() -> list[dict[str, Any]]:
            endpoint = leaguedashplayerbiostats.LeagueDashPlayerBioStats(
                season=season,
                season_type_all_star="Regular Season",
            )
            df = endpoint.get_data_frames()[0]
            return cast(list[dict[str, Any]], df.to_dict("records"))

        rows, cache_meta = await self._cached_call(key, AGGREGATE_TTL, fetch)
        row = next(
            (item for item in rows if self._safe_int(item.get("PLAYER_ID")) == player_id),
            None,
        )
        if not row:
            return ServiceResult(None, cache_meta)
        try:
            normalized = self._normalize_player_bio(row)
            return ServiceResult(PlayerBio(**normalized), cache_meta)
        except (KeyError, TypeError, ValueError, ValidationError) as exc:
            logger.warning(
                "Skipping malformed player bio row",
                extra={"error": str(exc), "row": row},
            )
            return ServiceResult(None, cache_meta)

    async def get_player_info(self, player_id: int) -> ServiceResult:
        key = f"player_info:{player_id}"

        def fetch() -> list[dict[str, Any]]:
            endpoint = commonplayerinfo.CommonPlayerInfo(player_id=player_id)
            df = endpoint.common_player_info.get_data_frame()
            return cast(list[dict[str, Any]], df.to_dict("records"))

        rows, cache_meta = await self._cached_call(key, AGGREGATE_TTL, fetch)
        if not rows:
            return ServiceResult(None, cache_meta)
        row = rows[0]
        try:
            normalized = self._normalize_player_info(row)
            return ServiceResult(PlayerInfo(**normalized), cache_meta)
        except (KeyError, TypeError, ValueError, ValidationError) as exc:
            logger.warning(
                "Skipping malformed player info row",
                extra={"error": str(exc), "player_id": player_id, "row": row},
            )
            return ServiceResult(None, cache_meta)

    async def get_team_history(
        self,
        team_id: int,
        season_type: str,
        per_mode: str,
    ) -> ServiceResult:
        season_type = (season_type or "Regular Season").strip()
        per_mode = (per_mode or "Totals").strip()
        key = f"team_history:{team_id}:{season_type}:{per_mode}"

        def fetch() -> list[dict[str, Any]]:
            endpoint = teamyearbyyearstats.TeamYearByYearStats(
                team_id=team_id,
                league_id="00",
                per_mode_simple=per_mode,
                season_type_all_star=season_type,
            )
            df = endpoint.team_stats.get_data_frame()
            return cast(list[dict[str, Any]], df.to_dict("records"))

        rows, cache_meta = await self._cached_call(key, AGGREGATE_TTL, fetch)
        history: list[TeamSeasonHistoryRow] = []
        for row in rows:
            try:
                normalized = self._normalize_team_history_row(row)
                history.append(TeamSeasonHistoryRow(**normalized))
            except (KeyError, TypeError, ValueError, ValidationError) as exc:
                logger.warning(
                    "Skipping malformed team history row",
                    extra={"error": str(exc), "team_id": team_id, "row": row},
                )
                continue
        history.sort(key=lambda item: self._season_sort_key(item.season), reverse=True)
        return ServiceResult(history, cache_meta)

    async def get_league_leaders(
        self,
        season: str,
        season_type: str,
        per_mode: str,
        stat_category: str,
        limit: int,
    ) -> ServiceResult:
        season = validate_season(season)
        season_type = (season_type or "Regular Season").strip()
        per_mode = (per_mode or "PerGame").strip()
        stat_category = (stat_category or "PTS").strip().upper()
        stat_field = LEAGUE_LEADER_STAT_FIELDS.get(stat_category)
        if not stat_field:
            supported = ", ".join(sorted(LEAGUE_LEADER_STAT_FIELDS))
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "INVALID_STAT_CATEGORY",
                    "message": (
                        f"Unsupported stat_category '{stat_category}'. " f"Use one of: {supported}."
                    ),
                    "retryable": False,
                },
            )
        key = f"league_leaders:{season}:{season_type}:{per_mode}:{stat_category}:{limit}"

        def fetch() -> list[dict[str, Any]]:
            endpoint = leagueleaders.LeagueLeaders(
                league_id="00",
                per_mode48=per_mode,
                season=season,
                season_type_all_star=season_type,
                stat_category_abbreviation=stat_category,
            )
            df = endpoint.league_leaders.get_data_frame()
            return cast(list[dict[str, Any]], df.to_dict("records"))

        rows, cache_meta = await self._cached_call(key, AGGREGATE_TTL, fetch)
        leaders: list[LeagueLeaderRow] = []
        for row in rows:
            try:
                normalized = self._normalize_league_leader_row(row, stat_category, stat_field)
                leaders.append(LeagueLeaderRow(**normalized))
            except (KeyError, TypeError, ValueError, ValidationError) as exc:
                logger.warning(
                    "Skipping malformed league leader row",
                    extra={
                        "error": str(exc),
                        "season": season,
                        "stat_category": stat_category,
                        "row": row,
                    },
                )
                continue
        leaders.sort(key=lambda item: item.rank)
        return ServiceResult(leaders[:limit], cache_meta)

    async def get_team_details(self, team_id: int) -> ServiceResult:
        key = f"team_details:{team_id}"

        def fetch() -> dict[str, list[dict[str, Any]]]:
            endpoint = teamdetails.TeamDetails(team_id=team_id)
            return {
                "background": self._dataset_to_rows(endpoint.team_background),
                "championships": self._dataset_to_rows(endpoint.team_awards_championships),
                "conference": self._dataset_to_rows(endpoint.team_awards_conf),
                "division": self._dataset_to_rows(endpoint.team_awards_div),
                "hof": self._dataset_to_rows(endpoint.team_hof),
                "retired": self._dataset_to_rows(endpoint.team_retired),
                "social": self._dataset_to_rows(endpoint.team_social_sites),
            }

        data, cache_meta = await self._cached_call(key, AGGREGATE_TTL, fetch)
        background = data.get("background", [])
        info = background[0] if background else {}

        def format_award_rows(rows: list[dict[str, Any]]) -> list[str]:
            formatted = []
            for row in rows:
                year = str(row.get("YEARAWARDED") or row.get("YEAR") or "").strip()
                opponent = (row.get("OPPOSITETEAM") or "").strip()
                formatted.append(year if not opponent else f"{year} vs {opponent}")
            return [item for item in formatted if item.strip()]

        detail = TeamDetail(
            team_id=int(team_id),
            abbreviation=info.get("ABBREVIATION"),
            nickname=info.get("NICKNAME"),
            city=info.get("CITY"),
            year_founded=self._safe_int(info.get("YEARFOUNDED")) or None,
            arena=info.get("ARENA"),
            arena_capacity=self._safe_int(info.get("ARENACAPACITY")) or None,
            owner=info.get("OWNER"),
            general_manager=info.get("GENERALMANAGER"),
            head_coach=info.get("HEADCOACH"),
            dleague_affiliation=info.get("DLEAGUEAFFILIATION"),
            championships=format_award_rows(data.get("championships", [])),
            conference_titles=format_award_rows(data.get("conference", [])),
            division_titles=format_award_rows(data.get("division", [])),
            hall_of_famers=[row.get("PLAYER") for row in data.get("hof", []) if row.get("PLAYER")],
            retired_numbers=[
                "{}{}".format(
                    (row.get("PLAYER") or "").strip(),
                    f" #{row.get('JERSEY')}" if row.get("JERSEY") else "",
                ).strip()
                for row in data.get("retired", [])
                if row.get("PLAYER")
            ],
            social_sites={
                str((row.get("ACCOUNTTYPE") or "").lower()): row.get("WEBSITE_LINK")
                for row in data.get("social", [])
                if row.get("WEBSITE_LINK")
            },
        )

        return ServiceResult(detail, cache_meta)

    async def get_boxscore_details(self, game_id: str) -> ServiceResult:
        key = f"boxscore:details:{game_id}"

        def fetch() -> dict[str, Any]:
            return self._build_boxscore_details(game_id)

        data, cache_meta = await self._cached_call(key, GAMES_TTL, fetch)
        return ServiceResult(BoxScoreGame(**data), cache_meta)

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
                extra={
                    "season": season,
                    "measure": measure,
                    "per_mode": per_mode,
                    "error": str(exc),
                },
            )
            return ServiceResult([], CacheMeta(hit=False, stale=True))
        stats: list[TeamStatsRow] = []
        skipped = 0
        sample_error: dict[str, Any] | None = None
        for row in rows:
            try:
                normalized = self._normalize_team_stats(row)
                stats.append(TeamStatsRow(**normalized))
            except (KeyError, TypeError, ValueError, ValidationError) as exc:
                skipped += 1
                if sample_error is None:
                    sample_error = {
                        "error": str(exc),
                        "team_id": row.get("TEAM_ID") if isinstance(row, dict) else None,
                        "team_name": row.get("TEAM_NAME") if isinstance(row, dict) else None,
                        "keys": list(row.keys())[:10] if isinstance(row, dict) else None,
                    }
                continue
        if skipped:
            logger.warning(
                "Skipped malformed team stats rows",
                extra={"count": skipped, "sample": sample_error, "season": season},
            )
        return ServiceResult(stats, cache_meta)

    async def get_player_stats(
        self,
        season: str,
        measure: str,
        per_mode: str,
        season_type: str,
        team_id: int | None,
        page: int,
        page_size: int,
    ) -> tuple[list[PlayerStatsRow], CacheMeta, dict[str, Any]]:
        season = validate_season(season)
        season_type = season_type or "Regular Season"
        key = f"player_stats:{season}:{season_type}:{measure}:{per_mode}:{team_id}"

        def fetch() -> list[dict[str, Any]]:
            endpoint = leaguedashplayerstats.LeagueDashPlayerStats(
                season=season,
                season_type_all_star=season_type,
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
        player_result = self._resolution_payload(
            self.resolver.resolve_player(player) if player else None
        )
        team_result = self._resolution_payload(self.resolver.resolve_team(team) if team else None)
        return ResolveResult(player=player_result, team=team_result)

    async def refresh_hot_keys(self) -> None:
        if not self.settings.nba_api_calls_allowed:
            return
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
            logger.warning(
                "CommonAllPlayers failed for %s; retrying without season. err=%s",
                season,
                exc,
            )
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
        if not self.settings.nba_api_calls_allowed:
            fallback = await self.cache.get_stale(key)
            if fallback is not None:
                return cast(TData, fallback), CacheMeta(hit=True, stale=True)
            raise UpstreamError("NBA API disabled; cache miss")
        try:
            data = await self._run_with_retry(fetcher)
        except Exception as exc:
            logger.warning(
                "Upstream fetch failed; checking stale cache",
                extra={"cache_key": key, "error": str(exc)},
            )
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
        for _attempt in range(self.settings.upstream_retry_attempts):
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

    def _season_sort_key(self, season: str | None) -> int:
        if not season:
            return 0
        match = re.match(r"^(\d{4})", season.strip())
        if not match:
            return 0
        return int(match.group(1))

    def _dedupe_games(
        self, rows: Sequence[dict[str, Any]], season: str | None = None
    ) -> list[dict[str, Any]]:
        games: dict[str, dict[str, Any]] = {}
        for row in rows:
            game_id = row.get("GAME_ID")
            if not game_id:
                continue
            try:
                game_date = datetime.strptime(row["GAME_DATE"], "%Y-%m-%d").date()
            except Exception:
                logger.warning(
                    "Skipping game row with invalid date",
                    extra={"game_id": game_id, "game_date": row.get("GAME_DATE")},
                )
                continue
            season_id = row.get("SEASON_ID")
            if isinstance(season_id, float) and math.isnan(season_id):
                season_id = None
            season_value = season_id or season
            season_text = str(season_value) if season_value is not None else None
            location = row.get("LOCATION")
            if isinstance(location, float) and math.isnan(location):
                location = None
            status = row.get("GAME_STATUS_TEXT") or row.get("WL")
            if isinstance(status, float) and math.isnan(status):
                status = None
            entry = games.setdefault(
                game_id,
                {
                    "game_id": game_id,
                    "date": game_date,
                    "season": season_text,
                    "location": location,
                    "home_team_id": None,
                    "home_team_name": None,
                    "home_team_abbreviation": None,
                    "home_team_score": None,
                    "away_team_id": None,
                    "away_team_name": None,
                    "away_team_abbreviation": None,
                    "away_team_score": None,
                    "status": status,
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
            raw_team_name = row.get("TEAM_NAME")
            if isinstance(raw_team_name, float) and math.isnan(raw_team_name):
                raw_team_name = None
            raw_team_abbr = row.get("TEAM_ABBREVIATION")
            if isinstance(raw_team_abbr, float) and math.isnan(raw_team_abbr):
                raw_team_abbr = None
            team_name = raw_team_name or raw_team_abbr or team_abbr or ""
            record = {
                "team_id": self._coerce_int(row.get("TEAM_ID")),
                "team_name": team_name,
                "score": self._safe_int(row.get("PTS")),
            }
            if is_home:
                entry["home_team_id"] = record["team_id"]
                entry["home_team_name"] = record["team_name"]
                entry["home_team_abbreviation"] = raw_team_abbr or team_abbr or None
                entry["home_team_score"] = record["score"]
            else:
                entry["away_team_id"] = record["team_id"]
                entry["away_team_name"] = record["team_name"]
                entry["away_team_abbreviation"] = raw_team_abbr or team_abbr or None
                entry["away_team_score"] = record["score"]
        normalized = [
            entry
            for entry in games.values()
            if entry["home_team_id"] is not None
            and entry["away_team_id"] is not None
            and entry["home_team_name"]
            and entry["away_team_name"]
            and entry["season"]
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

    def _normalize_league_standing(self, row: dict[str, Any]) -> dict[str, Any]:
        def parse_int(value: Any) -> int | None:
            if value in (None, "", " "):
                return None
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        def parse_float(value: Any) -> float | None:
            if value in (None, "", " "):
                return None
            try:
                number = float(value)
            except (TypeError, ValueError):
                return None
            if math.isnan(number) or math.isinf(number):
                return None
            return number

        team_city = (row.get("TeamCity") or "").strip()
        team_name = (row.get("TeamName") or "").strip()
        full_name = f"{team_city} {team_name}".strip()
        resolution = self.resolver.resolve_team(full_name) if full_name else None
        abbreviation = resolution.abbreviation if resolution else None
        if not abbreviation:
            slug = row.get("TeamSlug")
            if isinstance(slug, str) and slug:
                abbreviation = slug.upper()

        return {
            "team_id": int(row["TeamID"]),
            "team_name": team_name or (resolution.name if resolution else ""),
            "team_city": team_city,
            "team_slug": row.get("TeamSlug"),
            "team_abbreviation": abbreviation,
            "conference": row.get("Conference"),
            "conference_rank": parse_int(row.get("PlayoffRank") or row.get("LeagueRank")),
            "division": row.get("Division"),
            "division_rank": parse_int(row.get("DivisionRank")),
            "wins": self._safe_int(row.get("WINS")),
            "losses": self._safe_int(row.get("LOSSES")),
            "win_pct": self._safe_float(row.get("WinPCT")),
            "games_back": parse_float(row.get("ConferenceGamesBack")),
            "division_games_back": parse_float(row.get("DivisionGamesBack")),
            "record": row.get("Record"),
            "home_record": row.get("HOME"),
            "road_record": row.get("ROAD"),
            "last_ten": row.get("L10"),
            "streak": row.get("strCurrentStreak") or row.get("CurrentStreak"),
        }

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
            "field_goals_made": self._safe_float(row.get("FGM")),
            "field_goals_attempted": self._safe_float(row.get("FGA")),
            "three_point_made": self._safe_float(row.get("FG3M")),
            "three_point_attempted": self._safe_float(row.get("FG3A")),
            "field_goal_pct": self._safe_float(row.get("FG_PCT")),
            "three_point_pct": self._safe_float(row.get("FG3_PCT")),
        }

    def _build_boxscore_details(self, game_id: str) -> dict[str, Any]:
        try:
            return self._build_boxscore_details_stats(game_id)
        except Exception:
            logger.warning(
                "stats.nba.com boxscore failed; attempting CDN fallback",
                exc_info=True,
                extra={"game_id": game_id},
            )
            return self._build_boxscore_details_cdn(game_id)

    def _build_boxscore_details_stats(self, game_id: str) -> dict[str, Any]:
        traditional = boxscoretraditionalv2.BoxScoreTraditionalV2(
            game_id=game_id,
            start_period="0",
            end_period="0",
            start_range="0",
            end_range="0",
            range_type="0",
            headers=NBA_STATS_HEADERS,
            timeout=self._stats_timeout,
        )
        traditional_players = [
            self._normalize_traditional_player(row)
            for row in self._dataset_to_rows(traditional.player_stats)
        ]
        team_totals = [
            self._normalize_team_totals(row)
            for row in self._dataset_to_rows(traditional.team_stats)
        ]
        starter_bench = [
            self._normalize_starter_bench(row)
            for row in self._dataset_to_rows(traditional.team_starter_bench_stats)
        ]

        advanced_rows = self._load_advanced_rows(game_id)
        advanced_players = [self._normalize_advanced_player(row) for row in advanced_rows]

        summary = boxscoresummaryv2.BoxScoreSummaryV2(
            game_id=game_id, headers=NBA_STATS_HEADERS, timeout=self._stats_timeout
        )
        summary_rows = self._dataset_to_rows(summary.game_summary)
        if not summary_rows:
            raise UpstreamError("Box score summary unavailable.")
        summary_row = summary_rows[0]
        home_team_id = self._coerce_int(summary_row.get("HOME_TEAM_ID"))
        away_team_id = self._coerce_int(summary_row.get("VISITOR_TEAM_ID"))
        if home_team_id is None or away_team_id is None:
            raise UpstreamError("Unable to determine teams for box score.")

        line_score_rows = self._dataset_to_rows(summary.line_score)
        game_info_rows = self._dataset_to_rows(summary.game_info)
        officials_rows = self._dataset_to_rows(summary.officials)

        start_dt = self._parse_datetime(summary_row.get("GAME_DATE_EST"))
        attendance = (
            self._coerce_int(game_info_rows[0].get("ATTENDANCE")) if game_info_rows else None
        )
        officials = [
            "{} {}".format(
                row.get("FIRST_NAME", "").strip(),
                row.get("LAST_NAME", "").strip(),
            ).strip()
            for row in officials_rows
            if row.get("FIRST_NAME") or row.get("LAST_NAME")
        ]

        line_score = self._build_line_score(line_score_rows, home_team_id, away_team_id)
        home_team = self._build_team_card(home_team_id, True, line_score_rows, traditional_players)
        away_team = self._build_team_card(away_team_id, False, line_score_rows, traditional_players)
        summary_text = self._compose_summary(
            home_team,
            away_team,
            summary_row.get("GAME_STATUS_TEXT"),
        )
        arena = home_team.get("team_city")

        return {
            "game_id": game_id,
            "status": summary_row.get("GAME_STATUS_TEXT"),
            "game_date": start_dt,
            "start_time": start_dt,
            "arena": arena,
            "attendance": attendance,
            "summary": summary_text,
            "officials": officials,
            "home_team": home_team,
            "away_team": away_team,
            "line_score": line_score,
            "team_totals": team_totals,
            "starter_bench": starter_bench,
            "traditional_players": traditional_players,
            "advanced_players": advanced_players,
        }

    def _build_boxscore_details_cdn(self, game_id: str) -> dict[str, Any]:
        url = f"https://cdn.nba.com/static/json/liveData/boxscore/boxscore_{game_id}.json"
        try:
            response = requests.get(url, timeout=self._stats_timeout)
            response.raise_for_status()
        except Exception as exc:
            raise UpstreamError("NBA boxscore CDN unavailable") from exc

        payload = response.json()
        game = payload.get("game") or {}
        home_team_raw = game.get("homeTeam") or {}
        away_team_raw = game.get("awayTeam") or {}

        traditional_players = self._cdn_players(home_team_raw) + self._cdn_players(away_team_raw)
        team_totals = [self._cdn_team_totals(home_team_raw), self._cdn_team_totals(away_team_raw)]
        line_score = self._cdn_line_score(home_team_raw, away_team_raw)
        home_team = self._cdn_team_card(home_team_raw, True, traditional_players)
        away_team = self._cdn_team_card(away_team_raw, False, traditional_players)
        officials = [
            " ".join(filter(None, [ref.get("firstName"), ref.get("familyName")])).strip()
            for ref in (game.get("officials") or [])
            if ref.get("firstName") or ref.get("familyName")
        ]
        start_dt = self._parse_datetime(game.get("gameTimeUTC"))
        arena_meta = game.get("arena") or {}

        return {
            "game_id": game.get("gameId") or game_id,
            "status": game.get("gameStatusText"),
            "game_date": start_dt,
            "start_time": start_dt,
            "arena": arena_meta.get("arenaName") or arena_meta.get("arenaCity"),
            "attendance": self._coerce_int(game.get("attendance")),
            "summary": None,
            "officials": officials,
            "home_team": home_team,
            "away_team": away_team,
            "line_score": line_score,
            "team_totals": team_totals,
            "starter_bench": [],
            "traditional_players": traditional_players,
            "advanced_players": [],
        }

    def _cdn_players(self, team: dict[str, Any]) -> list[dict[str, Any]]:
        abbreviation = team.get("teamTricode")
        city = team.get("teamCity")
        team_id = self._coerce_int(team.get("teamId"))
        players = []
        for player in team.get("players") or []:
            stats = player.get("statistics") or {}
            minutes_raw = stats.get("minutesCalculated") or stats.get("minutes")
            players.append(
                {
                    "player_id": self._coerce_int(player.get("personId")),
                    "player_name": player.get("name"),
                    "team_id": team_id,
                    "team_abbreviation": abbreviation,
                    "team_city": city,
                    "start_position": player.get("position"),
                    "comment": None,
                    "minutes": self._iso_duration_to_minutes(minutes_raw),
                    "field_goals_made": self._coerce_float(stats.get("fieldGoalsMade")),
                    "field_goals_attempted": self._coerce_float(stats.get("fieldGoalsAttempted")),
                    "field_goal_pct": self._coerce_float(stats.get("fieldGoalsPercentage")),
                    "three_point_made": self._coerce_float(stats.get("threePointersMade")),
                    "three_point_attempted": self._coerce_float(
                        stats.get("threePointersAttempted")
                    ),
                    "three_point_pct": self._coerce_float(stats.get("threePointersPercentage")),
                    "free_throws_made": self._coerce_float(stats.get("freeThrowsMade")),
                    "free_throws_attempted": self._coerce_float(stats.get("freeThrowsAttempted")),
                    "free_throw_pct": self._coerce_float(stats.get("freeThrowsPercentage")),
                    "offensive_rebounds": self._coerce_float(stats.get("reboundsOffensive")),
                    "defensive_rebounds": self._coerce_float(stats.get("reboundsDefensive")),
                    "rebounds": self._coerce_float(stats.get("reboundsTotal")),
                    "assists": self._coerce_float(stats.get("assists")),
                    "steals": self._coerce_float(stats.get("steals")),
                    "blocks": self._coerce_float(stats.get("blocks")),
                    "turnovers": self._coerce_float(stats.get("turnovers")),
                    "fouls": self._coerce_float(stats.get("foulsPersonal")),
                    "points": self._coerce_float(stats.get("points")),
                    "plus_minus": self._coerce_float(stats.get("plusMinusPoints")),
                }
            )
        return players

    def _cdn_team_totals(self, team: dict[str, Any]) -> dict[str, Any]:
        stats = team.get("statistics") or {}
        minutes_raw = stats.get("minutesCalculated") or stats.get("minutes")
        points = self._coerce_float(stats.get("points"))
        points_against = self._coerce_float(stats.get("pointsAgainst"))
        plus_minus = None
        if points is not None and points_against is not None:
            plus_minus = points - points_against
        return {
            "team_id": self._coerce_int(team.get("teamId")),
            "team_name": team.get("teamName"),
            "team_abbreviation": team.get("teamTricode"),
            "minutes": self._iso_duration_to_minutes(minutes_raw),
            "field_goals_made": self._coerce_float(stats.get("fieldGoalsMade")),
            "field_goals_attempted": self._coerce_float(stats.get("fieldGoalsAttempted")),
            "field_goal_pct": self._coerce_float(stats.get("fieldGoalsPercentage")),
            "three_point_made": self._coerce_float(stats.get("threePointersMade")),
            "three_point_attempted": self._coerce_float(stats.get("threePointersAttempted")),
            "three_point_pct": self._coerce_float(stats.get("threePointersPercentage")),
            "free_throws_made": self._coerce_float(stats.get("freeThrowsMade")),
            "free_throws_attempted": self._coerce_float(stats.get("freeThrowsAttempted")),
            "free_throw_pct": self._coerce_float(stats.get("freeThrowsPercentage")),
            "offensive_rebounds": self._coerce_float(stats.get("reboundsOffensive")),
            "defensive_rebounds": self._coerce_float(stats.get("reboundsDefensive")),
            "rebounds": self._coerce_float(stats.get("reboundsTotal")),
            "assists": self._coerce_float(stats.get("assists")),
            "steals": self._coerce_float(stats.get("steals")),
            "blocks": self._coerce_float(stats.get("blocks")),
            "turnovers": self._coerce_float(stats.get("turnoversTotal") or stats.get("turnovers")),
            "fouls": self._coerce_float(stats.get("foulsPersonal")),
            "points": points,
            "plus_minus": plus_minus,
        }

    def _cdn_line_score(
        self, home_team: dict[str, Any], away_team: dict[str, Any]
    ) -> list[dict[str, Any]]:
        line_score = []
        home_periods = home_team.get("periods") or []
        away_periods = away_team.get("periods") or []
        max_periods = max(len(home_periods), len(away_periods))
        for idx in range(max_periods):
            label = f"Q{idx + 1}" if idx < 4 else ("OT" if idx == 4 else f"OT{idx - 3}")
            if idx < len(home_periods):
                home_pts = self._coerce_int(home_periods[idx].get("score")) or 0
            else:
                home_pts = 0
            if idx < len(away_periods):
                away_pts = self._coerce_int(away_periods[idx].get("score")) or 0
            else:
                away_pts = 0
            line_score.append({"label": label, "home": home_pts or 0, "away": away_pts or 0})
        return line_score

    def _cdn_team_card(
        self, team: dict[str, Any], is_home: bool, players: list[dict[str, Any]]
    ) -> dict[str, Any]:
        team_id = self._coerce_int(team.get("teamId"))
        leaders = self._cdn_team_leaders(team_id, players)
        return {
            "team_id": team_id,
            "team_name": team.get("teamName"),
            "team_city": team.get("teamCity"),
            "team_abbreviation": team.get("teamTricode"),
            "score": self._coerce_int(team.get("score")) or 0,
            "record": None,
            "is_home": is_home,
            "leaders": leaders,
        }

    def _cdn_team_leaders(
        self, team_id: int | None, players: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        filtered = [p for p in players if p.get("team_id") == team_id]
        metrics = [
            ("points", "PTS"),
            ("rebounds", "REB"),
            ("assists", "AST"),
        ]
        leaders: list[dict[str, Any]] = []
        for metric, _label in metrics:
            best = max(filtered, key=lambda p: p.get(metric) or -1, default=None)
            if best and best.get(metric) is not None:
                leaders.append(
                    {
                        "player_id": best.get("player_id") or 0,
                        "player_name": best.get("player_name") or "Unknown",
                        "points": best.get("points"),
                        "rebounds": best.get("rebounds"),
                        "assists": best.get("assists"),
                        "stat_line": self._format_leader_line(best),
                    }
                )
        return leaders

    def _iso_duration_to_minutes(self, value: str | None) -> str | None:
        if not value or not isinstance(value, str):
            return None
        match = re.match(r"PT(?:(\d+)M)?(?:(\d+)(?:\.\d+)?S)?", value)
        if not match:
            return None
        minutes = int(match.group(1) or 0)
        seconds = int(match.group(2) or 0)
        return f"{minutes}:{str(seconds).zfill(2)}"

    def _load_advanced_rows(self, game_id: str) -> list[dict[str, Any]]:
        try:
            endpoint = boxscoreadvancedv2.BoxScoreAdvancedV2(
                game_id=game_id,
                start_period="0",
                end_period="0",
                start_range="0",
                end_range="0",
                range_type="0",
                headers=NBA_STATS_HEADERS,
                timeout=self._stats_timeout,
            )
            rows = self._dataset_to_rows(endpoint.player_stats)
            if rows:
                return rows
        except Exception:
            logger.warning("boxscoreadvancedv2 returned no data; falling back to v3", exc_info=True)
        endpoint_v3 = boxscoreadvancedv3.BoxScoreAdvancedV3(
            game_id=game_id,
            start_period="0",
            end_period="0",
            start_range="0",
            end_range="0",
            range_type="0",
            headers=NBA_STATS_HEADERS,
            timeout=self._stats_timeout,
        )
        return cast(
            list[dict[str, Any]],
            endpoint_v3.player_stats.get_data_frame().to_dict("records"),
        )

    def _normalize_traditional_player(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "player_id": self._safe_int(row.get("PLAYER_ID")),
            "player_name": row.get("PLAYER_NAME"),
            "team_id": self._safe_int(row.get("TEAM_ID")),
            "team_abbreviation": row.get("TEAM_ABBREVIATION"),
            "team_city": row.get("TEAM_CITY"),
            "start_position": row.get("START_POSITION") or None,
            "comment": row.get("COMMENT") or None,
            "minutes": row.get("MIN"),
            "field_goals_made": self._coerce_float(row.get("FGM")),
            "field_goals_attempted": self._coerce_float(row.get("FGA")),
            "field_goal_pct": self._coerce_float(row.get("FG_PCT")),
            "three_point_made": self._coerce_float(row.get("FG3M")),
            "three_point_attempted": self._coerce_float(row.get("FG3A")),
            "three_point_pct": self._coerce_float(row.get("FG3_PCT")),
            "free_throws_made": self._coerce_float(row.get("FTM")),
            "free_throws_attempted": self._coerce_float(row.get("FTA")),
            "free_throw_pct": self._coerce_float(row.get("FT_PCT")),
            "offensive_rebounds": self._coerce_float(row.get("OREB")),
            "defensive_rebounds": self._coerce_float(row.get("DREB")),
            "rebounds": self._coerce_float(row.get("REB")),
            "assists": self._coerce_float(row.get("AST")),
            "steals": self._coerce_float(row.get("STL")),
            "blocks": self._coerce_float(row.get("BLK")),
            "turnovers": self._coerce_float(row.get("TO")),
            "fouls": self._coerce_float(row.get("PF")),
            "points": self._coerce_float(row.get("PTS")),
            "plus_minus": self._coerce_float(row.get("PLUS_MINUS")),
        }

    def _normalize_team_totals(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "team_id": self._safe_int(row.get("TEAM_ID")),
            "team_name": row.get("TEAM_NAME"),
            "team_abbreviation": row.get("TEAM_ABBREVIATION"),
            "minutes": row.get("MIN"),
            "field_goals_made": self._coerce_float(row.get("FGM")),
            "field_goals_attempted": self._coerce_float(row.get("FGA")),
            "field_goal_pct": self._coerce_float(row.get("FG_PCT")),
            "three_point_made": self._coerce_float(row.get("FG3M")),
            "three_point_attempted": self._coerce_float(row.get("FG3A")),
            "three_point_pct": self._coerce_float(row.get("FG3_PCT")),
            "free_throws_made": self._coerce_float(row.get("FTM")),
            "free_throws_attempted": self._coerce_float(row.get("FTA")),
            "free_throw_pct": self._coerce_float(row.get("FT_PCT")),
            "offensive_rebounds": self._coerce_float(row.get("OREB")),
            "defensive_rebounds": self._coerce_float(row.get("DREB")),
            "rebounds": self._coerce_float(row.get("REB")),
            "assists": self._coerce_float(row.get("AST")),
            "steals": self._coerce_float(row.get("STL")),
            "blocks": self._coerce_float(row.get("BLK")),
            "turnovers": self._coerce_float(row.get("TO")),
            "fouls": self._coerce_float(row.get("PF")),
            "points": self._coerce_float(row.get("PTS")),
            "plus_minus": self._coerce_float(row.get("PLUS_MINUS")),
        }

    def _normalize_starter_bench(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "team_id": self._safe_int(row.get("TEAM_ID")),
            "team_name": row.get("TEAM_NAME"),
            "team_abbreviation": row.get("TEAM_ABBREVIATION"),
            "label": row.get("STARTERS_BENCH") or "",
            "minutes": row.get("MIN"),
            "field_goals_made": self._coerce_float(row.get("FGM")),
            "field_goals_attempted": self._coerce_float(row.get("FGA")),
            "field_goal_pct": self._coerce_float(row.get("FG_PCT")),
            "three_point_made": self._coerce_float(row.get("FG3M")),
            "three_point_attempted": self._coerce_float(row.get("FG3A")),
            "three_point_pct": self._coerce_float(row.get("FG3_PCT")),
            "free_throws_made": self._coerce_float(row.get("FTM")),
            "free_throws_attempted": self._coerce_float(row.get("FTA")),
            "free_throw_pct": self._coerce_float(row.get("FT_PCT")),
            "offensive_rebounds": self._coerce_float(row.get("OREB")),
            "defensive_rebounds": self._coerce_float(row.get("DREB")),
            "rebounds": self._coerce_float(row.get("REB")),
            "assists": self._coerce_float(row.get("AST")),
            "steals": self._coerce_float(row.get("STL")),
            "blocks": self._coerce_float(row.get("BLK")),
            "turnovers": self._coerce_float(row.get("TO")),
            "fouls": self._coerce_float(row.get("PF")),
            "points": self._coerce_float(row.get("PTS")),
        }

    def _normalize_advanced_player(self, row: dict[str, Any]) -> dict[str, Any]:
        def pick(*keys: str) -> Any:
            for key in keys:
                if key in row:
                    return row[key]
            return None

        def team_abbr() -> str | None:
            value = pick("TEAM_ABBREVIATION", "teamTricode", "teamAbbreviation")
            return str(value) if value else None

        def player_name() -> str:
            value = pick("PLAYER_NAME", "playerName", "nameI")
            if value:
                return str(value)
            first = pick("FIRST_NAME", "firstName")
            last = pick("LAST_NAME", "familyName")
            full = " ".join(
                part.strip() for part in [str(first or ""), str(last or "")] if part
            ).strip()
            return full or "Unknown player"

        return {
            "player_id": self._safe_int(pick("PLAYER_ID", "personId", "playerId")),
            "player_name": player_name(),
            "team_id": self._safe_int(pick("TEAM_ID", "teamId")),
            "team_abbreviation": team_abbr() or "UNK",
            "minutes": pick("MIN", "minutes"),
            "offensive_rating": self._coerce_float(
                pick(
                    "OFF_RATING",
                    "E_OFF_RATING",
                    "offensiveRating",
                    "estimatedOffensiveRating",
                )
            ),
            "defensive_rating": self._coerce_float(
                pick(
                    "DEF_RATING",
                    "E_DEF_RATING",
                    "defensiveRating",
                    "estimatedDefensiveRating",
                )
            ),
            "net_rating": self._coerce_float(
                pick("NET_RATING", "E_NET_RATING", "netRating", "estimatedNetRating")
            ),
            "usage_pct": self._coerce_float(
                pick("USG_PCT", "E_USG_PCT", "usagePercentage", "estimatedUsagePercentage")
            ),
            "true_shooting_pct": self._coerce_float(pick("TS_PCT", "trueShootingPercentage")),
            "effective_fg_pct": self._coerce_float(pick("EFG_PCT", "effectiveFieldGoalPercentage")),
            "assist_pct": self._coerce_float(pick("AST_PCT", "assistPercentage")),
            "assist_to_turnover": self._coerce_float(pick("AST_TOV", "assistToTurnover")),
            "rebound_pct": self._coerce_float(pick("REB_PCT", "reboundPercentage")),
            "offensive_rebound_pct": self._coerce_float(
                pick("OREB_PCT", "offensiveReboundPercentage")
            ),
            "defensive_rebound_pct": self._coerce_float(
                pick("DREB_PCT", "defensiveReboundPercentage")
            ),
            "pace": self._coerce_float(pick("PACE", "E_PACE", "pace", "estimatedPace")),
            "pace_per40": self._coerce_float(pick("PACE_PER40", "pacePer40")),
            "possessions": self._coerce_float(pick("POSS", "possessions")),
            "pie": self._coerce_float(pick("PIE", "pie")),
        }

    def _build_team_card(
        self,
        team_id: int,
        is_home: bool,
        line_score_rows: list[dict[str, Any]],
        players: list[dict[str, Any]],
    ) -> dict[str, Any]:
        row = next(
            (item for item in line_score_rows if self._safe_int(item.get("TEAM_ID")) == team_id),
            {},
        )
        return {
            "team_id": team_id,
            "team_name": row.get("TEAM_NICKNAME") or row.get("TEAM_NAME"),
            "team_city": row.get("TEAM_CITY_NAME") or row.get("TEAM_CITY"),
            "team_abbreviation": row.get("TEAM_ABBREVIATION"),
            "score": self._coerce_int(row.get("PTS")) or 0,
            "record": row.get("TEAM_WINS_LOSSES"),
            "is_home": is_home,
            "leaders": self._team_leaders(players, team_id),
        }

    def _team_leaders(self, players: list[dict[str, Any]], team_id: int) -> list[dict[str, Any]]:
        filtered = [
            row for row in players if row.get("team_id") == team_id and not row.get("comment")
        ]
        filtered.sort(key=lambda player: player.get("points") or 0, reverse=True)
        leaders: list[dict[str, Any]] = []
        for row in filtered[:3]:
            leaders.append(
                {
                    "player_id": row.get("player_id"),
                    "player_name": row.get("player_name"),
                    "points": row.get("points"),
                    "rebounds": row.get("rebounds"),
                    "assists": row.get("assists"),
                    "stat_line": self._format_leader_line(row),
                }
            )
        return leaders

    def _compose_summary(
        self,
        home: dict[str, Any],
        away: dict[str, Any],
        status: str | None,
    ) -> str | None:
        if not home or not away:
            return None
        status_text = status or "Final"
        if home.get("score") is None or away.get("score") is None:
            return status_text
        home_score = int(home.get("score") or 0)
        away_score = int(away.get("score") or 0)
        if home_score == away_score:
            return (
                f"{status_text}: {home_score}-{away_score} in "
                f"{home.get('team_city') or 'NBA play'}."
            )
        winner = home if home_score > away_score else away
        loser = away if winner is home else home
        margin = abs(home_score - away_score)
        winner_name = winner.get("team_name") or "Home"
        loser_name = loser.get("team_name") or "Visitor"
        return f"{winner_name} {status_text.lower()} with a {margin}-point win over {loser_name}."

    def _build_line_score(
        self,
        rows: list[dict[str, Any]],
        home_id: int,
        away_id: int,
    ) -> list[dict[str, int]]:
        lookup = {self._safe_int(row.get("TEAM_ID")): row for row in rows}
        home_row = lookup.get(home_id, {})
        away_row = lookup.get(away_id, {})
        line_score: list[dict[str, int]] = []
        for period in range(1, 5):
            label = f"Q{period}"
            home_pts = self._coerce_int(home_row.get(f"PTS_QTR{period}")) or 0
            away_pts = self._coerce_int(away_row.get(f"PTS_QTR{period}")) or 0
            line_score.append({"label": label, "home": home_pts, "away": away_pts})
        for overtime in range(1, 11):
            home_pts = self._coerce_int(home_row.get(f"PTS_OT{overtime}")) or 0
            away_pts = self._coerce_int(away_row.get(f"PTS_OT{overtime}")) or 0
            if home_pts == 0 and away_pts == 0:
                continue
            label = "OT" if overtime == 1 else f"OT{overtime}"
            line_score.append({"label": label, "home": home_pts, "away": away_pts})
        return line_score

    def _format_leader_line(self, row: dict[str, Any]) -> str:
        parts = []
        if row.get("points") is not None:
            parts.append(f"{int(row['points'])} PTS")
        if row.get("rebounds") is not None:
            parts.append(f"{int(row['rebounds'])} REB")
        if row.get("assists") is not None:
            parts.append(f"{int(row['assists'])} AST")
        return " • ".join(parts) if parts else ""

    def _parse_datetime(self, value: str | None) -> datetime | None:
        if not value:
            return None
        normalized = value.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(normalized)
        except ValueError:
            try:
                return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S")
            except ValueError:
                return None

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
            "field_goal_pct": (
                self._safe_float(row.get("FG_PCT")) if row.get("FG_PCT") is not None else None
            ),
            "three_point_pct": (
                self._safe_float(row.get("FG3_PCT")) if row.get("FG3_PCT") is not None else None
            ),
            "free_throw_pct": (
                self._safe_float(row.get("FT_PCT")) if row.get("FT_PCT") is not None else None
            ),
            "true_shooting_pct": (
                self._safe_float(row.get("TS_PCT")) if row.get("TS_PCT") is not None else None
            ),
        }

    def _normalize_player_award(self, row: dict[str, Any]) -> dict[str, Any]:
        season = (row.get("SEASON") or "").strip()
        description = (row.get("DESCRIPTION") or "").strip()
        if not season or not description:
            raise ValueError("Player award row missing season or description")

        def clean(value: Any) -> str | None:
            if value in (None, "", " "):
                return None
            text = str(value).strip()
            return text or None

        def clean_int(value: Any) -> int | None:
            try:
                parsed = int(value)
            except (TypeError, ValueError):
                return None
            return parsed

        return {
            "season": season,
            "description": description,
            "team": clean(row.get("TEAM")),
            "conference": clean(row.get("CONFERENCE")),
            "award_type": clean(row.get("TYPE")),
            "subtype1": clean(row.get("SUBTYPE1")),
            "subtype2": clean(row.get("SUBTYPE2")),
            "subtype3": clean(row.get("SUBTYPE3")),
            "month": clean(row.get("MONTH")),
            "week": clean(row.get("WEEK")),
            "all_nba_team_number": clean_int(row.get("ALL_NBA_TEAM_NUMBER")),
        }

    def _normalize_player_bio(self, row: dict[str, Any]) -> dict[str, Any]:
        def clean_text(value: Any) -> str | None:
            if value in (None, "", " "):
                return None
            text = str(value).strip()
            if not text:
                return None
            lowered = text.lower()
            if lowered in {"none", "n/a"}:
                return None
            return text

        def is_undrafted(value: Any) -> bool:
            return isinstance(value, str) and value.strip().lower() == "undrafted"

        height = clean_text(row.get("PLAYER_HEIGHT"))
        height_inches = self._coerce_int(row.get("PLAYER_HEIGHT_INCHES"))
        if not height and height_inches:
            feet, inches = divmod(height_inches, 12)
            height = f"{feet}-{inches}"

        weight = self._coerce_int(row.get("PLAYER_WEIGHT"))

        draft_year_raw = row.get("DRAFT_YEAR")
        draft_round_raw = row.get("DRAFT_ROUND")
        draft_number_raw = row.get("DRAFT_NUMBER")
        undrafted = any(
            is_undrafted(value) for value in (draft_year_raw, draft_round_raw, draft_number_raw)
        )
        draft_year = None if undrafted else self._coerce_int(draft_year_raw)
        draft_round = None if undrafted else self._coerce_int(draft_round_raw)
        draft_number = None if undrafted else self._coerce_int(draft_number_raw)

        draft_pick: str | None = None
        if undrafted:
            draft_pick = "Undrafted"
        elif draft_round and draft_number:
            draft_pick = f"Round {draft_round}, Pick {draft_number}"
        elif draft_number:
            draft_pick = f"Pick {draft_number}"
        elif draft_round:
            draft_pick = f"Round {draft_round}"

        return {
            "height": height,
            "weight": weight,
            "draft_year": draft_year,
            "draft_pick": draft_pick,
            "college": clean_text(row.get("COLLEGE")),
            "country": clean_text(row.get("COUNTRY")),
        }

    def _normalize_player_info(self, row: dict[str, Any]) -> dict[str, Any]:
        birthdate: date | None = None
        birth_raw = row.get("BIRTHDATE")
        if isinstance(birth_raw, str):
            parsed = self._parse_datetime(birth_raw)
            if parsed:
                birthdate = parsed.date()

        display_name = self._clean_text_value(row.get("DISPLAY_FIRST_LAST"))
        first_name = self._clean_text_value(row.get("FIRST_NAME"))
        last_name = self._clean_text_value(row.get("LAST_NAME"))
        if not display_name:
            display_name = " ".join(part for part in [first_name, last_name] if part).strip()

        return {
            "player_id": self._safe_int(row.get("PERSON_ID")),
            "display_name": display_name or "Unknown",
            "first_name": first_name,
            "last_name": last_name,
            "position": self._clean_text_value(row.get("POSITION")),
            "jersey": self._clean_text_value(row.get("JERSEY")),
            "birthdate": birthdate,
            "school": self._clean_text_value(row.get("SCHOOL")),
            "country": self._clean_text_value(row.get("COUNTRY")),
            "season_experience": self._coerce_int(row.get("SEASON_EXP")),
            "roster_status": self._clean_text_value(row.get("ROSTERSTATUS")),
            "from_year": self._coerce_int(row.get("FROM_YEAR")),
            "to_year": self._coerce_int(row.get("TO_YEAR")),
            "team_id": self._coerce_int(row.get("TEAM_ID")),
            "team_name": self._clean_text_value(row.get("TEAM_NAME")),
            "team_abbreviation": self._clean_text_value(row.get("TEAM_ABBREVIATION")),
        }

    def _normalize_team_history_row(self, row: dict[str, Any]) -> dict[str, Any]:
        season = str(row.get("YEAR") or "").strip()
        if not season:
            raise ValueError("Team history row missing season")
        conference_rank = self._coerce_int(row.get("CONF_RANK"))
        if conference_rank is not None and conference_rank <= 0:
            conference_rank = None
        division_rank = self._coerce_int(row.get("DIV_RANK"))
        if division_rank is not None and division_rank <= 0:
            division_rank = None

        finals_result = self._clean_text_value(row.get("NBA_FINALS_APPEARANCE"))
        if finals_result and finals_result.lower() in {"n/a", "na"}:
            finals_result = None

        return {
            "team_id": self._safe_int(row.get("TEAM_ID")),
            "team_city": self._clean_text_value(row.get("TEAM_CITY")),
            "team_name": self._clean_text_value(row.get("TEAM_NAME")),
            "season": season,
            "games_played": self._safe_int(row.get("GP")),
            "wins": self._safe_int(row.get("WINS")),
            "losses": self._safe_int(row.get("LOSSES")),
            "win_pct": self._safe_float(row.get("WIN_PCT")),
            "conference_rank": conference_rank,
            "division_rank": division_rank,
            "playoff_wins": self._coerce_int(row.get("PO_WINS")),
            "playoff_losses": self._coerce_int(row.get("PO_LOSSES")),
            "finals_result": finals_result,
            "points": self._coerce_float(row.get("PTS")),
            "field_goal_pct": self._coerce_float(row.get("FG_PCT")),
            "three_point_pct": self._coerce_float(row.get("FG3_PCT")),
        }

    def _normalize_league_leader_row(
        self,
        row: dict[str, Any],
        stat_category: str,
        stat_field: str,
    ) -> dict[str, Any]:
        stat_value = self._coerce_float(row.get(stat_field))
        if stat_value is None:
            stat_value = 0.0

        return {
            "player_id": self._safe_int(row.get("PLAYER_ID")),
            "rank": self._safe_int(row.get("RANK")),
            "player_name": self._clean_text_value(row.get("PLAYER")) or "Unknown",
            "team_id": self._coerce_int(row.get("TEAM_ID")),
            "team_abbreviation": self._clean_text_value(row.get("TEAM")),
            "games_played": self._safe_int(row.get("GP")),
            "minutes": self._coerce_float(row.get("MIN")),
            "points": self._coerce_float(row.get("PTS")),
            "rebounds": self._coerce_float(row.get("REB")),
            "assists": self._coerce_float(row.get("AST")),
            "steals": self._coerce_float(row.get("STL")),
            "blocks": self._coerce_float(row.get("BLK")),
            "turnovers": self._coerce_float(row.get("TOV")),
            "efficiency": self._coerce_float(row.get("EFF")),
            "stat_value": stat_value,
            "stat_category": stat_category,
        }

    def _clean_text_value(self, value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        lowered = text.lower()
        if lowered in {"nan", "none", "n/a", "null"}:
            return None
        return text

    def _dataset_to_rows(self, dataset: Any) -> list[dict[str, Any]]:
        payload = dataset.get_dict()
        headers: list[Any] = payload.get("headers") or []
        rows: list[list[Any]] = payload.get("data") or []
        normalized: list[dict[str, Any]] = []
        for row in rows:
            normalized.append(
                {str(headers[idx]): row[idx] for idx in range(min(len(headers), len(row)))}
            )
        return normalized

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

    def _coerce_float(self, value: Any) -> float | None:
        try:
            if value is None or value == "":
                return None
            number = float(value)
        except (TypeError, ValueError):
            return None
        if math.isnan(number) or math.isinf(number):
            return None
        return number

    def _safe_int(self, value: Any) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0

    def _coerce_int(self, value: Any) -> int | None:
        try:
            if value is None or value == "":
                return None
            return int(value)
        except (TypeError, ValueError):
            return None
