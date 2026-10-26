"""Cache-first helpers with Redis-backed stampede protection."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, TypeAlias

from .cache import CacheBackend, RedisClientProtocol
from .schemas import CacheMeta

logger = logging.getLogger(__name__)
CacheTTL: TypeAlias = int | Callable[[Any], int]
CACHE_METADATA_SUFFIX = ":observation:v1"


@dataclass
class ObservedData:
    data: Any
    observed_at: datetime | None
    stale: bool = False


def observation_is_stale(as_of: datetime | None, ttl: int) -> bool:
    return as_of is not None and (datetime.now(UTC) - as_of).total_seconds() > ttl


def _resolve_ttl(ttl: CacheTTL, data: Any) -> int:
    resolved = ttl(data) if callable(ttl) else ttl
    return max(1, resolved)


async def read_cache_as_of(
    cache: CacheBackend,
    key: str,
    *,
    stale: bool = False,
) -> datetime | None:
    metadata_key = f"{key}{CACHE_METADATA_SUFFIX}"
    payload = await _read_optional_cache(cache, metadata_key, stale=stale)
    return source_observed_at(payload)


async def _read_optional_cache(cache: CacheBackend, key: str, *, stale: bool = False) -> Any:
    try:
        return await (cache.get_stale(key) if stale else cache.get(key))
    except Exception:
        logger.warning("cache read unavailable; continuing to primary data source")
        return None


def source_observed_at(data: Any) -> datetime | None:
    """Oldest known source observation; never infer one from cache or request time."""
    if isinstance(data, list):
        times = [source_observed_at(row) for row in data]
        if not times or any(value is None for value in times):
            return None
        return min(value for value in times if value is not None)
    raw = data.get("observed_at") if isinstance(data, dict) else None
    try:
        value = datetime.fromisoformat(raw) if isinstance(raw, str) else raw
        return value if isinstance(value, datetime) and value.tzinfo is not None else None
    except ValueError:
        return None


async def write_cache_as_of(
    cache: CacheBackend,
    key: str,
    *,
    as_of: datetime | None,
    ttl: int,
) -> None:
    await cache.set(
        f"{key}{CACHE_METADATA_SUFFIX}",
        {"observed_at": as_of.isoformat() if as_of else None},
        ttl,
    )


async def _acquire_lock(
    redis_client: RedisClientProtocol | None,
    key: str,
    ttl_ms: int,
) -> bool:
    if not redis_client:
        return True
    try:
        result = await redis_client.set(key, "1", nx=True, px=ttl_ms)
        return bool(result)
    except Exception:
        logger.warning("cache lock unavailable; continuing without stampede protection")
        return False


async def _release_lock(redis_client: RedisClientProtocol | None, key: str) -> None:
    if not redis_client:
        return
    try:
        await redis_client.delete(key)
    except Exception:
        logger.warning("cache lock release unavailable; allowing lock to expire")


async def get_or_set_cache(
    *,
    cache: CacheBackend,
    redis_client: RedisClientProtocol | None,
    key: str,
    ttl: CacheTTL,
    fetcher: Callable[[], Awaitable[Any]],
    allow_stale: bool = True,
    nocache: bool = False,
    lock_ttl_ms: int = 2000,
) -> tuple[Any, CacheMeta]:
    start = time.perf_counter()
    if not nocache:
        cached = await _read_optional_cache(cache, key)
        if cached is not None:
            logger.info("cache download", extra={"result": "hit"})
            as_of = await read_cache_as_of(cache, key) or source_observed_at(cached)
            return cached, CacheMeta(
                hit=True,
                stale=observation_is_stale(as_of, _resolve_ttl(ttl, cached)),
                as_of=as_of,
            )

    lock_key = f"{key}:lock"
    acquired = await _acquire_lock(redis_client, lock_key, lock_ttl_ms)
    if not acquired:
        await asyncio.sleep(0.1)
        cached = await _read_optional_cache(cache, key)
        if cached is not None:
            logger.info("cache download", extra={"result": "hit_after_wait"})
            as_of = await read_cache_as_of(cache, key) or source_observed_at(cached)
            return cached, CacheMeta(
                hit=True,
                stale=observation_is_stale(as_of, _resolve_ttl(ttl, cached)),
                as_of=as_of,
            )

    try:
        data = await fetcher()
    except Exception:
        if allow_stale and not nocache:
            stale = await _read_optional_cache(cache, key, stale=True)
            if stale is not None:
                logger.warning("cache download", extra={"result": "stale"})
                return stale, CacheMeta(
                    hit=True,
                    stale=True,
                    as_of=await read_cache_as_of(cache, key, stale=True)
                    or source_observed_at(stale),
                )
        raise
    finally:
        if acquired:
            await _release_lock(redis_client, lock_key)

    source_stale = False
    if isinstance(data, ObservedData):
        as_of, source_stale, data = data.observed_at, data.stale, data.data
    else:
        as_of = source_observed_at(data)
    resolved_ttl = _resolve_ttl(ttl, data)
    if not nocache and not source_stale:
        try:
            await cache.set(key, data, resolved_ttl)
            await write_cache_as_of(cache, key, as_of=as_of, ttl=resolved_ttl)
        except Exception:
            logger.warning("cache fill unavailable; returning primary data")
    elapsed_ms = int((time.perf_counter() - start) * 1000)
    logger.info("cache upload", extra={"result": "miss", "latency_ms": elapsed_ms})
    return data, CacheMeta(
        hit=False, stale=source_stale or observation_is_stale(as_of, resolved_ttl), as_of=as_of
    )
