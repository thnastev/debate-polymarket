#!/usr/bin/env bash
# Apply the migrations and run the SQL suite against a local Postgres.
#
# `supabase start` needs Docker. Where Docker isn't available (CI containers,
# this dev box) a bare `initdb` cluster runs the same SQL, with the auth schema
# stubbed by supabase/tests/00_local_auth_stub.sql. The migrations themselves
# are untouched and go to Supabase as-is.
set -euo pipefail
cd "$(dirname "$0")/.."

PGHOST="${PGHOST:-/tmp}"
PGPORT="${PGPORT:-55432}"
PGUSER="${PGUSER:-postgres}"
DB="${BISER_DB:-biser_test}"
export PGHOST PGPORT PGUSER
PSQL="psql -v ON_ERROR_STOP=1 -q"

reset() {
  $PSQL -d postgres -c "drop database if exists $DB" >/dev/null
  $PSQL -d postgres -c "create database $DB" >/dev/null
  $PSQL -d "$DB" -f supabase/tests/00_local_auth_stub.sql >/dev/null
  for f in supabase/migrations/*.sql; do
    echo "  applying $(basename "$f")"
    $PSQL -d "$DB" -f "$f" >/dev/null
  done
  # Sequence and function grants only. The TABLE grants are in 0003_rls.sql,
  # deliberately — getting them right is part of what the RLS suite tests, so
  # the harness must not paper over them.
  $PSQL -d "$DB" -c "grant usage, select on all sequences in schema public to authenticated;
                     grant execute on all functions in schema public to authenticated;" >/dev/null
  echo "  database $DB ready"
}

case "${1:-test}" in
  reset) reset ;;
  test)
    reset
    for f in supabase/tests/[0-9][0-9]_*.sql; do
      case "$(basename "$f")" in 00_*) continue ;; esac
      echo "── $(basename "$f")"
      $PSQL -d "$DB" -f "$f"
      # helper schema created by 01; make it reachable from role-switched blocks
      $PSQL -d "$DB" -c "grant execute on all functions in schema t to authenticated" >/dev/null 2>&1 || true
    done
    echo "── parity.mjs (TS vs SQL)"
    node --experimental-strip-types --no-warnings scripts/parity.mjs
    echo "── concurrency.mjs (50 simultaneous bets)"
    node --experimental-strip-types --no-warnings scripts/concurrency.mjs
    ;;
  psql) exec psql -d "$DB" ;;
  *) echo "usage: local-db.sh [reset|test|psql]" >&2; exit 1 ;;
esac
