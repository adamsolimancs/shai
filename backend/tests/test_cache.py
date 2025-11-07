import asyncio

import pytest

from app.cache import InMemoryCacheBackend
from app.config import Settings


@pytest.mark.asyncio
async def test_inmemory_cache_set_get_stale():
    cache = InMemoryCacheBackend(Settings())
    await cache.set("foo", {"bar": 1}, ttl=1)
    assert await cache.get("foo") == {"bar": 1}
    await asyncio.sleep(1.1)
    assert await cache.get("foo") is None
    assert await cache.get_stale("foo") == {"bar": 1}
