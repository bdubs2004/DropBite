#!/usr/bin/env bash
# Runs rls_attack_test.sql against a throwaway local Postgres that mimics
# Supabase (supabase_sim.sql). Nothing touches your real project.
#
#   supabase/tests/run_security.sh                 fresh install from schema.sql
#   supabase/tests/run_security.sh upgrade [ref]   schema.sql as of a git ref
#                                                  (default HEAD), then every
#                                                  migration numbered 0030 and up
#   supabase/tests/run_security.sh data            a database in use, then
#                                                  upgrade_all.sql and schema.sql
#                                                  (must not fail or change a row)
#   supabase/tests/run_security.sh legacy          the oldest schema.sql, rewound
#                                                  to before any migration, then
#                                                  upgrade_all.sql
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
if [ "$MODE" = data ]; then
  # A database in use (tests/realistic_data.sql), then upgrade_all.sql in one
  # transaction, then schema.sql again: neither may fail or change a row.
  psql_run -f "$WORK/src/schema.sql" >/dev/null 2>&1
  psql_run -f "$WORK/src/tests/realistic_data.sql" >/dev/null 2>&1 || { echo "realistic_data.sql FAILED"; exit 1; }
  rows() { as_pg "$PGBIN/pg_dump -h $WORK -p $PORT -d postgres --data-only --inserts -n public -n storage --exclude-table=storage.buckets" 2>/dev/null \
    | grep -E '^INSERT' | sed -E "s/'[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:.+]+'/TS/g" | sort; }
  rows > "$WORK/before"
  psql_run -f "$WORK/src/upgrade_all.sql" >"$WORK/up.log" 2>&1 || { echo "upgrade_all.sql FAILED on a database in use:"; grep ERROR "$WORK/up.log"; exit 1; }
  psql_run -f "$WORK/src/schema.sql" >"$WORK/schema.log" 2>&1 || { echo "schema.sql FAILED on a database in use:"; grep ERROR "$WORK/schema.log"; exit 1; }
  rows > "$WORK/after"
  if diff -q "$WORK/before" "$WORK/after" >/dev/null; then
    echo "upgrade_all.sql and schema.sql over a database in use: OK, all $(wc -l < "$WORK/after") rows unchanged"
  else
    echo "ROWS CHANGED:"; diff "$WORK/before" "$WORK/after" | head; exit 1
  fi
  grep -h WARNING "$WORK/up.log" "$WORK/schema.log" || true
  exit 0
elif [ "$MODE" = legacy ]; then
  # The oldest schema.sql in git, rewound to before any migration, then the
  # one-file upgrade in a single transaction (as the SQL Editor runs it).
  git -C "$REPO" show 01e8904:supabase/schema.sql > "$WORK/schema-oldest.sql"
  [ "$(id -u)" = 0 ] && chown postgres "$WORK/schema-oldest.sql"
  psql_run -f "$WORK/schema-oldest.sql" >/dev/null 2>&1
  psql_run -f "$WORK/src/tests/legacy_base.sql" >/dev/null 2>&1
  psql_run -f "$WORK/src/upgrade_all.sql" >/dev/null 2>&1 || { echo "upgrade_all.sql FAILED"; exit 1; }
elif [ "$MODE" = upgrade ]; then
  git -C "$REPO" show "${2:-HEAD}":supabase/schema.sql > "$WORK/schema-head.sql"
  [ "$(id -u)" = 0 ] && chown postgres "$WORK/schema-head.sql"
  psql_run -f "$WORK/schema-head.sql" >/dev/null 2>&1
  for f in "$WORK"/src/migrations/003*.sql; do psql_run -f "$f" >/dev/null 2>&1; done
else
  psql_run -f "$WORK/src/schema.sql" >/dev/null 2>&1
fi
as_pg "$PGBIN/psql -X -h $WORK -p $PORT -d postgres -v ON_ERROR_STOP=1 -f $WORK/src/tests/rls_attack_test.sql" \
  | grep -E '^ (PASS|FAIL) |passed|^ +[0-9]+ \| +[0-9]+|ERROR'
