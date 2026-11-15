"""FastAPI application entrypoint."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import cast

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.routes import router as v1_router
from .cache import CacheBackend, InMemoryCacheBackend, init_cache
from .config import get_settings
from .database import DatabaseClient
from .logging import configure_logging
from .middleware import RequestContextMiddleware
from .rate_limit import RateLimiter
from .resolvers import NameResolver
from .schemas import ErrorDetail, ErrorEnvelope
from .services.nba import NBAStatsClient
from .services.news import NewsService

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_format, settings.environment)
    cache, redis_client = await init_cache(settings)
    database = DatabaseClient(settings) if settings.database_url else None
    resolver = NameResolver(cache, database, allow_upstream=settings.nba_api_calls_allowed)
    await resolver.initialize()
    nba_client = NBAStatsClient(settings, cache, resolver)
    news_client = NewsService(settings, cache, database)
    rate_limiter = RateLimiter(
        settings.rate_limit_requests_per_minute,
        redis_client,
        namespace=f"{settings.cache_key_prefix}:rl:visitor",
    )
    service_rate_limiter = RateLimiter(
        settings.rate_limit_service_requests_per_minute,
        redis_client,
        namespace=f"{settings.cache_key_prefix}:rl:service",
    )

    app.state.settings = settings
    app.state.cache = cache
    app.state.redis = redis_client
    app.state.database = database
    app.state.resolver = resolver
    app.state.nba_client = nba_client
    app.state.news_client = news_client
    app.state.rate_limiter = rate_limiter
    app.state.service_rate_limiter = service_rate_limiter

    app.state.background_tasks = []
    if settings.enable_hot_cache_refresh and settings.nba_api_calls_allowed:
        refresh_task = asyncio.create_task(_refresh_loop(nba_client))
        app.state.background_tasks.append(refresh_task)
    try:
        yield
    finally:
        for task in getattr(app.state, "background_tasks", []):
            task.cancel()
        await cache.close()
        if database:
            await database.close()
        await news_client.close()


settings = get_settings()

app = FastAPI(
    title="NBA Data API",
    version="1.0.0",
    docs_url="/docs" if settings.enable_docs else None,
    redoc_url="/redoc" if settings.enable_docs else None,
    openapi_url="/openapi.json" if settings.enable_docs else None,
    lifespan=lifespan,
)

configure_logging(settings.log_level, settings.log_format, settings.environment)

app.add_middleware(RequestContextMiddleware, settings=settings)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=list(settings.cors_allow_methods),
    allow_headers=list(settings.cors_allow_headers),
    allow_credentials=settings.cors_allow_credentials,
)

app.include_router(v1_router)


@app.get("/healthz", include_in_schema=False)
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readiness", include_in_schema=False)
async def readiness(request: Request) -> JSONResponse:
    cache = cast(CacheBackend, request.app.state.cache)
    database = cast(DatabaseClient | None, request.app.state.database)
    current_settings = request.app.state.settings

    async def cache_ok() -> bool:
        try:
            await asyncio.wait_for(
                cache.get("readiness:noop"), current_settings.readiness_timeout_seconds
            )
            return True
        except Exception:
            return False

    async def database_ok() -> bool:
        if database is None:
            return False
        try:
            await asyncio.wait_for(
                database.check_readiness(), current_settings.readiness_timeout_seconds
            )
            return True
        except Exception:
            return False

    cache_ready, database_ready = await asyncio.gather(cache_ok(), database_ok())
    ready = (
        database_ready if current_settings.is_production or database is not None else cache_ready
    )
    memory_fallback = (
        isinstance(cache, InMemoryCacheBackend)
        and bool(current_settings.upstash_redis_rest_url)
        and bool(current_settings.upstash_redis_rest_token)
    )
    cache_status = "unavailable"
    if cache_ready:
        cache_status = "memory_fallback" if memory_fallback else "ok"
    status_text = "unavailable"
    if ready:
        status_text = "ok" if cache_status == "ok" else "degraded"
    checks = {
        "cache": cache_status,
        "database": "ok" if database_ready else "unavailable" if database else "not_configured",
    }
    return JSONResponse(
        status_code=200 if ready else 503,
        content={
            "status": status_text,
            "checks": checks,
        },
        headers={"Cache-Control": "no-store"},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    if isinstance(exc.detail, dict):
        error_detail = ErrorDetail(**exc.detail)
    else:
        error_detail = ErrorDetail(code="HTTP_ERROR", message=str(exc.detail), retryable=False)
    payload = ErrorEnvelope(ok=False, error=error_detail)
    return JSONResponse(
        status_code=exc.status_code, content=payload.model_dump(), headers=exc.headers
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception", extra={"path": request.url.path})
    detail = ErrorDetail(code="INTERNAL_ERROR", message="Unexpected server error.", retryable=False)
    payload = ErrorEnvelope(ok=False, error=detail)
    return JSONResponse(status_code=500, content=payload.model_dump())


async def _refresh_loop(client: NBAStatsClient) -> None:
    while True:
        try:
            await client.refresh_hot_keys()
        except Exception:
            logger.exception("hot cache refresh failed")
        await asyncio.sleep(60 * 60 * 24)
