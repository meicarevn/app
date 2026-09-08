import { execFileSync } from "node:child_process";
import { it } from "vitest";

it("blocks incompatible recovery targets using metadata only", () => {
  execFileSync("python3", ["test/recovery_compatibility.py", "-v"], {
    stdio: "pipe", timeout: 10000
  });
});
