import pytest

from app.config import Settings
from app.supabase import SupabaseClient


class DummyResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError("bad response")


class RecordingClient:
    def __init__(self, responder):
        self.responder = responder
        self.requests = []
        self.closed = False

    async def get(self, url, params=None, headers=None):
        self.requests.append({"url": url, "params": params, "headers": headers})
        return self.responder(params or {})

    async def aclose(self):
        self.closed = True


@pytest.mark.asyncio
async def test_supabase_requires_settings(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    settings = Settings(supabase_url=None, supabase_key=None, _env_file=None)
    with pytest.raises(ValueError):
        SupabaseClient(settings)


@pytest.mark.asyncio
async def test_select_builds_request(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")

    def responder(_params):
        return DummyResponse([{"id": 1}])

    fake_client = RecordingClient(responder)
    monkeypatch.setattr("app.supabase.httpx.AsyncClient", lambda **_: fake_client)

    settings = Settings(
        _env_file=None,
        supabase_schema="analytics",
    )
    client = SupabaseClient(settings)

    rows = await client.select(
        "players",
        filters={"id": "eq.1"},
        order="name.asc",
        limit=10,
        offset=20,
    )
    assert rows == [{"id": 1}]
    assert fake_client.requests
    request = fake_client.requests[0]
    assert request["url"].endswith("/rest/v1/players")
    assert request["params"] == {
        "select": "*",
        "id": "eq.1",
        "order": "name.asc",
        "limit": "10",
        "offset": "20",
    }
    assert request["headers"]["Accept-Profile"] == "analytics"

    await client.close()
    assert fake_client.closed is True


@pytest.mark.asyncio
async def test_select_one_returns_first_row(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")

    def responder(_params):
        return DummyResponse([{"id": 1}, {"id": 2}])

    fake_client = RecordingClient(responder)
    monkeypatch.setattr("app.supabase.httpx.AsyncClient", lambda **_: fake_client)

    settings = Settings(_env_file=None)
    client = SupabaseClient(settings)

    row = await client.select_one("players", filters={"id": "eq.1"})
    assert row == {"id": 1}


@pytest.mark.asyncio
async def test_select_all_paginates(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")

    def responder(params):
        offset = int(params.get("offset", 0))
        if offset == 0:
            return DummyResponse([{"id": 1}, {"id": 2}])
        if offset == 2:
            return DummyResponse([{"id": 3}])
        return DummyResponse([])

    fake_client = RecordingClient(responder)
    monkeypatch.setattr("app.supabase.httpx.AsyncClient", lambda **_: fake_client)

    settings = Settings(_env_file=None)
    client = SupabaseClient(settings)

    rows = await client.select_all("players", page_size=2)
    assert rows == [{"id": 1}, {"id": 2}, {"id": 3}]
