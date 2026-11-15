from types import SimpleNamespace

import httpx
import pytest

from app.api import routes
from app.config import Settings, get_settings
from app.dependencies import (
    get_cache_backend,
    get_database_client,
    get_nba_client,
    get_rate_limiter,
    get_service_rate_limiter,
    get_settings_dependency,
)
from app.main import app
from app.rate_limit import RateLimiter


@pytest.fixture
def budgets(monkeypatch):
    visitor = RateLimiter(requests_per_minute=2, namespace="visitor")
    service = RateLimiter(requests_per_minute=4, namespace="service")

    async def meta():
        return {
            "service": "fixture",
            "version": "1",
            "last_cache_refresh": {},
            "supported_seasons": ["2025-26"],
        }

    monkeypatch.setitem(
        app.dependency_overrides, get_settings, lambda: Settings(_env_file=None, api_key="test-key")
    )
    monkeypatch.setitem(app.dependency_overrides, get_rate_limiter, lambda: visitor)
    monkeypatch.setitem(app.dependency_overrides, get_service_rate_limiter, lambda: service)
    monkeypatch.setitem(
        app.dependency_overrides, get_nba_client, lambda: SimpleNamespace(get_meta=meta)
    )
    return visitor, service


@pytest.mark.asyncio
async def test_visitors_have_separate_budgets_and_retry_after(budgets):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        first = {"x-api-key": "test-key", "x-shai-visitor-id": "a" * 64}
        second = {"x-api-key": "test-key", "x-shai-visitor-id": "b" * 64}
        assert (await client.get("/v1/meta", headers=first)).status_code == 200
        assert (await client.get("/v1/meta", headers=first)).status_code == 200
        response = await client.get("/v1/meta", headers=first)
        assert response.status_code == 429
        assert response.json()["error"]["code"] == "RATE_LIMIT_EXCEEDED"
        assert 1 <= int(response.headers["Retry-After"]) <= 60
        assert (await client.get("/v1/meta", headers=second)).status_code == 200


@pytest.mark.asyncio
async def test_service_capacity_is_shared_across_visitors(budgets):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for value in "abcd":
            response = await client.get(
                "/v1/meta", headers={"x-api-key": "test-key", "x-shai-visitor-id": value * 64}
            )
            assert response.status_code == 200
        response = await client.get(
            "/v1/meta", headers={"x-api-key": "test-key", "x-shai-visitor-id": "e" * 64}
        )
        assert response.status_code == 429


@pytest.mark.asyncio
async def test_unauthenticated_headers_do_not_create_visitor_buckets(budgets):
    visitor, service = budgets
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/v1/meta", headers={"x-shai-visitor-id": "a" * 64})
    assert response.status_code == 401
    assert visitor._hits == service._hits == {}


@pytest.mark.asyncio
async def test_forwarded_ip_and_malformed_identity_cannot_rotate_direct_peer_budget(budgets):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for index in range(3):
            response = await client.get(
                "/v1/meta",
                headers={
                    "x-api-key": "test-key",
                    "x-forwarded-for": f"192.0.2.{index}",
                    "x-shai-visitor-id": f"forged-{index}",
                },
            )
            assert response.status_code == (200 if index < 2 else 429)


@pytest.mark.asyncio
async def test_production_boxscore_survives_redis_outage(monkeypatch, budgets):
    class BrokenCache:
        async def get(self, _key):
            raise RuntimeError("cache unavailable")

        async def get_stale(self, _key):
            raise RuntimeError("cache unavailable")

        async def set(self, *_args):
            raise RuntimeError("cache unavailable")

    class BrokenRedis:
        async def set(self, *_args, **_kwargs):
            raise RuntimeError("lock unavailable")

    settings = Settings(
        _env_file=None,
        environment="production",
        api_key="a" * 32,
        database_url="postgresql://db/app",
    )

    async def snapshot(_database, game_id):
        return {
            "game_id": game_id,
            "status": "Final",
            "observed_at": "2026-01-15T18:30:00Z",
            "home_team": {"team_id": 10, "score": 110, "is_home": True, "leaders": []},
            "away_team": {"team_id": 20, "score": 102, "is_home": False, "leaders": []},
            "traditional_players": [],
            "advanced_players": [],
            "line_score": [],
            "team_totals": [],
            "officials": [],
        }

    monkeypatch.setattr(routes, "fetch_boxscore", snapshot)
    monkeypatch.setattr(app.state, "redis", BrokenRedis(), raising=False)
    monkeypatch.setitem(app.dependency_overrides, get_settings_dependency, lambda: settings)
    monkeypatch.setitem(app.dependency_overrides, get_cache_backend, lambda: BrokenCache())
    monkeypatch.setitem(app.dependency_overrides, get_database_client, lambda: object())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/v1/boxscores/001", headers={"x-api-key": "test-key"})
    assert response.status_code == 200
    assert response.json()["data"]["home_team"]["score"] == 110
    assert response.json()["meta"]["as_of"] == "2026-01-15T18:30:00Z"
    assert response.json()["meta"]["source"] == "database"
