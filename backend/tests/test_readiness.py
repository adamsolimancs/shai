import asyncio
from types import SimpleNamespace

import httpx
import pytest

from app.cache import InMemoryCacheBackend
from app.config import Settings
from app.main import app


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "cache_mode, database_mode, expected, status",
    [
        ("ok", "ok", 200, "ok"),
        ("failed", "ok", 200, "degraded"),
        ("hung", "ok", 200, "degraded"),
        ("ok", "failed", 503, "unavailable"),
        ("ok", "hung", 503, "unavailable"),
        ("ok", "absent", 503, "unavailable"),
    ],
)
async def test_production_readiness_checks_required_database_without_exposing_errors(
    monkeypatch, cache_mode, database_mode, expected, status
):
    async def probe(mode):
        if mode == "failed":
            raise RuntimeError("postgresql://secret@example.invalid")
        if mode == "hung":
            await asyncio.Event().wait()

    async def cache_get(_key):
        await probe(cache_mode)

    async def database_check():
        await probe(database_mode)

    settings = Settings(
        _env_file=None,
        environment="production",
        api_key="a" * 32,
        database_url="postgresql://db/app",
        readiness_timeout_seconds=0.1,
    )
    monkeypatch.setattr(app.state, "settings", settings, raising=False)
    monkeypatch.setattr(app.state, "cache", SimpleNamespace(get=cache_get), raising=False)
    monkeypatch.setattr(
        app.state,
        "database",
        None if database_mode == "absent" else SimpleNamespace(check_readiness=database_check),
        raising=False,
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await asyncio.wait_for(client.get("/readiness"), 1)
        health = await client.get("/healthz")
    assert response.status_code == expected
    assert response.json()["status"] == status
    assert response.headers["Cache-Control"] == "no-store"
    assert "secret" not in response.text
    assert health.status_code == 200


@pytest.mark.asyncio
async def test_development_can_run_without_database(monkeypatch):
    async def get(_key):
        return None

    monkeypatch.setattr(app.state, "settings", Settings(_env_file=None), raising=False)
    monkeypatch.setattr(app.state, "cache", SimpleNamespace(get=get), raising=False)
    monkeypatch.setattr(app.state, "database", None, raising=False)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/readiness")
    assert response.status_code == 200
    assert response.json()["checks"]["database"] == "not_configured"


@pytest.mark.asyncio
async def test_startup_redis_failure_is_reported_as_memory_fallback(monkeypatch):
    monkeypatch.setenv("UPSTASH_REDIS_REST_URL", "https://redis.invalid")
    monkeypatch.setenv("UPSTASH_REDIS_REST_TOKEN", "fake")
    settings = Settings(
        _env_file=None,
        environment="production",
        api_key="a" * 32,
        database_url="postgresql://db/app",
    )

    async def check():
        pass

    monkeypatch.setattr(app.state, "settings", settings, raising=False)
    monkeypatch.setattr(app.state, "cache", InMemoryCacheBackend(settings), raising=False)
    monkeypatch.setattr(
        app.state, "database", SimpleNamespace(check_readiness=check), raising=False
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/readiness")
    assert response.status_code == 200
    assert response.json()["status"] == "degraded"
    assert response.json()["checks"]["cache"] == "memory_fallback"
