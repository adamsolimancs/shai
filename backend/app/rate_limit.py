"""Simple rate limiting utilities."""

from __future__ import annotations

import asyncio
import time

from fastapi import HTTPException, status

try:
    from redis import asyncio as redis_asyncio
except Exception:  # pragma: no cover
    redis_asyncio = None  # type: ignore


class RateLimitExceeded(HTTPException):
    """HTTP exception representing a rate limit breach."""

    def __init__(self, retry_after: int) -> None:
        super().__init__(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "RATE_LIMIT_EXCEEDED",
                "message": "Too many requests.",
                "retryable": True,
            },
            headers={"Retry-After": str(retry_after)},
        )


class RateLimiter:
    """Performs per-API-key rate limiting using Redis when available."""

    def __init__(self, requests_per_minute: int, redis_client: redis_asyncio.Redis | None = None):
        self.requests_per_minute = requests_per_minute
        self.redis = redis_client
        self._hits: dict[str, tuple[int, float]] = {}
        self._lock = asyncio.Lock()

    async def check(self, identifier: str) -> None:
        """Raise if the identifier exceeded the limit."""

        if self.redis:
            await self._check_redis(identifier)
        else:
            await self._check_memory(identifier)

    async def _check_redis(self, identifier: str) -> None:
        if not self.redis:  # pragma: no cover - guarded at runtime
            return
        key = f"rl:{identifier}"
        ttl_seconds = 60
        try:
            count = await self.redis.incr(key)
            if count == 1:
                await self.redis.expire(key, ttl_seconds)
            else:
                ttl = await self.redis.ttl(key)
                ttl_seconds = ttl if ttl > 0 else ttl_seconds
        except Exception:
            # fallback to in-memory tracking if redis hiccups
            await self._check_memory(identifier)
            return
        if count > self.requests_per_minute:
            raise RateLimitExceeded(ttl_seconds)

    async def _check_memory(self, identifier: str) -> None:
        ttl_seconds = 60
        async with self._lock:
            count, reset_at = self._hits.get(identifier, (0, time.time() + ttl_seconds))
            now = time.time()
            if now > reset_at:
                count = 0
                reset_at = now + ttl_seconds
            count += 1
            self._hits[identifier] = (count, reset_at)
            if count > self.requests_per_minute:
                retry_after = max(int(reset_at - now), 1)
                raise RateLimitExceeded(retry_after)
