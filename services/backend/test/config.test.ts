import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";
import { createLogger } from "../src/util/log.js";

const BASE = { RPC_URL: "http://127.0.0.1:8545", CHAIN_ID: "31337", DEPLOYMENT_FILE: "x.json" };

describe("config", () => {
  it("parses defaults and validates", () => {
    const c = loadConfig(BASE);
    expect(c.keeper.privateKey).toBeUndefined();
    expect(c.keeper.policy.enableDrift).toBe(false);
    expect(() => loadConfig({ ...BASE, CHAIN_ID: undefined })).toThrow(ConfigError);
    expect(() => loadConfig({ ...BASE, KEEPER_PRIVATE_KEY: "0x12" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...BASE, ADMIN_API_TOKEN: "short" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...BASE, DRIFT_THRESHOLD_BPS: "20000" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...BASE, KEEPER_ENABLE_DRIFT: "maybe" })).toThrow(ConfigError);
  });

  it("never logs secrets", () => {
    const lines: string[] = [];
    createLogger({ sink: (l) => lines.push(l) }).info("x", { privateKey: "0xdead", adminToken: "t", nested: { authorization: "Bearer y" } });
    expect(lines[0]).not.toMatch(/dead|Bearer/);
  });
});
