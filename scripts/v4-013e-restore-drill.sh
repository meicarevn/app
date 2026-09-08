#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to an isolated empty target}"
: "${SOURCE_PROJECT_REF:?Set SOURCE_PROJECT_REF to the production project reference}"
: "${RESTORE_PROJECT_REF:?Set RESTORE_PROJECT_REF to the isolated target reference or LOCAL}"
: "${ENCRYPTED_BACKUP:?Set ENCRYPTED_BACKUP to the .tar.age backup}"
: "${EXPECTED_BACKUP_SHA256:?Set EXPECTED_BACKUP_SHA256 from the signed evidence record}"
: "${SOURCE_BASELINE_CSV:?Set SOURCE_BASELINE_CSV to the matching source manifest}"
: "${AGE_IDENTITY_FILE:?Set AGE_IDENTITY_FILE to the age identity file}"
: "${DRILL_EVIDENCE_DIR:?Set DRILL_EVIDENCE_DIR to an absolute output directory}"
: "${DRILL_CHANGE_ID:?Set DRILL_CHANGE_ID to the approved drill identifier}"
: "${EXPECTED_BASELINE_SHA256:?Set EXPECTED_BASELINE_SHA256 from the reviewed backup evidence}"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
python3 "$script_dir/v4-013e-safety.py" restore

if [[ "$SOURCE_PROJECT_REF" == "$RESTORE_PROJECT_REF" ]]; then
  echo "Restore target must not be the production project" >&2
  exit 2
fi
if [[ "$RESTORE_DATABASE_URL" == *"$SOURCE_PROJECT_REF"* ]]; then
  echo "Restore URL contains the production project reference; refusing to continue" >&2
  exit 2
fi
case "$DRILL_EVIDENCE_DIR" in
  /*) ;;
  *) echo "DRILL_EVIDENCE_DIR must be an absolute path" >&2; exit 2 ;;
esac

for command_name in psql age sha256sum tar diff python3; do
  command -v "$command_name" >/dev/null || {
    echo "Required command is unavailable: $command_name" >&2
    exit 2
  }
done

actual_sha256="$(sha256sum "$ENCRYPTED_BACKUP" | awk '{print $1}')"
if [[ "$actual_sha256" != "$EXPECTED_BACKUP_SHA256" ]]; then
  echo "Encrypted backup checksum mismatch" >&2
  exit 3
fi
baseline_sha256="$(sha256sum "$SOURCE_BASELINE_CSV" | awk '{print $1}')"
if [[ "$baseline_sha256" != "$EXPECTED_BASELINE_SHA256" ]]; then
  echo "Source baseline checksum mismatch" >&2
  exit 3
fi

# This is the first database access, and it is read-only. A failure stops here.
target_check="$(psql "$RESTORE_DATABASE_URL" --no-psqlrc --set ON_ERROR_STOP=1 \
  --tuples-only --no-align --quiet --file "$script_dir/v4-013e-empty-target.sql")"
if [[ "$target_check" != "V4_013E_EMPTY_TARGET_PASS" ]]; then
  echo "Isolated target preflight failed" >&2
  exit 3
fi

work_dir="$(mktemp -d /tmp/meicare-recovery.XXXXXXXX)"
cleanup() {
  case "$work_dir" in
    /tmp/meicare-recovery.*) rm -rf -- "$work_dir" ;;
    *) echo "Refusing to remove unexpected temporary path: $work_dir" >&2 ;;
  esac
}
trap cleanup EXIT

mkdir -m 700 -- "$DRILL_EVIDENCE_DIR"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
started_epoch="$(date -u +%s)"

age --decrypt --identity "$AGE_IDENTITY_FILE" \
  --output "$work_dir/backup.tar" "$ENCRYPTED_BACKUP"
if ! python3 "$script_dir/v4-013e-safety.py" unpack "$work_dir/backup.tar" "$work_dir"; then
  echo "Backup archive contains unexpected paths" >&2
  exit 3
fi
for required_file in roles.sql schema.sql data.sql history_schema.sql history_data.sql; do
  [[ -s "$work_dir/$required_file" ]] || {
    echo "Backup is missing $required_file" >&2
    exit 3
  }
done

psql "$RESTORE_DATABASE_URL" \
  --no-psqlrc --single-transaction --set ON_ERROR_STOP=1 \
  --file "$work_dir/roles.sql" \
  --file "$work_dir/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$work_dir/data.sql" \
  --file "$work_dir/history_schema.sql" \
  --file "$work_dir/history_data.sql" \
  --command 'SET session_replication_role = origin'

target_baseline="$DRILL_EVIDENCE_DIR/${DRILL_CHANGE_ID}-restored-baseline.csv"
psql "$RESTORE_DATABASE_URL" \
  --no-psqlrc --set ON_ERROR_STOP=1 --csv --tuples-only --quiet \
  --file "$script_dir/v4-013e-recovery-baseline.sql" \
  > "$target_baseline"

diff_file="$DRILL_EVIDENCE_DIR/${DRILL_CHANGE_ID}-baseline.diff"
if ! diff -u "$SOURCE_BASELINE_CSV" "$target_baseline" > "$diff_file"; then
  echo "Restored baseline differs from the source; evidence retained at $diff_file" >&2
  exit 4
fi

psql "$RESTORE_DATABASE_URL" \
  --no-psqlrc --set ON_ERROR_STOP=1 \
  --file "$script_dir/v4-013e-recovery-acceptance.sql" \
  > "$DRILL_EVIDENCE_DIR/${DRILL_CHANGE_ID}-acceptance.txt"

completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
completed_epoch="$(date -u +%s)"
elapsed_seconds="$((completed_epoch - started_epoch))"
report="$DRILL_EVIDENCE_DIR/${DRILL_CHANGE_ID}-restore-report.txt"
printf '%s\n' \
  "result=DB_CHECKS_PASS" \
  "commercial_recovery_gate=BLOCKED_PENDING_OBJECT_AUTH_RTO_REVIEW" \
  "change_id=$DRILL_CHANGE_ID" \
  "source_project_ref=$SOURCE_PROJECT_REF" \
  "restore_project_ref=$RESTORE_PROJECT_REF" \
  "backup_sha256=$actual_sha256" \
  "source_baseline_sha256=$baseline_sha256" \
  "started_at=$started_at" \
  "completed_at=$completed_at" \
  "elapsed_seconds=$elapsed_seconds" \
  > "$report"

sha256sum "$target_baseline" "$diff_file" \
  "$DRILL_EVIDENCE_DIR/${DRILL_CHANGE_ID}-acceptance.txt" "$report" \
  > "$DRILL_EVIDENCE_DIR/${DRILL_CHANGE_ID}-SHA256SUMS"

printf 'V4_013E database checks PASS in %s seconds; commercial recovery gate pending review. Evidence: %s\n' \
  "$elapsed_seconds" "$DRILL_EVIDENCE_DIR"
