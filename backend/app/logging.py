"""Structured logging helpers."""

from __future__ import annotations

import json
import logging
import sys
import time
from collections.abc import Mapping
from typing import Any


class JsonFormatter(logging.Formatter):
    """Simple JSON log formatter with support for request metadata."""

    def format(self, record: logging.LogRecord) -> str:  # noqa: D401 - standard override
        payload: dict[str, Any] = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.gmtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        for attr in ("request_id", "client_host", "path"):
            value = getattr(record, attr, None)
            if value:
                payload[attr] = value
        extra = getattr(record, "extra", None)
        if isinstance(extra, Mapping):
            payload.update(extra)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    """Configure root logging to emit JSON."""

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=getattr(logging, level.upper(), logging.INFO), handlers=[handler], force=True)
