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


class PlayerBio(BaseModel):
    height: str | None = None
    weight: int | None = None
    draft_year: int | None = None
    draft_pick: str | None = None
    college: str | None = None
    country: str | None = None


class Game(BaseModel):
    game_id: str
    date: date
    start_time: datetime | None = None
    home_team_id: int
    home_team_name: str
    home_team_score: int
    away_team_id: int
    away_team_name: str
    away_team_score: int
    season: str
    location: str | None = None
    status: str | None = None


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
    field_goals_made: float | None = None
    field_goals_attempted: float | None = None
    three_point_made: float | None = None
    three_point_attempted: float | None = None
    field_goal_pct: float | None = None
    three_point_pct: float | None = None


class BoxScoreTeamLeader(BaseModel):
    player_id: int
    player_name: str
    points: float | None = None
    rebounds: float | None = None
    assists: float | None = None
    stat_line: str | None = None


class BoxScoreTeamInfo(BaseModel):
    team_id: int
    team_name: str | None = None
    team_city: str | None = None
    team_abbreviation: str | None = None
    score: int = 0
    record: str | None = None
    is_home: bool = False
    leaders: list[BoxScoreTeamLeader] = Field(default_factory=list)


class BoxScorePeriodScore(BaseModel):
    label: str
    home: int = 0
    away: int = 0


class BoxScoreTeamTotals(BaseModel):
    team_id: int
    team_name: str | None = None
    team_abbreviation: str | None = None
    minutes: str | None = None
    field_goals_made: float | None = None
    field_goals_attempted: float | None = None
    field_goal_pct: float | None = None
    three_point_made: float | None = None
    three_point_attempted: float | None = None
    three_point_pct: float | None = None
    free_throws_made: float | None = None
    free_throws_attempted: float | None = None
    free_throw_pct: float | None = None
    offensive_rebounds: float | None = None
    defensive_rebounds: float | None = None
    rebounds: float | None = None
    assists: float | None = None
    steals: float | None = None
    blocks: float | None = None
    turnovers: float | None = None
    fouls: float | None = None
    points: float | None = None
    plus_minus: float | None = None


class BoxScoreStarterBenchTotals(BaseModel):
    team_id: int
    team_name: str | None = None
    team_abbreviation: str | None = None
    label: str
    minutes: str | None = None
    field_goals_made: float | None = None
    field_goals_attempted: float | None = None
    field_goal_pct: float | None = None
    three_point_made: float | None = None
    three_point_attempted: float | None = None
    three_point_pct: float | None = None
    free_throws_made: float | None = None
    free_throws_attempted: float | None = None
    free_throw_pct: float | None = None
    offensive_rebounds: float | None = None
    defensive_rebounds: float | None = None
    rebounds: float | None = None
    assists: float | None = None
    steals: float | None = None
    blocks: float | None = None
    turnovers: float | None = None
    fouls: float | None = None
    points: float | None = None


class BoxScoreTraditionalPlayer(BaseModel):
    player_id: int
    player_name: str
    team_id: int
    team_abbreviation: str
    team_city: str | None = None
    start_position: str | None = None
    comment: str | None = None
    minutes: str | None = None
    field_goals_made: float | None = None
    field_goals_attempted: float | None = None
    field_goal_pct: float | None = None
    three_point_made: float | None = None
    three_point_attempted: float | None = None
    three_point_pct: float | None = None
    free_throws_made: float | None = None
    free_throws_attempted: float | None = None
    free_throw_pct: float | None = None
    offensive_rebounds: float | None = None
    defensive_rebounds: float | None = None
    rebounds: float | None = None
    assists: float | None = None
    steals: float | None = None
    blocks: float | None = None
    turnovers: float | None = None
    fouls: float | None = None
    points: float | None = None
    plus_minus: float | None = None


class BoxScoreAdvancedPlayer(BaseModel):
    player_id: int
    player_name: str
    team_id: int
    team_abbreviation: str
    minutes: str | None = None
    offensive_rating: float | None = None
    defensive_rating: float | None = None
    net_rating: float | None = None
    usage_pct: float | None = None
    true_shooting_pct: float | None = None
    effective_fg_pct: float | None = None
    assist_pct: float | None = None
    assist_to_turnover: float | None = None
    rebound_pct: float | None = None
    offensive_rebound_pct: float | None = None
    defensive_rebound_pct: float | None = None
    pace: float | None = None
    pace_per40: float | None = None
    possessions: float | None = None
    pie: float | None = None


class BoxScoreGame(BaseModel):
    game_id: str
    status: str | None = None
    game_date: datetime | None = None
    start_time: datetime | None = None
    arena: str | None = None
    attendance: int | None = None
    summary: str | None = None
    officials: list[str] = Field(default_factory=list)
    home_team: BoxScoreTeamInfo
    away_team: BoxScoreTeamInfo
    line_score: list[BoxScorePeriodScore] = Field(default_factory=list)
    team_totals: list[BoxScoreTeamTotals] = Field(default_factory=list)
    starter_bench: list[BoxScoreStarterBenchTotals] = Field(default_factory=list)
    traditional_players: list[BoxScoreTraditionalPlayer] = Field(default_factory=list)
    advanced_players: list[BoxScoreAdvancedPlayer] = Field(default_factory=list)


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
    true_shooting_pct: float | None = None


class PlayerAward(BaseModel):
    season: str
    description: str
    team: str | None = None
    conference: str | None = None
    award_type: str | None = None
    subtype1: str | None = None
    subtype2: str | None = None
    subtype3: str | None = None
    month: str | None = None
    week: str | None = None
    all_nba_team_number: int | None = None


class TeamDetail(BaseModel):
    team_id: int
    abbreviation: str | None = None
    nickname: str | None = None
    city: str | None = None
    year_founded: int | None = None
    arena: str | None = None
    arena_capacity: int | None = None
    owner: str | None = None
    general_manager: str | None = None
    head_coach: str | None = None
    dleague_affiliation: str | None = None
    championships: list[str]
    conference_titles: list[str]
    division_titles: list[str]
    hall_of_famers: list[str]
    retired_numbers: list[str]
    social_sites: dict[str, str]


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
