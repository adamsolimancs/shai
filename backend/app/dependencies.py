"""FastAPI dependency helpers."""

from __future__ import annotations

from typing import Any, cast

from fastapi import Request

from .cache import CacheBackend
from .config import Settings, get_settings
from .rate_limit import RateLimiter
from .resolvers import NameResolver
from .services.nba import NBAStatsClient
from .services.news import NewsService
from .supabase import SupabaseClient


def get_app_state(request: Request) -> dict[str, Any]:
    return cast(dict[str, Any], request.app.state.__dict__)


def get_settings_dependency() -> Settings:
    return get_settings()


def get_nba_client(request: Request) -> NBAStatsClient:
    return cast(NBAStatsClient, request.app.state.nba_client)


def get_news_client(request: Request) -> NewsService:
    return cast(NewsService, request.app.state.news_client)


def get_cache_backend(request: Request) -> CacheBackend:
    return cast(CacheBackend, request.app.state.cache)


def get_supabase_client(request: Request) -> SupabaseClient | None:
    return cast(SupabaseClient | None, request.app.state.supabase)


def get_resolver(request: Request) -> NameResolver:
    return cast(NameResolver, request.app.state.resolver)


def get_rate_limiter(request: Request) -> RateLimiter:
    return cast(RateLimiter, request.app.state.rate_limiter)
