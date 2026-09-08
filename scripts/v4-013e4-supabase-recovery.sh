#!/usr/bin/env bash
# Dedicated disposable GitHub runner ONLY; no production credentials or input URLs.
set -euo pipefail
umask 077
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted ]]
repo_dir=$(pwd)
run_root="$RUNNER_TEMP/meicare-e4"
mkdir -m 700 "$run_root"
cleanup() {
  docker rm -fv meicare-e4-restore-tools >/dev/null 2>&1 || true
  supabase stop --project-id meicare-e4-source --no-backup >/dev/null 2>&1 || true
  supabase stop --project-id meicare-e4-target --no-backup >/dev/null 2>&1 || true
  rm -rf -- "$run_root"
}
trap cleanup EXIT
exclude=studio,imgproxy,edge-runtime,logflare,vector,supavisor,realtime,postgres-meta
for phase in source target; do
  mkdir "$run_root/$phase"
  supabase init --workdir "$run_root/$phase" --yes
  python3 - "$run_root/$phase/supabase/config.toml" "$phase" <<'PY'
import re, sys
from pathlib import Path
p=Path(sys.argv[1]); s=p.read_text()
s=re.sub(r'^project_id = .*$', 'project_id = "meicare-e4-'+sys.argv[2]+'"', s, flags=re.M)
s=re.sub(r'^major_version = \d+$', 'major_version = 17', s, flags=re.M)
p.write_text(s)
PY
done
supabase start --workdir "$run_root/source" --exclude "$exclude" > "$run_root/source-start.log" 2>&1 || {
  tail -80 "$run_root/source-start.log"; exit 1;
}
source_db=supabase_db_meicare-e4-source
# Actual Supabase-managed schemas, no E2 stubs. Adapt history fixture only for
# an already bootstrapped CLI migration table; keep all fixture records.
sed -e 's/create schema supabase_migrations;/create schema if not exists supabase_migrations;/' \
    -e 's/create table supabase_migrations.schema_migrations/create table if not exists supabase_migrations.schema_migrations/' \
    "$repo_dir/test/fixtures/recovery-synthetic/source.sql" > "$run_root/source.sql"
docker exec -i "$source_db" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < "$run_root/source.sql"
docker exec -i "$source_db" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < "$repo_dir/test/fixtures/recovery-synthetic/supabase-extra.sql"
# Both sides use the same CLI-selected database image. Record image identity.
docker inspect --format '{{.Config.Image}} {{.Image}}' "$source_db"
docker exec -i "$source_db" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
  < "$repo_dir/scripts/v4-013e3-compatibility.sql" > "$run_root/source.json"
age-keygen -o "$run_root/key" 2> "$run_root/keygen.log"
export SOURCE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
export BACKUP_CHANGE_ID=E4-synthetic BACKUP_EVIDENCE_DIR="$run_root/capture"
export BACKUP_ENCRYPTION_RECIPIENT=$(age-keygen -y "$run_root/key")
(cd "$run_root/source"; bash "$repo_dir/scripts/v4-013e-capture-backup.sh")
cp "$run_root"/capture/*.tar.age "$run_root/backup.tar.age"
cp "$run_root"/capture/*-baseline.csv "$run_root/baseline.csv"
# Source is destroyed before target starts; no common cluster or shared roles.
supabase stop --project-id meicare-e4-source --no-backup
unset SOURCE_DATABASE_URL BACKUP_ENCRYPTION_RECIPIENT
supabase start --workdir "$run_root/target" --exclude "$exclude" > "$run_root/target-start.log" 2>&1 || {
  tail -80 "$run_root/target-start.log"; exit 1;
}
target_db=supabase_db_meicare-e4-target
# Fresh CLI target may have empty migration bookkeeping. Refuse any rows or
# unexpected relations; remove only empty known tables so E1's guard is unchanged.
docker exec -i "$target_db" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
do $$ declare r record; populated boolean; begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='supabase_migrations' and c.relkind='r' loop
    if r.relname not in ('schema_migrations','seed_files') then raise exception 'UNEXPECTED_BOOTSTRAP_TABLE'; end if;
    execute format('select exists(select 1 from supabase_migrations.%I)', r.relname) into populated;
    if populated then raise exception 'BOOTSTRAP_HISTORY_NOT_EMPTY'; end if;
    execute format('drop table supabase_migrations.%I restrict', r.relname);
  end loop;
end $$;
drop schema if exists supabase_migrations restrict;
SQL
docker exec "$target_db" psql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 -c "alter system set cron.launch_active_jobs = 'off'"
docker exec "$target_db" psql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 -c 'select pg_reload_conf()'
# Local Supabase's role-creation hook sets log_min_messages on custom roles.
# The dump preserves it; grant only this parameter permission on the disposable
# target, never SUPERUSER. Revoke after the restore/role checks complete.
docker exec "$target_db" psql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 -c 'grant set on parameter log_min_messages to postgres'
# Stop services to prevent background schema/data writes. Disconnect every DB
# network before sharing its loopback-only namespace with the restore tools.
for container in $(docker ps --format '{{.Names}}' | rg '_meicare-e4-target$'); do
  [[ "$container" == "$target_db" ]] || docker stop "$container" >/dev/null
done
for network in $(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$target_db"); do
  docker network disconnect "$network" "$target_db"
done
mkdir "$run_root/input"
cp "$run_root"/{backup.tar.age,baseline.csv,source.json,key} "$run_root/input/"
docker run --name meicare-e4-restore-tools --network "container:$target_db" \
  --mount type=bind,src="$repo_dir",dst=/repo,readonly \
  --mount type=bind,src="$run_root/input",dst=/input,readonly \
  --entrypoint env meicare-recovery-synthetic -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp \
  bash /repo/scripts/v4-013e4-isolated-restore.sh
docker exec "$target_db" psql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 -c 'revoke set on parameter log_min_messages from postgres'
docker cp meicare-e4-restore-tools:/tmp/e4-summary.txt "$RUNNER_TEMP/e4-summary.txt"
cat "$RUNNER_TEMP/e4-summary.txt" >> "$GITHUB_STEP_SUMMARY"
