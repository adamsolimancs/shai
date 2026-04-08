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

_SENSITIVE_URL_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(r"https?://[^\s'\"]*supabase\.co[^\s'\"]*", re.IGNORECASE),
        "[redacted-supabase-url]",
    ),
    (
        re.compile(r"https?://[^\s'\"]*upstash(?:redis)?\.(?:io|com)[^\s'\"]*", re.IGNORECASE),
        "[redacted-upstash-url]",
    ),
)


def _redact_sensitive_text(text: str, *, redact: bool) -> str:
    if not redact or not text:
        return text
    sanitized = text
    for pattern, replacement in _SENSITIVE_URL_PATTERNS:
        sanitized = pattern.sub(replacement, sanitized)
    return sanitized


def _sanitize_value(value: Any, *, redact: bool) -> Any:
    if not redact:
        return value
    if isinstance(value, str):
        return _redact_sensitive_text(value, redact=redact)
    if isinstance(value, Mapping):
        return {key: _sanitize_value(inner, redact=redact) for key, inner in value.items()}
    if isinstance(value, list):
        return [_sanitize_value(item, redact=redact) for item in value]
    if isinstance(value, tuple):
        return tuple(_sanitize_value(item, redact=redact) for item in value)
    return value


class JsonFormatter(logging.Formatter):
    """Simple JSON log formatter with support for request metadata."""

    def __init__(self, *, redact_sensitive_urls: bool = False) -> None:
        super().__init__()
        self._redact_sensitive_urls = redact_sensitive_urls

    def format(self, record: logging.LogRecord) -> str:  # noqa: D401 - standard override
        payload: dict[str, Any] = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.gmtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "message": _redact_sensitive_text(
                record.getMessage(),
                redact=self._redact_sensitive_urls,
            ),
        }
        if record.exc_info:
            payload["exc_info"] = _redact_sensitive_text(
                self.formatException(record.exc_info),
                redact=self._redact_sensitive_urls,
            )
        extras = _extract_extras(record, redact_sensitive_urls=self._redact_sensitive_urls)
        if extras:
            payload.update(extras)
        return json.dumps(payload, default=str)


class PrettyFormatter(logging.Formatter):
    """Human-readable log formatter with key=value extras."""

    def __init__(self, *, redact_sensitive_urls: bool = False) -> None:
        super().__init__()
        self._redact_sensitive_urls = redact_sensitive_urls

    def format(self, record: logging.LogRecord) -> str:  # noqa: D401 - standard override
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(record.created))
        message = _redact_sensitive_text(
            record.getMessage(),
            redact=self._redact_sensitive_urls,
        )
        extras = _extract_extras(record, redact_sensitive_urls=self._redact_sensitive_urls)
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
            formatted_exc = _redact_sensitive_text(
                self.formatException(record.exc_info),
                redact=self._redact_sensitive_urls,
            )
            base = f"{base}\n{formatted_exc}"
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


def _extract_extras(
    record: logging.LogRecord,
    *,
    redact_sensitive_urls: bool = False,
) -> dict[str, Any]:
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
                extras[inner_key] = _sanitize_value(inner_value, redact=redact_sensitive_urls)
            continue
        extras[key] = _sanitize_value(value, redact=redact_sensitive_urls)
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


def configure_logging(
    level: str = "INFO",
    log_format: str = "pretty",
    environment: str = "development",
) -> None:
    """Configure root logging output."""

    handler = logging.StreamHandler(sys.stdout)
    formatter: logging.Formatter
    redact_sensitive_urls = (environment or "").strip().lower() in {"production", "prod"}
    if (log_format or "").lower() == "json":
        formatter = JsonFormatter(redact_sensitive_urls=redact_sensitive_urls)
    else:
        formatter = PrettyFormatter(redact_sensitive_urls=redact_sensitive_urls)
    handler.setFormatter(formatter)
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        handlers=[handler],
        force=True,
    )

    access_logger = logging.getLogger("uvicorn.access")
    access_logger.handlers = [handler]
    access_logger.propagate = False
