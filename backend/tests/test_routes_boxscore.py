from types import SimpleNamespace

import pytest

from app.api import routes
from app.cache import InMemoryCacheBackend
from app.config import Settings
from app.schemas import BoxScoreGame, CacheMeta
from app.services.nba import ServiceResult
from app.serving_cache import boxscore_key


def _payload(*, status: str = "Final", complete: bool = True) -> dict:
    lists = {
        "team_totals": [{"team_id": 10, "points": 110}] if complete else [],
        "starter_bench": [{"team_id": 10, "label": "Starters"}] if complete else [],
        "traditional_players": (
            [
                {
                    "player_id": 1,
                    "player_name": "Player One",
                    "team_id": 10,
                    "team_abbreviation": "AAA",
                    "points": 30,
                }
            ]
            if complete
            else []
        ),
        "advanced_players": (
            [
                {
                    "player_id": 1,
                    "player_name": "Player One",
                    "team_id": 10,
                    "team_abbreviation": "AAA",
                    "offensive_rating": 121.5,
                }
            ]
            if complete
            else []
        ),
    }
    return {
        "game_id": "001",
        "status": status,
        "officials": [],
        "home_team": {"team_id": 10, "score": 110, "is_home": True, "leaders": []},
        "away_team": {"team_id": 20, "score": 102, "is_home": False, "leaders": []},
        "line_score": [],
        **lists,
    }


def _request() -> SimpleNamespace:
    return SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(redis=None)),
        state=SimpleNamespace(request_id="req-1"),
        method="GET",
        url=SimpleNamespace(path="/v1/boxscores/001"),
        headers={},
    )


class DummyClient:
    def __init__(self, payload: dict, *, cache_hit: bool = False, error: Exception | None = None):
        self.payload = payload
        self.cache_hit = cache_hit
        self.error = error
        self.calls = 0

    async def get_boxscore_details(self, game_id: str) -> ServiceResult:
        self.calls += 1
        if self.error:
            raise self.error
        return ServiceResult(
            BoxScoreGame(**self.payload),
            CacheMeta(hit=self.cache_hit, stale=False),
        )


@pytest.mark.asyncio
async def test_full_boxscore_caches_database_and_upstream_enrichment(monkeypatch):
    settings = Settings(_env_file=None)
    cache = InMemoryCacheBackend(settings)
    database_calls = 0

    async def fetch_database(_supabase, _game_id):
        nonlocal database_calls
        database_calls += 1
        return _payload(complete=False)

    monkeypatch.setattr(routes, "fetch_boxscore", fetch_database)
    client = DummyClient(_payload())

    first = await routes.full_boxscore(
        request=_request(),
        cache=cache,
        supabase=object(),
        client=client,
        settings=settings,
        game_id="001",
    )
    second = await routes.full_boxscore(
        request=_request(),
        cache=cache,
        supabase=object(),
        client=client,
        settings=settings,
        game_id="001",
    )

    assert database_calls == 1
    assert client.calls == 1
    assert first.meta.source == "database+nba_api"
    assert first.meta.stale is False
    assert first.meta.as_of is None  # Neither source supplied an observation timestamp.
    assert first.data["advanced_players"][0]["offensive_rating"] == 121.5
    assert second.meta.source == "redis"
    assert second.meta.as_of == first.meta.as_of
    assert second.data == first.data


@pytest.mark.asyncio
async def test_full_boxscore_serves_stale_redis_when_database_and_upstream_fail(monkeypatch):
    settings = Settings(_env_file=None)
    cache = InMemoryCacheBackend(settings)
    await cache.set(boxscore_key(settings, "001"), _payload(), ttl=0)

    async def fetch_database(_supabase, _game_id):
        return None

    monkeypatch.setattr(routes, "fetch_boxscore", fetch_database)
    client = DummyClient(_payload(), error=RuntimeError("upstream unavailable"))

    response = await routes.full_boxscore(
        request=_request(),
        cache=cache,
        supabase=object(),
        client=client,
        settings=settings,
        game_id="001",
    )

    assert response.meta.source == "redis"
    assert response.meta.stale is True
    assert response.meta.cache == CacheMeta(hit=True, stale=True)


def test_boxscore_ttl_tracks_game_freshness():
    assert routes._boxscore_cache_ttl(_payload(status="Q3 04:12")) == routes.TTLS.boxscore_live
    assert routes._boxscore_cache_ttl(_payload(status="Final/OT")) == routes.TTLS.boxscore_final


@pytest.mark.asyncio
@pytest.mark.parametrize("database_failed, expected_status", [(False, 404), (True, 503)])
async def test_missing_boxscore_is_distinct_from_database_failure(
    monkeypatch, database_failed, expected_status
):
    from fastapi import HTTPException

    settings = Settings(_env_file=None, environment="production", allow_nba_api_in_production=False)

    async def fetch_database(_supabase, _game_id):
        if database_failed:
            raise RuntimeError("database unavailable")
        return None

    monkeypatch.setattr(routes, "fetch_boxscore", fetch_database)
    with pytest.raises(HTTPException) as error:
        await routes.full_boxscore(
            request=_request(),
            cache=InMemoryCacheBackend(settings),
            supabase=object(),
            client=DummyClient(_payload()),
            settings=settings,
            game_id="001",
        )
    assert error.value.status_code == expected_status
