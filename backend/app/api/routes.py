"""Versioned API routes."""

from __future__ import annotations

import logging
from typing import Annotated, Any, Literal
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query, Request

from ..auth import require_api_key
from ..config import Settings
from ..dependencies import (
    get_cache_backend,
    get_nba_client,
    get_news_client,
    get_rate_limiter,
    get_settings_dependency,
    get_supabase_client,
)
from ..rate_limit import RateLimiter
from ..cache import CacheBackend
from ..cache_helpers import get_or_set_cache
from ..schemas import (
    BoxScoreGame,
    CacheMeta,
    Envelope,
    Game,
    LeagueStanding,
    MetaResponse,
    NewsArticle,
    PaginationMeta,
    Player,
    PlayerAward,
    PlayerBio,
    PlayerCareerStatsRow,
    PlayerGameLog,
    PlayerStatsRow,
    ResolveResult,
    ShotLocation,
    Team,
    TeamDetail,
    TeamGameRow,
    TeamStatsRow,
)
from ..services.nba import NBAStatsClient
from ..services.store import (
    fetch_boxscore,
    fetch_games,
    fetch_league_standings,
    fetch_player_gamelog_from_boxscores,
    fetch_teams,
)
from ..services.news import NewsService
from ..utils import paginate, parse_date, validate_date_range, validate_season
from ..serving_cache import (
    TTLS,
    boxscore_key,
    player_gamelog_key,
    scoreboard_key,
    standings_key,
    teams_key,
)
from ..supabase import SupabaseClient
from .responses import success

RateLimiterDep = Annotated[RateLimiter, Depends(get_rate_limiter)]
ApiKeyDep = Annotated[str, Depends(require_api_key)]
NBAClientDep = Annotated[NBAStatsClient, Depends(get_nba_client)]
NewsClientDep = Annotated[NewsService, Depends(get_news_client)]
SettingsDep = Annotated[Settings, Depends(get_settings_dependency)]
CacheDep = Annotated[CacheBackend, Depends(get_cache_backend)]
SupabaseDep = Annotated[SupabaseClient | None, Depends(get_supabase_client)]


async def authenticate_and_rate_limit(
    request: Request,
    rate_limiter: RateLimiterDep,
    api_key: ApiKeyDep,
) -> None:
    identifier = api_key or (request.client.host if request.client else "anonymous")
    await rate_limiter.check(identifier)


router = APIRouter(prefix="/v1", dependencies=[Depends(authenticate_and_rate_limit)])
logger = logging.getLogger("data_source")


def _source_from_cache(cache_meta: CacheMeta | None, miss_source: str) -> str:
    if cache_meta and cache_meta.hit:
        return "redis"
    return miss_source


def _log_data_source(
    request: Request,
    source: str,
    cache_meta: CacheMeta | None = None,
) -> None:
    payload = {"source": source}
    if cache_meta:
        payload["cache_hit"] = cache_meta.hit
        payload["cache_stale"] = cache_meta.stale
    logger.info(
        f"{request.method} {request.url.path} SOURCE={source}",
        extra={
            "request_id": getattr(request.state, "request_id", None),
            "path": request.url.path,
            "method": request.method,
            "extra": payload,
        },
    )


def _apply_pagination_links(
    request: Request, pagination: dict[str, Any] | None
) -> PaginationMeta | None:
    if not pagination:
        return None
    pagination_data = dict(pagination)
    if pagination_data.get("next"):
        pagination_data["next_url"] = str(
            request.url.include_query_params(page=pagination_data["next"])
        )
    if pagination_data.get("prev"):
        pagination_data["prev_url"] = str(
            request.url.include_query_params(page=pagination_data["prev"])
        )
    return PaginationMeta(**pagination_data)


def _parse_game_date(value: Any) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        cleaned = value.split("T", 1)[0]
        try:
            return date.fromisoformat(cleaned)
        except ValueError:
            return None
    return None


def _season_for_date(value: date) -> str:
    start_year = value.year if value.month >= 10 else value.year - 1
    return f"{start_year}-{str((start_year + 1) % 100).zfill(2)}"


def _sort_games_desc(data: list[Any]) -> list[Any]:
    if len(data) < 2:
        return data

    def key(item: Any) -> date:
        raw = getattr(item, "date", None)
        if raw is None and isinstance(item, dict):
            raw = item.get("date")
        parsed = _parse_game_date(raw)
        return parsed or date.min

    return sorted(data, key=key, reverse=True)


def _latest_game_date(data: list[Any]) -> date | None:
    latest: date | None = None
    for item in data:
        raw = getattr(item, "date", None)
        if raw is None and isinstance(item, dict):
            raw = item.get("date")
        parsed = _parse_game_date(raw)
        if parsed and (latest is None or parsed > latest):
            latest = parsed
    return latest


def _allow_nocache(request: Request, settings: Settings, nocache: bool) -> bool:
    if not nocache:
        return False
    admin_key = request.headers.get("x-admin-key")
    return bool(settings.admin_api_key and admin_key == settings.admin_api_key)


def _row_value(row: Any, key: str) -> Any:
    if isinstance(row, dict):
        return row.get(key)
    return getattr(row, key, None)


def _row_to_dict(row: Any) -> dict[str, Any]:
    if isinstance(row, dict):
        return dict(row)
    if hasattr(row, "model_dump"):
        return row.model_dump()
    return dict(row)


def _needs_shooting(data: list[Any]) -> bool:
    for row in data:
        if (
            _row_value(row, "field_goals_made") is None
            or _row_value(row, "field_goals_attempted") is None
            or _row_value(row, "three_point_made") is None
            or _row_value(row, "three_point_attempted") is None
            or _row_value(row, "field_goal_pct") is None
            or _row_value(row, "three_point_pct") is None
        ):
            return True
    return False


@router.get("/meta", response_model=Envelope[MetaResponse])
async def meta(request: Request, client: NBAClientDep) -> Envelope[MetaResponse]:
    payload = await client.get_meta()
    _log_data_source(request, "api")
    return success(request, payload)


@router.get("/news", response_model=Envelope[list[NewsArticle]])
async def news(
    request: Request,
    client: NewsClientDep,
) -> Envelope[list[NewsArticle]]:
    articles, cache_meta = await client.get_latest()
    _log_data_source(request, _source_from_cache(cache_meta, "api"), cache_meta)
    return success(request, articles, cache=cache_meta)


@router.get("/teams", response_model=Envelope[list[Team]])
async def teams(
    request: Request,
    cache: CacheDep,
    supabase: SupabaseDep,
    client: NBAClientDep,
    settings: SettingsDep,
    season: str = Query(..., description="Season like 2024-25"),
    nocache: bool = Query(False, description="Bypass cache (admin only)."),
) -> Envelope[list[Team]]:
    validate_season(season)
    if supabase:
        nocache_allowed = _allow_nocache(request, settings, nocache)
        key = teams_key(settings, season)
        try:
            data, cache_meta = await get_or_set_cache(
                cache=cache,
                redis_client=request.app.state.redis,
                key=key,
                ttl=TTLS.teams,
                fetcher=lambda: fetch_teams(supabase),
                nocache=nocache_allowed,
            )
            if data:
                _log_data_source(request, _source_from_cache(cache_meta, "db"), cache_meta)
                return success(request, data, cache=cache_meta)
        except Exception:
            logger.exception("supabase teams fetch failed; falling back to nba api")
    result = await client.get_teams(season)
    _log_data_source(request, _source_from_cache(result.cache, "api"), result.cache)
    return success(request, result.data, cache=result.cache)


@router.get("/league_standings", response_model=Envelope[list[LeagueStanding]])
async def league_standings(
    request: Request,
    cache: CacheDep,
    supabase: SupabaseDep,
    client: NBAClientDep,
    settings: SettingsDep,
    season: str = Query(..., description="Season like 2024-25"),
    league_id: str = Query("00"),
    season_type: str = Query("Regular Season"),
    nocache: bool = Query(False, description="Bypass cache (admin only)."),
) -> Envelope[list[LeagueStanding]]:
    validate_season(season)
    if supabase:
        nocache_allowed = _allow_nocache(request, settings, nocache)
        key = standings_key(settings, season, league_id, season_type)
        try:
            data, cache_meta = await get_or_set_cache(
                cache=cache,
                redis_client=request.app.state.redis,
                key=key,
                ttl=TTLS.standings,
                fetcher=lambda: fetch_league_standings(supabase, season),
                nocache=nocache_allowed,
            )
            if data:
                _log_data_source(request, _source_from_cache(cache_meta, "db"), cache_meta)
                return success(request, data, cache=cache_meta)
        except Exception:
            logger.exception("supabase league standings fetch failed; falling back to nba api")
    result = await client.get_league_standings(league_id, season, season_type)
    _log_data_source(request, _source_from_cache(result.cache, "api"), result.cache)
    return success(request, result.data, cache=result.cache)


@router.get("/players", response_model=Envelope[list[Player]])
async def players(
    request: Request,
    client: NBAClientDep,
    settings: SettingsDep,
    season: str = Query(...),
    search: str | None = Query(None, description="Case-insensitive substring filter"),
    active: bool | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> Envelope[list[Player]]:
    page_size = min(page_size, settings.pagination_max_page_size)
    players, cache_meta, pagination = await client.get_players(
        season, active, search, page, page_size
    )
    pagination_meta = _apply_pagination_links(request, pagination)
    _log_data_source(request, _source_from_cache(cache_meta, "api"), cache_meta)
    return success(request, players, cache=cache_meta, pagination=pagination_meta)


@router.get("/games", response_model=Envelope[list[Game | TeamGameRow]])
async def games(
    request: Request,
    settings: SettingsDep,
    cache: CacheDep,
    supabase: SupabaseDep,
    client: NBAClientDep,
    season: str = Query(...),
    team_id: int | None = Query(None),
    team_abbr: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    per_team: bool = Query(False),
    nocache: bool = Query(False, description="Bypass cache (admin only)."),
) -> Envelope[list[Game | TeamGameRow]]:
    page_size = min(page_size, settings.pagination_max_page_size)
    start = parse_date(date_from, "date_from")
    end = parse_date(date_to, "date_to")
    validate_date_range(start, end)
    data: list[Any] = []
    cache_meta = CacheMeta(hit=False, stale=False)
    source: str | None = None
    if supabase and not per_team:
        try:
            nocache_allowed = _allow_nocache(request, settings, nocache)
            use_scoreboard_cache = (
                not per_team
                and team_id is None
                and team_abbr is None
                and start is not None
                and end is not None
                and start == end
            )
            if use_scoreboard_cache:
                key = scoreboard_key(settings, start)
                ttl = TTLS.scoreboard_live if start == date.today() else TTLS.scoreboard_final
                data, cache_meta = await get_or_set_cache(
                    cache=cache,
                    redis_client=request.app.state.redis,
                    key=key,
                    ttl=ttl,
                    fetcher=lambda: fetch_games(
                        supabase,
                        season=season,
                        date_from=start,
                        date_to=end,
                        team_id=team_id,
                        team_abbr=team_abbr,
                        per_team=per_team,
                    ),
                    nocache=nocache_allowed,
                )
                source = _source_from_cache(cache_meta, "db")
            else:
                data = await fetch_games(
                    supabase,
                    season=season,
                    date_from=start,
                    date_to=end,
                    team_id=team_id,
                    team_abbr=team_abbr,
                    per_team=per_team,
                )
                cache_meta = CacheMeta(hit=False, stale=False)
                source = "db"
            if (
                data
                and team_id is None
                and team_abbr is None
                and start is None
                and end is None
                and season == _season_for_date(date.today())
            ):
                latest = _latest_game_date(data)
                if latest and latest < date.today() - timedelta(days=4):
                    logger.warning(
                        "supabase games data stale; falling back to nba api",
                        extra={"latest_date": latest.isoformat(), "season": season},
                    )
                    data = []
                    cache_meta = CacheMeta(hit=False, stale=True)
                    source = None
        except Exception:
            logger.exception("supabase games fetch failed; falling back to nba api")
            data = []
            cache_meta = CacheMeta(hit=False, stale=False)
            source = None
    if not data:
        result = await client.get_games(
            season=season,
            team_id=team_id,
            team_abbr=team_abbr,
            date_from=start,
            date_to=end,
            per_team=per_team,
        )
        data = result.data
        cache_meta = result.cache
        source = _source_from_cache(cache_meta, "api")
    data = _sort_games_desc(data)
    if not per_team:
        paged, pagination = paginate(data, page, page_size)
        pagination_meta = _apply_pagination_links(request, pagination.model_dump())
        _log_data_source(request, source or "api", cache_meta)
        return success(request, paged, cache=cache_meta, pagination=pagination_meta)
    paged, pagination = paginate(data, page, page_size)
    pagination_meta = _apply_pagination_links(request, pagination.model_dump())
    _log_data_source(request, source or "api", cache_meta)
    return success(request, paged, cache=cache_meta, pagination=pagination_meta)


@router.get("/players/{player_id}/gamelog", response_model=Envelope[list[PlayerGameLog]])
async def player_gamelog(
    request: Request,
    cache: CacheDep,
    supabase: SupabaseDep,
    client: NBAClientDep,
    settings: SettingsDep,
    player_id: int,
    season: str = Query(...),
    season_type: str = Query("Regular Season"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    nocache: bool = Query(False, description="Bypass cache (admin only)."),
) -> Envelope[list[PlayerGameLog]]:
    start = parse_date(date_from, "date_from")
    end = parse_date(date_to, "date_to")
    validate_date_range(start, end)
    normalized_season_type = (season_type or "Regular Season").strip()
    if normalized_season_type.lower() != "regular season":
        result = await client.get_player_gamelog(
            player_id, season, normalized_season_type, start, end
        )
        _log_data_source(request, _source_from_cache(result.cache, "api"), result.cache)
        return success(request, result.data, cache=result.cache)
    if supabase:
        try:
            data = await fetch_player_gamelog_from_boxscores(
                supabase,
                player_id=player_id,
                season=season,
                date_from=start,
                date_to=end,
            )
            if data:
                _log_data_source(request, "db")
                return success(request, data, cache=CacheMeta(hit=False, stale=False))
        except Exception:
            logger.exception(
                "supabase player gamelog fetch failed; falling back to nba api"
            )
    nocache_allowed = _allow_nocache(request, settings, nocache)
    key = player_gamelog_key(settings, player_id, season, normalized_season_type)

    async def fetcher() -> list[PlayerGameLog]:
        result = await client.get_player_gamelog(
            player_id, season, normalized_season_type, start, end
        )
        return result.data

    data, cache_meta = await get_or_set_cache(
        cache=cache,
        redis_client=request.app.state.redis,
        key=key,
        ttl=TTLS.player_gamelog,
        fetcher=fetcher,
        nocache=nocache_allowed,
    )
    if supabase and data:
        try:
            if _needs_shooting(data):
                fallback = await fetch_player_gamelog_from_boxscores(
                    supabase,
                    player_id=player_id,
                    season=season,
                    date_from=start,
                    date_to=end,
                )
                if fallback:
                    fallback_by_game = {
                        row.get("game_id"): row for row in fallback if row.get("game_id")
                    }
                    enriched: list[dict[str, Any]] = []
                    for row in data:
                        base = _row_to_dict(row)
                        fallback_row = fallback_by_game.get(base.get("game_id"))
                        if fallback_row:
                            if base.get("field_goals_made") is None:
                                base["field_goals_made"] = fallback_row.get("field_goals_made")
                            if base.get("field_goals_attempted") is None:
                                base["field_goals_attempted"] = fallback_row.get(
                                    "field_goals_attempted"
                                )
                            if base.get("three_point_made") is None:
                                base["three_point_made"] = fallback_row.get("three_point_made")
                            if base.get("three_point_attempted") is None:
                                base["three_point_attempted"] = fallback_row.get(
                                    "three_point_attempted"
                                )
                            if base.get("field_goal_pct") is None:
                                base["field_goal_pct"] = fallback_row.get("field_goal_pct")
                            if base.get("three_point_pct") is None:
                                base["three_point_pct"] = fallback_row.get("three_point_pct")
                        enriched.append(base)
                    _log_data_source(request, "db_enrich", cache_meta)
                    return success(request, enriched, cache=cache_meta)
        except Exception:
            logger.exception("supabase player gamelog enrich failed; returning api result")
    if not data and supabase:
        try:
            fallback = await fetch_player_gamelog_from_boxscores(
                supabase,
                player_id=player_id,
                season=season,
                date_from=start,
                date_to=end,
            )
            if fallback:
                _log_data_source(request, "db_fallback")
                return success(request, fallback, cache=CacheMeta(hit=False, stale=False))
        except Exception:
            logger.exception(
                "supabase player gamelog fallback failed; returning api result"
            )
    _log_data_source(request, _source_from_cache(cache_meta, "api"), cache_meta)
    return success(request, data, cache=cache_meta)


@router.get("/players/{player_id}/career", response_model=Envelope[list[PlayerCareerStatsRow]])
async def player_career(
    request: Request,
    client: NBAClientDep,
    player_id: int,
    season_type: str = Query("Regular Season"),
) -> Envelope[list[PlayerCareerStatsRow]]:
    result = await client.get_player_career_stats(player_id, season_type)
    _log_data_source(request, _source_from_cache(result.cache, "api"), result.cache)
    return success(request, result.data, cache=result.cache)


@router.get("/players/{player_id}/awards", response_model=Envelope[list[PlayerAward]])
async def player_awards(
    request: Request,
    client: NBAClientDep,
    player_id: int,
) -> Envelope[list[PlayerAward]]:
    result = await client.get_player_awards(player_id)
    _log_data_source(request, _source_from_cache(result.cache, "api"), result.cache)
    return success(request, result.data, cache=result.cache)


@router.get("/players/{player_id}/bio", response_model=Envelope[PlayerBio | None])
async def player_bio(
    request: Request,
    client: NBAClientDep,
    player_id: int,
    season: str = Query(_season_for_date(date.today()), description="Season like 2024-25"),
) -> Envelope[PlayerBio | None]:
    validate_season(season)
    result = await client.get_player_bio(player_id, season)
    _log_data_source(request, _source_from_cache(result.cache, "api"), result.cache)
    return success(request, result.data, cache=result.cache)


@router.get("/boxscores/{game_id}", response_model=Envelope[BoxScoreGame])
async def full_boxscore(
    request: Request,
    cache: CacheDep,
    supabase: SupabaseDep,
    client: NBAClientDep,
    settings: SettingsDep,
    game_id: str,
    nocache: bool = Query(False, description="Bypass cache (admin only)."),
) -> Envelope[BoxScoreGame]:
    if supabase:
        nocache_allowed = _allow_nocache(request, settings, nocache)
        key = boxscore_key(settings, game_id)
        try:
            data, cache_meta = await get_or_set_cache(
                cache=cache,
                redis_client=request.app.state.redis,
                key=key,
                ttl=TTLS.boxscore_final,
                fetcher=lambda: fetch_boxscore(supabase, game_id),
                nocache=nocache_allowed,
            )
            if data is not None:
                _log_data_source(request, _source_from_cache(cache_meta, "db"), cache_meta)
                return success(request, data, cache=cache_meta)
        except Exception:
            logger.exception("supabase boxscore fetch failed; falling back to nba api")
    result = await client.get_boxscore_details(game_id)
    _log_data_source(request, _source_from_cache(result.cache, "api"), result.cache)
    return success(request, result.data, cache=result.cache)


@router.get("/players/{player_id}/shots", response_model=Envelope[list[ShotLocation]])
async def player_shots(
    request: Request,
    client: NBAClientDep,
    player_id: int,
    season: str = Query(...),
    team_id: int | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
) -> Envelope[list[ShotLocation]]:
    start = parse_date(date_from, "date_from")
    end = parse_date(date_to, "date_to")
    validate_date_range(start, end)
    result = await client.get_shots(player_id, season, team_id, start, end)
    _log_data_source(request, _source_from_cache(result.cache, "api"), result.cache)
    return success(request, result.data, cache=result.cache)


@router.get("/teams/{team_id}/details", response_model=Envelope[TeamDetail])
async def team_details(
    request: Request,
    client: NBAClientDep,
    team_id: int,
) -> Envelope[TeamDetail]:
    result = await client.get_team_details(team_id)
    _log_data_source(request, _source_from_cache(result.cache, "api"), result.cache)
    return success(request, result.data, cache=result.cache)


async def _build_team_stats_response(
    request: Request,
    *,
    client: NBAStatsClient,
    season: str,
    measure: Literal["Base", "Advanced", "FourFactors"],
    per_mode: Literal["PerGame", "Totals"],
    team_filter: int | None,
) -> Envelope[list[TeamStatsRow]]:
    result = await client.get_team_stats(season, measure, per_mode)
    data = (
        result.data
        if team_filter is None
        else [row for row in result.data if row.team_id == team_filter]
    )
    _log_data_source(request, _source_from_cache(result.cache, "api"), result.cache)
    return success(request, data, cache=result.cache)


@router.get("/teams/stats", response_model=Envelope[list[TeamStatsRow]])
async def teams_stats(
    request: Request,
    client: NBAClientDep,
    season: str = Query(...),
    measure: Literal["Base", "Advanced", "FourFactors"] = Query("Base"),
    per_mode: Literal["PerGame", "Totals"] = Query("PerGame"),
    team_id: int | None = Query(None),
) -> Envelope[list[TeamStatsRow]]:
    return await _build_team_stats_response(
        request,
        client=client,
        season=season,
        measure=measure,
        per_mode=per_mode,
        team_filter=team_id,
    )


@router.get("/teams/{team_id}/stats", response_model=Envelope[list[TeamStatsRow]])
async def team_stats(
    request: Request,
    client: NBAClientDep,
    team_id: int,
    season: str = Query(...),
    measure: Literal["Base", "Advanced", "FourFactors"] = Query("Base"),
    per_mode: Literal["PerGame", "Totals"] = Query("PerGame"),
) -> Envelope[list[TeamStatsRow]]:
    return await _build_team_stats_response(
        request,
        client=client,
        season=season,
        measure=measure,
        per_mode=per_mode,
        team_filter=team_id,
    )


@router.get("/players/stats", response_model=Envelope[list[PlayerStatsRow]])
async def player_stats(
    request: Request,
    client: NBAClientDep,
    settings: SettingsDep,
    season: str = Query(...),
    season_type: str = Query("Regular Season"),
    measure: Literal["Base", "Advanced", "Misc", "Scoring", "Usage"] = Query("Base"),
    per_mode: Literal["PerGame", "Totals"] = Query("PerGame"),
    team_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> Envelope[list[PlayerStatsRow]]:
    page_size = min(page_size, settings.pagination_max_page_size)
    stats, cache_meta, pagination = await client.get_player_stats(
        season, measure, per_mode, season_type, team_id, page, page_size
    )
    pagination_meta = _apply_pagination_links(request, pagination)
    _log_data_source(request, _source_from_cache(cache_meta, "api"), cache_meta)
    return success(request, stats, cache=cache_meta, pagination=pagination_meta)


@router.get("/resolve", response_model=Envelope[ResolveResult])
async def resolve(
    request: Request,
    client: NBAClientDep,
    player: str | None = Query(None),
    team: str | None = Query(None),
) -> Envelope[ResolveResult]:
    result = await client.resolve(player, team)
    _log_data_source(request, "api")
    return success(request, result)
