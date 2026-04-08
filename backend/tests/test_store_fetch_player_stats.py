from datetime import date

import pytest

from app.services.store import (
    fetch_api_snapshot,
    fetch_games,
    fetch_player_career,
    fetch_player_info,
    fetch_player_stats,
)


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

    async def select_one(self, table: str, **kwargs):
        if table == "player_info":
            filters = kwargs.get("filters") or {}
            player_id = str(filters.get("player_id", "")).removeprefix("eq.")
            return next(
                (row for row in self._player_info if str(row.get("player_id")) == player_id),
                None,
            )
        if table == "api_snapshots":
            filters = kwargs.get("filters") or {}
            cache_key = str(filters.get("cache_key", "")).removeprefix("eq.")
            snapshots = getattr(self, "_snapshots", [])
            return next(
                (row for row in snapshots if row.get("cache_key") == cache_key),
                None,
            )
        raise AssertionError(f"Unexpected select_one table: {table}")


class DummySupabaseGames:
    def __init__(self, *, games, teams=None):
        self._games = games
        self._teams = teams or {}
        self.last_games_filters = None

    async def select(self, table: str, **kwargs):
        if table == "games":
            self.last_games_filters = kwargs.get("filters") or {}
            return [dict(row) for row in self._games]
        if table == "teams":
            return list(self._teams.values())
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


@pytest.mark.asyncio
async def test_fetch_games_per_team_expands_each_game():
    supabase = DummySupabaseGames(
        games=[
            {
                "game_id": "game_1",
                "date": "2026-02-11",
                "home_team_id": "1610612737",
                "away_team_id": "1610612738",
                "home_team_name": "Hawks",
                "away_team_name": "Celtics",
                "home_team_score": 110,
                "away_team_score": 101,
            }
        ],
        teams={
            "ATL": {"team_id": "1610612737", "abbreviation": "ATL"},
            "BOS": {"team_id": "1610612738", "abbreviation": "BOS"},
        },
    )

    rows = await fetch_games(
        supabase,
        season="2025-26",
        date_from=None,
        date_to=None,
        team_id=None,
        team_abbr=None,
        per_team=True,
    )

    assert len(rows) == 2
    assert rows[0]["team_abbreviation"] == "ATL"
    assert rows[0]["matchup"] == "ATL vs. BOS"
    assert rows[0]["result"] == "W"
    assert rows[1]["team_abbreviation"] == "BOS"
    assert rows[1]["matchup"] == "BOS @ ATL"
    assert rows[1]["result"] == "L"


@pytest.mark.asyncio
async def test_fetch_player_info_uses_player_info_table():
    supabase = DummySupabase(
        player_stats=[],
        players=[],
        player_info=[
            {
                "player_id": "2544",
                "display_name": "LeBron James",
                "first_name": "LeBron",
                "last_name": "James",
                "position": "F",
                "jersey": "23",
                "birthdate": "1984-12-30T00:00:00",
                "school": "St. Vincent-St. Mary HS",
                "country": "USA",
                "season_experience": "21",
                "roster_status": "Active",
                "from_year": "2003",
                "to_year": "2026",
                "team_id": "1610612747",
                "team_name": "Lakers",
                "team_abbreviation": "LAL",
            }
        ],
        teams=[],
    )

    row = await fetch_player_info(supabase, player_id=2544)

    assert row["display_name"] == "LeBron James"
    assert row["birthdate"].isoformat() == "1984-12-30"
    assert row["team_abbreviation"] == "LAL"


@pytest.mark.asyncio
async def test_fetch_player_career_uses_player_season_stats():
    supabase = DummySupabase(
        player_stats=[
            {
                "player_id": "2544",
                "season": "2024-25",
                "season_type": "Regular Season",
                "team_id": "1610612747",
                "games_played": "70",
                "games_started": "70",
                "minutes_pg": "34.9",
                "points_pg": "25.7",
                "rebounds_pg": "7.3",
                "assists_pg": "8.3",
                "steals_pg": "1.2",
                "blocks_pg": "0.6",
                "field_goal_pct_pg": "0.52",
                "three_point_pct_pg": "0.39",
                "free_throw_pct_pg": "0.77",
                "true_shooting_pct_pg": "0.63",
            }
        ],
        players=[],
        player_info=[],
        teams=[{"team_id": "1610612747", "abbreviation": "LAL"}],
    )

    rows = await fetch_player_career(
        supabase,
        player_id=2544,
        season_type="Regular Season",
    )

    assert len(rows) == 1
    assert rows[0]["season_id"] == "2024-25"
    assert rows[0]["team_abbreviation"] == "LAL"
    assert rows[0]["points"] == pytest.approx(25.7)


@pytest.mark.asyncio
async def test_fetch_api_snapshot_parses_json_payload():
    supabase = DummySupabase(
        player_stats=[],
        players=[],
        player_info=[],
        teams=[],
    )
    supabase._snapshots = [
        {
            "cache_key": "snapshot:key",
            "payload": '[{"player_id": 1, "player_name": "Sample"}]',
        }
    ]

    payload = await fetch_api_snapshot(supabase, "snapshot:key")

    assert payload == [{"player_id": 1, "player_name": "Sample"}]
