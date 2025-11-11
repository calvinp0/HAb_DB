import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.engine.url import make_url
from fastapi.testclient import TestClient

from api.app import app
from api.deps import get_db
from db.models import Base  # if you want to create schema in a fresh DB


def _resolve_test_database_url() -> str:
    """
    Prefer TEST_DATABASE_URL; otherwise clone DATABASE_URL but append `_test`.
    Last resort falls back to the docker-compose defaults.
    """
    explicit = os.getenv("TEST_DATABASE_URL")
    if explicit:
        return explicit

    base = os.getenv("DATABASE_URL")
    if base:
        try:
            base_url = make_url(base)
            db_name = base_url.database or "hab_db"
            return base_url.set(database=f"{db_name}_test").render_as_string(
                hide_password=False
            )
        except Exception:
            pass

    return "postgresql+psycopg2://chem:chem@localhost:5432/hab_db_test"


TEST_DATABASE_URL = _resolve_test_database_url()
os.environ.setdefault("TEST_DATABASE_URL", TEST_DATABASE_URL)

# 2) one Engine per test session
engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(
    bind=engine, autoflush=False, expire_on_commit=False, future=True
)


@pytest.fixture(scope="session", autouse=True)
def _ensure_schema():
    # If you point at a real, empty test DB:
    # Base.metadata.create_all(engine)
    # If you prefer alembic, run it here instead.
    yield
    # Base.metadata.drop_all(engine)  # optional


@pytest.fixture
def db_session():
    """
    Open a DB connection, start a transaction, give the test a Session bound to it,
    and roll it back at the end so the DB stays clean.
    """
    connection = engine.connect()
    trans = connection.begin()
    session = SessionLocal(bind=connection)
    try:
        yield session
    finally:
        session.close()
        trans.rollback()
        connection.close()


@pytest.fixture
def client(db_session):
    """
    Override FastAPI's get_db dependency to use our transactional session.
    """

    def _override():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
