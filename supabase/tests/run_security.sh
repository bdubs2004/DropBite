#!/usr/bin/env bash
# Runs rls_attack_test.sql against a throwaway local Postgres that mimics
# Supabase (supabase_sim.sql). Nothing touches your real project.
#
#   supabase/tests/run_security.sh                 fresh install from schema.sql
#   supabase/tests/run_security.sh upgrade [ref]   schema.sql as of a git ref
#                                                  (default HEAD), then every
#                                                  migration numbered 0030 and up
#
# Needs Postgres 16 binaries (initdb, pg_ctl, psql). Run as a user that can
# start Postgres, or as root (it switches to the postgres user).
set -euo pipefail

MODE=${1:-fresh}
HERE=$(cd "$(dirname "$0")/.." && pwd)          # .../supabase
REPO=$(cd "$HERE/.." && pwd)
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
WORK=$(mktemp -d /tmp/niblgo-sec.XXXXXX)
PORT=${PORT:-5544}

as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
cleanup() { as_pg "$PGBIN/pg_ctl -D $WORK/data -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

cp -r "$HERE" "$WORK/src"
[ "$(id -u)" = 0 ] && chown -R postgres "$WORK"
as_pg "$PGBIN/initdb -D $WORK/data -A trust" >/dev/null
as_pg "$PGBIN/pg_ctl -D $WORK/data -o '-p $PORT -k $WORK -c listen_addresses=' -l $WORK/pg.log -w start" >/dev/null
psql_run() { as_pg "$PGBIN/psql -X -q -h $WORK -p $PORT -d postgres -v ON_ERROR_STOP=1 $*"; }

psql_run -f "$WORK/src/tests/supabase_sim.sql" >/dev/null 2>&1
if [ "$MODE" = upgrade ]; then
  git -C "$REPO" show "${2:-HEAD}":supabase/schema.sql > "$WORK/schema-head.sql"
  [ "$(id -u)" = 0 ] && chown postgres "$WORK/schema-head.sql"
  psql_run -f "$WORK/schema-head.sql" >/dev/null 2>&1
  for f in "$WORK"/src/migrations/003*.sql; do psql_run -f "$f" >/dev/null 2>&1; done
else
  psql_run -f "$WORK/src/schema.sql" >/dev/null 2>&1
fi
as_pg "$PGBIN/psql -X -h $WORK -p $PORT -d postgres -v ON_ERROR_STOP=1 -f $WORK/src/tests/rls_attack_test.sql" \
  | grep -E '^ (PASS|FAIL) |passed|^ +[0-9]+ \| +[0-9]+|ERROR'
