#!/usr/bin/env bash
# Run ONLY inside the disposable, network-none CI container.
set -euo pipefail
umask 077
cd /repo
[[ -f /.dockerenv ]]
# Confirm the runtime has only loopback, with no mounted host Docker socket.
python3 - <<'PY'
from pathlib import Path
assert {p.name for p in Path('/sys/class/net').iterdir()} == {'lo'}
assert not Path('/var/run/docker.sock').exists()
PY
work_dir=$(mktemp -d /tmp/meicare-synthetic.XXXXXXXX)
trap 'rm -rf -- "$work_dir"' EXIT
source_url=postgresql://postgres@127.0.0.1:5432/synthetic_source
target_url=postgresql://postgres@127.0.0.1:5432/postgres
psql "$target_url" -X -v ON_ERROR_STOP=1 -c 'create database synthetic_source'
psql "$source_url" -X -v ON_ERROR_STOP=1 -f test/fixtures/recovery-synthetic/source.sql
# Minimal managed-schema stubs solely to exercise the unchanged E1 preflight.
psql "$target_url" -X -v ON_ERROR_STOP=1 <<'SQL'
create schema auth;
create table auth.users(id text);
create schema storage;
create table storage.objects(id text);
SQL
psql "$source_url" -X -v ON_ERROR_STOP=1 --csv -t -q \
  -f scripts/v4-013e-recovery-baseline.sql > "$work_dir/source.csv"
# Quiescent synthetic source; this is pg_dump integration, NOT Supabase CLI capture.
printf '%s\n' '-- Synthetic role component; cluster roles are shared.' > "$work_dir/roles.sql"
pg_dump "$source_url" --schema-only --no-owner --schema public --schema integration --schema private > "$work_dir/schema.sql"
pg_dump "$source_url" --data-only --schema public --schema integration --schema private > "$work_dir/data.sql"
pg_dump "$source_url" --schema-only --no-owner --schema supabase_migrations > "$work_dir/history_schema.sql"
pg_dump "$source_url" --data-only --schema supabase_migrations > "$work_dir/history_data.sql"
tar -C "$work_dir" -cf "$work_dir/backup.tar" roles.sql schema.sql data.sql history_schema.sql history_data.sql
age-keygen -o "$work_dir/key" 2> "$work_dir/keygen.log"
recipient=$(age-keygen -y "$work_dir/key")
age -r "$recipient" -o "$work_dir/backup.tar.age" "$work_dir/backup.tar"
age-keygen -o "$work_dir/wrong-key" 2> "$work_dir/wrong-keygen.log"
if age -d -i "$work_dir/wrong-key" "$work_dir/backup.tar.age" > /dev/null 2>&1; then
  echo 'Wrong key unexpectedly decrypted archive' >&2; exit 1
fi
# E1 fixes this identifier as a guard label; no connection to that project occurs.
# Only synthetic fixture data exists here; no Vault or column encryption is used.
# Start a clean environment to remove image PGDATA/PG_MAJOR etc. overrides.
run_restore() {
  env -i PATH="$PATH" HOME=/tmp \
    RESTORE_DATABASE_URL="$target_url" SOURCE_PROJECT_REF=sgxufmcsnveyyddazwuk \
    RESTORE_PROJECT_REF=LOCAL DRILL_CHANGE_ID=E2-synthetic RESTORE_APPROVAL=E2-synthetic \
    ISOLATION_CONFIRMED=NO_EGRESS_NO_TUNNEL ENCRYPTION_RECOVERY_REVIEWED=YES \
    ENCRYPTED_BACKUP="$work_dir/backup.tar.age" \
    EXPECTED_BACKUP_SHA256="$(sha256sum "$work_dir/backup.tar.age" | cut -d ' ' -f1)" \
    SOURCE_BASELINE_CSV="$work_dir/source.csv" \
    EXPECTED_BASELINE_SHA256="$(sha256sum "$work_dir/source.csv" | cut -d ' ' -f1)" \
    AGE_IDENTITY_FILE="$work_dir/key" DRILL_EVIDENCE_DIR="$1" \
    bash scripts/v4-013e-restore-drill.sh
}
run_restore "$work_dir/evidence"
# A second restore must stop on the real nonempty-target preflight.
if run_restore "$work_dir/rejected" > "$work_dir/rejected.log" 2>&1; then
  echo 'Nonempty target unexpectedly accepted' >&2; exit 1
fi
grep -q V4_013E_TARGET_NOT_EMPTY "$work_dir/rejected.log"
[[ ! -e "$work_dir/rejected" ]]
grep -q '^result=DB_CHECKS_PASS$' "$work_dir/evidence/E2-synthetic-restore-report.txt"
grep -q '^commercial_recovery_gate=BLOCKED' "$work_dir/evidence/E2-synthetic-restore-report.txt"
# Only this fixed, non-sensitive report is copied out by the workflow.
printf '%s\n' 'result=SYNTHETIC_RECOVERY_PASS' 'production_recovery_gate=BLOCKED' \
  'data=synthetic_only' 'network=none' 'postgres_major=17' \
  'age_roundtrip=PASS' 'wrong_key_rejected=PASS' 'baseline_match=PASS' \
  'invariants=PASS' 'nonempty_target_rejected=PASS' \
  'supabase_cli_capture=NOT_TESTED' 'auth_objects_vault_rto=NOT_TESTED' \
  > /tmp/synthetic-recovery-report.txt
