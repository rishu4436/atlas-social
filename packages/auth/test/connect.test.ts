import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encodeConnectCode, normalizeConnectCode, CONNECT_CODE_RE, handoffTexts, CONNECT_STAGES, CONNECT_STAGE_LABEL, CONNECT_INTENT_TTL_SECONDS } from "../src/connect.js";

describe("ATLAS Connect codes", () => {
  it("encodes 128 random bits as ATC- + 26 Crockford base32 chars", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const c = encodeConnectCode(randomBytes(16));
      expect(c).toMatch(CONNECT_CODE_RE);
      seen.add(c);
    }
    expect(seen.size).toBe(500);
    expect(encodeConnectCode(new Uint8Array(16))).toBe(`ATC-${"0".repeat(26)}`);
    expect(() => encodeConnectCode(new Uint8Array(8))).toThrow();
  });
  it("normalizes pasted codes and rejects anything else", () => {
    const c = encodeConnectCode(randomBytes(16));
    expect(normalizeConnectCode(`  ${c.toLowerCase()}\n`)).toBe(c);
    expect(normalizeConnectCode("ATC-123")).toBeNull();
    expect(normalizeConnectCode("ATC-ILOU" + "0".repeat(22))).toBeNull(); // ambiguous letters excluded
    expect(normalizeConnectCode("; rm -rf /")).toBeNull();
  });
  it("intents are short-lived", () => { expect(CONNECT_INTENT_TTL_SECONDS).toBeLessThanOrEqual(600); });
});

describe("handoff texts", () => {
  const code = encodeConnectCode(randomBytes(16));
  it("give the agent one bounded instruction with the code and preview-first rules", () => {
    const t = handoffTexts({ code, purpose: "login", apiUrl: "https://atlas-social-api.onrender.com", expiresAt: 1_800_000_000 });
    expect(t.agentPrompt).toContain(code);
    expect(t.agentPrompt).toMatch(/preview first/);
    expect(t.agentPrompt).toMatch(/execute only after I say yes/);
    expect(t.agentPrompt).toMatch(/never share my Binance credentials/i);
    expect(t.terminal).toBe(`npx --yes atlas-social-connect@latest login ${code}`);
    expect(t.commands.npx).toBe(t.terminal);
    expect(t.commands.posix).toBe(`curl -fsSL https://atlascalls.xyz/connect.sh | sh -s ${code}`);
    expect(t.commands.windows).toBe(`iex "& { $(irm https://atlascalls.xyz/connect.ps1) } ${code}"`);
    expect(t.mcp.url).toBe("https://atlas-social-api.onrender.com/mcp/connect");
    expect(t.mcp.tools).toContain("atlas_connect_complete");
  });
  it("adds --api only for non-default APIs; pay uses the pay subcommand and tx tools", () => {
    const t = handoffTexts({ code, purpose: "pay", apiUrl: "http://localhost:3000/api", expiresAt: 1_800_000_000 });
    expect(t.terminal).toBe(`npx --yes atlas-social-connect@latest pay ${code} --api http://localhost:3000/api`);
    expect(t.commands.posix).toContain("sh -s -- pay " + code);
    expect(t.commands.windows).toContain("} pay " + code);
    expect(t.mcp.tools).toContain("atlas_connect_submit_tx");
    expect(t.mcp.tools).not.toContain("atlas_connect_complete");
  });
  it("labels every reportable stage", () => {
    for (const s of CONNECT_STAGES) expect(CONNECT_STAGE_LABEL[s]).toBeTruthy();
  });
});
