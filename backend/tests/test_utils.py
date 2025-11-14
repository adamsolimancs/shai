from datetime import date

import pytest
from fastapi import HTTPException

from app.utils import paginate, parse_date, validate_date_range, validate_season


def test_validate_season_ok():
    assert validate_season("2024-25") == "2024-25"


def test_validate_season_bad():
    with pytest.raises(HTTPException):
        validate_season("2024-24")


def test_parse_date_ok():
    assert parse_date("2024-10-10", "date_from") == date(2024, 10, 10)


def test_parse_date_none():
    assert parse_date(None, "date_from") is None


def test_validate_date_range():
    validate_date_range(date(2024, 1, 1), date(2024, 1, 2))
    with pytest.raises(HTTPException):
        validate_date_range(date(2024, 1, 3), date(2024, 1, 2))


def test_paginate_builds_meta():
    items = list(range(100))
    sliced, meta = paginate(items, page=2, page_size=10)
    assert sliced == list(range(10, 20))
    assert meta.next == 3
    assert meta.prev == 1
