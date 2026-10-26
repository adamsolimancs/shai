from datetime import UTC, datetime
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from app.api import routes
from app.api.responses import success
from app.cache import InMemoryCacheBackend
from app.cache_helpers import ObservedData, get_or_set_cache, source_observed_at
from app.config import Settings
from app.dependencies import (
    get_cache_backend,
    get_database_client,
    get_nba_client,
    get_rate_limiter,
    get_service_rate_limiter,
    get_settings_dependency,
)
from app.rate_limit import RateLimiter
from app.schemas import CacheMeta
from app.services.store import fetch_observed_api_snapshot

OBSERVED = "2026-01-15T18:30:00+00:00"


@pytest.mark.parametrize("value", [None, "bad", "2026-01-15", "2026-01-15T18:30:00"])
def test_unknown_or_naive_source_observations_are_not_current(value):
    assert source_observed_at({"observed_at": value}) is None
    assert success(SimpleNamespace(state=SimpleNamespace()), []).meta.as_of is None


def test_oldest_observation_and_unknown_constituents():
    assert source_observed_at(
        [{"observed_at": OBSERVED}, {"observed_at": "2026-01-16T00:00:00Z"}]
    ) == datetime.fromisoformat(OBSERVED)
    assert source_observed_at([{"observed_at": OBSERVED}, {}]) is None
    assert source_observed_at([]) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("nocache", [False, True])
async def test_database_fill_does_not_advance_source_observation(nocache):
    cache = InMemoryCacheBackend(Settings(_env_file=None))

    async def fetcher():
        return {"observed_at": OBSERVED, "score": 110}

    for _ in range(2):
        data, meta = await get_or_set_cache(
            cache=cache, redis_client=None, key="game", ttl=60, fetcher=fetcher, nocache=nocache
        )
        assert data["score"] == 110
        assert meta.as_of == datetime.fromisoformat(OBSERVED)
        assert meta.stale is True


@pytest.mark.asyncio
async def test_stale_fallback_keeps_observation_and_ignores_legacy_cache_fill_time():
    cache = InMemoryCacheBackend(Settings(_env_file=None))
    await cache.set("game", {"observed_at": OBSERVED}, ttl=0)
    await cache.set("game:metadata", {"as_of": datetime.now(UTC).isoformat()}, ttl=60)

    async def failed():
        raise RuntimeError("source unavailable")

    _, meta = await get_or_set_cache(
        cache=cache, redis_client=None, key="game", ttl=60, fetcher=failed
    )
    assert meta == CacheMeta(hit=True, stale=True, as_of=datetime.fromisoformat(OBSERVED))
    await cache.set("legacy", {"score": 110}, ttl=60)
    await cache.set("legacy:metadata", {"as_of": datetime.now(UTC).isoformat()}, ttl=60)
    _, legacy_meta = await get_or_set_cache(
        cache=cache, redis_client=None, key="legacy", ttl=60, fetcher=failed
    )
    assert legacy_meta.as_of is None


@pytest.mark.asyncio
async def test_empty_snapshot_keeps_source_observation_through_cache():
    cache = InMemoryCacheBackend(Settings(_env_file=None))

    class Store:
        async def select_one(self, *_args, **_kwargs):
            return {"payload": "[]", "observed_at": OBSERVED, "updated_at": datetime.now(UTC)}

    async def fetcher():
        return await fetch_observed_api_snapshot(Store(), "snapshot")

    for _ in range(2):
        data, meta = await get_or_set_cache(
            cache=cache, redis_client=None, key="snapshot", ttl=60, fetcher=fetcher
        )
        assert data == []
        assert meta.as_of == datetime.fromisoformat(OBSERVED)
        assert meta.stale is True


@pytest.mark.asyncio
async def test_upstream_stale_flag_is_not_laundered_by_outer_cache():
    cache = InMemoryCacheBackend(Settings(_env_file=None))

    async def fetcher():
        return ObservedData({"score": 110}, None, stale=True)

    for _ in range(2):
        _, meta = await get_or_set_cache(
            cache=cache, redis_client=None, key="game", ttl=60, fetcher=fetcher
        )
        assert meta.stale is True
        assert meta.as_of is None
    assert await cache.get("game") is None


@pytest.mark.asyncio
@pytest.mark.parametrize("single_day", [False, True])
@pytest.mark.parametrize("mode", ["empty", "old", "failed", "missing"])
async def test_games_http_distinguishes_empty_stale_and_unavailable(monkeypatch, single_day, mode):
    settings = Settings(
        _env_file=None,
        environment="production",
        api_key="a" * 32,
        database_url="postgresql://localhost/test",
        allow_nba_api_in_production=False,
    )
    cache = InMemoryCacheBackend(settings)
    app = FastAPI()
    app.state.redis = None
    app.include_router(routes.router)
    app.dependency_overrides[routes.require_api_key] = lambda: "fixture-key"
    app.dependency_overrides[get_rate_limiter] = lambda: RateLimiter(requests_per_minute=1000)
    app.dependency_overrides[get_service_rate_limiter] = lambda: RateLimiter(
        requests_per_minute=1000
    )
    app.dependency_overrides[get_settings_dependency] = lambda: settings
    app.dependency_overrides[get_cache_backend] = lambda: cache
    app.dependency_overrides[get_database_client] = lambda: None if mode == "missing" else object()
    app.dependency_overrides[get_nba_client] = lambda: object()

    async def fetch_games(*_args, **_kwargs):
        if mode == "failed":
            raise RuntimeError("database unavailable")
        return (
            []
            if mode == "empty"
            else [
                {
                    "game_id": "001",
                    "date": "2026-01-15",
                    "season": "2025-26",
                    "home_team_id": 1,
                    "away_team_id": 2,
                    "home_team_name": "Lakers",
                    "away_team_name": "Celtics",
                    "home_team_score": 110,
                    "away_team_score": 102,
                    "observed_at": OBSERVED,
                }
            ]
        )

    monkeypatch.setattr(routes, "fetch_games", fetch_games)
    path = "/v1/games?season=2025-26"
    if single_day:
        path += "&date_from=2026-01-15&date_to=2026-01-15"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for _ in range(2):
            response = await client.get(path)
            if mode in {"failed", "missing"}:
                assert response.status_code == 503
            else:
                assert response.status_code == 200
                body = response.json()
                if mode == "empty":
                    assert body["data"] == []
                    assert body["meta"]["as_of"] is None
                else:
                    assert body["data"][0]["home_team_score"] == 110
                    assert body["meta"]["as_of"] == "2026-01-15T18:30:00Z"
                    assert body["meta"]["stale"] is True


@pytest.mark.asyncio
async def test_player_gamelog_keeps_upstream_stale_observation():
    settings = Settings(_env_file=None, environment="development")
    cache = InMemoryCacheBackend(settings)
    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(redis=None)),
        state=SimpleNamespace(),
        headers={},
        method="GET",
        url=SimpleNamespace(path="/v1/players/1/gamelog"),
    )

    class Client:
        async def get_player_gamelog(self, *_args):
            return SimpleNamespace(
                data=[],
                cache=CacheMeta(hit=True, stale=True, as_of=datetime.fromisoformat(OBSERVED)),
            )

    response = await routes.player_gamelog(
        request=request,
        cache=cache,
        supabase=None,
        client=Client(),
        settings=settings,
        player_id=1,
        season="2025-26",
        season_type="Regular Season",
        date_from=None,
        date_to=None,
        nocache=False,
    )
    assert response.meta.stale is True
    assert response.meta.as_of == datetime.fromisoformat(OBSERVED)
