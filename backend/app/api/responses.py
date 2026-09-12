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
        source=getattr(request.state, "data_source", "service"),
        as_of=(
            cache.as_of
            if cache is not None and cache.as_of is not None
            else getattr(request.state, "data_as_of", None)
        ),
        stale=cache.stale if cache is not None else False,
        cache=cache,
        pagination=pagination,
    )
    return Envelope[T](data=data, meta=meta)
