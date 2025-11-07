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
from .cache import CacheBackend, init_cache
from .config import get_settings
from .logging import configure_logging
from .middleware import RequestContextMiddleware
from .rate_limit import RateLimiter
from .resolvers import NameResolver
from .schemas import ErrorDetail, ErrorEnvelope
from .services.nba import NBAStatsClient

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level)
    cache, redis_client = await init_cache(settings)
    resolver = NameResolver(cache)
    await resolver.initialize()
    nba_client = NBAStatsClient(settings, cache, resolver)
    rate_limiter = RateLimiter(settings.rate_limit_requests_per_minute, redis_client)

    app.state.settings = settings
    app.state.cache = cache
    app.state.redis = redis_client
    app.state.resolver = resolver
    app.state.nba_client = nba_client
    app.state.rate_limiter = rate_limiter

    refresh_task = asyncio.create_task(_refresh_loop(nba_client))
    app.state.background_tasks = [refresh_task]
    try:
        yield
    finally:
        for task in getattr(app.state, "background_tasks", []):
            task.cancel()
        await cache.close()


app = FastAPI(
    title="NBA Data API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

settings = get_settings()

app.add_middleware(RequestContextMiddleware, settings=settings)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET"],
    allow_headers=["*"],
    allow_credentials=settings.cors_allow_credentials,
)

app.include_router(v1_router)


@app.get("/healthz", include_in_schema=False)
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readiness", include_in_schema=False)
async def readiness(request: Request) -> dict[str, str]:
    cache = cast(CacheBackend, request.app.state.cache)
    status_text = "ok"
    try:
        await cache.get("readiness:noop")
    except Exception as exc:
        status_text = f"degraded: {exc}"
    return {"status": status_text}


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    if isinstance(exc.detail, dict):
        error_detail = ErrorDetail(**exc.detail)
    else:
        error_detail = ErrorDetail(code="HTTP_ERROR", message=str(exc.detail), retryable=False)
    payload = ErrorEnvelope(ok=False, error=error_detail)
    return JSONResponse(status_code=exc.status_code, content=payload.model_dump())


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
