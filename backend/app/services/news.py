"""Scrape external NBA news sources into a normalized feed."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any, Iterable, Sequence
from xml.etree import ElementTree

import httpx
from bs4 import BeautifulSoup
from fastapi import HTTPException, status

from ..cache import CacheBackend
from ..config import Settings
from ..schemas import CacheMeta, NewsArticle

logger = logging.getLogger(__name__)


class NewsUpstreamError(HTTPException):
    """Raised when all upstream news sources fail."""

    def __init__(self, message: str):
        super().__init__(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "NEWS_UPSTREAM_ERROR", "message": message, "retryable": True},
        )


@dataclass(slots=True)
class ScrapedArticle:
    """Internal representation before validation."""

    id: str
    source: str
    title: str
    summary: str
    url: str
    published_at: datetime
    image_url: str | None = None

    def to_model(self) -> NewsArticle:
        return NewsArticle(
            id=self.id,
            source=self.source,
            title=self.title,
            summary=self.summary,
            url=self.url,
            published_at=self.published_at,
            image_url=self.image_url,
        )


class NewsService:
    """Coordinator that fetches and caches league news from multiple outlets."""

    ESPN_NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news"
    SPORTSCENTER_RSS_URL = "https://www.espn.com/espn/rss/news"
    CBS_RSS_URL = "https://www.cbssports.com/rss/headlines/nba/"

    def __init__(self, settings: Settings, cache: CacheBackend):
        self.settings = settings
        self.cache = cache
        self._cache_key = "news:latest"
        self._client = httpx.AsyncClient(
            timeout=self.settings.news_http_timeout_seconds,
            headers={"user-agent": "nba-data-api-news-scraper/1.0"},
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def get_latest(self) -> tuple[list[NewsArticle], CacheMeta]:
        cached = await self.cache.get(self._cache_key)
        if cached is not None:
            try:
                return [NewsArticle(**item) for item in cached], CacheMeta(hit=True, stale=False)
            except Exception:  # pragma: no cover - cache corruption guard
                logger.warning("news cache payload invalid; refetching.")

        try:
            articles = await self._scrape_sources()
        except Exception as exc:
            stale = await self.cache.get_stale(self._cache_key)
            if stale:
                logger.warning("news scrape failed; serving stale copy.", extra={"error": str(exc)})
                return [NewsArticle(**item) for item in stale], CacheMeta(hit=True, stale=True)
            raise NewsUpstreamError("Unable to reach ESPN / SportsCenter / CBS feeds.") from exc

        serialized = [article.model_dump() for article in articles]
        await self.cache.set(self._cache_key, serialized, self.settings.news_cache_ttl_seconds)
        return articles, CacheMeta(hit=False, stale=False)

    async def _scrape_sources(self) -> list[NewsArticle]:
        tasks = [
            self._fetch_espn_json(),
            self._fetch_sportscenter_rss(),
            self._fetch_cbs_rss(),
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        aggregated: list[ScrapedArticle] = []
        for source_name, result in zip(("espn", "sportscenter", "cbs"), results, strict=True):
            if isinstance(result, Exception):
                logger.warning("news source failed", extra={"source": source_name, "error": str(result)})
                continue
            aggregated.extend(result)

        if not aggregated:
            raise RuntimeError("All news sources failed.")

        deduped = self._dedupe_articles(aggregated)
        deduped.sort(key=lambda art: art.published_at, reverse=True)
        trimmed = deduped[: self.settings.news_max_articles]
        return [article.to_model() for article in trimmed]

    async def _fetch_espn_json(self) -> list[ScrapedArticle]:
        response = await self._client.get(self.ESPN_NEWS_URL)
        response.raise_for_status()
        payload = response.json()
        articles: list[ScrapedArticle] = []
        for item in payload.get("articles", []):
            try:
                article = self._normalize_espn_article(item)
            except Exception:
                continue
            if article:
                articles.append(article)
        return articles

    async def _fetch_sportscenter_rss(self) -> list[ScrapedArticle]:
        response = await self._client.get(self.SPORTSCENTER_RSS_URL)
        response.raise_for_status()
        return self._parse_rss_feed(
            response.text,
            source="SportsCenter",
            keyword_filters=("nba", "basketball"),
        )

    async def _fetch_cbs_rss(self) -> list[ScrapedArticle]:
        response = await self._client.get(self.CBS_RSS_URL)
        response.raise_for_status()
        return self._parse_rss_feed(response.text, source="CBS Sports")

    def _normalize_espn_article(self, item: dict[str, Any]) -> ScrapedArticle | None:
        headline = item.get("headline") or item.get("title")
        link = (
            item.get("links", {})
            .get("web", {})
            .get("href")
        ) or item.get("link")
        if not headline or not link:
            return None
        description = item.get("description") or item.get("summary") or ""
        published_raw = item.get("published") or item.get("lastModified")
        published_at = self._parse_datetime(published_raw)
        image_url = self._extract_image(item.get("images", []))
        return ScrapedArticle(
            id=f"espn-{item.get('id') or hash(headline)}",
            source="ESPN",
            title=headline.strip(),
            summary=self._clean_html(description),
            url=link,
            published_at=published_at,
            image_url=image_url,
        )

    def _parse_rss_feed(
        self,
        xml_data: str,
        *,
        source: str,
        keyword_filters: Sequence[str] | None = None,
    ) -> list[ScrapedArticle]:
        articles: list[ScrapedArticle] = []
        root = ElementTree.fromstring(xml_data)
        for item in root.findall("./channel/item"):
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            description = self._clean_html(item.findtext("description") or "")
            publication = item.findtext("pubDate")
            if not title or not link:
                continue
            if keyword_filters and not self._matches_filters(title, description, keyword_filters):
                continue
            published_at = self._parse_datetime(publication)
            image_url = None
            enclosure = item.find("enclosure")
            if enclosure is not None:
                image_url = enclosure.attrib.get("url")
            articles.append(
                ScrapedArticle(
                    id=f"{source}-{hash(link)}",
                    source=source,
                    title=title,
                    summary=description,
                    url=link,
                    published_at=published_at,
                    image_url=image_url,
                )
            )
        return articles

    def _clean_html(self, html: str) -> str:
        soup = BeautifulSoup(html, "html.parser")
        text = soup.get_text(" ", strip=True)
        return text

    def _parse_datetime(self, value: str | None) -> datetime:
        if not value:
            return datetime.now(tz=UTC)
        try:
            parsed = parsedate_to_datetime(value)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
            return parsed.astimezone(UTC)
        except Exception:
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
            except Exception:
                return datetime.now(tz=UTC)

    def _matches_filters(self, title: str, description: str, filters: Sequence[str]) -> bool:
        haystack = f"{title} {description}".lower()
        return any(keyword.lower() in haystack for keyword in filters)

    def _extract_image(self, images: Iterable[dict[str, Any]]) -> str | None:
        for image in images:
            href = image.get("href") or image.get("url")
            if href:
                return href
        return None

    def _dedupe_articles(self, articles: Iterable[ScrapedArticle]) -> list[ScrapedArticle]:
        deduped: dict[str, ScrapedArticle] = {}
        for article in articles:
            key = article.url.lower()
            existing = deduped.get(key)
            if existing is None or article.published_at > existing.published_at:
                deduped[key] = article
        return list(deduped.values())
