import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM encryption at rest for direct messages. Server-held key: NOT end-to-end encryption. */
export class MessageCipher {
  private key: Buffer;
  readonly ephemeral: boolean;
  constructor(b64?: string) {
    this.ephemeral = !b64;
    this.key = b64 ? Buffer.from(b64, "base64") : randomBytes(32);
    if (this.key.length !== 32) throw new Error("MESSAGE_KEY must be 32 bytes base64");
  }
  encrypt(plain: string, aad: string) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    c.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return { ciphertext, iv, tag: c.getAuthTag() };
  }
  decrypt(m: { ciphertext: Buffer; iv: Buffer; tag: Buffer }, aad: string) {
    const d = createDecipheriv("aes-256-gcm", this.key, m.iv);
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(m.tag);
    return Buffer.concat([d.update(m.ciphertext), d.final()]).toString("utf8");
  }
}
