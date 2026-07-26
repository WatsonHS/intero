import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export interface ProviderSecretCipher {
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export class AesGcmProviderSecretCipher implements ProviderSecretCipher {
  readonly #key: Buffer;

  constructor(secret: string) {
    if (secret.length < 16) {
      throw new Error(
        "INTERO_PROVIDER_ENCRYPTION_KEY must contain at least 16 characters.",
      );
    }
    this.#key = createHash("sha256").update(secret).digest();
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      encrypted.toString("base64url"),
    ].join(".");
  }

  decrypt(value: string): string {
    const [version, iv, tag, encrypted] = value.split(".");
    if (version !== "v1" || !iv || !tag || !encrypted) {
      throw new Error("Unsupported encrypted provider credential.");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.#key,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}
