import type { SourceConfig } from "./index";

/** A feed's configuration as one string, keys sorted, so equal configurations hash equally wherever they are hashed. */
export function canonicalSourceConfig(config: SourceConfig): string {
  return JSON.stringify(Object.fromEntries(Object.entries(config).sort(([left], [right]) => left.localeCompare(right))));
}

/** The digest the Gatekeeper stamps on a resolved feed and the kernel checks before trusting it. */
export async function hashSourceConfig(config: SourceConfig): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalSourceConfig(config)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
