import pytest
from fastapi import HTTPException, status

from app.auth import require_api_key
from app.config import Settings


def test_require_api_key_missing_config():
    settings = Settings(api_key="")
    with pytest.raises(HTTPException) as excinfo:
        require_api_key(settings, None)
    assert excinfo.value.status_code == 500
    assert excinfo.value.detail["code"] == "CONFIG_ERROR"


def test_require_api_key_invalid():
    settings = Settings(api_key="secret")
    with pytest.raises(HTTPException) as excinfo:
        require_api_key(settings, "nope")
    assert excinfo.value.status_code == status.HTTP_401_UNAUTHORIZED
    assert excinfo.value.detail["code"] == "UNAUTHORIZED"


def test_require_api_key_valid():
    settings = Settings(api_key="secret")
    assert require_api_key(settings, "secret") == "secret"
