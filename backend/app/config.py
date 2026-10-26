"""Application settings loaded from environment variables."""

from __future__ import annotations

from collections.abc import Sequence
from functools import lru_cache

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration for the NBA data API."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", hide_input_in_errors=True
    )

    api_key: str = Field(
        "dev-secret-key",
        description="Shared secret for x-api-key authentication.",
    )
    port: int = Field(8080, ge=1, le=65535)
    log_level: str = Field("INFO")
    upstash_redis_rest_url: str | None = Field(
        None,
        validation_alias=AliasChoices("UPSTASH_REDIS_REST_URL"),
    )
    upstash_redis_rest_token: str | None = Field(
        None,
        validation_alias=AliasChoices("UPSTASH_REDIS_REST_TOKEN"),
    )
    cache_default_ttl_seconds: int = Field(
        60 * 60 * 2,
        description="Fallback TTL when none is specified.",
    )
    cache_stale_ttl_seconds: int = Field(
        60 * 60 * 24 * 7,
        description="How long stale cache copies live.",
    )
    rate_limit_requests_per_minute: int = Field(240, ge=1)
    rate_limit_service_requests_per_minute: int = Field(6000, ge=1)
    readiness_timeout_seconds: float = Field(2.0, ge=0.1, le=30)
    cache_redis_timeout_seconds: float = Field(0.5, ge=0.05, le=5)
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
    enable_hot_cache_refresh: bool = Field(
        False,
        validation_alias=AliasChoices(
            "ENABLE_HOT_CACHE_REFRESH",
            "HOT_CACHE_REFRESH_ENABLED",
        ),
        description="Start the background hot-cache refresh loop on startup.",
    )
    environment: str = Field(
        "development",
        validation_alias=AliasChoices("environment", "BACKEND_ENV", "ENVIRONMENT"),
    )
    allow_nba_api_in_production: bool = Field(
        False,
        validation_alias=AliasChoices(
            "ALLOW_NBA_API_IN_PRODUCTION",
            "NBA_API_ALLOW_IN_PROD",
        ),
        description="When false, production avoids direct NBA API calls unless cached.",
    )
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
    database_schema: str = Field("public", validation_alias=AliasChoices("DATABASE_SCHEMA"))
    hot_cache_keys: list[str] = Field(default_factory=list)
    enable_integration_tests: bool = False
    cache_key_prefix: str = Field("nba:serve")
    admin_api_key: str | None = None
    log_format: str = Field("pretty", validation_alias=AliasChoices("LOG_FORMAT"))

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() in {"production", "prod"}

    @model_validator(mode="after")
    def validate_production(self) -> Settings:
        if self.is_production:
            if len(self.api_key.strip()) < 32 or self.api_key.strip().lower() in {
                "dev-secret-key",
                "replace-me",
                "change-me",
            }:
                raise ValueError(
                    "Production API_KEY must be an explicit secret of at least 32 characters"
                )
            if not self.database_url or not self.database_url.strip():
                raise ValueError("Production DATABASE_URL is required")
        return self

    @property
    def nba_api_calls_allowed(self) -> bool:
        env = (self.environment or "").strip().lower()
        if env in {"production", "prod"}:
            return self.allow_nba_api_in_production
        return True

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
