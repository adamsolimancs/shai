"""Custom ASGI middleware."""

from __future__ import annotations

import logging
import time
import uuid

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.types import ASGIApp

from .config import Settings

logger = logging.getLogger("request")


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Attach a request identifier and emit structured access logs."""

    def __init__(self, app: ASGIApp, settings: Settings):
        super().__init__(app)
        self.settings = settings

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = request.headers.get(self.settings.request_id_header) or str(uuid.uuid4())
        request.state.request_id = request_id
        start_time = time.perf_counter()

        response = await call_next(request)

        process_time_ms = (time.perf_counter() - start_time) * 1000
        response.headers[self.settings.request_id_header] = request_id

        logger.info(
            "access",
            extra={
                "request_id": request_id,
                "client_host": request.client.host if request.client else None,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": round(process_time_ms, 2),
            },
        )
        return response
