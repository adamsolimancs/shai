from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.config import Settings
from app.middleware import RequestContextMiddleware


def _build_app():
    settings = Settings(request_id_header="x-request-id")
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware, settings=settings)

    @app.get("/ping")
    def ping(request: Request):
        return {"request_id": request.state.request_id}

    return app


def test_request_context_middleware_preserves_header():
    app = _build_app()
    client = TestClient(app)
    response = client.get("/ping", headers={"x-request-id": "req-123"})
    assert response.status_code == 200
    assert response.headers.get("x-request-id") == "req-123"
    assert response.json()["request_id"] == "req-123"


def test_request_context_middleware_generates_header():
    app = _build_app()
    client = TestClient(app)
    response = client.get("/ping")
    assert response.status_code == 200
    assert response.headers.get("x-request-id")
    assert response.json()["request_id"]
