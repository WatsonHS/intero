import { isIP, isIPv4 } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

import { normalizePublicHttpUrl } from "@intero/domain";

export const UNFURL_MAX_REDIRECTS = 3;
export const UNFURL_TIMEOUT_MS = 5_000;
export const UNFURL_MAX_BODY_BYTES = 512 * 1024;
export const UNFURL_USER_AGENT = "Intero-Unfurl/1.0";
export const UNFURL_ALLOWED_PORTS = new Set([80, 443]);

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type DnsLookupFn = (hostname: string) => Promise<ResolvedAddress[]>;

export class UnfurlBlockedError extends Error {
  readonly code = "unfurl_blocked" as const;

  constructor(detail: string) {
    super(detail);
    this.name = "UnfurlBlockedError";
  }
}

export class UnfurlFailedError extends Error {
  readonly code = "unfurl_failed" as const;

  constructor(detail: string) {
    super(detail);
    this.name = "UnfurlFailedError";
  }
}

const IPV4_BLOCKED_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "255.255.255.255/32",
] as const;

const IPV6_BLOCKED_CIDRS = [
  "::/128",
  "::1/128",
  "fe80::/10",
  "fc00::/7",
  "ff00::/8",
  "100::/64",
  "2001:db8::/32",
  "2001:10::/28",
  "64:ff9b::/96",
  "2002::/16",
] as const;

export function defaultDnsLookup(hostname: string): Promise<ResolvedAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true }).then((records) =>
    records.map((record) => ({
      address: record.address,
      family: record.family === 6 ? 6 : 4,
    })),
  );
}

export function parseUnfurlUrl(raw: string): URL {
  const normalized = normalizePublicHttpUrl(raw);
  if (!normalized) {
    throw new UnfurlBlockedError("url_invalid");
  }
  return new URL(normalized);
}

export function assertUnfurlUrlShape(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnfurlBlockedError("scheme_blocked");
  }
  if (url.username || url.password) {
    throw new UnfurlBlockedError("credentials_blocked");
  }
  const port = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : 80;
  if (!UNFURL_ALLOWED_PORTS.has(port)) {
    throw new UnfurlBlockedError("port_blocked");
  }
  const hostname = url.hostname.toLowerCase();
  const address = unwrapIpv6Hostname(hostname);
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new UnfurlBlockedError("host_denied");
  }
  if (isIP(address) && isBlockedAddress(address)) {
    throw new UnfurlBlockedError("address_blocked");
  }
}

function unwrapIpv6Hostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

export function isBlockedAddress(address: string): boolean {
  const mapped = mappedIpv4(address);
  if (mapped) return isBlockedIpv4(mapped);
  if (isIPv4(address)) return isBlockedIpv4(address);
  return isBlockedIpv6(address);
}

export async function assertSafeUnfurlTarget(
  raw: string,
  options: {
    lookup?: DnsLookupFn;
  } = {},
): Promise<URL> {
  const url = parseUnfurlUrl(raw);
  assertUnfurlUrlShape(url);
  const address = unwrapIpv6Hostname(url.hostname.toLowerCase());
  if (isIP(address)) return url;
  const records = await (options.lookup ?? defaultDnsLookup)(url.hostname);
  if (records.length === 0) {
    throw new UnfurlBlockedError("dns_empty");
  }
  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      throw new UnfurlBlockedError("address_blocked");
    }
  }
  return url;
}

function isBlockedIpv4(address: string): boolean {
  return IPV4_BLOCKED_CIDRS.some((cidr) => ipv4InCidr(address, cidr));
}

function isBlockedIpv6(address: string): boolean {
  const mapped = mappedIpv4(address);
  if (mapped) return isBlockedIpv4(mapped);
  return IPV6_BLOCKED_CIDRS.some((cidr) => ipv6InCidr(address, cidr));
}

function mappedIpv4(address: string): string | undefined {
  const lower = address.toLowerCase();
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(lower);
  if (dotted?.[1]) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(lower);
  if (!hex?.[1] || !hex[2]) return undefined;
  const hi = Number.parseInt(hex[1], 16);
  const lo = Number.parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function ipv4ToInt(address: string): number {
  const parts = address.split(".").map((part) => Number(part));
  return (
    (((parts[0] ?? 0) << 24) |
      ((parts[1] ?? 0) << 16) |
      ((parts[2] ?? 0) << 8) |
      (parts[3] ?? 0)) >>>
    0
  );
}

function ipv4InCidr(address: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(address) & mask) === (ipv4ToInt(base ?? "0.0.0.0") & mask);
}

function ipv6ToBigInt(address: string): bigint {
  const mapped = mappedIpv4(address);
  if (mapped) return (0xffffn << 32n) + BigInt(ipv4ToInt(mapped));
  const [head = "", tail = ""] = address.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = Math.max(8 - headParts.length - tailParts.length, 0);
  const parts = [
    ...headParts,
    ...Array.from({ length: missing }, () => "0"),
    ...tailParts,
  ].map((part) => Number.parseInt(part || "0", 16));
  return parts.reduce((acc, part) => (acc << 16n) + BigInt(part), 0n);
}

function ipv6InCidr(address: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = BigInt(bitsRaw ?? "128");
  const mask =
    bits === 0n
      ? 0n
      : (((1n << bits) - 1n) << (128n - bits)) & ((1n << 128n) - 1n);
  return (ipv6ToBigInt(address) & mask) === (ipv6ToBigInt(base ?? "::") & mask);
}
