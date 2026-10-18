#!/usr/bin/env bash
# End-to-end security verification: a real, local copy of the NiblGo backend,
# attacked through the same front door the app uses.
#
#   Postgres 16      with schema.sql (every migration folded in)
#   Supabase Auth    the real server (GoTrue v2.177.0): real sign-up, sign-in,
#                    sign-out and access tokens
#   PostgREST 12     the real API server, with the per-request session check
#   Edge functions   all seven, run for real under Deno
#   Gateway          gateway.mjs: routes /auth, /rest, /functions like Supabase,
#                    checks function JWTs like Supabase, and stands in for
#                    Storage (see gateway.mjs for exactly how)
#
# Then verify.test.mjs signs up User A, User B and friends with supabase-js
# (the library the app uses) and runs every check against that stack.
#
# Needs Postgres 16 binaries, Node 18+, Deno 2, openssl and network access the
# first time (downloads cached in ~/.cache/niblgo-e2e). Nothing touches your
# Supabase project.
#
#   supabase/tests/e2e/run.sh
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SUPA=$(cd "$HERE/../.." && pwd)            # .../supabase
REPO=$(cd "$SUPA/.." && pwd)
CACHE=${E2E_CACHE:-$HOME/.cache/niblgo-e2e}
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/16/bin /usr/lib/postgresql/*/bin 2>/dev/null | head -1)}
WORK=$(mktemp -d /tmp/niblgo-e2e.XXXXXX)
PGPORT=5600 RESTPORT=3600 AUTHPORT=9600 GATEPORT=54321
JWT_SECRET="e2e-only-secret-$(openssl rand -hex 24)"
PIDS=()

log() { echo "[e2e] $*"; }
as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  as_pg "$PGBIN/pg_ctl -D $WORK/pg -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# --- downloads (cached) ---------------------------------------------------------
mkdir -p "$CACHE"
if [ ! -x "$CACHE/postgrest" ]; then
  log "downloading PostgREST 12.2.3"
  curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar xJ -C "$CACHE"
fi
if [ ! -x "$CACHE/auth/auth" ]; then
  log "downloading Supabase Auth v2.177.0"
  mkdir -p "$CACHE/auth"
  curl -sSL https://github.com/supabase/auth/releases/download/v2.177.0/auth-v2.177.0-x86.tar.gz | tar xz -C "$CACHE/auth"
fi
if [ ! -d "$CACHE/node/node_modules/pg" ]; then
  log "installing the pg driver for the gateway"
  npm install --silent --prefix "$CACHE/node" pg@8 >/dev/null
fi

# --- Postgres ----------------------------------------------------------------------
mkdir -p "$WORK/pg" && [ "$(id -u)" = 0 ] && chown -R postgres "$WORK"
as_pg "$PGBIN/initdb -D $WORK/pg -A trust" >/dev/null
as_pg "$PGBIN/pg_ctl -D $WORK/pg -o '-p $PGPORT -c listen_addresses=127.0.0.1 -k $WORK' -l $WORK/pg.log -w start" >/dev/null
psql_q() { "$PGBIN/psql" -X -q -h 127.0.0.1 -p $PGPORT -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

log "roles, then Supabase Auth's own migrations"
psql_q <<SQL >/dev/null
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit password 'e2e';
grant anon, authenticated, service_role to authenticator;
-- As on Supabase: Auth runs as its own role, which owns the auth schema and
-- works in it (its migrations name some objects without the schema).
create role supabase_auth_admin login createrole superuser;
alter role supabase_auth_admin set search_path = auth;
create schema auth authorization supabase_auth_admin;
SQL
export GOTRUE_DB_DRIVER=postgres
export DATABASE_URL="postgres://supabase_auth_admin@127.0.0.1:$PGPORT/postgres?sslmode=disable"
export GOTRUE_DB_DATABASE_URL="$DATABASE_URL" GOTRUE_DB_NAMESPACE=auth
export GOTRUE_API_HOST=127.0.0.1 PORT=$AUTHPORT
export API_EXTERNAL_URL="https://127.0.0.1:$GATEPORT/auth/v1" GOTRUE_SITE_URL="https://niblgo.com"
export GOTRUE_URI_ALLOW_LIST="https://niblgo.com/auth/reset,niblgo://reset,https://niblgo.com/auth/confirm"
export GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated
export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role
export GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_DISABLE_SIGNUP=false
export GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 GOTRUE_LOG_LEVEL=error
# Auth's emails (password resets) go to a local catcher, smtp_sink.mjs, which
# saves each one for the checks to open. Nothing leaves the machine.
SMTPPORT=${SMTPPORT:-2525}
export GOTRUE_SMTP_HOST=127.0.0.1 GOTRUE_SMTP_PORT=$SMTPPORT GOTRUE_SMTP_USER=e2e GOTRUE_SMTP_PASS=e2e
export GOTRUE_SMTP_ADMIN_EMAIL=no-reply@niblgo.com GOTRUE_SMTP_SENDER_NAME=NiblGo GOTRUE_SMTP_MAX_FREQUENCY=1ms
# As on hosted Supabase, the links in Auth's emails point at /auth/v1/verify.
export GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/v1/verify GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify
export GOTRUE_MAILER_URLPATHS_INVITE=/auth/v1/verify GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify
# The reset email is the production template (supabase/templates/), served by
# smtp_sink.mjs, the way Auth loads custom templates.
TPLPORT=${TPLPORT:-2526}
export GOTRUE_MAILER_TEMPLATES_RECOVERY="http://127.0.0.1:$TPLPORT/reset-password.html"
export GOTRUE_MAILER_SUBJECTS_RECOVERY="Reset your NiblGo password"
"$CACHE/auth/auth" migrate >"$WORK/auth-migrate.log" 2>&1 || { cat "$WORK/auth-migrate.log"; exit 1; }

log "the rest of the platform (supabase_sim.sql), then schema.sql"
psql_q -f "$SUPA/tests/supabase_sim.sql" >/dev/null 2>&1
psql_q -f "$SUPA/schema.sql" >"$WORK/schema.log" 2>&1 || { grep ERROR "$WORK/schema.log"; exit 1; }
psql_q -tAc "select 'session check: ' || coalesce((select array_to_string(setconfig, ',') from pg_db_role_setting where setrole = 'authenticator'::regrole), 'OFF')"

# --- keys and TLS --------------------------------------------------------------------
read -r ANON_KEY SERVICE_KEY < <(JWT_SECRET="$JWT_SECRET" node -e '
const c = require("crypto"); const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (p) => { const h = b({ alg: "HS256", typ: "JWT" }), q = b(p);
  return h + "." + q + "." + c.createHmac("sha256", process.env.JWT_SECRET).update(h + "." + q).digest("base64url"); };
const exp = Math.floor(Date.now() / 1000) + 86400;
console.log(sign({ role: "anon", iss: "supabase", exp }), sign({ role: "service_role", iss: "supabase", exp }));')
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=127.0.0.1" \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" >/dev/null 2>&1

# --- servers ---------------------------------------------------------------------------
cat >"$WORK/postgrest.conf" <<EOF
db-uri = "postgres://authenticator:e2e@127.0.0.1:$PGPORT/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-port = $RESTPORT
server-host = "127.0.0.1"
EOF
"$CACHE/postgrest" "$WORK/postgrest.conf" >"$WORK/postgrest.log" 2>&1 & PIDS+=($!)
E2E_SMTP_PORT=$SMTPPORT E2E_MAIL_DIR="$WORK/mail" E2E_TEMPLATE_PORT=$TPLPORT E2E_TEMPLATES_DIR="$SUPA/templates" node "$HERE/smtp_sink.mjs" >"$WORK/smtp.log" 2>&1 & PIDS+=($!)
"$CACHE/auth/auth" serve >"$WORK/auth.log" 2>&1 & PIDS+=($!)

export E2E_JWT_SECRET="$JWT_SECRET" E2E_DB_URL="postgres://postgres@127.0.0.1:$PGPORT/postgres"
export E2E_TLS_KEY="$WORK/key.pem" E2E_TLS_CERT="$WORK/cert.pem"
export E2E_REST="http://127.0.0.1:$RESTPORT" E2E_AUTH="http://127.0.0.1:$AUTHPORT" E2E_PORT=$GATEPORT
NODE_PATH="$CACHE/node/node_modules" node "$HERE/gateway.mjs" >"$WORK/gateway.log" 2>&1 & PIDS+=($!)

# Each function on its own port; fn_entry.ts points Deno.serve there and sends
# its calls to Anthropic, USDA and Expo to the gateway's stand-ins.
mkdir -p "$WORK/fn" && cp -r "$SUPA/functions" "$WORK/fn/" && echo '{"nodeModulesDir":"none"}' >"$WORK/fn/deno.json"
FNS=(upload-photo format-recipe lookup-nutrition notify-message notify-activity delete-account sweep-storage)
for i in "${!FNS[@]}"; do
  fn=${FNS[$i]}
  FN_PORT=$((8601 + i)) FN_MAIN="file://$WORK/fn/functions/$fn/index.ts" \
  FAKES_URL="https://127.0.0.1:$GATEPORT/__fakes" \
  SUPABASE_URL="https://127.0.0.1:$GATEPORT" SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY" \
  ANTHROPIC_API_KEY=sk-ant-e2e-fake USDA_API_KEY=usda-e2e-fake SWEEP_SECRET="$(openssl rand -hex 32)" \
  NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost" \
  deno run -A --quiet --unsafely-ignore-certificate-errors=127.0.0.1 --config "$WORK/fn/deno.json" "$HERE/fn_entry.ts" \
    >"$WORK/fn-$fn.log" 2>&1 & PIDS+=($!)
done

log "waiting for the servers"
for t in $(seq 1 120); do
  ok=0
  curl -sk "https://127.0.0.1:$GATEPORT/auth/v1/health" >/dev/null 2>&1 && ok=$((ok + 1))
  curl -sk -o /dev/null -w '%{http_code}' -H "apikey: $ANON_KEY" "https://127.0.0.1:$GATEPORT/rest/v1/" 2>/dev/null | grep -q 200 && ok=$((ok + 1))
  for i in "${!FNS[@]}"; do curl -s -o /dev/null "http://127.0.0.1:$((8601 + i))/" 2>/dev/null && ok=$((ok + 1)); done
  [ $ok -eq $((2 + ${#FNS[@]})) ] && break
  sleep 1
done
[ $ok -eq $((2 + ${#FNS[@]})) ] || { log "servers did not come up"; tail -5 "$WORK"/*.log; exit 1; }

log "running the checks"
E2E_URL="https://127.0.0.1:$GATEPORT" E2E_ANON_KEY="$ANON_KEY" E2E_SERVICE_KEY="$SERVICE_KEY" \
E2E_FIXTURES="$SUPA/functions/_shared/test-fixtures" E2E_WORK="$WORK" E2E_REPO="$REPO" E2E_RESULTS="${E2E_RESULTS:-}" \
NODE_TLS_REJECT_UNAUTHORIZED=0 NODE_NO_WARNINGS=1 NODE_PATH="$REPO/node_modules" \
  node "$HERE/verify.test.mjs"
