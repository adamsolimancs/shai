import asyncio
import socket
import ssl
from urllib.parse import parse_qsl, urlsplit

import asyncpg
import certifi
import pytest

from app.config import Settings
from app.database import DatabaseClient, _identifier


def test_database_client_requires_database_url():
    with pytest.raises(ValueError, match="DATABASE_URL"):
        DatabaseClient(Settings(_env_file=None, database_url=None))


def test_database_client_accepts_neon_url():
    client = DatabaseClient(Settings(_env_file=None, database_url="postgresql://user:pass@host/db"))
    assert client._schema == "public"


def test_identifier_rejects_injection():
    with pytest.raises(ValueError, match="Invalid SQL identifier"):
        _identifier("players; drop table players")


def test_where_parameterizes_filters():
    args = []
    where = DatabaseClient._where({"season": "eq.2025", "full_name": "ilike.*james*"}, args)
    assert where == ' WHERE "season"::text = $1 AND "full_name"::text ILIKE $2'
    assert args == ["2025", "%james%"]


def _closed_local_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@pytest.fixture
def isolated_libpq_env(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    for name in ("PGSSLMODE", "PGSSLROOTCERT", "PGSERVICE"):
        monkeypatch.delenv(name, raising=False)
    return tmp_path


def _client(query: str) -> DatabaseClient:
    url = f"postgresql://user:pass@127.0.0.1:{_closed_local_port()}/db?{query}"
    return DatabaseClient(Settings(_env_file=None, database_url=url))


@pytest.mark.asyncio
async def test_verify_full_without_root_cert_reaches_the_server(isolated_libpq_env):
    client = _client("sslmode=verify-full")

    with pytest.raises(OSError):
        await client.select("players")


@pytest.mark.asyncio
async def test_verify_full_uses_trusted_bundle_and_keeps_hostname_checks(
    isolated_libpq_env, monkeypatch
):
    captured = {}

    async def fake_create_pool(dsn, **kwargs):
        captured["dsn"] = dsn
        raise ConnectionRefusedError

    monkeypatch.setattr(asyncpg, "create_pool", fake_create_pool)

    with pytest.raises(ConnectionRefusedError):
        await _client("sslmode=verify-full&channel_binding=require").select("players")

    query = dict(parse_qsl(urlsplit(captured["dsn"]).query))
    assert query == {
        "sslmode": "verify-full",
        "channel_binding": "require",
        "sslrootcert": certifi.where(),
    }


@pytest.mark.asyncio
async def test_explicit_root_certificate_settings_take_precedence(isolated_libpq_env, monkeypatch):
    missing = str(isolated_libpq_env / "missing-ca.pem")

    with pytest.raises(FileNotFoundError):
        await _client(f"sslmode=verify-full&sslrootcert={missing}").select("players")

    monkeypatch.setenv("PGSSLROOTCERT", missing)
    with pytest.raises(FileNotFoundError):
        await _client("sslmode=verify-full").select("players")


@pytest.mark.asyncio
async def test_libpq_default_root_certificate_takes_precedence(isolated_libpq_env):
    root = isolated_libpq_env / ".postgresql" / "root.crt"
    root.parent.mkdir()
    root.write_text("not a certificate")

    with pytest.raises(ssl.SSLError):
        await _client("sslmode=verify-full").select("players")


@pytest.mark.asyncio
async def test_unverified_modes_are_left_unchanged(isolated_libpq_env, monkeypatch):
    captured = []

    async def fake_create_pool(dsn, **kwargs):
        captured.append(dsn)
        raise ConnectionRefusedError

    monkeypatch.setattr(asyncpg, "create_pool", fake_create_pool)

    for query in ("sslmode=require", "sslmode=disable", ""):
        with pytest.raises(ConnectionRefusedError):
            await _client(query).select("players")

    assert all("sslrootcert" not in dsn for dsn in captured)


@pytest.mark.asyncio
async def test_concurrent_first_queries_share_one_pool(monkeypatch):
    created = []

    class FakePool:
        async def fetch(self, query, *args):
            return []

        async def close(self):
            pass

    async def fake_create_pool(dsn, **kwargs):
        await asyncio.sleep(0.01)
        pool = FakePool()
        created.append(pool)
        return pool

    monkeypatch.setattr(asyncpg, "create_pool", fake_create_pool)
    client = DatabaseClient(Settings(_env_file=None, database_url="postgresql://u@h/db"))

    await asyncio.gather(*(client.select("players") for _ in range(5)))

    assert len(created) == 1
