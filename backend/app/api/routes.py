"""Versioned API routes."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request

from ..auth import require_api_key
from ..config import Settings
from ..dependencies import get_nba_client, get_rate_limiter, get_settings_dependency
from ..rate_limit import RateLimiter
from ..schemas import (
    BoxScoreLine,
    Envelope,
    Game,
    MetaResponse,
    PaginationMeta,
    Player,
    PlayerCareerStatsRow,
    PlayerGameLog,
    PlayerStatsRow,
    ResolveResult,
    ShotLocation,
    Team,
    TeamGameRow,
    TeamStatsRow,
)
from ..services.nba import NBAStatsClient
from ..utils import paginate, parse_date, validate_date_range, validate_season
from .responses import success


async def authenticate_and_rate_limit(
    request: Request,
    rate_limiter: RateLimiter = Depends(get_rate_limiter),
    api_key: str = Depends(require_api_key),
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
        pagination_data["next_url"] = str(request.url.include_query_params(page=pagination_data["next"]))
    if pagination_data.get("prev"):
        pagination_data["prev_url"] = str(request.url.include_query_params(page=pagination_data["prev"]))
    return PaginationMeta(**pagination_data)


@router.get("/meta", response_model=Envelope[MetaResponse])
async def meta(request: Request, client: NBAStatsClient = Depends(get_nba_client)) -> Envelope[MetaResponse]:
    payload = await client.get_meta()
    return success(request, payload)


@router.get("/teams", response_model=Envelope[list[Team]])
async def teams(
    request: Request,
    season: str = Query(..., description="Season like 2024-25"),
    client: NBAStatsClient = Depends(get_nba_client),
) -> Envelope[list[Team]]:
    validate_season(season)
    result = await client.get_teams(season)
    return success(request, result.data, cache=result.cache)


@router.get("/players", response_model=Envelope[list[Player]])
async def players(
    request: Request,
    season: str = Query(...),
    search: str | None = Query(None, description="Case-insensitive substring filter"),
    active: bool | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    client: NBAStatsClient = Depends(get_nba_client),
    settings: Settings = Depends(get_settings_dependency),
) -> Envelope[list[Player]]:
    page_size = min(page_size, settings.pagination_max_page_size)
    players, cache_meta, pagination = await client.get_players(season, active, search, page, page_size)
    pagination_meta = _apply_pagination_links(request, pagination)
    return success(request, players, cache=cache_meta, pagination=pagination_meta)


@router.get("/games", response_model=Envelope[list[Game | TeamGameRow]])
async def games(
    request: Request,
    season: str = Query(...),
    team_id: int | None = Query(None),
    team_abbr: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    per_team: bool = Query(False),
    client: NBAStatsClient = Depends(get_nba_client),
    settings: Settings = Depends(get_settings_dependency),
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
    player_id: int,
    season: str = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    client: NBAStatsClient = Depends(get_nba_client),
) -> Envelope[list[PlayerGameLog]]:
    start = parse_date(date_from, "date_from")
    end = parse_date(date_to, "date_to")
    validate_date_range(start, end)
    result = await client.get_player_gamelog(player_id, season, start, end)
    return success(request, result.data, cache=result.cache)


@router.get("/players/{player_id}/career", response_model=Envelope[list[PlayerCareerStatsRow]])
async def player_career(
    request: Request,
    player_id: int,
    client: NBAStatsClient = Depends(get_nba_client),
) -> Envelope[list[PlayerCareerStatsRow]]:
    result = await client.get_player_career_stats(player_id)
    return success(request, result.data, cache=result.cache)


@router.get("/games/{game_id}/boxscore", response_model=Envelope[list[BoxScoreLine]])
async def game_boxscore(
    request: Request,
    game_id: str,
    kind: Literal["traditional", "advanced", "four_factors"] = Query("traditional"),
    client: NBAStatsClient = Depends(get_nba_client),
) -> Envelope[list[BoxScoreLine]]:
    result = await client.get_boxscore(game_id, kind)
    return success(request, result.data, cache=result.cache)


@router.get("/players/{player_id}/shots", response_model=Envelope[list[ShotLocation]])
async def player_shots(
    request: Request,
    player_id: int,
    season: str = Query(...),
    team_id: int | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    client: NBAStatsClient = Depends(get_nba_client),
) -> Envelope[list[ShotLocation]]:
    start = parse_date(date_from, "date_from")
    end = parse_date(date_to, "date_to")
    validate_date_range(start, end)
    result = await client.get_shots(player_id, season, team_id, start, end)
    return success(request, result.data, cache=result.cache)


@router.get("/teams/{team_id}/stats", response_model=Envelope[list[TeamStatsRow]])
async def team_stats(
    request: Request,
    team_id: int,
    season: str = Query(...),
    measure: Literal["Base", "Advanced", "FourFactors"] = Query("Base"),
    per_mode: Literal["PerGame", "Totals"] = Query("PerGame"),
    client: NBAStatsClient = Depends(get_nba_client),
) -> Envelope[list[TeamStatsRow]]:
    result = await client.get_team_stats(season, measure, per_mode)
    filtered = [row for row in result.data if row.team_id == team_id]
    return success(request, filtered, cache=result.cache)


@router.get("/players/stats", response_model=Envelope[list[PlayerStatsRow]])
async def player_stats(
    request: Request,
    season: str = Query(...),
    measure: Literal["Base", "Advanced", "Misc", "Scoring", "Usage"] = Query("Base"),
    per_mode: Literal["PerGame", "Totals"] = Query("PerGame"),
    team_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    client: NBAStatsClient = Depends(get_nba_client),
    settings: Settings = Depends(get_settings_dependency),
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
    player: str | None = Query(None),
    team: str | None = Query(None),
    client: NBAStatsClient = Depends(get_nba_client),
) -> Envelope[ResolveResult]:
    result = await client.resolve(player, team)
    return success(request, result)
