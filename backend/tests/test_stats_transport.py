"""Transport and game-query regressions; no live NBA access."""

from datetime import date

import pandas as pd
import pytest
from nba_api.stats.library.http import STATS_HEADERS

from app.cache import InMemoryCacheBackend
from app.config import Settings
from app.resolvers import NameResolver
from app.services.nba import NBAStatsClient


@pytest.mark.asyncio
async def test_games_use_maintained_headers_and_isolate_date_ranges(monkeypatch):
    settings = Settings()
    cache = InMemoryCacheBackend(settings)
    client = NBAStatsClient(settings, cache, NameResolver(cache))
    calls = []
    queries = []

    class Endpoint:
        def get_request(self):
            queries.append(dict(self.parameters))

        def get_data_frames(self):
            return [pd.DataFrame()]

    def endpoint(**kwargs):
        calls.append(kwargs)
        instance = Endpoint()
        instance.parameters = {
            "LeagueID": kwargs["league_id_nullable"],
            "PlayerOrTeam": "T",
            "Season": kwargs["season_nullable"],
            "SeasonType": kwargs["season_type_nullable"],
            "DateFrom": kwargs["date_from_nullable"],
            "DateTo": kwargs["date_to_nullable"],
            "UnusedOptionalFilter": "",
        }
        return instance

    monkeypatch.setattr("app.services.nba.leaguegamefinder.LeagueGameFinder", endpoint)

    async def games(start=None, end=None):
        return await client.get_games("2026-27", None, None, start, end, True)

    first = await games()
    filtered = await games(date(2026, 10, 25), date(2026, 10, 25))
    repeated = await games()

    assert len(calls) == 2
    assert first.cache.hit is False
    assert filtered.cache.hit is False
    assert repeated.cache.hit is True
    for call in calls:
        assert call["headers"] == STATS_HEADERS
        assert call["season_nullable"] == "2026-27"
        assert call["season_type_nullable"] == "Regular Season"
        assert call["league_id_nullable"] == "00"
    assert calls[0]["date_from_nullable"] == ""
    assert calls[1]["date_from_nullable"] == "2026-10-25"
    assert calls[1]["date_to_nullable"] == "2026-10-25"

    assert len(queries) == 2
    assert all(len(query) == 6 for query in queries)
    assert all("UnusedOptionalFilter" not in query for query in queries)
    assert queries[0]["DateFrom"] == ""
    assert queries[1]["DateFrom"] == "2026-10-25"
    assert all(call["get_request"] is False for call in calls)
