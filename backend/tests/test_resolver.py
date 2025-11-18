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
