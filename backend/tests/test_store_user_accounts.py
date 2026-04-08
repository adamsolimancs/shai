import pytest

from app.services.store import (
    fetch_user_account_by_auth_user_id,
    fetch_user_account_by_username,
    upsert_user_account,
)


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
        return None

    async def upsert(self, table, rows, *, on_conflict):
        self.upsert_calls.append((table, rows, on_conflict))
        row = rows[0]
        self.rows_by_auth_user_id[row["auth_user_id"]] = row
        if row.get("username"):
            self.rows_by_username[row["username"]] = row


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
