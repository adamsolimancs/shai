"""Versioned API routes."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request

from ..auth import require_api_key
from ..config import Settings
from ..dependencies import (
    get_nba_client,
    get_news_client,
    get_rate_limiter,
    get_settings_dependency,
)
from ..rate_limit import RateLimiter
from ..schemas import (
    BoxScoreLine,
    Envelope,
    Game,
    LeagueStanding,
    MetaResponse,
    NewsArticle,
    PaginationMeta,
    Player,
    PlayerAward,
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
from ..services.news import NewsService
from ..utils import paginate, parse_date, validate_date_range, validate_season
from .responses import success

RateLimiterDep = Annotated[RateLimiter, Depends(get_rate_limiter)]
ApiKeyDep = Annotated[str, Depends(require_api_key)]
NBAClientDep = Annotated[NBAStatsClient, Depends(get_nba_client)]
NewsClientDep = Annotated[NewsService, Depends(get_news_client)]
SettingsDep = Annotated[Settings, Depends(get_settings_dependency)]


async def authenticate_and_rate_limit(
    request: Request,
    rate_limiter: RateLimiterDep,
    api_key: ApiKeyDep,
) -> None:
    identifier = api_key or (request.client.host if request.client else "anonymous")
    await rate_limiter.check(identifier)


router = APIRouter(prefix="/v1", dependencies=[Depends(authenticate_and_rate_limit)])


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


@router.get("/meta", response_model=Envelope[MetaResponse])
async def meta(request: Request, client: NBAClientDep) -> Envelope[MetaResponse]:
    payload = await client.get_meta()
    return success(request, payload)


@router.get("/news", response_model=Envelope[list[NewsArticle]])
async def news(
    request: Request,
    client: NewsClientDep,
) -> Envelope[list[NewsArticle]]:
    articles, cache_meta = await client.get_latest()
    return success(request, articles, cache=cache_meta)


@router.get("/teams", response_model=Envelope[list[Team]])
async def teams(
    request: Request,
    client: NBAClientDep,
    season: str = Query(..., description="Season like 2024-25"),
) -> Envelope[list[Team]]:
    validate_season(season)
    result = await client.get_teams(season)
    return success(request, result.data, cache=result.cache)


@router.get("/league_standings", response_model=Envelope[list[LeagueStanding]])
async def league_standings(
    request: Request,
    client: NBAClientDep,
    season: str = Query(..., description="Season like 2024-25"),
    league_id: str = Query("00"),
    season_type: str = Query("Regular Season"),
) -> Envelope[list[LeagueStanding]]:
    validate_season(season)
    result = await client.get_league_standings(league_id, season, season_type)
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
    return success(request, players, cache=cache_meta, pagination=pagination_meta)


@router.get("/games", response_model=Envelope[list[Game | TeamGameRow]])
async def games(
    request: Request,
    client: NBAClientDep,
    settings: SettingsDep,
    season: str = Query(...),
    team_id: int | None = Query(None),
    team_abbr: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    per_team: bool = Query(False),
) -> Envelope[list[Game | TeamGameRow]]:
    page_size = min(page_size, settings.pagination_max_page_size)
    start = parse_date(date_from, "date_from")
    end = parse_date(date_to, "date_to")
    validate_date_range(start, end)
    result = await client.get_games(season, team_id, team_abbr, start, end, per_team=per_team)
    data = result.data
    if not per_team:
        paged, pagination = paginate(data, page, page_size)
        pagination_meta = _apply_pagination_links(request, pagination.model_dump())
        return success(request, paged, cache=result.cache, pagination=pagination_meta)
    paged, pagination = paginate(data, page, page_size)
    pagination_meta = _apply_pagination_links(request, pagination.model_dump())
    return success(request, paged, cache=result.cache, pagination=pagination_meta)


@router.get("/players/{player_id}/gamelog", response_model=Envelope[list[PlayerGameLog]])
async def player_gamelog(
    request: Request,
    client: NBAClientDep,
    player_id: int,
    season: str = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
) -> Envelope[list[PlayerGameLog]]:
    start = parse_date(date_from, "date_from")
    end = parse_date(date_to, "date_to")
    validate_date_range(start, end)
    result = await client.get_player_gamelog(player_id, season, start, end)
    return success(request, result.data, cache=result.cache)


@router.get("/players/{player_id}/career", response_model=Envelope[list[PlayerCareerStatsRow]])
async def player_career(
    request: Request,
    client: NBAClientDep,
    player_id: int,
) -> Envelope[list[PlayerCareerStatsRow]]:
    result = await client.get_player_career_stats(player_id)
    return success(request, result.data, cache=result.cache)


@router.get("/players/{player_id}/awards", response_model=Envelope[list[PlayerAward]])
async def player_awards(
    request: Request,
    client: NBAClientDep,
    player_id: int,
) -> Envelope[list[PlayerAward]]:
    result = await client.get_player_awards(player_id)
    return success(request, result.data, cache=result.cache)


@router.get("/games/{game_id}/boxscore", response_model=Envelope[list[BoxScoreLine]])
async def game_boxscore(
    request: Request,
    client: NBAClientDep,
    game_id: str,
    kind: Literal["traditional", "advanced", "four_factors"] = Query("traditional"),
) -> Envelope[list[BoxScoreLine]]:
    result = await client.get_boxscore(game_id, kind)
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
    return success(request, result.data, cache=result.cache)


@router.get("/teams/{team_id}/details", response_model=Envelope[TeamDetail])
async def team_details(
    request: Request,
    client: NBAClientDep,
    team_id: int,
) -> Envelope[TeamDetail]:
    result = await client.get_team_details(team_id)
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
    measure: Literal["Base", "Advanced", "Misc", "Scoring", "Usage"] = Query("Base"),
    per_mode: Literal["PerGame", "Totals"] = Query("PerGame"),
    team_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> Envelope[list[PlayerStatsRow]]:
    page_size = min(page_size, settings.pagination_max_page_size)
    stats, cache_meta, pagination = await client.get_player_stats(
        season, measure, per_mode, team_id, page, page_size
    )
    pagination_meta = _apply_pagination_links(request, pagination)
    return success(request, stats, cache=cache_meta, pagination=pagination_meta)


@router.get("/resolve", response_model=Envelope[ResolveResult])
async def resolve(
    request: Request,
    client: NBAClientDep,
    player: str | None = Query(None),
    team: str | None = Query(None),
) -> Envelope[ResolveResult]:
    result = await client.resolve(player, team)
    return success(request, result)
