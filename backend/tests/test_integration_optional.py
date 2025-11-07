import os

import pytest
from fastapi.testclient import TestClient

from app.main import app

pytestmark = pytest.mark.skipif(
    not os.getenv("ENABLE_NBA_INTEGRATION"), reason="Integration test disabled by default."
)


def test_integration_meta():
    with TestClient(app) as client:
        response = client.get("/healthz")
        assert response.status_code == 200
