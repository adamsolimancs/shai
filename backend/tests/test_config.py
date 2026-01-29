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


def test_get_settings_cached():
    get_settings.cache_clear()
    first = get_settings()
    second = get_settings()
    assert first is second
