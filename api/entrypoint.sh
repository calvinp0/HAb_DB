#!/usr/bin/env bash
set -euo pipefail

PGHOST="${POSTGRES_HOST:-db}"
PGPORT="${POSTGRES_PORT:-5432}"
PGUSER="${POSTGRES_USER:-chem}"
PGDB="${POSTGRES_DB:-hab_db}"

echo "Waiting for Postgres at $PGHOST:$PGPORT ..."
# quick loop even though we also have a healthcheck; double-safety.
for i in {1..60}; do
  if pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; then
    echo "Postgres is ready."
    break
  fi
  sleep 2
done

# run migrations
echo "Running Alembic migrations..."
alembic upgrade head

# start API
echo "Starting Uvicorn..."
exec uvicorn api.app:app --host 0.0.0.0 --port 8000 "$@"
