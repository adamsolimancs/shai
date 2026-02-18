from datetime import date

import pytest

from app.services.store import fetch_games, fetch_player_stats


class DummySupabase:
    def __init__(self, *, player_stats, players, player_info, teams):
        self._player_stats = player_stats
        self._players = players
        self._player_info = player_info
        self._teams = teams

    async def select_all(self, table: str, **_kwargs):
        if table == "player_season_stats":
            return self._player_stats
        if table == "players":
            return self._players
        if table == "player_info":
            return self._player_info
        if table == "teams":
            return self._teams
        raise AssertionError(f"Unexpected select_all table: {table}")

    async def select(self, table: str, **_kwargs):
        raise AssertionError(f"Unexpected select table: {table}")


class DummySupabaseGames:
    def __init__(self, *, games, teams=None):
        self._games = games
        self._teams = teams or {}
        self.last_games_filters = None

    async def select(self, table: str, **kwargs):
        if table == "games":
            self.last_games_filters = kwargs.get("filters") or {}
            return [dict(row) for row in self._games]
        raise AssertionError(f"Unexpected select table: {table}")

    async def select_one(self, table: str, **kwargs):
        if table != "teams":
            raise AssertionError(f"Unexpected select_one table: {table}")
        filters = kwargs.get("filters") or {}
        raw = str(filters.get("abbreviation") or "")
        abbr = raw.removeprefix("eq.")
        return self._teams.get(abbr)


@pytest.mark.asyncio
async def test_fetch_player_stats_uses_row_name_when_players_name_missing():
    supabase = DummySupabase(
        player_stats=[
            {
                "player_id": "201939",
                "team_id": "1610612744",
                "player_name": "Stephen Curry",
                "points_pg": "30.5",
                "rebounds_pg": "5.1",
                "assists_pg": "6.3",
                "minutes_pg": "34.2",
            }
        ],
        players=[{"player_id": "201939", "full_name": ""}],
        player_info=[],
        teams=[{"team_id": 1610612744, "abbreviation": "GSW"}],
    )

    result = await fetch_player_stats(
        supabase, season="2025-26", season_type="Regular Season", team_id=None
    )

    assert len(result) == 1
    assert result[0]["player_name"] == "Stephen Curry"
    assert result[0]["team_abbreviation"] == "GSW"
    assert result[0]["points"] == pytest.approx(30.5)
    assert result[0]["rebounds"] == pytest.approx(5.1)
    assert result[0]["assists"] == pytest.approx(6.3)
    assert result[0]["minutes"] == pytest.approx(34.2)


@pytest.mark.asyncio
async def test_fetch_player_stats_normalizes_ids_and_uses_player_info_name():
    supabase = DummySupabase(
        player_stats=[
            {
                "player_id": 2544,
                "team_id": "1610612747",
                "points": "25.0",
                "rebounds": "8.2",
                "assists": "8.3",
                "minutes": "35.1",
            }
        ],
        players=[{"player_id": "2544", "full_name": None}],
        player_info=[{"player_id": "2544", "display_name": "LeBron James"}],
        teams=[{"team_id": "1610612747", "abbreviation": "LAL"}],
    )

    result = await fetch_player_stats(
        supabase, season="2025-26", season_type="Regular Season", team_id=None
    )

    assert len(result) == 1
    assert result[0]["player_name"] == "LeBron James"
    assert result[0]["team_abbreviation"] == "LAL"
    assert result[0]["points"] == pytest.approx(25.0)
    assert result[0]["rebounds"] == pytest.approx(8.2)
    assert result[0]["assists"] == pytest.approx(8.3)
    assert result[0]["minutes"] == pytest.approx(35.1)


@pytest.mark.asyncio
async def test_fetch_games_honors_date_from_and_date_to():
    supabase = DummySupabaseGames(
        games=[
            {
                "game_id": "before",
                "date": "2026-02-10",
                "home_team_id": 1,
                "away_team_id": 2,
                "home_team_name": "A",
                "away_team_name": "B",
            },
            {
                "game_id": "in_range",
                "date": "2026-02-11",
                "home_team_id": 3,
                "away_team_id": 4,
                "home_team_name": "C",
                "away_team_name": "D",
            },
            {
                "game_id": "after",
                "date": "2026-02-12",
                "home_team_id": 5,
                "away_team_id": 6,
                "home_team_name": "E",
                "away_team_name": "F",
            },
        ]
    )

    rows = await fetch_games(
        supabase,
        season="2025-26",
        date_from=date(2026, 2, 11),
        date_to=date(2026, 2, 11),
        team_id=None,
        team_abbr=None,
        per_team=False,
    )

    assert supabase.last_games_filters["and"] == "(date.gte.2026-02-11,date.lte.2026-02-11)"
    assert [row["game_id"] for row in rows] == ["in_range"]
    assert rows[0]["season"] == "2025-26"


@pytest.mark.asyncio
async def test_fetch_games_team_filter_handles_string_team_ids():
    supabase = DummySupabaseGames(
        games=[
            {
                "game_id": "game_1",
                "date": "2026-02-11",
                "home_team_id": "1610612737",
                "away_team_id": "1610612738",
                "home_team_name": "Hawks",
                "away_team_name": "Celtics",
            },
            {
                "game_id": "game_2",
                "date": "2026-02-11",
                "home_team_id": "1610612747",
                "away_team_id": "1610612748",
                "home_team_name": "Lakers",
                "away_team_name": "Heat",
            },
        ]
    )

    rows = await fetch_games(
        supabase,
        season="2025-26",
        date_from=None,
        date_to=None,
        team_id=1610612737,
        team_abbr=None,
        per_team=False,
    )

    assert [row["game_id"] for row in rows] == ["game_1"]
