import pytest

from app.rate_limit import RateLimiter, RateLimitExceeded


@pytest.mark.asyncio
async def test_rate_limiter_memory():
    limiter = RateLimiter(requests_per_minute=2, redis_client=None)
    await limiter.check("key")
    await limiter.check("key")
    with pytest.raises(RateLimitExceeded):
        await limiter.check("key")


@pytest.mark.asyncio
async def test_rate_limiter_redis_client_protocol():
    class FakeRedisClient:
        def __init__(self) -> None:
            self.counts: dict[str, int] = {}
            self.expire_calls: list[tuple[str, int]] = []

        async def incr(self, key: str) -> int:
            self.counts[key] = self.counts.get(key, 0) + 1
            return self.counts[key]

        async def expire(self, key: str, seconds: int) -> int:
            self.expire_calls.append((key, seconds))
            return 1

        async def ttl(self, key: str) -> int:
            return 42

    redis_client = FakeRedisClient()
    limiter = RateLimiter(requests_per_minute=2, redis_client=redis_client)

    await limiter.check("key")
    await limiter.check("key")
    with pytest.raises(RateLimitExceeded) as exc_info:
        await limiter.check("key")

    assert exc_info.value.headers == {"Retry-After": "42"}
    assert redis_client.expire_calls == [("rl:key", 60)]
