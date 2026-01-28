import pytest

from app.cache import InMemoryCacheBackend
from app.cache_helpers import get_or_set_cache
from app.config import Settings


@pytest.mark.asyncio
async def test_get_or_set_cache_hit():
    settings = Settings()
    cache = InMemoryCacheBackend(settings)
    await cache.set("key", {"value": 1}, ttl=60)

    fetcher_called = False

    async def fetcher():
        nonlocal fetcher_called
        fetcher_called = True
        return {"value": 2}

    data, meta = await get_or_set_cache(
        cache=cache,
        redis_client=None,
        key="key",
        ttl=60,
        fetcher=fetcher,
    )

    assert data == {"value": 1}
    assert meta.hit is True
    assert meta.stale is False
    assert fetcher_called is False


@pytest.mark.asyncio
async def test_get_or_set_cache_miss_sets_value():
    settings = Settings()
    cache = InMemoryCacheBackend(settings)

    async def fetcher():
        return {"value": 42}

    data, meta = await get_or_set_cache(
        cache=cache,
        redis_client=None,
        key="key",
        ttl=60,
        fetcher=fetcher,
    )

    assert data == {"value": 42}
    assert meta.hit is False
    assert meta.stale is False
    assert await cache.get("key") == {"value": 42}


@pytest.mark.asyncio
async def test_get_or_set_cache_stale_fallback():
    settings = Settings()
    cache = InMemoryCacheBackend(settings)
    await cache.set("key", {"value": "stale"}, ttl=0)

    async def fetcher():
        raise RuntimeError("boom")

    data, meta = await get_or_set_cache(
        cache=cache,
        redis_client=None,
        key="key",
        ttl=60,
        fetcher=fetcher,
    )

    assert data == {"value": "stale"}
    assert meta.hit is True
    assert meta.stale is True


@pytest.mark.asyncio
async def test_get_or_set_cache_nocache_ignores_cached_value():
    settings = Settings()
    cache = InMemoryCacheBackend(settings)
    await cache.set("key", {"value": "cached"}, ttl=60)

    async def fetcher():
        return {"value": "fresh"}

    data, meta = await get_or_set_cache(
        cache=cache,
        redis_client=None,
        key="key",
        ttl=60,
        fetcher=fetcher,
        nocache=True,
    )

    assert data == {"value": "fresh"}
    assert meta.hit is False
    assert meta.stale is False
    assert await cache.get("key") == {"value": "cached"}
