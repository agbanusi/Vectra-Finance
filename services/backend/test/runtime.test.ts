import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression: an unref'd sleep timer let the indexer and keeper processes exit after one step.
describe("runLoop", () => {
  it("keeps a service process alive across iterations and stops on SIGTERM", async () => {
    const script = `
      import { runLoop } from ${JSON.stringify(new URL("../src/runtime.ts", import.meta.url).pathname)};
      let n = 0;
      const logger = { info() {}, warn() {}, error() {}, debug() {}, child() { return logger; } };
      await runLoop("probe", 50, logger, async () => { n++; if (n === 3) console.log("third-step"); });
      console.log("stopped-after", n);
    `;
    const file = join(mkdtempSync(join(tmpdir(), "vectra-runloop-")), "probe.mts");
    writeFileSync(file, script);
    const child = spawn(process.execPath, ["--import", "tsx", file], {
      cwd: new URL("..", import.meta.url).pathname,
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += String(d);
      if (out.includes("third-step") && !child.killed) setTimeout(() => child.kill("SIGTERM"), 500);
    });
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
    expect(out).toContain("third-step");
    expect(out).toMatch(/stopped-after ([3-9]|[1-9][0-9]+)/);
    expect(code).toBe(0);
  }, 20_000);
});
