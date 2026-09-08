"""Synthetic execution tests: mocked psql/age, real shell/guards/checksums/tar."""
import hashlib
import io
import os
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts/v4-013e-restore-drill.sh"
GUARD = ROOT / "scripts/v4-013e-safety.py"
FILES = ("roles.sql", "schema.sql", "data.sql", "history_schema.sql", "history_data.sql")


class RecoveryExecution(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="meicare-recovery-test-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        fixture = (ROOT / "test/fixtures/recovery-command.py").read_bytes()
        for name in ("psql", "age", "supabase", "docker"):
            path = self.bin / name
            path.write_bytes(fixture)
            path.chmod(0o700)
        self.archive = self.root / "backup.tar.age"
        self.make_archive()
        self.baseline = self.root / "source.csv"
        self.baseline.write_text("synthetic-baseline\n")
        self.log = self.root / "calls.log"
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
        self.env.update(
            PATH=str(self.bin) + os.pathsep + os.environ["PATH"],
            MOCK_CALL_LOG=str(self.log),
            RESTORE_DATABASE_URL="postgresql://postgres:test@127.0.0.1:54322/postgres",
            SOURCE_PROJECT_REF="sgxufmcsnveyyddazwuk", RESTORE_PROJECT_REF="LOCAL",
            DRILL_CHANGE_ID="E1-test", RESTORE_APPROVAL="E1-test",
            ISOLATION_CONFIRMED="NO_EGRESS_NO_TUNNEL", ENCRYPTION_RECOVERY_REVIEWED="YES",
            DRILL_EVIDENCE_DIR=str(self.root / "evidence"),
            ENCRYPTED_BACKUP=str(self.archive), AGE_IDENTITY_FILE=str(self.root / "fake-key"),
            SOURCE_BASELINE_CSV=str(self.baseline),
            EXPECTED_BACKUP_SHA256=hashlib.sha256(self.archive.read_bytes()).hexdigest(),
            EXPECTED_BASELINE_SHA256=hashlib.sha256(self.baseline.read_bytes()).hexdigest(),
        )

    def make_archive(self, variant="regular"):
        with tarfile.open(self.archive, "w") as bundle:
            for name in FILES:
                info = tarfile.TarInfo(name)
                data = b"-- synthetic, never executed against PostgreSQL\n"
                if name == "data.sql" and variant == "link":
                    info.type = tarfile.SYMTYPE
                    info.linkname = "/tmp/outside.sql"
                    bundle.addfile(info)
                elif name == "data.sql" and variant == "traversal":
                    info.name = "../data.sql"
                    info.size = len(data)
                    bundle.addfile(info, io.BytesIO(data))
                elif name == "history_data.sql" and variant == "missing":
                    continue
                else:
                    info.size = len(data)
                    bundle.addfile(info, io.BytesIO(data))

    def run_script(self, **changes):
        return subprocess.run(["bash", str(SCRIPT)], env={**self.env, **changes},
                              cwd=self.root, text=True, capture_output=True, timeout=10)

    def assert_no_write(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        calls = self.log.read_text() if self.log.exists() else ""
        self.assertNotIn("psql:restore", calls)

    def test_remote_and_override_urls_rejected_before_connection(self):
        for url in (
            "postgresql://postgres:SECRET@db.sgxufmcsnveyyddazwuk.supabase.co:5432/postgres",
            "postgresql://postgres:SECRET@127.0.0.1:54322/postgres?host=production",
            "postgresql://postgres:SECRET@remote.example:5432/postgres",
            "host=production dbname=postgres password=SECRET",
            "postgresql://postgres:SECRET@localhost:54322/postgres",
            "postgresql://postgres:SECRET@127.0.0.1:bad/postgres",
        ):
            with self.subTest(url=url):
                result = self.run_script(RESTORE_DATABASE_URL=url)
                self.assert_no_write(result)
                self.assertFalse(self.log.exists())
                self.assertNotIn("SECRET", result.stderr + result.stdout)

    def test_missing_approval_or_environment_override_rejected(self):
        for change in ({"RESTORE_APPROVAL": ""}, {"PGHOST": "production"},
                       {"RESTORE_PROJECT_REF": "other-project"},
                       {"ISOLATION_CONFIRMED": ""}, {"ENCRYPTION_RECOVERY_REVIEWED": ""},
                       {"DRILL_CHANGE_ID": "../../escape"}):
            with self.subTest(change=change):
                self.assert_no_write(self.run_script(**change))
                self.assertFalse(self.log.exists())

    def test_existing_evidence_is_preserved(self):
        evidence = Path(self.env["DRILL_EVIDENCE_DIR"])
        evidence.mkdir()
        marker = evidence / "keep.txt"
        marker.write_text("keep")
        self.assert_no_write(self.run_script())
        self.assertEqual(marker.read_text(), "keep")

    def test_bad_archive_checksum_stops_before_database(self):
        self.assert_no_write(self.run_script(EXPECTED_BACKUP_SHA256="0" * 64))
        self.assertFalse(self.log.exists())

    def test_bad_baseline_checksum_stops_before_database(self):
        self.assert_no_write(self.run_script(EXPECTED_BASELINE_SHA256="0" * 64))
        self.assertFalse(self.log.exists())

    def test_nonempty_target_stops_before_decrypt_or_write(self):
        self.assert_no_write(self.run_script(MOCK_NONEMPTY="1"))
        self.assertNotIn("age:", self.log.read_text())

    def test_archive_paths_links_and_missing_history_rejected(self):
        for variant in ("link", "traversal", "missing"):
            with self.subTest(variant=variant):
                self.make_archive(variant)
                out = self.root / variant
                out.mkdir()
                result = subprocess.run(["python3", str(GUARD), "unpack", str(self.archive), str(out)],
                                        capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(list(out.iterdir()), [])

    def test_success_is_database_only_not_commercial_pass(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        report = (Path(self.env["DRILL_EVIDENCE_DIR"]) / "E1-test-restore-report.txt").read_text()
        self.assertIn("result=DB_CHECKS_PASS", report)
        self.assertIn("commercial_recovery_gate=BLOCKED", report)
        self.assertNotIn("result=PASS\n", report)

    def test_restore_failure_does_not_emit_success_report(self):
        result = self.run_script(MOCK_RESTORE_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((Path(self.env["DRILL_EVIDENCE_DIR"]) / "E1-test-restore-report.txt").exists())

    def test_manifest_drift_does_not_emit_success_report(self):
        result = self.run_script(MOCK_BASELINE="changed")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((Path(self.env["DRILL_EVIDENCE_DIR"]) / "E1-test-restore-report.txt").exists())

    def test_invariant_failure_does_not_emit_success_report(self):
        result = self.run_script(MOCK_INVARIANT_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((Path(self.env["DRILL_EVIDENCE_DIR"]) / "E1-test-restore-report.txt").exists())

    def run_capture(self, **changes):
        env = {**self.env, "SOURCE_DATABASE_URL": "postgresql://synthetic-only",
               "BACKUP_CHANGE_ID": "E1-backup", "BACKUP_ENCRYPTION_RECIPIENT": "synthetic-recipient",
               "BACKUP_EVIDENCE_DIR": str(self.root / "capture"), **changes}
        return subprocess.run(["bash", str(ROOT / "scripts/v4-013e-capture-backup.sh")],
                              cwd=self.root, env=env, capture_output=True, text=True, timeout=10)

    def test_capture_includes_migration_history_and_checksums(self):
        result = self.run_capture()
        self.assertEqual(result.returncode, 0, result.stderr)
        folder = self.root / "capture"
        archive = next(folder.glob("*.tar.age"))
        # age is a copy-only test double: this is NOT encryption evidence.
        with tarfile.open(archive) as bundle:
            self.assertEqual(set(bundle.getnames()), set(FILES))
        self.assertEqual(self.log.read_text().count("supabase:"), 5)
        self.assertEqual(len(next(folder.glob("*-SHA256SUMS")).read_text().splitlines()), 4)

    def test_capture_drift_does_not_emit_archive(self):
        result = self.run_capture(MOCK_CAPTURE_DRIFT="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list((self.root / "capture").glob("*.tar.age")), [])

    def test_capture_empty_component_does_not_emit_archive(self):
        result = self.run_capture(MOCK_EMPTY_DUMP="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list((self.root / "capture").glob("*.tar.age")), [])


if __name__ == "__main__":
    unittest.main()
