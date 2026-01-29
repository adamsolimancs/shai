"""Supabase REST client for read-only access."""

from __future__ import annotations

from typing import Any

import httpx

from .config import Settings


class SupabaseClient:
    """Minimal Supabase REST wrapper for selects."""

    def __init__(self, settings: Settings):
        if not settings.supabase_url or not settings.supabase_key:
            raise ValueError("Supabase settings are required for DB reads.")
        self._base_url = settings.supabase_url.rstrip("/")
        self._schema = settings.supabase_schema
        self._headers = {
            "apikey": settings.supabase_key,
            "Authorization": f"Bearer {settings.supabase_key}",
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

    async def close(self) -> None:
        await self._client.aclose()
