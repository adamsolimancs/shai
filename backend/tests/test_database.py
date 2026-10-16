import pytest

from app.config import Settings
from app.database import DatabaseClient, _identifier


def test_database_client_requires_database_url():
    with pytest.raises(ValueError, match="DATABASE_URL"):
        DatabaseClient(Settings(_env_file=None, database_url=None))


def test_database_client_accepts_neon_url():
    client = DatabaseClient(Settings(_env_file=None, database_url="postgresql://user:pass@host/db"))
    assert client._schema == "public"


def test_identifier_rejects_injection():
    with pytest.raises(ValueError, match="Invalid SQL identifier"):
        _identifier("players; drop table players")


def test_where_parameterizes_filters():
    args = []
    where = DatabaseClient._where({"season": "eq.2025", "full_name": "ilike.*james*"}, args)
    assert where == ' WHERE "season"::text = $1 AND "full_name"::text ILIKE $2'
    assert args == ["2025", "%james%"]
