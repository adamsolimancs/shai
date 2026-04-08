import pytest

from app.cache import InMemoryCacheBackend
from app.config import Settings
from app.resolvers import NameResolver


@pytest.mark.asyncio
async def test_resolver_uses_cache(monkeypatch):
    cache = InMemoryCacheBackend(Settings())
    resolver = NameResolver(cache)
    resolver.players = {"lebron james": {"id": 2544, "name": "LeBron James"}}
    resolver.teams = {
        "los angeles lakers": {
            "id": 1610612747,
            "name": "Los Angeles Lakers",
            "abbreviation": "LAL",
        }
    }
    assert resolver.resolve_player("LeBron James").id == 2544
    assert resolver.resolve_team("lal").abbreviation == "LAL"


@pytest.mark.asyncio
async def test_resolver_skips_upstream_refresh_when_disabled(monkeypatch):
    cache = InMemoryCacheBackend(Settings(environment="production"))
    resolver = NameResolver(cache, supabase=object(), allow_upstream=False)

    async def fake_fetch_from_db():
        return {
            "players": {"lebron james": {"id": 2544, "name": "LeBron James"}},
            "teams": {},
        }

    def fail_fetch_latest():
        raise AssertionError("resolver should not call upstream")

    monkeypatch.setattr(resolver, "_fetch_from_db", fake_fetch_from_db)
    monkeypatch.setattr(resolver, "_fetch_latest", fail_fetch_latest)

    await resolver.refresh()

    assert resolver.resolve_player("LeBron James").id == 2544
