"""Response helpers to keep envelopes consistent."""

from __future__ import annotations

from typing import TypeVar

from fastapi import Request

from ..schemas import CacheMeta, Envelope, PaginationMeta, ServiceMeta

T = TypeVar("T")


def success(
    request: Request,
    data: T,
    cache: CacheMeta | None = None,
    pagination: PaginationMeta | None = None,
) -> Envelope[T]:
    meta = ServiceMeta(
        request_id=getattr(request.state, "request_id", None),
        cache=cache,
        pagination=pagination,
    )
    return Envelope[T](data=data, meta=meta)
