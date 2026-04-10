import pytest

from app.cache import InMemoryCacheBackend
from app.config import Settings
from app.resolvers import NameResolver
from app.schemas import CacheMeta
from app.services.nba import NBAStatsClient


@pytest.mark.asyncio
async def test_get_players_filters(monkeypatch):
    settings = Settings()
    cache = InMemoryCacheBackend(settings)
    resolver = NameResolver(cache)
    client = NBAStatsClient(settings, cache, resolver)

    sample = [
        {
            "id": 1,
            "first_name": "Test",
            "last_name": "Player",
            "full_name": "Test Player",
            "team_id": 100,
            "team_abbreviation": "TP",
            "is_active": True,
        },
        {
            "id": 2,
            "first_name": "Bench",
            "last_name": "Guy",
            "full_name": "Bench Guy",
            "team_id": 200,
            "team_abbreviation": "BG",
            "is_active": False,
        },
    ]

    async def fake_cached_call(key, ttl, fetcher):
        return sample, CacheMeta(hit=True, stale=False)

    monkeypatch.setattr(client, "_cached_call", fake_cached_call)
    players, cache_meta, pagination = await client.get_players("2024-25", True, "test", 1, 10)
    assert len(players) == 1
    assert players[0].full_name == "Test Player"
    assert pagination["total"] == 1


@pytest.mark.asyncio
async def test_get_player_career_stats(monkeypatch):
    settings = Settings()
    cache = InMemoryCacheBackend(settings)
    resolver = NameResolver(cache)
    client = NBAStatsClient(settings, cache, resolver)

    sample = [
        {
            "SEASON_ID": "2023-24",
            "TEAM_ID": 1610612747,
            "TEAM_ABBREVIATION": "LAL",
            "PLAYER_AGE": 39,
            "GP": 70,
            "GS": 70,
            "MIN": "35.0",
            "PTS": "25.0",
            "REB": "8.0",
            "AST": "8.0",
            "STL": "1.0",
            "BLK": "0.5",
            "FG_PCT": "0.495",
            "FG3_PCT": "0.410",
            "FT_PCT": "0.750",
        }
    ]

    async def fake_cached_call(key, ttl, fetcher):
        return sample, CacheMeta(hit=True, stale=False)

    monkeypatch.setattr(client, "_cached_call", fake_cached_call)
    result = await client.get_player_career_stats(2544, "Regular Season")
    assert len(result.data) == 1
    assert result.data[0].season_id == "2023-24"
    assert result.data[0].field_goal_pct == pytest.approx(0.495)
    assert result.data[0].three_point_pct == pytest.approx(0.41)
    assert result.data[0].free_throw_pct == pytest.approx(0.75)


@pytest.mark.asyncio
async def test_get_player_bio(monkeypatch):
    settings = Settings()
    cache = InMemoryCacheBackend(settings)
    resolver = NameResolver(cache)
    client = NBAStatsClient(settings, cache, resolver)

    sample = [
        {
            "PLAYER_ID": 123,
            "PLAYER_HEIGHT": "6-6",
            "PLAYER_HEIGHT_INCHES": 78,
            "PLAYER_WEIGHT": "210",
            "COLLEGE": "Duke",
            "COUNTRY": "USA",
            "DRAFT_YEAR": "2019",
            "DRAFT_ROUND": "1",
            "DRAFT_NUMBER": "3",
        }
    ]

    async def fake_cached_call(key, ttl, fetcher):
        return sample, CacheMeta(hit=True, stale=False)

    monkeypatch.setattr(client, "_cached_call", fake_cached_call)
    result = await client.get_player_bio(123, "2024-25")
    assert result.data is not None
    assert result.data.height == "6-6"
    assert result.data.weight == 210
    assert result.data.draft_year == 2019
    assert result.data.draft_pick == "Round 1, Pick 3"
    assert result.data.college == "Duke"
    assert result.data.country == "USA"


@pytest.mark.asyncio
async def test_get_player_info(monkeypatch):
    settings = Settings()
    cache = InMemoryCacheBackend(settings)
    resolver = NameResolver(cache)
    client = NBAStatsClient(settings, cache, resolver)

    sample = [
        {
            "PERSON_ID": 2544,
            "FIRST_NAME": "LeBron",
            "LAST_NAME": "James",
            "DISPLAY_FIRST_LAST": "LeBron James",
            "BIRTHDATE": "1984-12-30T00:00:00",
            "AGE": 40,
            "SCHOOL": "St. Vincent-St. Mary HS (OH)",
            "COUNTRY": "USA",
            "SEASON_EXP": 22,
            "JERSEY": "23",
            "POSITION": "Forward",
            "ROSTERSTATUS": "Active",
            "TEAM_ID": 1610612747,
            "TEAM_NAME": "Lakers",
            "TEAM_ABBREVIATION": "LAL",
            "FROM_YEAR": 2003,
            "TO_YEAR": 2025,
        }
    ]

    async def fake_cached_call(key, ttl, fetcher):
        return sample, CacheMeta(hit=True, stale=False)

    monkeypatch.setattr(client, "_cached_call", fake_cached_call)
    result = await client.get_player_info(2544)
    assert result.data is not None
    assert result.data.player_id == 2544
    assert result.data.display_name == "LeBron James"
    assert result.data.position == "Forward"
    assert result.data.jersey == "23"
    assert result.data.age == 40
    assert result.data.team_abbreviation == "LAL"
