import { z } from "zod";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

export const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().default(4000),
  /** Audience bound into every login challenge, e.g. https://atlas.example. Must equal the site origin. */
  PUBLIC_ORIGIN: z.string().url().default("http://localhost:3000"),
  WEB_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001"),
  DATABASE_URL: z.string().default("postgres://atlas@127.0.0.1:5433/atlas"),
  APP_DATABASE_URL: z.string().default("postgres://atlas_app@127.0.0.1:5433/atlas"),
  /** Chain where ATLAS contracts and the Agent ID registry live. Production: 56. */
  CHAIN_ID: z.coerce.number().default(31337),
  RPC_URL: z.string().default("http://127.0.0.1:8545"),
  /** BSC mainnet RPC used for PancakeSwap quotes and trade-proof verification. */
  BSC_RPC_URL: z.string().default("https://bsc-rpc.publicnode.com"),
  AGENT_ID_MODE: z.enum(["onchain", "mock"]).default("onchain"),
  AGENT_ID_ADDRESS: z.string().optional(),
  DEPLOYMENT_FILE: z.string().optional(),
  IDENTITY_REGISTRY: z.string().optional(),
  THESIS_REGISTRY: z.string().optional(),
  REVIEW_REGISTRY: z.string().optional(),
  OUTCOME_REGISTRY: z.string().optional(),
  MARKET_DATA_MODE: z.enum(["live", "synthetic", "live-with-fallback"]).default("live-with-fallback"),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().optional(),
  AI_MODEL: z.string().optional(),
  /** base64 32-byte key for message encryption at rest */
  MESSAGE_KEY: z.string().optional(),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_DIR: z.string().default("/tmp/atlas-storage"),
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  REDIS_URL: z.string().optional(),
  COOKIE_SECURE: bool.optional(),
  RP_ID: z.string().optional(),
  RP_NAME: z.string().default("ATLAS Social"),
  RUN_WORKERS: bool.default("true"),
});
export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = configSchema.parse(env);
  if (cfg.NODE_ENV === "production") {
    const problems: string[] = [];
    if (cfg.AGENT_ID_MODE === "mock") problems.push("AGENT_ID_MODE=mock is forbidden in production");
    if (cfg.CHAIN_ID !== 56) problems.push("production requires CHAIN_ID=56 (BNB Smart Chain mainnet, where Agent ID lives)");
    if (cfg.MARKET_DATA_MODE === "synthetic") problems.push("synthetic market data is forbidden in production");
    if (!cfg.MESSAGE_KEY) problems.push("MESSAGE_KEY is required in production");
    if (!cfg.PUBLIC_ORIGIN.startsWith("https://")) problems.push("PUBLIC_ORIGIN must be https in production");
    if (problems.length) throw new Error(`Unsafe production configuration:\n- ${problems.join("\n- ")}`);
  }
  return cfg;
}
