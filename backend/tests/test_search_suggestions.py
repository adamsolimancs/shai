import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import authenticate_and_rate_limit, router
from app.dependencies import get_database_client, get_resolver
from app.services.search import fetch_search_suggestions, search_resolver_catalog


class DummySupabase:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    async def rpc(self, function_name, params=None):
        self.calls.append((function_name, params))
        return self.payload


class DummyResolver:
    players = {
        "lebron james": {
            "id": 2544,
            "name": "LeBron James",
            "team_id": 1610612747,
        }
    }
    teams = {
        "los angeles lakers": {
            "id": 1610612747,
            "name": "Los Angeles Lakers",
            "abbreviation": "LAL",
        },
        "lakers": {
            "id": 1610612747,
            "name": "Los Angeles Lakers",
            "abbreviation": "LAL",
        },
        "lal": {
            "id": 1610612747,
            "name": "Los Angeles Lakers",
            "abbreviation": "LAL",
        },
    }


@pytest.mark.asyncio
async def test_fetch_search_suggestions_normalizes_canonical_urls():
    supabase = DummySupabase(
        [
            {
                "entity_type": "player",
                "entity_id": "2544",
                "display_name": "LeBron James",
                "secondary_text": "LAL",
            },
            {
                "entity_type": "team",
                "entity_id": 1610612747,
                "display_name": "Los Angeles Lakers",
                "secondary_text": "LAL",
            },
        ]
    )

    result = await fetch_search_suggestions(supabase, query="lakers", limit=8)

    assert supabase.calls == [("search_suggestions", {"p_query": "lakers", "p_limit": 8})]
    assert [item.url for item in result] == [
        "/players/2544",
        "/teams/los-angeles-lakers",
    ]


def test_search_resolver_catalog_deduplicates_team_aliases():
    result = search_resolver_catalog(DummyResolver(), query="la", limit=8)

    assert [(item.type, item.id) for item in result] == [
        ("team", 1610612747),
    ]
    assert result[0].url == "/teams/los-angeles-lakers"


def test_search_suggestions_endpoint_enforces_minimum_and_returns_envelope():
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[authenticate_and_rate_limit] = lambda: None
    app.dependency_overrides[get_database_client] = lambda: None
    app.dependency_overrides[get_resolver] = DummyResolver

    client = TestClient(app)
    too_short = client.get("/v1/search/suggestions", params={"q": "l"})
    response = client.get("/v1/search/suggestions", params={"q": "le", "limit": 8})

    assert too_short.status_code == 422
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"][0]["id"] == 2544
    assert body["data"][0]["url"] == "/players/2544"
