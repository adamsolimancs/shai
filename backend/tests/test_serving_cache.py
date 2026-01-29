from datetime import date

from app.config import Settings
from app.serving_cache import (
    cache_key,
    cache_prefix,
    boxscore_key,
    player_gamelog_key,
    scoreboard_key,
    standings_key,
    teams_key,
)


def test_cache_prefix_strips_trailing_colon():
    settings = Settings(cache_key_prefix="nba:serve:")
    assert cache_prefix(settings) == "nba:serve"


def test_cache_key_handles_empty_parts():
    settings = Settings(cache_key_prefix="nba:serve")
    assert cache_key(settings) == "nba:serve"
    assert cache_key(settings, "scoreboard", "2024-10-10") == "nba:serve:scoreboard:2024-10-10"


def test_scoreboard_key_accepts_date_objects():
    settings = Settings(cache_key_prefix="nba:serve")
    assert scoreboard_key(settings, date(2024, 10, 10)) == "nba:serve:scoreboard:2024-10-10"


def test_keys_build_expected_paths():
    settings = Settings(cache_key_prefix="nba:serve")
    assert boxscore_key(settings, "001") == "nba:serve:boxscore:001"
    assert standings_key(settings, "2024-25", "00", "Regular Season") == (
        "nba:serve:standings:2024-25:00:Regular Season"
    )
    assert teams_key(settings, "2024-25") == "nba:serve:teams:2024-25"


def test_player_gamelog_key_defaults_season_type():
    settings = Settings(cache_key_prefix="nba:serve")
    key = player_gamelog_key(settings, 99, "2024-25", "")
    assert key.endswith(":Regular Season")
