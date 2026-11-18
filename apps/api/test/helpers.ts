import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "../src/config.js";
import { createDeps, type Deps } from "../src/deps.js";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://atlas@127.0.0.1:5433/atlas_test";
export const TEST_APP_DB = process.env.TEST_APP_DATABASE_URL ?? "postgres://atlas_app@127.0.0.1:5433/atlas_test";
export const DEPLOYMENT = new URL("../../../packages/contracts/deployments/31337.json", import.meta.url).pathname;
export const ORIGIN = "http://localhost:3000";

export interface Harness { app: FastifyInstance; deps: Deps; clock: { offset: number }; close(): Promise<void> }

export async function harness(env: Record<string, string> = {}, overrides: Partial<Deps> = {}): Promise<Harness> {
  await migrate(TEST_DB, { reset: true, log: () => {} });
  const cfg = loadConfig({
    NODE_ENV: "test", DATABASE_URL: TEST_DB, APP_DATABASE_URL: TEST_APP_DB, AGENT_ID_MODE: "mock", CHAIN_ID: "31337",
    DEPLOYMENT_FILE: DEPLOYMENT, MARKET_DATA_MODE: "synthetic", PUBLIC_ORIGIN: ORIGIN, WEB_ORIGINS: ORIGIN, STORAGE_DIR: "/tmp/atlas-test-storage", ...env,
  } as any);
  const clock = { offset: 0 };
  const deps = await createDeps(cfg, { now: () => Math.floor(Date.now() / 1000) + clock.offset, ...overrides });
  const app = await buildApp(deps);
  return { app, deps, clock, close: async () => { await app.close(); await deps.db.close(); } };
}

/** A browser-like client: keeps cookies and the CSRF token. */
export class Client {
  cookies = new Map<string, string>();
  csrf: string | null = null;
  constructor(public h: Harness, public account: PrivateKeyAccount = privateKeyToAccount(generatePrivateKey())) {}
  get address() { return this.account.address; }
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.h.app.inject({
      method: method as any, url, payload: body as any,
      headers: { origin: ORIGIN, cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "), ...(this.csrf ? { "x-atlas-csrf": this.csrf } : {}), ...headers },
    });
    for (const c of ([] as string[]).concat((res.headers["set-cookie"] as any) ?? [])) {
      const [kv] = c.split(";");
      const [k, ...v] = kv!.split("=");
      const val = v.join("=");
      if (!val || /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(k!); else this.cookies.set(k!, val);
    }
    this.csrf = this.cookies.get("atlas_csrf") ?? null;
    return { status: res.statusCode, body: res.body ? safeJson(res.body) : null };
  }
  get = (u: string) => this.req("GET", u);
  post = (u: string, b: unknown = {}) => this.req("POST", u, b);

  async signChallenge(ch: any, account = this.account) {
    const td = ch.typedData;
    const { EIP712Domain: _d, ...types } = td.types;
    return account.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: { ...td.message, issuedAt: BigInt(td.message.issuedAt), expiresAt: BigInt(td.message.expiresAt) } });
  }

  /** Full Agent ID login with an EIP-712 signature (mock resolver must know the wallet). */
  async login(handle?: string) {
    if (handle && this.h.deps.mockResolver) this.h.deps.mockResolver.set(this.address, handle);
    const ch = await this.post("/auth/challenge", { wallet: this.address });
    if (ch.status !== 200) throw new Error(`challenge failed ${ch.status} ${JSON.stringify(ch.body)}`);
    const sig = await this.signChallenge(ch.body);
    const v = await this.post("/auth/verify", { loginId: ch.body.loginId, signature: sig });
    if (v.status !== 200) throw new Error(`verify failed ${v.status} ${JSON.stringify(v.body)}`);
    return v.body;
  }
}

function safeJson(s: string) { try { return JSON.parse(s); } catch { return s; } }
export const uniq = (p = "u") => `${p}${Math.random().toString(36).slice(2, 8)}`;
