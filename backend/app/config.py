"""Application settings loaded from environment variables."""

from __future__ import annotations

from collections.abc import Sequence
from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration for the NBA data API."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    api_key: str = Field(
        "dev-secret-key",
        description="Shared secret for x-api-key authentication.",
    )
    port: int = Field(8080, ge=1, le=65535)
    log_level: str = Field("INFO")
    redis_url: str = Field("redis://redis:6379/0")
    cache_default_ttl_seconds: int = Field(
        60 * 60 * 2,
        description="Fallback TTL when none is specified.",
    )
    cache_stale_ttl_seconds: int = Field(
        60 * 60 * 24 * 7,
        description="How long stale cache copies live.",
    )
    rate_limit_requests_per_minute: int = Field(240, ge=1)
    cors_allow_origins: str = Field(
        "*",
        description="Comma-separated origins or * for all.",
    )
    allowed_docs_origins: str = Field("*")
    upstream_timeout_seconds: float = Field(10.0, ge=0.1)
    upstream_retry_attempts: int = Field(3, ge=1)
    upstream_retry_backoff_seconds: float = Field(0.75, ge=0.01)
    pagination_default_page_size: int = Field(50, ge=1)
    pagination_max_page_size: int = Field(200, ge=1)
    cache_refresh_cron_hour_utc: int = Field(9, ge=0, le=23)
    environment: str = Field("development")
    cors_allow_credentials: bool = False
    cors_allow_methods: Sequence[str] = ("GET",)
    cors_allow_headers: Sequence[str] = ("*",)
    news_cache_ttl_seconds: int = Field(
        600,
        ge=60,
        description="TTL for scraped news payloads.",
    )
    news_http_timeout_seconds: float = Field(
        8.0,
        ge=0.5,
        description="Per-request timeout for news scrapers.",
    )
    news_max_articles: int = Field(
        40,
        ge=5,
        le=200,
        description="Maximum number of news articles to retain.",
    )
    enable_docs: bool = True
    request_id_header: str = Field("x-request-id")
    readiness_startup_delay_seconds: float = Field(2.0, ge=0.0)
    supported_season_start_year: int = Field(1996, ge=1946)
    database_url: str | None = None
    supabase_url: str | None = Field(None, validation_alias=AliasChoices("SUPABASE_URL"))
    supabase_key: str | None = Field(
        None,
        validation_alias=AliasChoices("SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    )
    supabase_schema: str = Field("public")
    hot_cache_keys: list[str] = Field(default_factory=list)
    enable_integration_tests: bool = False
    cache_key_prefix: str = Field("nba:serve")
    admin_api_key: str | None = None

    @property
    def cors_origins(self) -> list[str]:
        if self.cors_allow_origins.strip() == "*":
            return ["*"]
        return [origin.strip() for origin in self.cors_allow_origins.split(",") if origin.strip()]

    @property
    def docs_origins(self) -> list[str]:
        if self.allowed_docs_origins.strip() == "*":
            return ["*"]
        return [origin.strip() for origin in self.allowed_docs_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return cached settings instance."""

    return Settings(**{})
