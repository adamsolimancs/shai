"""Caching utilities with Redis + in-memory fallback."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Protocol

import httpx
from fastapi.encoders import jsonable_encoder

from .config import Settings

logger = logging.getLogger(__name__)


class CacheBackend(Protocol):
    """Protocol describing cache operations."""

    async def get(self, key: str) -> Any | None: ...

    async def set(self, key: str, value: Any, ttl: int) -> None: ...

    async def get_stale(self, key: str) -> Any | None: ...

    async def delete(self, key: str) -> None: ...

    async def close(self) -> None: ...


class RedisClientProtocol(Protocol):
    """Subset of Redis operations used by the backend."""

    async def ping(self) -> Any: ...

    async def get(self, key: str) -> str | None: ...

    async def set(
        self,
        key: str,
        value: str,
        *,
        ex: int | None = None,
        px: int | None = None,
        nx: bool = False,
    ) -> Any: ...

    async def delete(self, *keys: str) -> int | None: ...

    async def incr(self, key: str) -> int: ...

    async def expire(self, key: str, seconds: int) -> int: ...

    async def ttl(self, key: str) -> int: ...

    async def close(self) -> None: ...


@dataclass
class CacheResult:
    """Represents a cache lookup outcome."""

    hit: bool
    stale: bool


class UpstashRedisClient:
    """Minimal async Upstash REST client for Redis-compatible commands."""

    def __init__(
        self,
        *,
        url: str,
        token: str,
        timeout: float = 5.0,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._request_url = f"{url.rstrip('/')}/"
        self._client = http_client or httpx.AsyncClient(timeout=timeout)
        self._client.headers["Authorization"] = f"Bearer {token}"

    async def _execute(self, *command: str) -> Any:
        response = await self._client.post(self._request_url, json=list(command))
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError("Unexpected Upstash response payload.")
        if "error" in payload:
            raise RuntimeError(str(payload["error"]))
        return payload.get("result")

    async def ping(self) -> Any:
        return await self._execute("PING")

    async def get(self, key: str) -> str | None:
        result = await self._execute("GET", key)
        return str(result) if result is not None else None

    async def set(
        self,
        key: str,
        value: str,
        *,
        ex: int | None = None,
        px: int | None = None,
        nx: bool = False,
    ) -> Any:
        command = ["SET", key, value]
        if ex is not None:
            command.extend(["EX", str(ex)])
        if px is not None:
            command.extend(["PX", str(px)])
        if nx:
            command.append("NX")
        return await self._execute(*command)

    async def delete(self, *keys: str) -> int | None:
        if not keys:
            return 0
        result = await self._execute("DEL", *keys)
        return int(result) if result is not None else None

    async def incr(self, key: str) -> int:
        result = await self._execute("INCR", key)
        return int(result)

    async def expire(self, key: str, seconds: int) -> int:
        result = await self._execute("EXPIRE", key, str(seconds))
        return int(result)

    async def ttl(self, key: str) -> int:
        result = await self._execute("TTL", key)
        return int(result)

    async def close(self) -> None:
        await self._client.aclose()


class RedisCacheBackend:
    """Redis wrapper implementing the CacheBackend protocol."""

    def __init__(self, client: RedisClientProtocol, settings: Settings):
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
        await self.client.delete(key, f"{key}:stale")

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

    if settings.upstash_redis_rest_url and settings.upstash_redis_rest_token:
        redis_client = UpstashRedisClient(
            url=settings.upstash_redis_rest_url,
            token=settings.upstash_redis_rest_token,
        )
        try:
            await redis_client.ping()
            return RedisCacheBackend(redis_client, settings), redis_client
        except Exception:
            logger.warning("upstash redis unavailable; falling back to in-memory cache")
            await redis_client.close()
    return InMemoryCacheBackend(settings), None
