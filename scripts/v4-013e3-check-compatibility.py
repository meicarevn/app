"""Compare metadata JSON files offline; PASS does not authorize data movement."""
import json
import sys
from pathlib import Path


def check(source, target):
    for manifest in (source, target):
        if (manifest.get('format_version') != 1
                or type(manifest.get('postgres_major')) is not int
                or not isinstance(manifest.get('extensions'), list)
                or not manifest['extensions']
                or not isinstance(manifest.get('managed_columns'), list)
                or not manifest['managed_columns']):
            raise ValueError('Invalid or empty metadata manifest')
        for schema in ('auth', 'storage'):
            if not any(c.get('schema') == schema for c in manifest['managed_columns']):
                raise ValueError('Managed schema metadata missing')
    failures = []
    if source['postgres_major'] != target['postgres_major']:
        failures.append('POSTGRES_MAJOR_MISMATCH')
    # Conservative exact-version gate; exceptions need an explicit reviewed plan.
    extension = lambda e: (e['name'], e['version'], e['schema'])
    if not {extension(e) for e in source['extensions']} <= {
            extension(e) for e in target['extensions']}:
        failures.append('EXTENSION_MISMATCH')
    column = lambda c: (c['schema'], c['table'], c['column'], c['type'], c['not_null'])
    if {column(c) for c in source['managed_columns']} != {
            column(c) for c in target['managed_columns']}:
        failures.append('MANAGED_SCHEMA_MISMATCH')
    return failures


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3:
            raise ValueError('Two manifest paths required')
        failures = check(*(json.loads(Path(p).read_text()) for p in sys.argv[1:]))
        print(json.dumps({'result': 'BLOCKED' if failures else 'METADATA_MATCH',
                          'blockers': failures, 'production_recovery_gate': 'BLOCKED'}))
        sys.exit(1 if failures else 0)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        print('{"result":"INVALID_MANIFEST","production_recovery_gate":"BLOCKED"}')
        sys.exit(2)
