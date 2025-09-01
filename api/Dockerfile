FROM python:3.11-slim

# system deps for psycopg2 and pg_isready
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev postgresql-client && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# copy the whole repo so /app/api and /app/db are siblings
COPY . /app

# entrypoint script
COPY api/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Optional default if image run standalone; Compose `command` overrides this.
CMD ["./entrypoint.sh"]
