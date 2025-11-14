"""API key authentication helpers."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import APIKeyHeader

from .config import Settings, get_settings

api_key_header = APIKeyHeader(name="x-api-key", auto_error=False)


def require_api_key(
    settings: Annotated[Settings, Depends(get_settings)],
    api_key: Annotated[str | None, Security(api_key_header)],
) -> str:
    if not settings.api_key:
        raise HTTPException(
            status_code=500,
            detail={"code": "CONFIG_ERROR", "message": "API key unset."},
        )
    if api_key != settings.api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Invalid API key.", "retryable": False},
        )
    return api_key
