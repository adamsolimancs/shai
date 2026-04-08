import pytest

from app.services.store import fetch_boxscore


class DummySupabase:
    def __init__(self, *, rpc_payload=None, row=None, players=None, rpc_error: Exception | None = None):
        self.rpc_payload = rpc_payload
        self.row = row
        self.players = players or []
        self.rpc_error = rpc_error
        self.rpc_calls = []
        self.select_one_calls = []
        self.select_calls = []

    async def rpc(self, function_name: str, params: dict[str, str]):
        self.rpc_calls.append((function_name, params))
        if self.rpc_error:
            raise self.rpc_error
        return self.rpc_payload

    async def select_one(self, table: str, *, filters=None):
        self.select_one_calls.append((table, filters))
        return self.row

    async def select(self, table: str, *, filters=None, order=None, limit=None, offset=None):
        self.select_calls.append((table, filters, order, limit, offset))
        return self.players


@pytest.mark.asyncio
async def test_fetch_boxscore_uses_rpc_snapshot():
    supabase = DummySupabase(
        rpc_payload={
            "boxscore": {
                "game_id": "001",
                "status": "Final",
                "officials": '["Ref A"]',
                "home_team": '{"team_id": 10, "score": 110, "is_home": true, "leaders": []}',
                "away_team": '{"team_id": 20, "score": 102, "is_home": false, "leaders": []}',
                "line_score": '[{"label": "Q1", "home": 30, "away": 22}]',
                "team_totals": '[{"team_id": 10, "points": 110}, {"team_id": 20, "points": 102}]',
            },
            "players": [
                {
                    "player_id": "1",
                    "player_name": "Player One",
                    "team_id": 10,
                    "team_abbreviation": "HOM",
                    "minutes": "30:00",
                    "points": 30,
                    "offensive_rating": 120.5,
                }
            ],
        }
    )

    payload = await fetch_boxscore(supabase, "001")

    assert payload is not None
    assert payload["status"] == "Final"
    assert payload["officials"] == ["Ref A"]
    assert payload["home_team"]["score"] == 110
    assert payload["traditional_players"][0]["player_id"] == "1"
    assert payload["advanced_players"][0]["offensive_rating"] == 120.5
    assert supabase.rpc_calls == [("get_boxscore_snapshot", {"p_game_id": "001"})]
    assert supabase.select_one_calls == []
    assert supabase.select_calls == []


@pytest.mark.asyncio
async def test_fetch_boxscore_falls_back_to_table_reads_when_rpc_fails():
    supabase = DummySupabase(
        rpc_error=RuntimeError("rpc unavailable"),
        row={
            "game_id": "001",
            "status": "Final",
            "officials": "[]",
            "home_team": '{"team_id": 10, "score": 110, "is_home": true, "leaders": []}',
            "away_team": '{"team_id": 20, "score": 102, "is_home": false, "leaders": []}',
            "line_score": "[]",
            "team_totals": "[]",
        },
        players=[{"player_id": "1", "player_name": "Player One", "team_id": 10, "points": 30}],
    )

    payload = await fetch_boxscore(supabase, "001")

    assert payload is not None
    assert payload["traditional_players"][0]["player_name"] == "Player One"
    assert supabase.select_one_calls == [("boxscores", {"game_id": "eq.001"})]
    assert supabase.select_calls[0][0] == "boxscore_players"
