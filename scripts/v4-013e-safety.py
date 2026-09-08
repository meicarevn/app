"""Offline guards only: no database/network access, no credential output."""
import os
import re
import shutil
import sys
import tarfile
from pathlib import Path
from urllib.parse import urlsplit

FILES = {"roles.sql", "schema.sql", "data.sql", "history_schema.sql", "history_data.sql"}
PRODUCTION_REF = "sgxufmcsnveyyddazwuk"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check_environment(mode):
    prefix = "DRILL" if mode == "restore" else "BACKUP"
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", os.environ.get(prefix + "_CHANGE_ID", "")),
            "CHANGE_ID must contain only letters, digits, underscore or hyphen")
    path = Path(os.environ.get(prefix + "_EVIDENCE_DIR", ""))
    repo = Path(__file__).resolve().parent.parent
    require(path.is_absolute() and path != Path("/"), "Evidence path must be absolute and not root")
    require(repo not in (path.resolve(), *path.resolve().parents), "Evidence must be outside the repository")
    require(not path.exists() and not path.is_symlink(), "Evidence directory must be new; never overwrite a run")
    if mode != "restore":
        return
    require(os.environ.get("RESTORE_PROJECT_REF") == "LOCAL", "E1 permits LOCAL restore targets only")
    require(os.environ.get("SOURCE_PROJECT_REF") == PRODUCTION_REF, "Unexpected source project reference")
    require(os.environ.get("RESTORE_APPROVAL") == os.environ["DRILL_CHANGE_ID"], "RESTORE_APPROVAL must match the approved change ID")
    require(os.environ.get("ISOLATION_CONFIRMED") == "NO_EGRESS_NO_TUNNEL", "Confirm isolated target with no egress or production tunnel")
    require(os.environ.get("ENCRYPTION_RECOVERY_REVIEWED") == "YES", "Vault/column encryption recovery review required")
    raw = os.environ.get("RESTORE_DATABASE_URL", "")
    require(not any(c.isspace() for c in raw), "Invalid restore URL")
    parsed = urlsplit(raw)
    require(parsed.scheme in ("postgres", "postgresql") and parsed.hostname in ("127.0.0.1", "::1"),
            "Restore URL must use an explicit loopback IP; remote targets are disabled")
    require(parsed.port is not None and parsed.port > 0 and parsed.path == "/postgres", "Explicit port and postgres database required")
    require(not parsed.query and not parsed.fragment, "Restore URL options are forbidden (including host overrides)")
    require(parsed.username == "postgres", "Restore user must be postgres on the isolated target")
    require(not any(k.startswith("PG") for k in os.environ), "Unset PG environment overrides before restore")
    for key in ("EXPECTED_BACKUP_SHA256", "EXPECTED_BASELINE_SHA256"):
        require(re.fullmatch(r"[0-9a-f]{64}", os.environ.get(key, "")), "Expected SHA-256 must be 64 lowercase hex digits")


def unpack(archive, destination):
    destination = Path(destination)
    with tarfile.open(archive, "r:") as bundle:
        members = bundle.getmembers()
        require(len(members) == len(FILES) and {m.name for m in members} == FILES,
                "Backup archive contains unexpected paths or missing components")
        require(all(m.isfile() and 0 < m.size <= 2_147_483_648 for m in members),
                "Backup members must be non-empty regular files, not links/devices")
        require(sum(m.size for m in members) <= 5_368_709_120, "Archive exceeds reviewed drill size limit")
        # Never use extractall: only copy validated file streams into fresh files.
        for member in members:
            with bundle.extractfile(member) as source, (destination / member.name).open("xb") as target:
                shutil.copyfileobj(source, target)


if __name__ == "__main__":
    try:
        if sys.argv[1] == "unpack":
            unpack(sys.argv[2], sys.argv[3])
        else:
            check_environment(sys.argv[1])
    except (ValueError, OSError, tarfile.TarError, IndexError):
        # No exception interpolation: malformed URIs can contain credentials.
        print("V4_013E_SAFETY_REJECTED: check target, approvals, evidence path or archive", file=sys.stderr)
        sys.exit(2)
