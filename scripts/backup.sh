#!/usr/bin/env bash
# Off-site backup of NiblGo: the database (accounts, posts, messages, ...) and
# both photo buckets. Supabase's own backups (paid plans) cover the database
# only, never the photos in storage, so this is the one copy of those.
#
# Needs:
#   * the Supabase CLI, signed in and linked:  supabase login && supabase link --project-ref <ref>
#   * Docker running (the CLI runs pg_dump in a container)
#   * SUPABASE_DB_URL: Dashboard -> Connect -> "Session pooler" connection
#     string, with your database password in it (percent-encode special characters)
#
# Writes backups/<UTC time>/ with roles.sql, schema.sql, data.sql, photos/ and
# dm-photos/. That folder holds everyone's private messages and DM photos:
# keep it encrypted and off this laptop (OPERATIONS.md, "Backups"), and never
# commit it (backups/ is in .gitignore).
#
#   SUPABASE_DB_URL='postgresql://...' scripts/backup.sh
set -euo pipefail

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the database connection string (Dashboard -> Connect).}"
command -v supabase >/dev/null || { echo "Install the Supabase CLI first: https://supabase.com/docs/guides/cli" >&2; exit 1; }

umask 077
OUT="backups/$(date -u +%Y-%m-%dT%H%MZ)"
mkdir -p "$OUT"

echo "Database -> $OUT"
supabase db dump --db-url "$SUPABASE_DB_URL" --role-only -f "$OUT/roles.sql"
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$OUT/schema.sql"
supabase db dump --db-url "$SUPABASE_DB_URL" --data-only --use-copy -f "$OUT/data.sql"

for bucket in photos dm-photos; do
  echo "Photos ($bucket) -> $OUT/$bucket"
  supabase storage cp -r "ss:///$bucket" "$OUT/$bucket" --experimental
done

echo
echo "Done: $OUT"
echo "Now encrypt it and move it off this machine, e.g.:"
echo "  tar czf - $OUT | gpg --symmetric --cipher-algo AES256 -o $OUT.tgz.gpg && rm -rf $OUT"
