"""Exercise the actual Upstash adapter/Lua against disposable local Redis.

Run from backend with: python -m integration.rate_limit_redis
Requires redis-server/redis-cli on PATH; never uses external credentials.
"""

import asyncio
import json
import subprocess
import tempfile
from pathlib import Path

import httpx

from app.cache import UpstashRedisClient
from app.rate_limit import RateLimiter, RateLimitExceeded


async def exercise(socket):
    async def command(*args):
        process = await asyncio.create_subprocess_exec(
            "redis-cli",
            "-s",
            str(socket),
            "--json",
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        if process.returncode:
            raise RuntimeError(stderr.decode())
        return json.loads(stdout)

    # Translate real REST command payloads to an isolated Redis Unix socket.
    async def rest(request):
        assert request.headers["Authorization"] == "Bearer local-test"
        return httpx.Response(200, json={"result": await command(*json.loads(request.content))})

    client = UpstashRedisClient(
        url="http://local.test",
        token="local-test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(rest)),
    )
    try:
        for _ in range(100):
            if socket.exists():
                break
            await asyncio.sleep(0.01)
        assert await client.ping() == "PONG"
        # Two processes/replicas share a single atomic visitor budget.
        first = RateLimiter(5, client, namespace="visitor")
        second = RateLimiter(5, client, namespace="visitor")
        results = await asyncio.gather(
            *((first if index % 2 else second).check("one") for index in range(20)),
            return_exceptions=True,
        )
        assert sum(result is None for result in results) == 5, results
        assert sum(isinstance(result, RateLimitExceeded) for result in results) == 15
        assert 1 <= await client.ttl(first._key("one")) <= 60
        await first.check("two")
        await RateLimiter(1, client, namespace="service").check("one")
        # Repair an old partial INCR without expiry, then test a fresh window.
        await command("SET", first._key("legacy"), "3")
        await first.check("legacy")
        assert 1 <= await client.ttl(first._key("legacy")) <= 60
        await command("PEXPIRE", first._key("one"), "1")
        await asyncio.sleep(0.02)
        await first.check("one")
        assert await command("GET", first._key("one")) == "1"
    finally:
        await client.close()


def main():
    with tempfile.TemporaryDirectory(prefix="shai-rate-limit-", dir="/tmp") as directory:
        socket = Path(directory) / "redis.sock"
        with (Path(directory) / "redis.log").open("w") as log:
            process = subprocess.Popen(
                [
                    "redis-server",
                    "--port",
                    "0",
                    "--unixsocket",
                    str(socket),
                    "--save",
                    "",
                    "--appendonly",
                    "no",
                ],
                stdout=log,
                stderr=log,
            )
            try:
                asyncio.run(exercise(socket))
            finally:
                process.terminate()
                process.wait(timeout=5)
    print(
        "Redis rate limits passed: concurrent replicas, visitor/service isolation, "
        "expiry and repair."
    )


if __name__ == "__main__":
    main()
