from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator, Optional

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass

DATABASE_URL: str = os.getenv(
    "DATABASE_URL", "postgresql+psycopg2://postgres:password@localhost:5432/hab_db"
)

POOL_SIZE: int = int(os.getenv("DB_POOL_SIZE", 5))
MAX_OVERFLOW: int = int(os.getenv("DB_MAX_OVERFLOW", 5))
POOL_RECYCLE: int = int(os.getenv("DB_POOL_RECYCLE", 1800))
POOL_PRE_PING: bool = os.getenv("DB_POOL_PRE_PING", "true").lower() == "true"

STATEMENT_TIMEOUT_MS: Optional[int] = (
    int(os.getenv("DB_STATEMENT_TIMEOUT_MS"))
    if os.getenv("DB_STATEMENT_TIMEOUT_MS")
    else None
)
SEARCH_PATH: Optional[str] = os.getenv("DB_SEARCH_PATH")


# Engine Factory

_engine: Optional[Engine] = None


def get_engine(echo: bool = False) -> Engine:
    """
    Create (or return) the shared SQLAlchemy Engine

    echo=True prints SQL for debugging. Pool pre-ping ensures broken connections are recycled. We set isolation_level to "AUTOCOMMIT"-friendly behaviour
    via session scopes; leave engine default transactional mode.
    """
    global _engine
    if _engine is not None and not _engine.pool.dispose_called:
        return _engine

    _engine = create_engine(
        DATABASE_URL,
        echo=echo,
        pool_size=POOL_SIZE,
        max_overflow=MAX_OVERFLOW,
        pool_recycle=POOL_RECYCLE,
        pool_pre_ping=POOL_PRE_PING,
        future=True,
    )

    @event.listens_for(_engine, "connect")
    def _on_connect(dbapi_conn, connection_record):
        # Apply optional Postgres settings for each new connection
        with dbapi_conn.cursor() as cur:
            if STATEMENT_TIMEOUT_MS is not None:
                cur.execute(f"SET statement_timeout = {STATEMENT_TIMEOUT_MS}")
            if SEARCH_PATH:
                cur.execute(f"SET search_path TO {SEARCH_PATH}")

    return _engine


# Session handling

_SessionFactory: Optional[sessionmaker[Session]] = None


def get_session_factory() -> sessionmaker[Session]:
    global _SessionFactory
    if _SessionFactory is None:
        _SessionFactory = sessionmaker(
            bind=get_engine(), autoflush=False, expire_on_commit=False, future=True
        )
    return _SessionFactory


@contextmanager
def session_scope() -> Iterator[Session]:
    """
    Provide a transactional scope around a series of operations

    Example::
        with sessions_scope() as s:
            s.add(obj)
            s.flush()
            # s.execute(text("..."))

            On exception, the transaction is rolled back; otherwise committed.
    """
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception as e:
        session.rollback()
        raise e
    finally:
        session.close()


# Utilities
def exec_sql(sql: str) -> None:
    """Execute a raw SQL statement."""
    with session_scope() as session:
        session.execute(text(sql))


def healthcheck() -> bool:
    """Simple connectivity check; returns True if SELECT 1 succeeds."""
    try:
        with session_scope() as s:
            s.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
