import { describe, it, expect } from "vitest";
import { configSchema, loadConfig } from "../src/config.js";
import { loadContracts } from "../src/deps.js";
import { assertContractsDeployed } from "../src/lib/contracts-status.js";

describe("live beta before the mainnet deploy", () => {
  const cfg = loadConfig({ NODE_ENV: "production", CHAIN_ID: "56", AGENT_ID_MODE: "onchain", MARKET_DATA_MODE: "live", MESSAGE_KEY: "x", PUBLIC_ORIGIN: "https://atlas.example" } as any);
  it("uses the official Agent ID registry and marks ATLAS contracts as pending", () => {
    const c = loadContracts(cfg);
    expect(c.agentId).toBe("0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F");
    expect(c.agentIdIsMock).toBe(false);
    expect(c.atlasDeployed).toBe(false);
  });
  it("refuses on-chain actions with 503 CONTRACTS_PENDING instead of faking success", () => {
    expect(() => assertContractsDeployed({ contracts: loadContracts(cfg) })).toThrowError(/pending deployment/);
    try { assertContractsDeployed({ contracts: loadContracts(cfg) }); } catch (e: any) { expect(e.status).toBe(503); expect(e.code).toBe("CONTRACTS_PENDING"); }
  });
  it("still rejects a non-official registry on chain 56", () => {
    expect(() => loadContracts(configSchema.parse({ CHAIN_ID: "56", AGENT_ID_ADDRESS: "0x000000000000000000000000000000000000dEaD" }))).toThrow();
  });
});
