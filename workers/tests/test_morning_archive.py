import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "morning_archive", Path(__file__).resolve().parents[1] / "morning-archive.py"
)
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)


class PlayerIdentityTest(unittest.TestCase):
    def setUp(self):
        self.player = {"athlete_id": "4433188", "athlete_display_name": "Devin Carter"}
        self.prior_match = {
            "nba_player_id": "1642269",
            "espn_full_name": "Devin Carter",
            "nba_player_name": "Devin Carter",
        }

    def test_prior_season_match_preserves_nba_id_after_team_change(self):
        prior = {"4433188": [self.prior_match]}
        self.assertEqual(archive.resolve_player(self.player, {}, prior), 1642269)

    def test_prior_season_match_requires_same_name_and_unambiguous_id(self):
        for change in [
            {"nba_player_name": "Another Player"},
            {"nba_player_id": "1642270"},
        ]:
            with self.subTest(change=change):
                prior = {"4433188": [self.prior_match, {**self.prior_match, **change}]}
                with self.assertRaisesRegex(ValueError, "No unambiguous NBA ID"):
                    archive.resolve_player(self.player, {}, prior)

    def test_ambiguous_current_season_match_cannot_use_prior_match(self):
        current = {"4433188": [self.prior_match, {**self.prior_match, "nba_player_id": "1642270"}]}
        with self.assertRaisesRegex(ValueError, "No unambiguous NBA ID"):
            archive.resolve_player(self.player, current, {"4433188": [self.prior_match]})
