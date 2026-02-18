
from datetime import date, datetime

import pytest

from app.cache import InMemoryCacheBackend
from app.config import Settings
from app.resolvers import NameResolver
from app.schemas import CacheMeta
from app.services.nba import NBAStatsClient, ServiceResult


def _client():
    settings = Settings()
    cache = InMemoryCacheBackend(settings)
    resolver = NameResolver(cache)
    return NBAStatsClient(settings, cache, resolver)


def test_dedupe_games_merges_home_away():
    client = _client()
    rows = [
        {
            "GAME_ID": "001",
            "GAME_DATE": "2024-10-10",
            "TEAM_ID": 1,
            "TEAM_NAME": "LAL",
            "MATCHUP": "LAL vs. BOS",
            "PTS": 110,
            "SEASON_ID": "2024",
            "WL": "W",
        },
        {
            "GAME_ID": "001",
            "GAME_DATE": "2024-10-10",
            "TEAM_ID": 2,
            "TEAM_NAME": "BOS",
            "MATCHUP": "LAL vs. BOS",
            "PTS": 100,
            "SEASON_ID": "2024",
            "WL": "L",
        },
    ]
    deduped = client._dedupe_games(rows)
    assert deduped[0]["home_team_id"] == 1
    assert deduped[0]["away_team_id"] == 2


@pytest.mark.asyncio
async def test_get_games_falls_back_to_scoreboard_for_today(monkeypatch):
    client = _client()
    today = date.today()
    fallback_game = {
        "game_id": "0022500775",
        "date": today,
        "start_time": datetime(today.year, today.month, today.day, 19, 0),
        "home_team_id": 1610612766,
        "home_team_name": "Hornets",
        "home_team_abbreviation": "CHA",
        "home_team_score": 0,
        "away_team_id": 1610612737,
        "away_team_name": "Hawks",
        "away_team_abbreviation": "ATL",
        "away_team_score": 0,
        "season": "2025-26",
        "status": "Scheduled",
    }

    async def fake_cached_call(key, ttl, fetcher):
        return [], CacheMeta(hit=False, stale=False)

    async def fake_scoreboard_games(game_date, season=None):
        assert game_date == today
        assert season == "2025-26"
        return ServiceResult([fallback_game], CacheMeta(hit=False, stale=False))

    monkeypatch.setattr(client, "_cached_call", fake_cached_call)
    monkeypatch.setattr(client, "get_scoreboard_games", fake_scoreboard_games)

    result = await client.get_games(
        season="2025-26",
        team_id=None,
        team_abbr=None,
        date_from=today,
        date_to=today,
        per_team=False,
    )

    assert len(result.data) == 1
    assert result.data[0].game_id == "0022500775"
    assert result.data[0].status == "Scheduled"


@pytest.mark.asyncio
async def test_get_games_prefers_scoreboard_for_single_day_current_season(monkeypatch):
    client = _client()
    game_date = date(2026, 2, 11)
    scoreboard_game = {
        "game_id": "0022500776",
        "date": game_date,
        "start_time": datetime(game_date.year, game_date.month, game_date.day, 19, 0),
        "home_team_id": 1610612739,
        "home_team_name": "Cavaliers",
        "home_team_abbreviation": "CLE",
        "home_team_score": 0,
        "away_team_id": 1610612764,
        "away_team_name": "Wizards",
        "away_team_abbreviation": "WAS",
        "away_team_score": 0,
        "season": "2025-26",
        "status": "Scheduled",
    }

    async def fake_cached_call(key, ttl, fetcher):
        raise AssertionError("leaguegamefinder should not be called for single-day current season")

    async def fake_scoreboard_games(date_value, season=None):
        assert date_value == game_date
        assert season == "2025-26"
        return ServiceResult([scoreboard_game], CacheMeta(hit=False, stale=False))

    monkeypatch.setattr(client, "_season_for_date", lambda _: "2025-26")
    monkeypatch.setattr(client, "_cached_call", fake_cached_call)
    monkeypatch.setattr(client, "get_scoreboard_games", fake_scoreboard_games)

    result = await client.get_games(
        season="2025-26",
        team_id=None,
        team_abbr=None,
        date_from=game_date,
        date_to=game_date,
        per_team=False,
    )

    assert len(result.data) == 1
    assert result.data[0].game_id == "0022500776"


def test_parse_scoreboard_tipoff_parses_eastern_clock():
    client = _client()
    parsed = client._parse_scoreboard_tipoff(date(2026, 2, 11), "7:30 pm ET")

    assert parsed is not None
    assert parsed.hour == 19
    assert parsed.minute == 30
