# Repository Guidelines

## Project Structure & Module Organization
Backend code lives under `api/` (FastAPI routers, schemas, services) and `db/` (SQLAlchemy models, migrations, and maintenance jobs). Reaction ingestion utilities are in `ingest/`, while reusable test helpers sit in `tests/`. The Vite/React UI is in `frontend/` with Tailwind config and component code under `frontend/src/`. Persistent assets like exports, reports, and SQL dumps stay in `database_reports/`, `backup_before_reset.sql`, and `hab_db.dump`; keep large artifacts out of Git when possible.

## Build, Test, and Development Commands
- `python -m ingest.export_reactions --out ./outdir` – create a distributable snapshot of all reactions.
- `uvicorn api.app:app --reload` (or `docker-compose up api`) – start the FastAPI service against your local Postgres.
- `docker-compose up db pgadmin` – launch the RDKit-enabled Postgres plus pgAdmin.
- `npm install && npm run dev -- --host 0.0.0.0 --port 5173` inside `frontend/` – run the UI with live reload.
- `alembic -c alembic.ini upgrade head` – apply the latest DB migrations.

## Coding Style & Naming Conventions
Follow idiomatic Python 3.12 with 4-space indentation, `snake_case` functions, and type-hinted dataclasses/models defined near their routers. Keep FastAPI schemas in `api/schemas` and prefix Pydantic models with `*Schema` (e.g., `SpeciesSchema`). TypeScript/React files use ES modules, `PascalCase` for components, and co-locate styles via Tailwind utility classes. Run `npm run lint` before pushing front-end changes; use `ruff` or `black` locally if needed, but commit only formatted code.

## Testing Guidelines
Use `pytest` (see `tests/`) to validate ingestion logic; target >80% coverage for new modules and name tests `test_<behavior>`. Run `pytest tests -k sdf` when iterating on SDF tooling. Mock RDKit-heavy paths where possible to keep the suite fast, and add fixtures to `tests/factories.py` for any new molecule setup helpers.

## Commit & Pull Request Guidelines
Recent history mixes concise subjects (e.g., `refactor: Simplify energy calculations`) with imperative summaries. Prefer `<type>: <verb>` prefixes (`feat`, `fix`, `refactor`, `docs`) followed by a short scope. Each PR should describe motivation, include schema changes or migration IDs, link tracking issues, and attach screenshots or `curl` traces when the API/UI behavior changes. Draft PRs until CI (pytest + lint + frontend build) passes.

## Security & Configuration Tips
Store secrets in `.env` files that match `docker-compose.yml` variables (`POSTGRES_*`, `VITE_API_BASE`). Never commit dumps exported from production. When debugging locally, use non-default passwords and rotate shared pgAdmin credentials after demos.
