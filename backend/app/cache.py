"""Caching utilities with Redis + in-memory fallback."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Awaitable
from dataclasses import dataclass
from typing import Any, Protocol, cast

from fastapi.encoders import jsonable_encoder

try:
    from redis import asyncio as redis_asyncio
except Exception:  # pragma: no cover - redis is an optional dependency during tests
    redis_asyncio = None  # type: ignore[assignment]

from .config import Settings


class CacheBackend(Protocol):
    """Protocol describing cache operations."""

    async def get(self, key: str) -> Any | None: ...

    async def set(self, key: str, value: Any, ttl: int) -> None: ...

    async def get_stale(self, key: str) -> Any | None: ...

    async def delete(self, key: str) -> None: ...

    async def close(self) -> None: ...


@dataclass
class CacheResult:
    """Represents a cache lookup outcome."""

    hit: bool
    stale: bool


class RedisCacheBackend:
    """Redis wrapper implementing the CacheBackend protocol."""

    def __init__(self, client: redis_asyncio.Redis, settings: Settings):
        self.client = client
        self.settings = settings

    async def get(self, key: str) -> Any | None:
        raw = await self.client.get(key)
        return json.loads(raw) if raw else None

    async def set(self, key: str, value: Any, ttl: int) -> None:
        payload = json.dumps(jsonable_encoder(value), default=str)
        await self.client.set(key, payload, ex=ttl)
        # keep a stale copy for graceful degradation
        stale_ttl = max(ttl, self.settings.cache_stale_ttl_seconds)
        await self.client.set(f"{key}:stale", payload, ex=stale_ttl)

    async def get_stale(self, key: str) -> Any | None:
        raw = await self.client.get(f"{key}:stale")
        return json.loads(raw) if raw else None

    async def delete(self, key: str) -> None:
        await self.client.delete(key)
        await self.client.delete(f"{key}:stale")

    async def close(self) -> None:
        await self.client.close()


class InMemoryCacheBackend:
    """Simple asyncio-safe in-process cache."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self._data: dict[str, tuple[Any, float]] = {}
        self._stale: dict[str, tuple[Any, float]] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Any | None:
        async with self._lock:
            value, expires_at = self._data.get(key, (None, 0.0))
            if value is None:
                return None
            if expires_at < time.time():
                self._data.pop(key, None)
                return None
            return value

    async def set(self, key: str, value: Any, ttl: int) -> None:
        expires_at = time.time() + ttl
        stale_expires = time.time() + max(ttl, self.settings.cache_stale_ttl_seconds)
        async with self._lock:
            self._data[key] = (jsonable_encoder(value), expires_at)
            self._stale[key] = (jsonable_encoder(value), stale_expires)

    async def get_stale(self, key: str) -> Any | None:
        async with self._lock:
            value, expires_at = self._stale.get(key, (None, 0.0))
            if value is None:
                return None
            if expires_at < time.time():
                self._stale.pop(key, None)
                return None
            return value

    async def delete(self, key: str) -> None:
        async with self._lock:
            self._data.pop(key, None)
            self._stale.pop(key, None)

    async def close(self) -> None:  # pragma: no cover - nothing to close
        self._data.clear()
        self._stale.clear()


async def init_cache(settings: Settings) -> tuple[CacheBackend, Any | None]:
    """Instantiate the preferred cache backend."""

    if redis_asyncio is not None:
        try:
            client_raw = redis_asyncio.from_url(  # type: ignore[no-untyped-call]
                settings.redis_url, encoding="utf-8", decode_responses=False
            )
            redis_client = cast("redis_asyncio.Redis", client_raw)
            await cast(Awaitable[Any], redis_client.ping())
            return RedisCacheBackend(redis_client, settings), redis_client
        except Exception:
            pass
    return InMemoryCacheBackend(settings), None
