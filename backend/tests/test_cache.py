import asyncio
import json

import httpx
import pytest

from app import cache as cache_module
from app.cache import InMemoryCacheBackend, RedisCacheBackend, UpstashRedisClient, init_cache
from app.config import Settings


@pytest.mark.asyncio
async def test_inmemory_cache_set_get_stale():
    cache = InMemoryCacheBackend(Settings())
    await cache.set("foo", {"bar": 1}, ttl=1)
    assert await cache.get("foo") == {"bar": 1}
    await asyncio.sleep(1.1)
    assert await cache.get("foo") is None
    assert await cache.get_stale("foo") == {"bar": 1}


@pytest.mark.asyncio
async def test_upstash_redis_client_uses_rest_commands():
    commands: list[list[str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer token"
        command = json.loads(request.content.decode())
        commands.append(command)
        operation = command[0]
        responses = {
            "PING": "PONG",
            "SET": "OK",
            "GET": '{"value": 1}',
            "DEL": 2,
            "INCR": 1,
            "EXPIRE": 1,
            "TTL": 60,
        }
        return httpx.Response(200, json={"result": responses[operation]})

    transport = httpx.MockTransport(handler)
    http_client = httpx.AsyncClient(base_url="https://upstash.example", transport=transport)
    client = UpstashRedisClient(
        url="https://upstash.example",
        token="token",
        http_client=http_client,
    )

    assert await client.ping() == "PONG"
    assert await client.set("lock", "1", nx=True, px=2500) == "OK"
    assert await client.get("cache:key") == '{"value": 1}'
    assert await client.delete("cache:key", "cache:key:stale") == 2
    assert await client.incr("rl:key") == 1
    assert await client.expire("rl:key", 60) == 1
    assert await client.ttl("rl:key") == 60
    await client.close()

    assert commands == [
        ["PING"],
        ["SET", "lock", "1", "PX", "2500", "NX"],
        ["GET", "cache:key"],
        ["DEL", "cache:key", "cache:key:stale"],
        ["INCR", "rl:key"],
        ["EXPIRE", "rl:key", "60"],
        ["TTL", "rl:key"],
    ]


@pytest.mark.asyncio
async def test_init_cache_uses_upstash_when_configured(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, object] = {}

    class FakeUpstashRedisClient:
        def __init__(self, *, url: str, token: str, timeout: float = 5.0, http_client=None):
            captured["url"] = url
            captured["token"] = token
            captured["timeout"] = timeout

        async def ping(self) -> str:
            captured["pinged"] = True
            return "PONG"

        async def get(self, key: str) -> str | None:
            return None

        async def set(
            self,
            key: str,
            value: str,
            *,
            ex: int | None = None,
            px: int | None = None,
            nx: bool = False,
        ) -> str:
            return "OK"

        async def delete(self, *keys: str) -> int:
            return len(keys)

        async def incr(self, key: str) -> int:
            return 1

        async def expire(self, key: str, seconds: int) -> int:
            return 1

        async def ttl(self, key: str) -> int:
            return 60

        async def close(self) -> None:
            captured["closed"] = True

    monkeypatch.setattr(cache_module, "UpstashRedisClient", FakeUpstashRedisClient)
    monkeypatch.setenv("UPSTASH_REDIS_REST_URL", "https://nba-cache.upstash.io")
    monkeypatch.setenv("UPSTASH_REDIS_REST_TOKEN", "rest-token")

    cache, redis_client = await init_cache(Settings(_env_file=None))

    assert isinstance(cache, RedisCacheBackend)
    assert isinstance(redis_client, FakeUpstashRedisClient)
    assert captured["url"] == "https://nba-cache.upstash.io"
    assert captured["token"] == "rest-token"
    assert captured["pinged"] is True

    await cache.close()
    assert captured["closed"] is True
