"""Pydantic schemas for the NBA API surface."""

from __future__ import annotations

from datetime import date, datetime
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, Field


class CacheMeta(BaseModel):
    hit: bool = False
    stale: bool = False


class PaginationMeta(BaseModel):
    total: int = 0
    page: int = 1
    page_size: int = 50
    next: int | None = None
    prev: int | None = None
    next_url: str | None = None
    prev_url: str | None = None


class ServiceMeta(BaseModel):
    request_id: str | None = None
    cache: CacheMeta | None = None
    pagination: PaginationMeta | None = None


class ErrorDetail(BaseModel):
    code: str
    message: str
    retryable: bool = False


T = TypeVar("T")


class Envelope(BaseModel, Generic[T]):
    ok: Literal[True] = True
    data: T
    meta: ServiceMeta = Field(default_factory=ServiceMeta)


class ErrorEnvelope(BaseModel):
    ok: Literal[False] = False
    error: ErrorDetail


class NewsArticle(BaseModel):
    id: str
    source: str
    title: str
    summary: str
    url: str
    published_at: datetime
    image_url: str | None = None


class Team(BaseModel):
    id: int
    abbreviation: str
    city: str
    name: str
    conference: str | None = None
    division: str | None = None


class Player(BaseModel):
    id: int
    first_name: str
    last_name: str
    full_name: str
    team_id: int | None = None
    team_abbreviation: str | None = None
    is_active: bool = True


class Game(BaseModel):
    game_id: str
    date: date
    home_team_id: int
    home_team_name: str
    home_team_score: int
    away_team_id: int
    away_team_name: str
    away_team_score: int
    season: str
    location: str | None = None


class LeagueStanding(BaseModel):
    team_id: int
    team_name: str
    team_city: str
    team_slug: str | None = None
    team_abbreviation: str | None = None
    conference: str | None = None
    conference_rank: int | None = None
    division: str | None = None
    division_rank: int | None = None
    wins: int
    losses: int
    win_pct: float
    games_back: float | None = None
    division_games_back: float | None = None
    record: str | None = None
    home_record: str | None = None
    road_record: str | None = None
    last_ten: str | None = None
    streak: str | None = None


class PlayerGameLog(BaseModel):
    game_id: str
    game_date: date
    matchup: str
    team_abbreviation: str
    minutes: float
    points: float
    rebounds: float
    assists: float
    steals: float | None = None
    blocks: float | None = None
    turnovers: float | None = None
    plus_minus: float | None = None


class BoxScoreLine(BaseModel):
    player_id: int
    player_name: str
    team_id: int
    team_abbreviation: str
    minutes: float
    points: float | None = None
    rebounds: float | None = None
    assists: float | None = None
    steals: float | None = None
    blocks: float | None = None
    turnovers: float | None = None
    fouls: float | None = None
    plus_minus: float | None = None


class ShotLocation(BaseModel):
    game_id: str
    x: float
    y: float
    zone_range: str | None = None
    zone_basic: str | None = None
    shot_made: bool
    period: int
    minutes_remaining: int
    seconds_remaining: int


class TeamStatsRow(BaseModel):
    team_id: int
    team_abbreviation: str
    team_name: str
    games_played: int
    wins: int
    losses: int
    win_pct: float
    points: float
    field_goal_pct: float
    rebounds: float
    assists: float
    steals: float | None = None
    blocks: float | None = None
    turnovers: float | None = None
    plus_minus: float | None = None


class PlayerStatsRow(BaseModel):
    player_id: int
    player_name: str
    team_id: int | None
    team_abbreviation: str | None
    points: float
    rebounds: float
    assists: float
    minutes: float | None = None


class PlayerCareerStatsRow(BaseModel):
    season_id: str
    team_id: int | None
    team_abbreviation: str | None = None
    player_age: float | None = None
    games_played: int
    games_started: int
    minutes: float
    points: float
    rebounds: float
    assists: float
    steals: float | None = None
    blocks: float | None = None
    field_goal_pct: float | None = None
    three_point_pct: float | None = None
    free_throw_pct: float | None = None


class ResolveRequest(BaseModel):
    player: str | None = None
    team: str | None = None


class ResolutionPayload(BaseModel):
    id: int | None = None
    name: str | None = None
    abbreviation: str | None = None
    confidence: float = 0.0


class ResolveResult(BaseModel):
    player: ResolutionPayload | None = None
    team: ResolutionPayload | None = None


class MetaResponse(BaseModel):
    service: str
    version: str
    supported_seasons: list[str]
    last_cache_refresh: dict[str, datetime | None]


class TeamGameRow(BaseModel):
    game_id: str
    date: date
    team_id: int
    team_abbreviation: str
    opponent_team_id: int | None = None
    matchup: str
    result: str | None = None
    points: float
