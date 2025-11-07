import pytest

from app.rate_limit import RateLimiter, RateLimitExceeded


@pytest.mark.asyncio
async def test_rate_limiter_memory():
    limiter = RateLimiter(requests_per_minute=2, redis_client=None)
    await limiter.check("key")
    await limiter.check("key")
    with pytest.raises(RateLimitExceeded):
        await limiter.check("key")
