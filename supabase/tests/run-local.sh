#!/usr/bin/env bash
# Teste les migrations + policies RLS sur un cluster Postgres jetable, sans
# Docker. Équivalent local de `supabase start` + tests SQL.
#
# Usage : supabase/tests/run-local.sh
# Prérequis : binaires PostgreSQL >= 15 (initdb, pg_ctl, psql).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-$(dirname "$(find /usr/lib/postgresql -name initdb -type f 2>/dev/null | sort -V | tail -1 || true)")}"
[ -x "$PGBIN/initdb" ] || { echo "initdb introuvable (définir PGBIN)"; exit 1; }

# initdb refuse root : on se ré-exécute sous l'utilisateur postgres.
if [ "$(id -u)" = 0 ] && id postgres >/dev/null 2>&1; then
  WORK="$(mktemp -d)"
  chown postgres "$WORK"
  exec su -s /bin/bash postgres -c "WORK=$(printf '%q' "$WORK") PGBIN=$(printf '%q' "$PGBIN") $(printf '%q' "$0")"
fi

WORK="${WORK:-$(mktemp -d)}"
DATADIR="$WORK/data"
export PGHOST="$WORK"          # socket unix uniquement, aucun port TCP
export PGUSER=postgres
DB=notre_garde_test

cleanup() { "$PGBIN/pg_ctl" -D "$DATADIR" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"$PGBIN/initdb" -D "$DATADIR" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$DATADIR" -o "-c listen_addresses='' -c unix_socket_directories='$WORK' -c wal_level=logical" \
  -l "$WORK/pg.log" start >/dev/null
"$PGBIN/createdb" "$DB"

PSQL=("$PGBIN/psql" -d "$DB" -v ON_ERROR_STOP=1 -q)

echo "— shim Supabase (auth, rôles, publication)"
"${PSQL[@]}" -f "$ROOT/supabase/tests/shim_supabase.sql"

echo "— migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "  $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done

echo "— tests RLS"
"${PSQL[@]}" -f "$ROOT/supabase/tests/rls.test.sql"

echo "Migrations et policies validées sur PostgreSQL local."
