"""Cache-first helpers with Redis-backed stampede protection."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from .cache import CacheBackend, RedisClientProtocol
from .schemas import CacheMeta

logger = logging.getLogger(__name__)


async def _acquire_lock(
    redis_client: RedisClientProtocol | None,
    key: str,
    ttl_ms: int,
) -> bool:
    if not redis_client:
        return True
    result = await redis_client.set(key, "1", nx=True, px=ttl_ms)
    return bool(result)


async def _release_lock(redis_client: RedisClientProtocol | None, key: str) -> None:
    if not redis_client:
        return
    await redis_client.delete(key)


async def get_or_set_cache(
    *,
    cache: CacheBackend,
    redis_client: RedisClientProtocol | None,
    key: str,
    ttl: int,
    fetcher: Callable[[], Awaitable[Any]],
    allow_stale: bool = True,
    nocache: bool = False,
    lock_ttl_ms: int = 2000,
) -> tuple[Any, CacheMeta]:
    start = time.perf_counter()
    if not nocache:
        cached = await cache.get(key)
        if cached is not None:
            logger.info("cache download", extra={"result": "hit"})
            return cached, CacheMeta(hit=True, stale=False)

    lock_key = f"{key}:lock"
    acquired = await _acquire_lock(redis_client, lock_key, lock_ttl_ms)
    if not acquired:
        await asyncio.sleep(0.1)
        cached = await cache.get(key)
        if cached is not None:
            logger.info("cache download", extra={"result": "hit_after_wait"})
            return cached, CacheMeta(hit=True, stale=False)

    try:
        data = await fetcher()
    except Exception:
        if allow_stale and not nocache:
            stale = await cache.get_stale(key)
            if stale is not None:
                logger.warning("cache download", extra={"result": "stale"})
                return stale, CacheMeta(hit=True, stale=True)
        raise
    finally:
        if acquired:
            await _release_lock(redis_client, lock_key)

    if not nocache:
        await cache.set(key, data, ttl)
    elapsed_ms = int((time.perf_counter() - start) * 1000)
    logger.info("cache upload", extra={"result": "miss", "latency_ms": elapsed_ms})
    return data, CacheMeta(hit=False, stale=False)
