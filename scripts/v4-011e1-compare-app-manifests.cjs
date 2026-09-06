#!/usr/bin/env node

const fs = require('node:fs');
const [sourceBeforePath, sourceAfterPath, restoredPath] = process.argv.slice(2);
if (!sourceBeforePath || !sourceAfterPath || !restoredPath) {
  console.error('Usage: node scripts/v4-011e1-compare-app-manifests.cjs <source-before.json> <source-after.json> <restored.json>');
  process.exit(2);
}

const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const before = load(sourceBeforePath);
const after = load(sourceAfterPath);
const restored = load(restoredPath);

const normalize = (m) => ({
  rls_policy_count: Number(m.rls_policy_count),
  runtime: m.runtime,
  projection_rows: Number(m.projection_rows),
  ledger_drift_rows: Number(m.ledger_drift_rows),
  entities: [...(m.entities || [])]
    .map(({ entity, row_count, content_hash }) => ({ entity, row_count: Number(row_count), content_hash }))
    .sort((a, b) => a.entity.localeCompare(b.entity)),
});

const failures = [];
const check = (label, expected, observed) => {
  if (JSON.stringify(expected) !== JSON.stringify(observed)) {
    failures.push({ label, expected, observed });
  }
};

const beforeN = normalize(before);
const afterN = normalize(after);
const restoredN = normalize(restored);

check('source_stable_during_dump', beforeN, afterN);
check('restored_matches_source', afterN, restoredN);
check('ledger_drift_zero', 0, restoredN.ledger_drift_rows);
check('projection_rows', 2244, restoredN.projection_rows);
check('runtime.cutover_stage', 'SHADOW', restoredN.runtime?.cutover_stage);
check('runtime.inventory_write_mode', 'LEGACY', restoredN.runtime?.inventory_write_mode);
check('runtime.alert_publish_mode', 'SHADOW', restoredN.runtime?.alert_publish_mode);
check('runtime.his_ingestion_mode', 'HYBRID', restoredN.runtime?.his_ingestion_mode);
check('runtime.frontend_v4_ready', false, restoredN.runtime?.frontend_v4_ready);

if (failures.length) {
  console.error(JSON.stringify({ passed: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  passed: true,
  source_stable_during_dump: true,
  restored_matches_source: true,
  projection_rows: restoredN.projection_rows,
  ledger_drift_rows: restoredN.ledger_drift_rows,
  rls_policy_count: restoredN.rls_policy_count,
  entity_count: restoredN.entities.length,
  runtime: restoredN.runtime,
  ignored_by_design: ['captured_at', 'server_version patch-level differences']
}, null, 2));