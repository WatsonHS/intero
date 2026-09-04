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

export interface OrganizationWebPushKeyStore {
  listOrganizationIds(): Promise<readonly string[]>;
  read(organizationId: string): Promise<WebPushKeyPair | undefined>;
  insertIfAbsent(organizationId: string, keys: WebPushKeyPair): Promise<void>;
}

export async function ensureWebPushKeysForOrganizations(
  store: OrganizationWebPushKeyStore,
  generate: () => WebPushKeyPair = generateWebPushKeyPair,
): Promise<Map<string, WebPushKeyPair>> {
  const organizationIds = await store.listOrganizationIds();
  const pairs = new Map<string, WebPushKeyPair>();
  for (const organizationId of organizationIds) {
    pairs.set(
      organizationId,
      await ensureWebPushKeyPair(
        {
          read: () => store.read(organizationId),
          insertIfAbsent: (keys) => store.insertIfAbsent(organizationId, keys),
        },
        generate,
      ),
    );
  }
  return pairs;
}

export function webPushSubjectFromPublicUrl(publicUrl: string): string {
  const url = new URL(publicUrl);
  if (url.protocol === "https:") return url.origin;
  return `mailto:intero@${url.hostname}`;
}
