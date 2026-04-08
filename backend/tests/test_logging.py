import json
import logging
import sys

from app.logging import JsonFormatter, configure_logging


def test_json_formatter_includes_extras():
    record = logging.LogRecord("test", logging.INFO, __file__, 10, "hello %s", ("world",), None)
    record.request_id = "req-1"
    record.client_host = "127.0.0.1"
    record.path = "/ping"
    record.extra = {"foo": "bar"}

    payload = json.loads(JsonFormatter().format(record))

    assert payload["message"] == "hello world"
    assert payload["request_id"] == "req-1"
    assert payload["client_host"] == "127.0.0.1"
    assert payload["path"] == "/ping"
    assert payload["foo"] == "bar"


def test_json_formatter_includes_exception():
    try:
        raise ValueError("boom")
    except ValueError:
        record = logging.LogRecord("test", logging.ERROR, __file__, 11, "oops", (), None)
        record.exc_info = sys.exc_info()
        payload = json.loads(JsonFormatter().format(record))

    assert "exc_info" in payload
    assert payload["message"] == "oops"


def test_json_formatter_redacts_sensitive_urls_in_production():
    record = logging.LogRecord(
        "test",
        logging.ERROR,
        __file__,
        12,
        "supabase failed at %s",
        ("https://abc.supabase.co/rest/v1/players",),
        None,
    )
    record.extra = {"cache_url": "https://nba-cache.upstash.io"}
    payload = json.loads(JsonFormatter(redact_sensitive_urls=True).format(record))

    assert payload["message"] == "supabase failed at [redacted-supabase-url]"
    assert payload["cache_url"] == "[redacted-upstash-url]"


def test_configure_logging_sets_level():
    configure_logging("debug", "json", "development")
    root = logging.getLogger()
    assert root.level == logging.DEBUG
    assert root.handlers
    assert isinstance(root.handlers[0].formatter, JsonFormatter)
