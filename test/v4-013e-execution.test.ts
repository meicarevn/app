import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";

describe("V4_013E1 offline recovery execution", () => {
  it("runs shell guards and simulated recovery without network or production credentials", () => {
    execFileSync("python3", ["test/recovery_execution.py", "-v"], {
      timeout: 30000,
      stdio: "pipe"
    });
  }, 35000);
});
