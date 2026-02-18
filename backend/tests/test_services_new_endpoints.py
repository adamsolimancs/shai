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


def _client() -> NBAStatsClient:
    settings = Settings()
    cache = InMemoryCacheBackend(settings)
    resolver = NameResolver(cache)
    return NBAStatsClient(settings, cache, resolver)


def test_normalize_advanced_player_supports_estimated_v3_keys():
    client = _client()
    normalized = client._normalize_advanced_player(
        {
            "personId": 201939,
            "nameI": "S.Curry",
            "teamId": 1610612744,
            "teamTricode": "GSW",
            "minutes": "34:10",
            "estimatedOffensiveRating": 123.4,
            "estimatedDefensiveRating": 109.2,
            "estimatedNetRating": 14.2,
            "estimatedUsagePercentage": 0.31,
            "trueShootingPercentage": 0.663,
            "effectiveFieldGoalPercentage": 0.602,
            "assistPercentage": 0.321,
            "reboundPercentage": 0.104,
            "estimatedPace": 101.5,
            "pacePer40": 84.7,
            "possessions": 68.2,
            "PIE": 0.188,
        }
    )

    assert normalized["player_id"] == 201939
    assert normalized["player_name"] == "S.Curry"
    assert normalized["team_id"] == 1610612744
    assert normalized["team_abbreviation"] == "GSW"
    assert normalized["offensive_rating"] == pytest.approx(123.4)
    assert normalized["defensive_rating"] == pytest.approx(109.2)
    assert normalized["net_rating"] == pytest.approx(14.2)
    assert normalized["usage_pct"] == pytest.approx(0.31)
    assert normalized["pace"] == pytest.approx(101.5)
    assert normalized["pie"] == pytest.approx(0.188)


def test_normalize_advanced_player_supports_estimated_v2_keys():
    client = _client()
    normalized = client._normalize_advanced_player(
        {
            "PLAYER_ID": "123",
            "PLAYER_NAME": "Sample Player",
            "TEAM_ID": "1",
            "TEAM_ABBREVIATION": "AAA",
            "MIN": "29:00",
            "E_OFF_RATING": "110.5",
            "E_DEF_RATING": "105.1",
            "E_NET_RATING": "5.4",
            "E_USG_PCT": "0.24",
            "E_PACE": "98.7",
        }
    )

    assert normalized["player_id"] == 123
    assert normalized["player_name"] == "Sample Player"
    assert normalized["team_id"] == 1
    assert normalized["team_abbreviation"] == "AAA"
    assert normalized["offensive_rating"] == pytest.approx(110.5)
    assert normalized["defensive_rating"] == pytest.approx(105.1)
    assert normalized["net_rating"] == pytest.approx(5.4)
    assert normalized["usage_pct"] == pytest.approx(0.24)
    assert normalized["pace"] == pytest.approx(98.7)


def test_normalize_player_stats_falls_back_to_alternate_name_keys():
    client = _client()
    normalized = client._normalize_player_stats(
        {
            "PLAYER_ID": 123,
            "PLAYER_NAME": "   ",
            "PLAYER": "Sample Player",
            "TEAM_ID": 1,
            "TEAM": "AAA",
            "PTS": 10.0,
            "REB": 5.0,
            "AST": 3.0,
            "MIN": 28.5,
        }
    )

    assert normalized["player_id"] == 123
    assert normalized["player_name"] == "Sample Player"
    assert normalized["team_id"] == 1
    assert normalized["team_abbreviation"] == "AAA"
    assert normalized["points"] == pytest.approx(10.0)


def test_normalize_player_stats_uses_placeholder_when_name_missing():
    client = _client()
    normalized = client._normalize_player_stats(
        {
            "PLAYER_ID": 987,
            "TEAM_ABBREVIATION": "BBB",
            "PTS": 20.0,
            "REB": 7.0,
            "AST": 4.0,
            "MIN": 33.1,
        }
    )

    assert normalized["player_id"] == 987
    assert normalized["player_name"] == "Player 987"
    assert normalized["team_abbreviation"] == "BBB"
