"""Supabase REST client for backend reads and lightweight writes."""

from __future__ import annotations

from typing import Any

import httpx

from .config import Settings


class SupabaseClient:
    """Minimal Supabase REST wrapper for selects and upserts."""

    def __init__(self, settings: Settings):
        if not settings.supabase_url or not settings.supabase_key:
            raise ValueError("Supabase settings are required for DB reads.")
        self._base_url = settings.supabase_url.rstrip("/")
        self._schema = settings.supabase_schema
        self._auth_headers = {
            "apikey": settings.supabase_key,
            "Authorization": f"Bearer {settings.supabase_key}",
        }
        self._headers = {
            **self._auth_headers,
            "Accept-Profile": self._schema,
        }
        self._client = httpx.AsyncClient(timeout=10.0)

    async def select(
        self,
        table: str,
        *,
        filters: dict[str, str] | None = None,
        order: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[dict[str, Any]]:
        params: dict[str, str] = {"select": "*"}
        if filters:
            params.update(filters)
        if order:
            params["order"] = order
        if limit is not None:
            params["limit"] = str(limit)
        if offset is not None:
            params["offset"] = str(offset)
        url = f"{self._base_url}/rest/v1/{table}"
        response = await self._client.get(url, params=params, headers=self._headers)
        response.raise_for_status()
        return response.json()

    async def select_one(
        self,
        table: str,
        *,
        filters: dict[str, str] | None = None,
    ) -> dict[str, Any] | None:
        rows = await self.select(table, filters=filters, limit=1)
        return rows[0] if rows else None

    async def select_all(
        self,
        table: str,
        *,
        filters: dict[str, str] | None = None,
        order: str | None = None,
        page_size: int = 1000,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        offset = 0
        while True:
            chunk = await self.select(
                table,
                filters=filters,
                order=order,
                limit=page_size,
                offset=offset,
            )
            if not chunk:
                break
            rows.extend(chunk)
            if len(chunk) < page_size:
                break
            offset += page_size
        return rows

    async def upsert(
        self,
        table: str,
        rows: list[dict[str, Any]],
        *,
        on_conflict: str,
    ) -> None:
        if not rows:
            return
        url = f"{self._base_url}/rest/v1/{table}"
        response = await self._client.post(
            url,
            params={"on_conflict": on_conflict},
            json=rows,
            headers={
                **self._headers,
                "Content-Type": "application/json",
                "Content-Profile": self._schema,
                "Prefer": "resolution=merge-duplicates",
            },
        )
        response.raise_for_status()

    async def list_auth_users(self) -> list[dict[str, Any]]:
        url = f"{self._base_url}/auth/v1/admin/users"
        response = await self._client.get(url, headers=self._auth_headers)
        response.raise_for_status()
        body = response.json()
        users = body.get("users") if isinstance(body, dict) else None
        return users if isinstance(users, list) else []

    async def create_auth_user(
        self,
        *,
        email: str,
        user_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = f"{self._base_url}/auth/v1/admin/users"
        payload: dict[str, Any] = {
            "email": email,
            "email_confirm": True,
        }
        if user_metadata:
            payload["user_metadata"] = user_metadata
        response = await self._client.post(
            url,
            json=payload,
            headers={
                **self._auth_headers,
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()
        body = response.json()
        return body if isinstance(body, dict) else {}

    async def ensure_auth_user(
        self,
        *,
        email: str,
        user_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        normalized_email = email.strip().lower()
        for user in await self.list_auth_users():
            existing_email = user.get("email")
            if isinstance(existing_email, str) and existing_email.strip().lower() == normalized_email:
                return user
        return await self.create_auth_user(
            email=normalized_email,
            user_metadata=user_metadata,
        )

    async def rpc(self, function_name: str, params: dict[str, Any] | None = None) -> Any:
        url = f"{self._base_url}/rest/v1/rpc/{function_name}"
        response = await self._client.post(
            url,
            json=params or {},
            headers={
                **self._headers,
                "Content-Type": "application/json",
                "Accept-Profile": self._schema,
                "Content-Profile": self._schema,
            },
        )
        response.raise_for_status()
        if response.status_code == 204:
            return None
        return response.json()

    async def close(self) -> None:
        await self._client.aclose()
