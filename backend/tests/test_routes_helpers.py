from datetime import date

import pytest

from app.api.routes import _filter_player_gamelog_rows, _resolve_user_account_auth_user_id
from app.schemas import UserAccountSyncRequest


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


class DummyDatabase:
    pass


@pytest.mark.asyncio
async def test_resolve_user_account_auth_user_id_keeps_existing_uuid():
    database = DummyDatabase()
    payload = UserAccountSyncRequest(
        auth_user_id="fbdf5a53-161e-4460-98ad-0e39408d8689",
        email="scout@example.com",
        name="Scout",
        username="scout",
    )

    auth_user_id = await _resolve_user_account_auth_user_id(database, payload)

    assert auth_user_id == "fbdf5a53-161e-4460-98ad-0e39408d8689"


@pytest.mark.asyncio
async def test_resolve_user_account_auth_user_id_keeps_google_subject():
    database = DummyDatabase()
    payload = UserAccountSyncRequest(
        auth_user_id="google-oauth-subject",
        email="Scout@Example.com",
        name="Scout",
        username="Scout",
    )

    auth_user_id = await _resolve_user_account_auth_user_id(database, payload)

    assert auth_user_id == "google-oauth-subject"
