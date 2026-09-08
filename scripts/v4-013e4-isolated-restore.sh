#!/usr/bin/env bash
set -euo pipefail
umask 077
python3 - <<'PY'
from pathlib import Path
assert {p.name for p in Path('/sys/class/net').iterdir()} == {'lo'}
assert not Path('/var/run/docker.sock').exists()
PY
target_url=postgresql://postgres:postgres@127.0.0.1:5432/postgres
psql "$target_url" -X -qAt -v ON_ERROR_STOP=1 -f /repo/scripts/v4-013e3-compatibility.sql > /tmp/target.json
python3 /repo/scripts/v4-013e3-check-compatibility.py /input/source.json /tmp/target.json
export RESTORE_DATABASE_URL="$target_url" SOURCE_PROJECT_REF=sgxufmcsnveyyddazwuk
export RESTORE_PROJECT_REF=LOCAL DRILL_CHANGE_ID=E4-synthetic RESTORE_APPROVAL=E4-synthetic
export ISOLATION_CONFIRMED=NO_EGRESS_NO_TUNNEL ENCRYPTION_RECOVERY_REVIEWED=YES
# No Vault secret is seeded. pgcrypto fixture key is explicitly synthetic.
export ENCRYPTED_BACKUP=/input/backup.tar.age SOURCE_BASELINE_CSV=/input/baseline.csv
export AGE_IDENTITY_FILE=/input/key DRILL_EVIDENCE_DIR=/tmp/e4-evidence
export EXPECTED_BACKUP_SHA256=$(sha256sum "$ENCRYPTED_BACKUP" | cut -d ' ' -f1)
export EXPECTED_BASELINE_SHA256=$(sha256sum "$SOURCE_BASELINE_CSV" | cut -d ' ' -f1)
bash /repo/scripts/v4-013e-restore-drill.sh
grep -q '^result=DB_CHECKS_PASS$' /tmp/e4-evidence/E4-synthetic-restore-report.txt
# Candidate summary only. The controller publishes it only AFTER the fixture
# acceptance SQL succeeds through the isolated target's local admin socket.
printf '%s\n' 'result=SUPABASE_SYNTHETIC_RECOVERY_PASS' 'production_recovery_gate=BLOCKED' \
  'cli_capture=PASS' 'managed_metadata_match=PASS' 'auth_record_hash=PASS' \
  'storage_metadata=PASS' 'custom_role_rls=PASS' 'pgcrypto_external_fixture_key=PASS' \
  'scheduler=DISABLED' 'restore_network=LOOPBACK_ONLY' \
  'vault_key_portability=NOT_TESTED' 'auth_service_login=NOT_TESTED' \
  'binary_objects_rto=NOT_TESTED' > /tmp/e4-summary.txt
