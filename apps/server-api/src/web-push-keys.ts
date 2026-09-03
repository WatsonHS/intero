import { createRequire } from "node:module";

export interface WebPushKeyPair {
  publicKey: string;
  privateKey: string;
}

export interface WebPushKeyStore {
  read(): Promise<WebPushKeyPair | undefined>;
  insertIfAbsent(keys: WebPushKeyPair): Promise<void>;
}

export function generateWebPushKeyPair(): WebPushKeyPair {
  const webpush = createRequire(import.meta.url)("web-push") as {
    generateVAPIDKeys(): { publicKey: string; privateKey: string };
  };
  return webpush.generateVAPIDKeys();
}

export async function ensureWebPushKeyPair(
  store: WebPushKeyStore,
  generate: () => WebPushKeyPair = generateWebPushKeyPair,
): Promise<WebPushKeyPair> {
  const existing = await store.read();
  if (existing) return existing;
  await store.insertIfAbsent(generate());
  const stored = await store.read();
  if (!stored) {
    throw new Error("web_push_keys_missing_after_insert");
  }
  return stored;
}

export function webPushSubjectFromPublicUrl(publicUrl: string): string {
  const url = new URL(publicUrl);
  if (url.protocol === "https:") return url.origin;
  return `mailto:intero@${url.hostname}`;
}
