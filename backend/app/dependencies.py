"""FastAPI dependency helpers."""

from __future__ import annotations

from typing import Any, cast

from fastapi import Request

from .config import Settings, get_settings
from .rate_limit import RateLimiter
from .resolvers import NameResolver
from .services.nba import NBAStatsClient


def get_app_state(request: Request) -> dict[str, Any]:
    return cast(dict[str, Any], request.app.state.__dict__)


def get_settings_dependency() -> Settings:
    return get_settings()


def get_nba_client(request: Request) -> NBAStatsClient:
    return cast(NBAStatsClient, request.app.state.nba_client)


def get_resolver(request: Request) -> NameResolver:
    return cast(NameResolver, request.app.state.resolver)


def get_rate_limiter(request: Request) -> RateLimiter:
    return cast(RateLimiter, request.app.state.rate_limiter)
