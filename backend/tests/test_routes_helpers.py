from datetime import date

from app.api.routes import _filter_player_gamelog_rows


def test_filter_player_gamelog_rows_applies_date_window():
    rows = [
        {"game_id": "1", "game_date": date(2024, 10, 20)},
        {"game_id": "2", "game_date": date(2024, 10, 25)},
        {"game_id": "3", "game_date": date(2024, 10, 30)},
    ]

    filtered = _filter_player_gamelog_rows(
        rows,
        date_from=date(2024, 10, 21),
        date_to=date(2024, 10, 29),
    )

    assert [row["game_id"] for row in filtered] == ["2"]
