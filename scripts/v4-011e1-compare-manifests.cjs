#!/usr/bin/env node

const fs = require('node:fs');

const [sourcePath, restoredPath] = process.argv.slice(2);
if (!sourcePath || !restoredPath) {
  console.error('Usage: node scripts/v4-011e1-compare-manifests.cjs <source.json> <restored.json>');
  process.exit(2);
}

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const restored = JSON.parse(fs.readFileSync(restoredPath, 'utf8'));

const failures = [];
const check = (label, a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) failures.push({ label, expected: a, observed: b });
};

check('migration_count', source.migration_count, restored.migration_count);
check('latest_migration_version', source.latest_migration_version, restored.latest_migration_version);
check('storage.supabase_bucket_count', source.storage?.supabase_bucket_count, restored.storage?.supabase_bucket_count);
check('storage.supabase_object_count', source.storage?.supabase_object_count, restored.storage?.supabase_object_count);
check('security_metadata.rls_policy_count_public_and_integration', source.security_metadata?.rls_policy_count_public_and_integration, restored.security_metadata?.rls_policy_count_public_and_integration);
check('runtime', source.runtime, restored.runtime);
check('inventory_invariants.projection_rows', source.inventory_invariants?.projection_rows, restored.inventory_invariants?.projection_rows);
check('inventory_invariants.ledger_drift_rows', 0, restored.inventory_invariants?.ledger_drift_rows);

const normalizeEntities = (items = []) => [...items]
  .map(({ entity, row_count, content_hash }) => ({ entity, row_count, content_hash }))
  .sort((a, b) => a.entity.localeCompare(b.entity));

check('entities', normalizeEntities(source.entities), normalizeEntities(restored.entities));

if (failures.length) {
  console.error(JSON.stringify({ passed: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  passed: true,
  compared: [
    'migration chain',
    'Supabase Storage metadata counts',
    'RLS policy count',
    'runtime safety state',
    'inventory projection and ledger drift',
    'critical entity row counts and content hashes'
  ],
  ignored_by_design: ['captured_at_utc', 'database_bytes', 'postgres_version', 'free-form notes']
}, null, 2));
