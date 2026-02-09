import pytest

from app.cache import InMemoryCacheBackend
from app.config import Settings
from app.resolvers import NameResolver
from app.schemas import CacheMeta
from app.services.nba import NBAStatsClient


@pytest.mark.asyncio
async def test_get_team_history_sorts_descending(monkeypatch):
    settings = Settings()
    cache = InMemoryCacheBackend(settings)
    resolver = NameResolver(cache)
    client = NBAStatsClient(settings, cache, resolver)

    sample = [
        {
            "TEAM_ID": 1610612747,
            "TEAM_CITY": "Los Angeles",
            "TEAM_NAME": "Lakers",
            "YEAR": "2021-22",
            "GP": 82,
            "WINS": 33,
            "LOSSES": 49,
            "WIN_PCT": 0.402,
            "CONF_RANK": 11,
            "DIV_RANK": 4,
            "PO_WINS": 0,
            "PO_LOSSES": 0,
            "NBA_FINALS_APPEARANCE": "",
            "PTS": 9200,
            "FG_PCT": 0.469,
            "FG3_PCT": 0.347,
        },
        {
            "TEAM_ID": 1610612747,
            "TEAM_CITY": "Los Angeles",
            "TEAM_NAME": "Lakers",
            "YEAR": "2023-24",
            "GP": 82,
            "WINS": 47,
            "LOSSES": 35,
            "WIN_PCT": 0.573,
            "CONF_RANK": 8,
            "DIV_RANK": 3,
            "PO_WINS": 1,
            "PO_LOSSES": 4,
            "NBA_FINALS_APPEARANCE": "N/A",
            "PTS": 9558,
            "FG_PCT": 0.499,
            "FG3_PCT": 0.377,
        },
    ]

    async def fake_cached_call(key, ttl, fetcher):
        return sample, CacheMeta(hit=True, stale=False)

    monkeypatch.setattr(client, "_cached_call", fake_cached_call)
    result = await client.get_team_history(1610612747, "Regular Season", "Totals")

    assert len(result.data) == 2
    assert result.data[0].season == "2023-24"
    assert result.data[1].season == "2021-22"
    assert result.data[0].conference_rank == 8
    assert result.data[0].finals_result is None


@pytest.mark.asyncio
async def test_get_league_leaders_respects_limit(monkeypatch):
    settings = Settings()
    cache = InMemoryCacheBackend(settings)
    resolver = NameResolver(cache)
    client = NBAStatsClient(settings, cache, resolver)

    sample = [
        {
            "PLAYER_ID": 2,
            "RANK": 2,
            "PLAYER": "Player B",
            "TEAM_ID": 1610612744,
            "TEAM": "GSW",
            "GP": 79,
            "MIN": 34.5,
            "PTS": 28.0,
            "REB": 6.2,
            "AST": 5.5,
            "STL": 1.2,
            "BLK": 0.4,
            "TOV": 2.8,
            "EFF": 25.0,
        },
        {
            "PLAYER_ID": 1,
            "RANK": 1,
            "PLAYER": "Player A",
            "TEAM_ID": 1610612747,
            "TEAM": "LAL",
            "GP": 80,
            "MIN": 35.2,
            "PTS": 30.1,
            "REB": 7.0,
            "AST": 6.1,
            "STL": 1.5,
            "BLK": 0.6,
            "TOV": 3.1,
            "EFF": 27.2,
        },
    ]

    async def fake_cached_call(key, ttl, fetcher):
        return sample, CacheMeta(hit=True, stale=False)

    monkeypatch.setattr(client, "_cached_call", fake_cached_call)
    result = await client.get_league_leaders(
        season="2024-25",
        season_type="Regular Season",
        per_mode="PerGame",
        stat_category="PTS",
        limit=1,
    )

    assert len(result.data) == 1
    assert result.data[0].rank == 1
    assert result.data[0].player_name == "Player A"
    assert result.data[0].stat_value == pytest.approx(30.1)
    assert result.data[0].stat_category == "PTS"
