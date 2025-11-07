"""Shared utility helpers."""

from __future__ import annotations

import re
from collections.abc import Sequence
from datetime import date, datetime
from typing import TypeVar

from fastapi import HTTPException, status

from .schemas import PaginationMeta

SEASON_REGEX = re.compile(r"^(?P<start>\d{4})-(?P<end>\d{2})$")

T = TypeVar("T")


def validate_season(season: str) -> str:
    match = SEASON_REGEX.match(season or "")
    if not match:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_SEASON", "message": "Season must be formatted as YYYY-YY.", "retryable": False},
        )
    start_year = int(match.group("start"))
    end_suffix = int(match.group("end"))
    expected_end = (start_year + 1) % 100
    if expected_end != end_suffix:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "INVALID_SEASON",
                "message": "Season end year must match start+1 (e.g. 2024-25).",
                "retryable": False,
            },
        )
    return season


def parse_date(value: str | None, field: str) -> date | None:
    if not value:
        return None
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "INVALID_DATE",
                "message": f"{field} must use YYYY-MM-DD.",
                "retryable": False,
            },
        ) from exc
    return parsed


def validate_date_range(date_from: date | None, date_to: date | None) -> None:
    if date_from and date_to and date_from > date_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "INVALID_RANGE",
                "message": "date_from must be on/before date_to.",
                "retryable": False,
            },
        )


def paginate(items: Sequence[T], page: int, page_size: int) -> tuple[list[T], PaginationMeta]:
    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size
    sliced = list(items[start:end])
    next_page = page + 1 if end < total else None
    prev_page = page - 1 if page > 1 else None
    meta = PaginationMeta(
        total=total,
        page=page,
        page_size=page_size,
        next=next_page,
        prev=prev_page,
    )
    return sliced, meta
