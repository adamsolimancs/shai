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
        self.requests.append({"method": "GET", "url": url, "params": params, "headers": headers})
        return self.responder("GET", params or {}, None)

    async def post(self, url, params=None, json=None, headers=None):
        self.requests.append(
            {
                "method": "POST",
                "url": url,
                "params": params,
                "json": json,
                "headers": headers,
            }
        )
        return self.responder("POST", params or {}, json)

    async def aclose(self):
        self.closed = True


@pytest.mark.asyncio
async def test_supabase_requires_settings(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    settings = Settings(supabase_url=None, supabase_key=None, _env_file=None)
    with pytest.raises(ValueError):
        SupabaseClient(settings)


@pytest.mark.asyncio
async def test_select_builds_request(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "service-key")

    def responder(_method, _params, _json):
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
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "service-key")

    def responder(_method, _params, _json):
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
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "service-key")

    def responder(_method, params, _json):
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


@pytest.mark.asyncio
async def test_upsert_builds_request(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "service-key")

    def responder(_method, _params, _json):
        return DummyResponse([])

    fake_client = RecordingClient(responder)
    monkeypatch.setattr("app.supabase.httpx.AsyncClient", lambda **_: fake_client)

    settings = Settings(_env_file=None, supabase_schema="analytics")
    client = SupabaseClient(settings)

    await client.upsert(
        "api_snapshots",
        [{"cache_key": "foo", "payload": '{"ok":true}'}],
        on_conflict="cache_key",
    )

    request = fake_client.requests[0]
    assert request["method"] == "POST"
    assert request["url"].endswith("/rest/v1/api_snapshots")
    assert request["params"] == {"on_conflict": "cache_key"}
    assert request["json"] == [{"cache_key": "foo", "payload": '{"ok":true}'}]
    assert request["headers"]["Content-Profile"] == "analytics"
    assert request["headers"]["Prefer"] == "resolution=merge-duplicates"


@pytest.mark.asyncio
async def test_list_auth_users_builds_request(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "service-key")

    def responder(_method, _params, _json):
        return DummyResponse({"users": [{"id": "user-1"}]})

    fake_client = RecordingClient(responder)
    monkeypatch.setattr("app.supabase.httpx.AsyncClient", lambda **_: fake_client)

    settings = Settings(_env_file=None)
    client = SupabaseClient(settings)

    users = await client.list_auth_users()

    assert users == [{"id": "user-1"}]
    request = fake_client.requests[0]
    assert request["method"] == "GET"
    assert request["url"].endswith("/auth/v1/admin/users")
    assert request["headers"]["Authorization"] == "Bearer service-key"
    assert "Accept-Profile" not in request["headers"]


@pytest.mark.asyncio
async def test_create_auth_user_builds_request(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "service-key")

    def responder(_method, _params, json):
        return DummyResponse({"id": "fbdf5a53-161e-4460-98ad-0e39408d8689", **(json or {})})

    fake_client = RecordingClient(responder)
    monkeypatch.setattr("app.supabase.httpx.AsyncClient", lambda **_: fake_client)

    settings = Settings(_env_file=None)
    client = SupabaseClient(settings)

    user = await client.create_auth_user(
        email="scout@example.com",
        user_metadata={"name": "Scout", "username": "scout"},
    )

    assert user["id"] == "fbdf5a53-161e-4460-98ad-0e39408d8689"
    request = fake_client.requests[0]
    assert request["method"] == "POST"
    assert request["url"].endswith("/auth/v1/admin/users")
    assert request["json"] == {
        "email": "scout@example.com",
        "email_confirm": True,
        "user_metadata": {"name": "Scout", "username": "scout"},
    }
    assert request["headers"]["Content-Type"] == "application/json"


@pytest.mark.asyncio
async def test_ensure_auth_user_reuses_existing_match(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "service-key")

    def responder(method, _params, _json):
        if method == "GET":
            return DummyResponse(
                {
                    "users": [
                        {
                            "id": "fbdf5a53-161e-4460-98ad-0e39408d8689",
                            "email": "scout@example.com",
                        }
                    ]
                }
            )
        raise AssertionError("create_auth_user should not run when a user already exists")

    fake_client = RecordingClient(responder)
    monkeypatch.setattr("app.supabase.httpx.AsyncClient", lambda **_: fake_client)

    settings = Settings(_env_file=None)
    client = SupabaseClient(settings)

    user = await client.ensure_auth_user(
        email="SCOUT@EXAMPLE.COM",
        user_metadata={"name": "Scout"},
    )

    assert user == {
        "id": "fbdf5a53-161e-4460-98ad-0e39408d8689",
        "email": "scout@example.com",
    }
    assert len(fake_client.requests) == 1


@pytest.mark.asyncio
async def test_rpc_builds_request(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "service-key")

    def responder(_method, _params, _json):
        return DummyResponse({"ok": True})

    fake_client = RecordingClient(responder)
    monkeypatch.setattr("app.supabase.httpx.AsyncClient", lambda **_: fake_client)

    settings = Settings(_env_file=None, supabase_schema="analytics")
    client = SupabaseClient(settings)

    payload = await client.rpc("publish_game_snapshot", {"p_game_id": "001"})

    assert payload == {"ok": True}
    request = fake_client.requests[0]
    assert request["method"] == "POST"
    assert request["url"].endswith("/rest/v1/rpc/publish_game_snapshot")
    assert request["json"] == {"p_game_id": "001"}
    assert request["headers"]["Accept-Profile"] == "analytics"
    assert request["headers"]["Content-Profile"] == "analytics"
