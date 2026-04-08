import pytest

from app.config import Settings, get_settings


def test_cors_origins_allows_star():
    settings = Settings()
    assert settings.cors_origins == ["*"]


def test_cors_origins_split():
    settings = Settings(cors_allow_origins=" https://a.com, https://b.com , ")
    assert settings.cors_origins == ["https://a.com", "https://b.com"]


def test_docs_origins_split():
    settings = Settings(allowed_docs_origins="https://docs.example.com, https://foo.bar")
    assert settings.docs_origins == ["https://docs.example.com", "https://foo.bar"]


def test_supabase_aliases(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    settings = Settings()
    assert settings.supabase_url == "https://example.supabase.co"
    assert settings.supabase_key == "service-key"


def test_hot_cache_refresh_disabled_by_default():
    settings = Settings()
    assert settings.enable_hot_cache_refresh is False


def test_backend_env_alias_controls_environment(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("BACKEND_ENV", "production")
    settings = Settings()
    assert settings.environment == "production"


def test_upstash_redis_aliases(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("UPSTASH_REDIS_REST_URL", "https://nba-cache.upstash.io")
    monkeypatch.setenv("UPSTASH_REDIS_REST_TOKEN", "rest-token")
    settings = Settings()
    assert settings.upstash_redis_rest_url == "https://nba-cache.upstash.io"
    assert settings.upstash_redis_rest_token == "rest-token"


def test_nba_api_calls_disabled_in_production_by_default():
    settings = Settings(environment="production")
    assert settings.nba_api_calls_allowed is False


def test_nba_api_calls_allowed_in_development():
    settings = Settings(environment="development")
    assert settings.nba_api_calls_allowed is True


def test_get_settings_cached():
    get_settings.cache_clear()
    first = get_settings()
    second = get_settings()
    assert first is second
