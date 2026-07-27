interface BrowserLocation {
  hostname: string;
  origin: string;
  port: string;
  protocol: string;
}

/**
 * Keeps direct Vite development working while making a reverse-proxied build
 * same-origin by default. An explicit VITE_INTERO_API_URL always wins.
 */
export function resolveInteroApiUrl(
  configured: string | undefined,
  location: BrowserLocation | undefined,
): string {
  const explicit = configured?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  if (!location || !["http:", "https:"].includes(location.protocol)) {
    return "http://localhost:4310";
  }
  if (location.port !== "5173") return location.origin;

  const hostname = location.hostname.includes(":")
    ? `[${location.hostname.replaceAll("[", "").replaceAll("]", "")}]`
    : location.hostname;
  return `${location.protocol}//${hostname}:4310`;
}

export const INTERO_API_URL = resolveInteroApiUrl(
  import.meta.env.VITE_INTERO_API_URL,
  typeof window === "undefined" ? undefined : window.location,
);
