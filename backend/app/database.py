"""Asynchronous PostgreSQL adapter used by the API service."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from collections.abc import Iterable
from datetime import date, datetime
from typing import Any

import asyncpg

from .config import Settings

_IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*$")


def _identifier(value: str) -> str:
    if not _IDENTIFIER.fullmatch(value):
        raise ValueError(f"Invalid SQL identifier: {value!r}")
    return value


def _json_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def _row_dict(row: asyncpg.Record) -> dict[str, Any]:
    # Text IDs and JSON-looking text must retain their PostgreSQL types.
    return {
        key: value.isoformat() if isinstance(value, (datetime, date)) else value
        for key, value in dict(row).items()
    }


class DatabaseClient:
    """Small, pooled Postgres client matching the application's storage needs."""

    def __init__(self, settings: Settings):
        if not settings.database_url:
            raise ValueError("DATABASE_URL is required for database access.")
        self._database_url = settings.database_url
        self._schema = _identifier(settings.database_schema)
        self._pool: asyncpg.Pool | None = None

    async def _get_pool(self) -> asyncpg.Pool:
        if self._pool is None:
            self._pool = await asyncpg.create_pool(
                self._database_url,
                min_size=1,
                max_size=10,
                command_timeout=30,
            )
        return self._pool

    def _table(self, table: str) -> str:
        return f'"{self._schema}"."{_identifier(table)}"'

    @staticmethod
    def _where(filters: dict[str, str] | None, args: list[Any]) -> str:
        if not filters:
            return ""
        clauses: list[str] = []
        for column, expression in filters.items():
            if column == "and":
                inner = expression.removeprefix("(").removesuffix(")")
                nested: dict[str, str] = {}
                for part in inner.split(","):
                    name, operator, value = part.split(".", 2)
                    nested[f"{name}__{len(nested)}"] = f"{operator}.{value}"
                for nested_column, nested_expression in nested.items():
                    actual_column = nested_column.split("__", 1)[0]
                    clauses.append(
                        DatabaseClient._condition(actual_column, nested_expression, args)
                    )
                continue
            clauses.append(DatabaseClient._condition(column, expression, args))
        return " WHERE " + " AND ".join(clauses)

    @staticmethod
    def _condition(column: str, expression: str, args: list[Any]) -> str:
        quoted = f'"{_identifier(column)}"'
        operator, separator, raw_value = expression.partition(".")
        if not separator:
            raise ValueError(f"Invalid filter expression: {expression!r}")
        if operator == "in":
            raw_items = raw_value.removeprefix("(").removesuffix(")")
            values = [item for item in raw_items.split(",") if item]
            args.append(values)
            return f"{quoted}::text = ANY(${len(args)}::text[])"
        sql_operator = {
            "eq": "=",
            "neq": "<>",
            "gt": ">",
            "gte": ">=",
            "lt": "<",
            "lte": "<=",
            "like": "LIKE",
            "ilike": "ILIKE",
        }.get(operator)
        if sql_operator is None:
            raise ValueError(f"Unsupported filter operator: {operator!r}")
        value = raw_value.replace("*", "%") if operator in {"like", "ilike"} else raw_value
        args.append(value)
        return f"{quoted}::text {sql_operator} ${len(args)}"

    async def select(
        self,
        table: str,
        *,
        filters: dict[str, str] | None = None,
        order: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
        columns: Iterable[str] | None = None,
    ) -> list[dict[str, Any]]:
        selected = "*" if columns is None else ", ".join(f'"{_identifier(c)}"' for c in columns)
        args: list[Any] = []
        query = f"SELECT {selected} FROM {self._table(table)}"
        query += self._where(filters, args)
        if order:
            column, _, direction = order.partition(".")
            direction_sql = "DESC" if direction.lower() == "desc" else "ASC"
            query += f' ORDER BY "{_identifier(column)}" {direction_sql}'
        if limit is not None:
            args.append(limit)
            query += f" LIMIT ${len(args)}"
        if offset is not None:
            args.append(offset)
            query += f" OFFSET ${len(args)}"
        pool = await self._get_pool()
        return [_row_dict(row) for row in await pool.fetch(query, *args)]

    async def select_one(
        self, table: str, *, filters: dict[str, str] | None = None
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
                table, filters=filters, order=order, limit=page_size, offset=offset
            )
            rows.extend(chunk)
            if len(chunk) < page_size:
                return rows
            offset += page_size

    async def upsert(self, table: str, rows: list[dict[str, Any]], *, on_conflict: str) -> None:
        if not rows:
            return
        conflict_columns = [_identifier(column.strip()) for column in on_conflict.split(",")]
        grouped: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            grouped[tuple(sorted(row))].append(row)
        pool = await self._get_pool()
        async with pool.acquire() as connection, connection.transaction():
            for columns, group in grouped.items():
                safe_columns = [_identifier(column) for column in columns]
                updates = [column for column in safe_columns if column not in conflict_columns]
                update_sql = ", ".join(f'"{column}" = EXCLUDED."{column}"' for column in updates)
                conflict_sql = ", ".join(f'"{column}"' for column in conflict_columns)
                action = f"DO UPDATE SET {update_sql}" if update_sql else "DO NOTHING"
                column_sql = ", ".join(f'"{column}"' for column in safe_columns)
                query = (
                    f"INSERT INTO {self._table(table)} "
                    f"({column_sql}) "
                    f"SELECT {column_sql} FROM jsonb_populate_record("
                    f"NULL::{self._table(table)}, $1::jsonb) "
                    f"ON CONFLICT ({conflict_sql}) {action}"
                )
                values = [(json.dumps(row),) for row in group]
                await connection.executemany(query, values)

    async def rpc(self, function_name: str, params: dict[str, Any] | None = None) -> Any:
        function_name = _identifier(function_name)
        params = params or {}
        safe_params = [_identifier(name) for name in params]
        args = [
            json.dumps(value) if isinstance(value, (dict, list)) else value
            for value in params.values()
        ]
        assignments = ", ".join(
            f'"{name}" := ${index}' for index, name in enumerate(safe_params, start=1)
        )
        pool = await self._get_pool()
        if function_name == "search_suggestions":
            rows = await pool.fetch(
                f'SELECT * FROM "{self._schema}"."{function_name}"({assignments})', *args
            )
            return [_row_dict(row) for row in rows]
        if function_name == "publish_game_snapshot":
            assignments = ", ".join(
                f'"{name}" := ${index}::jsonb' for index, name in enumerate(safe_params, start=1)
            )
        row = await pool.fetchrow(
            f'SELECT "{self._schema}"."{function_name}"({assignments}) AS result', *args
        )
        return _json_value(row["result"]) if row else None

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
