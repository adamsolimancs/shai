from datetime import UTC, datetime

import pytest

from app.cache import InMemoryCacheBackend
from app.config import Settings
from app.schemas import NewsArticle
from app.services.news import NewsService, ScrapedArticle


class DummySupabase:
    def __init__(self, rows=None):
        self.rows = rows or []

    async def select(self, table, **kwargs):
        assert table == "news_articles"
        return list(self.rows)


def _service(settings: Settings | None = None, supabase: DummySupabase | None = None):
    settings = settings or Settings()
    cache = InMemoryCacheBackend(settings)
    return NewsService(settings, cache, supabase), cache


def test_normalize_espn_article():
    service, _ = _service()
    item = {
        "id": "123",
        "headline": "Test Headline",
        "links": {"web": {"href": "https://example.com/story"}},
        "description": "<p>Short summary</p>",
        "published": "Tue, 10 Oct 2024 10:00:00 GMT",
        "images": [{"href": "https://example.com/image.jpg"}],
    }
    article = service._normalize_espn_article(item)
    assert article is not None
    assert article.source == "ESPN"
    assert article.title == "Test Headline"
    assert article.summary == "Short summary"
    assert article.image_url == "https://example.com/image.jpg"


def test_normalize_espn_article_missing_fields():
    service, _ = _service()
    assert service._normalize_espn_article({"headline": "Missing link"}) is None
    assert service._normalize_espn_article({"links": {"web": {"href": "x"}}}) is None


def test_parse_rss_feed_filters_keywords():
    service, _ = _service()
    xml = """
    <rss><channel>
      <item>
        <title>NBA news</title>
        <link>https://example.com/nba</link>
        <description><![CDATA[Great game]]></description>
        <pubDate>Tue, 10 Oct 2024 10:00:00 GMT</pubDate>
      </item>
      <item>
        <title>NFL news</title>
        <link>https://example.com/nfl</link>
        <description><![CDATA[Football]]></description>
        <pubDate>Tue, 10 Oct 2024 11:00:00 GMT</pubDate>
      </item>
    </channel></rss>
    """
    articles = service._parse_rss_feed(xml, source="SportsCenter", keyword_filters=("nba",))
    assert len(articles) == 1
    assert articles[0].title == "NBA news"


def test_dedupe_articles_prefers_latest():
    service, _ = _service()
    older = ScrapedArticle(
        id="1",
        source="ESPN",
        title="Older",
        summary="",
        url="https://example.com/story",
        published_at=datetime(2024, 1, 1, tzinfo=UTC),
    )
    newer = ScrapedArticle(
        id="2",
        source="ESPN",
        title="Newer",
        summary="",
        url="https://example.com/story",
        published_at=datetime(2024, 2, 1, tzinfo=UTC),
    )
    deduped = service._dedupe_articles([older, newer])
    assert len(deduped) == 1
    assert deduped[0].title == "Newer"


def test_parse_datetime_handles_iso_and_rfc():
    service, _ = _service()
    iso = service._parse_datetime("2024-10-10T10:00:00Z")
    assert iso.tzinfo == UTC
    rfc = service._parse_datetime("Tue, 10 Oct 2024 10:00:00 GMT")
    assert rfc.tzinfo == UTC


@pytest.mark.asyncio
async def test_get_latest_uses_cache():
    settings = Settings()
    service, cache = _service(settings)
    payload = [
        NewsArticle(
            id="1",
            source="ESPN",
            title="Cached",
            summary="",
            url="https://example.com/story",
            published_at=datetime(2024, 1, 1, tzinfo=UTC),
        ).model_dump()
    ]
    await cache.set("news:latest", payload, ttl=60)

    articles, meta = await service.get_latest()
    assert meta.hit is True
    assert meta.stale is False
    assert articles[0].title == "Cached"


@pytest.mark.asyncio
async def test_get_latest_returns_stale_on_failure(monkeypatch: pytest.MonkeyPatch):
    settings = Settings()
    service, cache = _service(settings)
    payload = [
        NewsArticle(
            id="1",
            source="ESPN",
            title="Stale",
            summary="",
            url="https://example.com/story",
            published_at=datetime(2024, 1, 1, tzinfo=UTC),
        ).model_dump()
    ]
    await cache.set("news:latest", payload, ttl=0)

    async def fail_scrape():
        raise RuntimeError("down")

    monkeypatch.setattr(service, "_scrape_sources", fail_scrape)

    articles, meta = await service.get_latest()
    assert meta.hit is True
    assert meta.stale is True
    assert articles[0].title == "Stale"


@pytest.mark.asyncio
async def test_get_latest_prefers_db_before_upstream(monkeypatch: pytest.MonkeyPatch):
    rows = [
        {
            "id": "db-1",
            "source": "CBS Sports",
            "title": "From DB",
            "summary": "Stored summary",
            "url": "https://example.com/db-story",
            "published_at": "2024-01-01T00:00:00+00:00",
            "image_url": None,
        }
    ]
    service, cache = _service(Settings(), DummySupabase(rows))

    async def fail_scrape():
        raise AssertionError("news scrape should not run when db data exists")

    monkeypatch.setattr(service, "_scrape_sources", fail_scrape)

    articles, meta = await service.get_latest()

    assert meta.hit is False
    assert meta.stale is False
    assert articles[0].title == "From DB"
    cached = await cache.get("news:latest")
    assert cached[0]["title"] == "From DB"


@pytest.mark.asyncio
async def test_get_latest_returns_empty_in_production_without_cache_or_db():
    settings = Settings(environment="production")
    service, _ = _service(settings)

    articles, meta = await service.get_latest()

    assert articles == []
    assert meta.hit is False
    assert meta.stale is False


@pytest.mark.asyncio
async def test_scrape_sources_aggregates_and_limits(monkeypatch: pytest.MonkeyPatch):
    settings = Settings(news_max_articles=5)
    service, _ = _service(settings)

    async def fetch_espn():
        return [
            ScrapedArticle(
                id="1",
                source="ESPN",
                title="A",
                summary="",
                url="https://example.com/a",
                published_at=datetime(2024, 1, 3, tzinfo=UTC),
            ),
            ScrapedArticle(
                id="2",
                source="ESPN",
                title="B",
                summary="",
                url="https://example.com/b",
                published_at=datetime(2024, 1, 4, tzinfo=UTC),
            ),
        ]

    async def fetch_sc():
        return [
            ScrapedArticle(
                id="3",
                source="SportsCenter",
                title="C",
                summary="",
                url="https://example.com/c",
                published_at=datetime(2024, 1, 2, tzinfo=UTC),
            ),
            ScrapedArticle(
                id="4",
                source="SportsCenter",
                title="D",
                summary="",
                url="https://example.com/d",
                published_at=datetime(2024, 1, 1, tzinfo=UTC),
            ),
        ]

    async def fetch_cbs():
        return [
            ScrapedArticle(
                id="5",
                source="CBS",
                title="E",
                summary="",
                url="https://example.com/e",
                published_at=datetime(2024, 1, 5, tzinfo=UTC),
            ),
            ScrapedArticle(
                id="6",
                source="CBS",
                title="F",
                summary="",
                url="https://example.com/f",
                published_at=datetime(2024, 1, 6, tzinfo=UTC),
            ),
        ]

    monkeypatch.setattr(service, "_fetch_espn_json", fetch_espn)
    monkeypatch.setattr(service, "_fetch_sportscenter_rss", fetch_sc)
    monkeypatch.setattr(service, "_fetch_cbs_rss", fetch_cbs)

    articles = await service._scrape_sources()
    assert len(articles) == 5
    assert articles[0].title == "F"
    assert articles[-1].title == "C"
