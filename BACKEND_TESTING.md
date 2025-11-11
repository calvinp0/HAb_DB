# Backend Test Instructions

Use this guide to stand up the dedicated Postgres database used by the backend
pytest suite and to run the new API-focused tests.

## 1. Prerequisites

- Python 3.12 environment with `pytest`, `sqlalchemy`, `psycopg2-binary`, RDKit,
  and the rest of `requirements.txt` installed (e.g., `pip install -r requirements.txt`).
- Docker Compose stack running the primary database (from the repo root):
  ```bash
  docker compose up -d db
  ```
- `alembic` available in the environment (provided via `pip install -r requirements.txt`).

## 2. Create the dedicated test database

Run the helper script once per machine (or whenever you drop the test DB). It
will clone your existing `DATABASE_URL`, append `_test`, create that database,
and run all migrations:

```bash
python scripts/setup_test_db.py \
  --source-url postgresql+psycopg2://chem:chem@127.0.0.1:5432/hab_db
```

Tips:

- Adjust the `--source-url` if you run Postgres elsewhere or with different
  credentials.
- Pass `--test-url ...` to override the full SQLAlchemy URL explicitly.
- The script sets `DATABASE_URL` while running Alembic, so no manual edits to
  `alembic.ini` are needed.

## 3. Point pytest at the test database

Export `TEST_DATABASE_URL` (or add it to your shell profile) so `tests/conftest.py`
connects to the isolated DB:

```bash
export TEST_DATABASE_URL=postgresql+psycopg2://chem:chem@127.0.0.1:5432/hab_db_test
```

If you skip this step, the fixtures will still try to use `DATABASE_URL`, but
they will automatically append `_test`. Setting the env var explicitly avoids
surprises.

## 4. Run the backend tests

Execute the focused suites that were added for the backend:

```bash
pytest tests/api/test_species_filters.py tests/api/test_reaction_helpers.py
```

You can, of course, run the entire API suite or the whole repository (`pytest`)
once the test DB is available.

## 5. Troubleshooting

- **`psycopg2.OperationalError`** – confirm Docker is running and the port
  (`127.0.0.1:5432`) is reachable. `docker compose ps` should show the `db`
  container healthy.
- **Enum value errors (e.g., `invalid input value for enum namesource`)** –
  ensure your factories provide enum values present in `db/sqltypes.py`.
- **Schema drift** – rerun `python scripts/setup_test_db.py ...` whenever new
  Alembic migrations land; it will apply any pending revisions to the test DB.

With the test database in place and `TEST_DATABASE_URL` exported, you can
rerun these steps any time to validate backend changes locally.
