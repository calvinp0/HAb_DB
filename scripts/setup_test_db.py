#!/usr/bin/env python
"""
Ensure a dedicated test database exists (and is migrated) before running pytest.

Usage:
    python scripts/setup_test_db.py \
        --source-url postgresql+psycopg2://chem:chem@localhost:5432/hab_db

Arguments are optional; the script falls back to TEST_DATABASE_URL/DATABASE_URL env vars.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from typing import Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine.url import make_url, URL
from sqlalchemy.exc import OperationalError


def _render(url: URL) -> str:
    return url.render_as_string(hide_password=False)


def _derive_test_url(
    test_url: Optional[str],
    source_url: Optional[str],
) -> str:
    if test_url:
        return test_url
    if source_url:
        url = make_url(source_url)
        name = url.database or "hab_db"
        return _render(url.set(database=f"{name}_test"))
    return "postgresql+psycopg2://chem:chem@localhost:5432/hab_db_test"


def ensure_database_exists(url_str: str, admin_db: str) -> None:
    url = make_url(url_str)
    db_name = url.database
    if not db_name:
        raise ValueError("Test database URL must include a database name")

    admin_url = url.set(database=admin_db)
    engine = create_engine(
        _render(admin_url), isolation_level="AUTOCOMMIT", future=True
    )
    try:
        with engine.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname=:name"),
                {"name": db_name},
            ).scalar()
            if exists:
                print(f"[setup_test_db] Database '{db_name}' already exists")
                return

            safe_name = db_name.replace('"', '""')
            print(f"[setup_test_db] Creating database '{db_name}'")
            conn.exec_driver_sql(f'CREATE DATABASE "{safe_name}"')
    except OperationalError as exc:
        raise RuntimeError(
            f"Failed to connect as admin to create database '{db_name}': {exc}"
        ) from exc
    finally:
        engine.dispose()


def migrate_database(url_str: str, alembic_ini: str, run_migrations: bool) -> None:
    if not run_migrations:
        return
    env = os.environ.copy()
    env["DATABASE_URL"] = url_str
    print("[setup_test_db] Running alembic upgrade head")
    subprocess.run(
        [sys.executable, "-m", "alembic", "-c", alembic_ini, "upgrade", "head"],
        check=True,
        env=env,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Create and migrate the test database.")
    parser.add_argument(
        "--test-url",
        dest="test_url",
        default=os.getenv("TEST_DATABASE_URL"),
        help="Full SQLAlchemy URL for the test database (overrides everything else)",
    )
    parser.add_argument(
        "--source-url",
        dest="source_url",
        default=os.getenv("DATABASE_URL"),
        help="Existing DATABASE_URL used to infer host/user/password",
    )
    parser.add_argument(
        "--admin-db",
        dest="admin_db",
        default=os.getenv("TEST_ADMIN_DB", "postgres"),
        help="Database to connect to when issuing CREATE DATABASE (default: postgres)",
    )
    parser.add_argument(
        "--alembic-ini",
        dest="alembic_ini",
        default="alembic.ini",
        help="Path to alembic.ini when running migrations",
    )
    parser.add_argument(
        "--skip-migrations",
        dest="skip_migrations",
        action="store_true",
        help="Create the database but skip alembic upgrade",
    )
    args = parser.parse_args()

    test_url = _derive_test_url(args.test_url, args.source_url)
    print(f"[setup_test_db] Target test DB URL: {test_url}")

    ensure_database_exists(test_url, args.admin_db)
    migrate_database(test_url, args.alembic_ini, not args.skip_migrations)

    print(
        "[setup_test_db] Done! Export TEST_DATABASE_URL to point pytest at the new database."
    )


if __name__ == "__main__":
    main()
