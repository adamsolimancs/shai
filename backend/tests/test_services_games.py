
from app.cache import InMemoryCacheBackend
from app.config import Settings
from app.resolvers import NameResolver
from app.services.nba import NBAStatsClient


def _client():
    settings = Settings()
    cache = InMemoryCacheBackend(settings)
    resolver = NameResolver(cache)
    return NBAStatsClient(settings, cache, resolver)


def test_dedupe_games_merges_home_away():
    client = _client()
    rows = [
        {
            "GAME_ID": "001",
            "GAME_DATE": "2024-10-10",
            "TEAM_ID": 1,
            "TEAM_NAME": "LAL",
            "MATCHUP": "LAL vs. BOS",
            "PTS": 110,
            "SEASON_ID": "2024",
            "WL": "W",
        },
        {
            "GAME_ID": "001",
            "GAME_DATE": "2024-10-10",
            "TEAM_ID": 2,
            "TEAM_NAME": "BOS",
            "MATCHUP": "LAL vs. BOS",
            "PTS": 100,
            "SEASON_ID": "2024",
            "WL": "L",
        },
    ]
    deduped = client._dedupe_games(rows)
    assert deduped[0]["home_team_id"] == 1
    assert deduped[0]["away_team_id"] == 2


def test_normalize_boxscore():
    client = _client()
    row = {
        "PLAYER_ID": 1,
        "PLAYER_NAME": "Test Player",
        "TEAM_ID": 10,
        "TEAM_ABBREVIATION": "TP",
        "MIN": "35",
        "PTS": "25",
        "REB": "10",
        "AST": "5",
        "STL": "2",
        "BLK": "1",
        "TO": "3",
        "PF": "4",
        "PLUS_MINUS": "5",
    }
    output = client._normalize_boxscore(row)
    assert output["player_id"] == 1
    assert output["points"] == 25.0
