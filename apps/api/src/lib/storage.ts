import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

/** S3-compatible object storage with content-addressed keys (sha256). Local FS driver for development. */
export interface ObjectStorage {
  readonly driver: "local" | "s3";
  put(bytes: Uint8Array, contentType: string, prefix: string): Promise<{ key: string; sha256: string }>;
  get(key: string): Promise<Uint8Array | null>;
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export class LocalStorage implements ObjectStorage {
  readonly driver = "local" as const;
  constructor(private dir: string) {}
  async put(bytes: Uint8Array, _ct: string, prefix: string) {
    const h = sha(bytes);
    const key = `${prefix}/${h}`;
    await mkdir(join(this.dir, prefix), { recursive: true });
    await writeFile(join(this.dir, key), bytes);
    return { key, sha256: h };
  }
  async get(key: string) {
    if (!/^[a-z]+\/[0-9a-f]{64}$/.test(key)) return null;
    try { return new Uint8Array(await readFile(join(this.dir, key))); } catch { return null; }
  }
}

export class S3Storage implements ObjectStorage {
  readonly driver = "s3" as const;
  private client: any;
  constructor(private bucket: string, private opts: { endpoint?: string; region: string }) {}
  private async c() {
    if (!this.client) {
      const { S3Client } = await import("@aws-sdk/client-s3");
      this.client = new S3Client({ region: this.opts.region, endpoint: this.opts.endpoint, forcePathStyle: !!this.opts.endpoint });
    }
    return this.client;
  }
  async put(bytes: Uint8Array, contentType: string, prefix: string) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const h = sha(bytes);
    const key = `${prefix}/${h}`;
    await (await this.c()).send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType, ChecksumSHA256: Buffer.from(h, "hex").toString("base64") }));
    return { key, sha256: h };
  }
  async get(key: string) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      const r = await (await this.c()).send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return new Uint8Array(await r.Body.transformToByteArray());
    } catch { return null; }
  }
}
