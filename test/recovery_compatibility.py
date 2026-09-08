import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('compatibility', Path(__file__).resolve().parents[1] / 'scripts/v4-013e3-check-compatibility.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Compatibility(unittest.TestCase):
    def setUp(self):
        self.source = {'format_version': 1, 'postgres_major': 17,
                       'extensions': [{'name': 'plpgsql', 'version': '1.0', 'schema': 'pg_catalog'}],
                       'managed_columns': [{'schema': s, 'table': 'fixture', 'column': 'id', 'type': 'uuid', 'not_null': True} for s in ('auth', 'storage')]}
        self.target = copy.deepcopy(self.source)

    def test_matching_metadata(self):
        self.assertEqual(module.check(self.source, self.target), [])

    def test_major_and_extension_mismatch(self):
        self.target['postgres_major'] = 15
        self.target['extensions'][0]['version'] = '0.9'
        self.assertEqual(module.check(self.source, self.target), ['POSTGRES_MAJOR_MISMATCH', 'EXTENSION_MISMATCH'])

    def test_missing_managed_column(self):
        self.target['managed_columns'].append({'schema': 'auth', 'table': 'fixture', 'column': 'required', 'type': 'text', 'not_null': True})
        self.assertEqual(module.check(self.source, self.target), ['MANAGED_SCHEMA_MISMATCH'])

    def test_invalid_and_empty_metadata_fail_closed(self):
        for manifest in ({}, {**self.source, 'extensions': []}, {**self.source, 'managed_columns': []}):
            with self.assertRaises(ValueError):
                module.check(manifest, self.target)


if __name__ == '__main__':
    unittest.main()
