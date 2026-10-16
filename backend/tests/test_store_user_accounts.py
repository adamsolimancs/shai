import pytest

from app.services.store import (
    fetch_user_account_by_auth_user_id,
    fetch_user_account_by_username,
    update_user_account_profile,
    upsert_user_account,
)

LEGACY_ID = "2f0c6a52-3f43-4c1e-9d55-5f3b0f1d7a10"


class DummySupabase:
    def __init__(self):
        self.select_one_calls = []
        self.upsert_calls = []
        self.rows_by_auth_user_id = {
            "auth-123": {
                "auth_user_id": "auth-123",
                "email": "player@example.com",
                "name": "Player One",
                "username": "playerone",
            }
        }
        self.rows_by_username = {
            "playerone": self.rows_by_auth_user_id["auth-123"],
        }

    def _matches(self, row, filters):
        return all(
            row.get(column) == value.removeprefix("eq.") for column, value in filters.items()
        )

    async def select_one(self, table, *, filters=None):
        self.select_one_calls.append((table, filters))
        if table != "user_accounts" or not filters:
            return None
        if "auth_user_id" in filters:
            value = filters["auth_user_id"].removeprefix("eq.")
            return self.rows_by_auth_user_id.get(value)
        if "username" in filters:
            value = filters["username"].removeprefix("eq.")
            return self.rows_by_username.get(value)
        return next(
            (row for row in self.rows_by_auth_user_id.values() if self._matches(row, filters)),
            None,
        )

    async def upsert(self, table, rows, *, on_conflict):
        self.upsert_calls.append((table, rows, on_conflict))
        row = {**self.rows_by_auth_user_id.get(rows[0]["auth_user_id"], {}), **rows[0]}
        self.rows_by_auth_user_id[row["auth_user_id"]] = row
        if row.get("username"):
            self.rows_by_username[row["username"]] = row

    async def update(self, table, values, *, filters):
        updated = []
        for key, row in list(self.rows_by_auth_user_id.items()):
            if not self._matches(row, filters):
                continue
            new_row = {**row, **values}
            del self.rows_by_auth_user_id[key]
            self.rows_by_auth_user_id[new_row["auth_user_id"]] = new_row
            self.rows_by_username = {
                name: existing
                for name, existing in self.rows_by_username.items()
                if existing is not row
            }
            if new_row.get("username"):
                self.rows_by_username[new_row["username"]] = new_row
            updated.append(new_row)
        return updated


@pytest.mark.asyncio
async def test_fetch_user_account_by_auth_user_id_returns_normalized_row():
    supabase = DummySupabase()

    row = await fetch_user_account_by_auth_user_id(supabase, auth_user_id="auth-123")

    assert row == {
        "auth_user_id": "auth-123",
        "email": "player@example.com",
        "name": "Player One",
        "username": "playerone",
    }


@pytest.mark.asyncio
async def test_fetch_user_account_by_username_normalizes_lookup():
    supabase = DummySupabase()

    row = await fetch_user_account_by_username(supabase, username=" PlayerOne ")

    assert row == {
        "auth_user_id": "auth-123",
        "email": "player@example.com",
        "name": "Player One",
        "username": "playerone",
    }


@pytest.mark.asyncio
async def test_upsert_user_account_lowercases_username_and_email():
    supabase = DummySupabase()

    row = await upsert_user_account(
        supabase,
        auth_user_id="auth-456",
        email="NEWUSER@EXAMPLE.COM",
        name="New User",
        username="New_User",
    )

    assert row == {
        "auth_user_id": "auth-456",
        "email": "newuser@example.com",
        "name": "New User",
        "username": "new_user",
    }
    assert supabase.upsert_calls[0][0] == "user_accounts"
    assert supabase.upsert_calls[0][2] == "auth_user_id"


@pytest.mark.asyncio
async def test_upsert_user_account_preserves_saved_profile_on_sign_in():
    supabase = DummySupabase()

    row = await upsert_user_account(
        supabase,
        auth_user_id="auth-123",
        email="player@example.com",
        email_verified=True,
        name="Google Display Name",
    )

    assert row["name"] == "Player One"
    assert row["username"] == "playerone"
    assert supabase.rows_by_auth_user_id["auth-123"]["username"] == "playerone"


@pytest.mark.asyncio
async def test_upsert_user_account_claims_legacy_account_for_verified_email():
    supabase = DummySupabase()
    supabase.rows_by_auth_user_id[LEGACY_ID] = {
        "auth_user_id": LEGACY_ID,
        "email": "legacy@example.com",
        "name": "Legacy Name",
        "username": "legacy_user",
    }

    row = await upsert_user_account(
        supabase,
        auth_user_id="google:001234567890",
        email="Legacy@Example.com",
        email_verified=True,
        name="Google Name",
    )

    assert row == {
        "auth_user_id": "google:001234567890",
        "email": "legacy@example.com",
        "name": "Legacy Name",
        "username": "legacy_user",
    }
    assert LEGACY_ID not in supabase.rows_by_auth_user_id


@pytest.mark.asyncio
async def test_upsert_user_account_does_not_claim_without_verified_email():
    supabase = DummySupabase()
    supabase.rows_by_auth_user_id[LEGACY_ID] = {
        "auth_user_id": LEGACY_ID,
        "email": "legacy@example.com",
        "name": "Legacy Name",
        "username": "legacy_user",
    }

    await upsert_user_account(
        supabase,
        auth_user_id="google:001234567890",
        email="legacy@example.com",
        email_verified=False,
    )

    assert supabase.rows_by_auth_user_id[LEGACY_ID]["username"] == "legacy_user"


@pytest.mark.asyncio
async def test_upsert_user_account_does_not_claim_another_provider_subject():
    supabase = DummySupabase()

    await upsert_user_account(
        supabase,
        auth_user_id="google:999",
        email="player@example.com",
        email_verified=True,
    )

    assert supabase.rows_by_auth_user_id["auth-123"]["username"] == "playerone"


@pytest.mark.asyncio
async def test_update_user_account_profile_updates_only_existing_accounts():
    supabase = DummySupabase()

    updated = await update_user_account_profile(
        supabase, auth_user_id="auth-123", name=" Renamed ", username="New_Handle"
    )
    missing = await update_user_account_profile(
        supabase, auth_user_id="google:missing", name="Nobody", username=None
    )

    assert updated == {
        "auth_user_id": "auth-123",
        "email": "player@example.com",
        "name": "Renamed",
        "username": "new_handle",
    }
    assert missing is None
