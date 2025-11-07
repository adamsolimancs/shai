import pytest

from app.cache import InMemoryCacheBackend
from app.config import Settings
from app.resolvers import NameResolver
from app.schemas import CacheMeta
from app.services.nba import NBAStatsClient


@pytest.mark.asyncio
async def test_get_team_stats_skips_malformed_rows(monkeypatch):
    settings = Settings()
    cache = InMemoryCacheBackend(settings)
    resolver = NameResolver(cache)
    client = NBAStatsClient(settings, cache, resolver)

    rows = [
        {
            "TEAM_ID": 1610612747,
            "TEAM_ABBREVIATION": "CLE",
            "TEAM_NAME": "Cleveland Cavaliers",
            "GP": 10,
            "W": 6,
            "L": 4,
            "W_PCT": 0.6,
            "PTS": 110.3,
            "FG_PCT": 0.5,
            "REB": 45.2,
            "AST": 25.1,
        },
        {
            # Missing TEAM_ID should be ignored instead of crashing the service
            "TEAM_NAME": "Broken Row",
        },
    ]

    async def fake_cached_call(key, ttl, fetcher):
        return rows, CacheMeta(hit=True, stale=False)

    monkeypatch.setattr(client, "_cached_call", fake_cached_call)
    result = await client.get_team_stats("2024-25", "Base", "PerGame")

    assert len(result.data) == 1
    assert result.data[0].team_id == 1610612747


@pytest.mark.asyncio
async def test_get_team_stats_handles_upstream_failure(monkeypatch):
    settings = Settings()
    cache = InMemoryCacheBackend(settings)
    resolver = NameResolver(cache)
    client = NBAStatsClient(settings, cache, resolver)

    async def failing_cached_call(key, ttl, fetcher):
        raise RuntimeError("upstream down")

    monkeypatch.setattr(client, "_cached_call", failing_cached_call)
    result = await client.get_team_stats("2024-25", "Base", "PerGame")

    assert result.data == []


@pytest.mark.asyncio
async def test_get_team_stats_skips_unsupported_season(monkeypatch):
    settings = Settings()
    cache = InMemoryCacheBackend(settings)
    resolver = NameResolver(cache)
    client = NBAStatsClient(settings, cache, resolver)

    async def should_not_run(*args, **kwargs):
        raise AssertionError("fetch should be skipped for unsupported seasons")

    monkeypatch.setattr(client, "_cached_call", should_not_run)
    monkeypatch.setattr(client, "_supported_seasons", lambda: ["2024-25"])

    result = await client.get_team_stats("2030-31", "Base", "PerGame")

    assert result.data == []
