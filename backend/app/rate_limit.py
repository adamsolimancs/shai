"""Simple rate limiting utilities."""

from __future__ import annotations

import asyncio
import hashlib
import math
import time

from fastapi import HTTPException, status

from .cache import RedisClientProtocol

WINDOW_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], 60)
  ttl = 60
end
return {count, ttl}
"""


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
    """Fixed-window budgets with atomic Redis updates and a local outage fallback."""

    def __init__(
        self,
        requests_per_minute: int,
        redis_client: RedisClientProtocol | None = None,
        *,
        namespace: str = "nba:rl",
    ):
        self.requests_per_minute = requests_per_minute
        self.redis = redis_client
        self._hits: dict[str, tuple[int, float]] = {}
        self._lock = asyncio.Lock()
        self.namespace = namespace
        self._last_cleanup = 0.0

    def _key(self, identifier: str) -> str:
        return f"{self.namespace}:{hashlib.sha256(identifier.encode()).hexdigest()}"

    async def check(self, identifier: str) -> None:
        """Raise if the identifier exceeded the limit."""

        if self.redis:
            await self._check_redis(identifier)
        else:
            await self._check_memory(identifier)

    async def _check_redis(self, identifier: str) -> None:
        if not self.redis:  # pragma: no cover - guarded at runtime
            return
        key = self._key(identifier)
        ttl_seconds = 60
        try:
            count, ttl = await self.redis.eval(WINDOW_SCRIPT, 1, key)
            ttl_seconds = max(int(ttl), 1)
        except Exception:
            # fallback to in-memory tracking if redis hiccups
            await self._check_memory(identifier)
            return
        if count > self.requests_per_minute:
            raise RateLimitExceeded(ttl_seconds)

    async def _check_memory(self, identifier: str) -> None:
        ttl_seconds = 60
        async with self._lock:
            now = time.monotonic()
            if now - self._last_cleanup >= ttl_seconds:
                self._hits = {key: hit for key, hit in self._hits.items() if hit[1] > now}
                self._last_cleanup = now
            key = self._key(identifier)
            count, reset_at = self._hits.get(key, (0, now + ttl_seconds))
            if now >= reset_at:
                count = 0
                reset_at = now + ttl_seconds
            count += 1
            self._hits[key] = (count, reset_at)
            if count > self.requests_per_minute:
                retry_after = max(math.ceil(reset_at - now), 1)
                raise RateLimitExceeded(retry_after)
