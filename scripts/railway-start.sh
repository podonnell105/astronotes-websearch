#!/bin/bash
set -euo pipefail

export PATH="/usr/lib/postgresql/16/bin:/usr/lib/postgresql/15/bin:/usr/lib/postgresql/14/bin:${PATH}"

PGDATA="${PGDATA:-/data/pgdata}"
PGUSER="${POSTGRES_USER:-astronotes}"
PGPASSWORD_VALUE="${POSTGRES_PASSWORD:-}"
PGDB="${POSTGRES_DB:-astronotes}"
EXPORT_FILE="${EXPORT_PATH:-/data/supabase-export.json}"
LOCAL_URL="postgresql://${PGUSER}:${PGPASSWORD_VALUE}@127.0.0.1:5432/${PGDB}"

if [ -z "$PGPASSWORD_VALUE" ]; then
  echo "POSTGRES_PASSWORD not set; starting app only"
  exec npm run start
fi

if ! command -v initdb >/dev/null 2>&1; then
  echo "postgres binaries not installed; starting app only"
  exec npm run start
fi

mkdir -p /data
mkdir -p /var/run/postgresql
chown -R postgres:postgres /data /var/run/postgresql || true

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "initializing postgres at $PGDATA"
  su -s /bin/bash postgres -c "initdb -D '$PGDATA' --username=postgres --auth-local=trust --auth-host=scram-sha-256"
  cat >> "$PGDATA/postgresql.conf" <<'EOF'
listen_addresses = '127.0.0.1'
port = 5432
unix_socket_directories = '/var/run/postgresql'
EOF
  echo "host all all 127.0.0.1/32 scram-sha-256" >> "$PGDATA/pg_hba.conf"
fi

su -s /bin/bash postgres -c "pg_ctl -D '$PGDATA' -l /data/postgres.log -w start"

if ! su -s /bin/bash postgres -c "psql -d postgres -tAc \"SELECT 1 FROM pg_roles WHERE rolname='$PGUSER'\"" | grep -q 1; then
  su -s /bin/bash postgres -c "psql -d postgres" <<SQL
CREATE USER ${PGUSER} WITH PASSWORD '${PGPASSWORD_VALUE}';
CREATE DATABASE ${PGDB} OWNER ${PGUSER};
GRANT ALL PRIVILEGES ON DATABASE ${PGDB} TO ${PGUSER};
SQL
fi

PGPASSWORD="$PGPASSWORD_VALUE" psql "$LOCAL_URL" -v ON_ERROR_STOP=1 -f /app/lib/schema.sql

if [ -f "$EXPORT_FILE" ]; then
  count="$(PGPASSWORD="$PGPASSWORD_VALUE" psql "$LOCAL_URL" -tAc "SELECT count(*) FROM users" | tr -d '[:space:]')"
  if [ "${count:-0}" = "0" ]; then
    echo "importing $EXPORT_FILE into empty local database"
    DATABASE_URL="$LOCAL_URL" IMPORT_PATH="$EXPORT_FILE" node /app/scripts/import-store.mjs
  fi
fi

if [ "${USE_LOCAL_POSTGRES:-}" = "1" ]; then
  export DATABASE_URL="$LOCAL_URL"
fi

exec npm run start
