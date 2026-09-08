#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL to the Supabase session-pooler connection string}"
: "${BACKUP_EVIDENCE_DIR:?Set BACKUP_EVIDENCE_DIR to an absolute output directory}"
: "${BACKUP_CHANGE_ID:?Set BACKUP_CHANGE_ID to the approved change or incident identifier}"
: "${BACKUP_ENCRYPTION_RECIPIENT:?Set BACKUP_ENCRYPTION_RECIPIENT to an age recipient}"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
python3 "$script_dir/v4-013e-safety.py" capture

case "$BACKUP_EVIDENCE_DIR" in
  /*) ;;
  *) echo "BACKUP_EVIDENCE_DIR must be an absolute path" >&2; exit 2 ;;
esac

for command_name in supabase psql docker age sha256sum tar diff python3; do
  command -v "$command_name" >/dev/null || {
    echo "Required command is unavailable: $command_name" >&2
    exit 2
  }
done

work_dir="$(mktemp -d /tmp/meicare-recovery.XXXXXXXX)"
cleanup() {
  case "$work_dir" in
    /tmp/meicare-recovery.*) rm -rf -- "$work_dir" ;;
    *) echo "Refusing to remove unexpected temporary path: $work_dir" >&2 ;;
  esac
}
trap cleanup EXIT

mkdir -m 700 -- "$BACKUP_EVIDENCE_DIR"
evidence_id="$(date -u +%Y%m%dT%H%M%SZ)-${BACKUP_CHANGE_ID}"
archive_name="meicare-db-${evidence_id}.tar"
encrypted_name="${archive_name}.age"
baseline_name="meicare-db-${evidence_id}-baseline.csv"
baseline_before_name="meicare-db-${evidence_id}-baseline-before.csv"
baseline_drift_name="meicare-db-${evidence_id}-baseline-drift.diff"

psql "$SOURCE_DATABASE_URL" \
  --no-psqlrc --set ON_ERROR_STOP=1 --csv --tuples-only --quiet \
  --file "$script_dir/v4-013e-recovery-baseline.sql" \
  > "$BACKUP_EVIDENCE_DIR/$baseline_before_name"

supabase db dump --db-url "$SOURCE_DATABASE_URL" \
  --file "$work_dir/roles.sql" --role-only
supabase db dump --db-url "$SOURCE_DATABASE_URL" \
  --file "$work_dir/schema.sql"
supabase db dump --db-url "$SOURCE_DATABASE_URL" \
  --file "$work_dir/data.sql" --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"

# The standard dump excludes migration history; preserve it explicitly.
supabase db dump --db-url "$SOURCE_DATABASE_URL" \
  --file "$work_dir/history_schema.sql" --schema supabase_migrations
supabase db dump --db-url "$SOURCE_DATABASE_URL" \
  --file "$work_dir/history_data.sql" --use-copy --data-only --schema supabase_migrations

for component in roles.sql schema.sql data.sql history_schema.sql history_data.sql; do
  if [[ ! -s "$work_dir/$component" || -L "$work_dir/$component" ]]; then
    echo "Backup component is missing, empty or a link" >&2
    exit 3
  fi
done

psql "$SOURCE_DATABASE_URL" \
  --no-psqlrc --set ON_ERROR_STOP=1 --csv --tuples-only --quiet \
  --file "$script_dir/v4-013e-recovery-baseline.sql" \
  > "$BACKUP_EVIDENCE_DIR/$baseline_name"

if ! diff -u "$BACKUP_EVIDENCE_DIR/$baseline_before_name" \
  "$BACKUP_EVIDENCE_DIR/$baseline_name" \
  > "$BACKUP_EVIDENCE_DIR/$baseline_drift_name"; then
  echo "Database changed during the logical backup window; discard and retry during a quiet window" >&2
  exit 4
fi

tar -C "$work_dir" -cf "$work_dir/$archive_name" \
  roles.sql schema.sql data.sql history_schema.sql history_data.sql
age --recipient "$BACKUP_ENCRYPTION_RECIPIENT" \
  --output "$BACKUP_EVIDENCE_DIR/$encrypted_name" \
  "$work_dir/$archive_name"

(
  cd "$BACKUP_EVIDENCE_DIR"
  sha256sum "$encrypted_name" "$baseline_before_name" "$baseline_name" \
    "$baseline_drift_name" > "${evidence_id}-SHA256SUMS"
)

printf '%s\n' \
  "backup_evidence_id=$evidence_id" \
  "encrypted_archive=$BACKUP_EVIDENCE_DIR/$encrypted_name" \
  "baseline_manifest=$BACKUP_EVIDENCE_DIR/$baseline_name" \
  "checksums=$BACKUP_EVIDENCE_DIR/${evidence_id}-SHA256SUMS"
