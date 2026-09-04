interface BrowserLocation {
  hostname: string;
  origin: string;
  port: string;
  protocol: string;
}

/**
 * Keeps direct Vite development working while making a reverse-proxied build
 * same-origin.
 */
export function resolveInteroApiUrl(
  location: BrowserLocation | undefined,
): string {
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
  typeof window === "undefined" ? undefined : window.location,
);
