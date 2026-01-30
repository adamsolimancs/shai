"""Structured logging helpers."""

from __future__ import annotations

import json
import logging
import os
import re
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
        extras = _extract_extras(record)
        if extras:
            payload.update(extras)
        return json.dumps(payload, default=str)


class PrettyFormatter(logging.Formatter):
    """Human-readable log formatter with key=value extras."""

    def format(self, record: logging.LogRecord) -> str:  # noqa: D401 - standard override
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(record.created))
        message = record.getMessage()
        extras = _extract_extras(record)
        path = extras.pop("path", None)
        method = extras.pop("method", None)
        source = extras.pop("source", None)
        status = extras.pop("status_code", None)
        duration = extras.pop("duration_ms", None)
        request_id = extras.pop("request_id", None)
        client_host = extras.pop("client_host", None)

        route_bits = []
        if method or path:
            route_bits.append(f"{method or ''} {path or ''}".strip())
        if source:
            route_bits.append(f"SOURCE={source}")
        if status is not None:
            route_bits.append(f"status={status}")
        if duration is not None:
            route_bits.append(f"duration_ms={duration}")

        base = f"{timestamp} {record.levelname:<5} {record.name} {message}"
        if route_bits:
            base = f"{timestamp} {record.levelname:<5} {record.name} {' '.join(route_bits)}"
        elif record.name == "uvicorn.access":
            base = f"{timestamp} {record.levelname:<5} {record.name} {_colorize_access(message)}"
        if record.exc_info:
            base = f"{base}\n{self.formatException(record.exc_info)}"
        tail_bits = []
        if request_id:
            tail_bits.append(f"request_id={request_id}")
        if client_host:
            tail_bits.append(f"client={client_host}")
        if extras:
            tail_bits.extend(f"{key}={value}" for key, value in extras.items())
        if tail_bits:
            base = f"{base} {' '.join(tail_bits)}"
        return base


def _extract_extras(record: logging.LogRecord) -> dict[str, Any]:
    reserved = {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "module",
        "msecs",
        "message",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "thread",
        "threadName",
    }
    extras: dict[str, Any] = {}
    for key, value in record.__dict__.items():
        if key in reserved:
            continue
        if value is None:
            continue
        if key == "extra" and isinstance(value, Mapping):
            for inner_key, inner_value in value.items():
                if inner_value is None:
                    continue
                extras[inner_key] = inner_value
            continue
        extras[key] = value
    return extras


def _colorize_access(message: str) -> str:
    if not _use_color():
        return message
    match = re.search(r'"([^"]+)"', message)
    if not match:
        return message
    colored = f"\x1b[32m{match.group(1)}\x1b[0m"
    return message.replace(match.group(1), colored, 1)


def _use_color() -> bool:
    return sys.stdout.isatty() and os.environ.get("LOG_COLOR", "1") != "0"


def configure_logging(level: str = "INFO", log_format: str = "pretty") -> None:
    """Configure root logging output."""

    handler = logging.StreamHandler(sys.stdout)
    formatter: logging.Formatter
    if (log_format or "").lower() == "json":
        formatter = JsonFormatter()
    else:
        formatter = PrettyFormatter()
    handler.setFormatter(formatter)
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        handlers=[handler],
        force=True,
    )

    access_logger = logging.getLogger("uvicorn.access")
    access_logger.handlers = [handler]
    access_logger.propagate = False
