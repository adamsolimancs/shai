import asyncio

import pytest

from app.rate_limit import WINDOW_SCRIPT, RateLimiter, RateLimitExceeded


@pytest.mark.asyncio
async def test_rate_limiter_memory():
    limiter = RateLimiter(requests_per_minute=2)
    await limiter.check("key")
    await limiter.check("key")
    with pytest.raises(RateLimitExceeded):
        await limiter.check("key")
    await limiter.check("other")


@pytest.mark.asyncio
async def test_rate_limiter_redis_uses_atomic_window():
    class FakeRedisClient:
        def __init__(self):
            self.count = 0
            self.calls = []

        async def eval(self, script, numkeys, key):
            self.calls.append((script, numkeys, key))
            self.count += 1
            return [self.count, 42]

    redis = FakeRedisClient()
    limiter = RateLimiter(requests_per_minute=2, redis_client=redis)
    await limiter.check("secret-key")
    await limiter.check("secret-key")
    with pytest.raises(RateLimitExceeded) as error:
        await limiter.check("secret-key")
    assert error.value.headers == {"Retry-After": "42"}
    assert redis.calls == [(WINDOW_SCRIPT, 1, limiter._key("secret-key"))] * 3
    assert "secret-key" not in redis.calls[0][2]


@pytest.mark.asyncio
async def test_redis_outage_falls_back_to_enforced_local_budget():
    class BrokenRedis:
        async def eval(self, *_args):
            raise RuntimeError("unavailable")

    limiter = RateLimiter(requests_per_minute=1, redis_client=BrokenRedis())
    await limiter.check("one")
    with pytest.raises(RateLimitExceeded):
        await limiter.check("one")
    await limiter.check("two")


@pytest.mark.asyncio
async def test_concurrent_memory_requests_share_budget():
    limiter = RateLimiter(requests_per_minute=5)
    results = await asyncio.gather(
        *(limiter.check("one") for _ in range(20)), return_exceptions=True
    )
    assert sum(result is None for result in results) == 5
    assert sum(isinstance(result, RateLimitExceeded) for result in results) == 15


@pytest.mark.asyncio
async def test_local_windows_expire_and_old_visitors_are_cleaned(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr("app.rate_limit.time.monotonic", lambda: now[0])
    limiter = RateLimiter(requests_per_minute=1)
    await limiter.check("old")
    now[0] += 60
    await limiter.check("new")
    assert len(limiter._hits) == 1
    await limiter.check("old")
