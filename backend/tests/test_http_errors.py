import httpx
import pytest

from app.auth import require_api_key
from app.dependencies import get_rate_limiter
from app.main import app
from app.rate_limit import RateLimiter


@pytest.mark.asyncio
async def test_rate_limit_response_preserves_retry_after(monkeypatch):
    limiter = RateLimiter(requests_per_minute=1)
    await limiter.check("test-key")
    monkeypatch.setitem(app.dependency_overrides, require_api_key, lambda: "test-key")
    monkeypatch.setitem(app.dependency_overrides, get_rate_limiter, lambda: limiter)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/v1/meta")

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMIT_EXCEEDED"
    assert 1 <= int(response.headers["Retry-After"]) <= 60
