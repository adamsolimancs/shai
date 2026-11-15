"""Offline regression checks for the overnight snapshot import."""

import importlib.util
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "import_hoopr", Path(__file__).resolve().parents[1] / "import-hoopr.py"
)
hoopr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hoopr)


class HoopRImportTest(unittest.TestCase):
    def setUp(self):
        self.game = {
            "game_id": "11",
            "game_date": "2026-11-14",
            "season_type": "2",
            "status_type_name": "STATUS_FINAL",
            "away_id": "1",
            "away_abbreviation": "AWY",
            "away_display_name": "Away",
            "away_score": "10",
            "home_id": "2",
            "home_abbreviation": "HME",
            "home_display_name": "Home",
            "home_score": "20",
        }
        self.players = []
        self.teams = []
        for team_id, points in (("1", 2), ("2", 4)):
            self.teams.append(
                {
                    **dict.fromkeys(hoopr.MATCHED_STATS, "0"),
                    "game_id": "11",
                    "team_id": team_id,
                    "team_score": str(5 * points),
                    "field_goals_made": str(5 * points // 2),
                    "field_goals_attempted": str(5 * points // 2),
                }
            )
            for index in range(5):
                self.players.append(
                    {
                        **dict.fromkeys(hoopr.MATCHED_STATS, "0"),
                        "game_id": "11",
                        "team_id": team_id,
                        "athlete_id": f"{team_id}{index}",
                        "athlete_display_name": f"Player {team_id}{index}",
                        "did_not_play": "false",
                        "minutes": "48",
                        "points": str(points),
                        "rebounds": "0",
                        "field_goals_made": str(points // 2),
                        "field_goals_attempted": str(points // 2),
                    }
                )

    def snapshot(self):
        return hoopr.build_snapshot(
            [self.game],
            self.players,
            self.teams,
            date(2026, 11, 15),
            datetime(2026, 11, 15, tzinfo=timezone.utc),
        )

    def test_completed_game_publishes_scores_with_all_player_lines(self):
        (slate,) = self.snapshot()["slates"]
        (game,) = slate["games"]
        self.assertEqual(slate["date"], "2026-11-14")
        self.assertEqual((game["awayScore"], game["homeScore"]), (10, 20))
        self.assertEqual(len(game["players"]), 10)

    def test_scheduled_game_cannot_publish_a_slate(self):
        self.game["status_type_name"] = "STATUS_SCHEDULED"
        with self.assertRaisesRegex(ValueError, "still unresolved"):
            self.snapshot()

    def test_player_totals_that_disagree_with_the_final_score_fail(self):
        self.players[0]["points"] = "0"
        with self.assertRaisesRegex(ValueError, "Incomplete player box"):
            self.snapshot()
