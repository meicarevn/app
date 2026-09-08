#!/usr/bin/env python3
"""Offline command double. Never opens a database or a network connection."""
import os
import shutil
import sys
from pathlib import Path

name = Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ["MOCK_CALL_LOG"], "a") as log:
    log.write(name + ":" + ("restore" if "--single-transaction" in args else "read") + "\n")
if name == "psql":
    file = args[args.index("--file") + 1]
    if "empty-target" in file:
        if os.environ.get("MOCK_NONEMPTY"):
            sys.exit(1)
        print("V4_013E_EMPTY_TARGET_PASS")
    elif "baseline" in file:
        count = Path(os.environ["MOCK_CALL_LOG"]).read_text().count("psql:read")
        print("drift" if os.environ.get("MOCK_CAPTURE_DRIFT") and count > 1
              else os.environ.get("MOCK_BASELINE", "synthetic-baseline"))
    elif "acceptance" in file:
        if os.environ.get("MOCK_INVARIANT_FAIL"):
            sys.exit(1)
        print("V4_013E_RESTORE_INVARIANTS_PASS")
    elif os.environ.get("MOCK_RESTORE_FAIL"):
        sys.exit(1)
elif name == "age":
    if os.environ.get("MOCK_DECRYPT_FAIL"):
        sys.exit(1)
    shutil.copyfile(args[-1], args[args.index("--output") + 1])
elif name == "supabase":
    path = Path(args[args.index("--file") + 1])
    path.write_text("" if os.environ.get("MOCK_EMPTY_DUMP") else "-- synthetic dump\n")
