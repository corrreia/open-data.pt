import type { FeedGatekeeper } from "@open-data-pt/gatekeeper-shared";

export type GatekeeperService = Service<FeedGatekeeper>;

/**
 * Every GATEKEEPER_* service binding becomes an available source driver.
 * Adding a Gatekeeper does not change the kernel.
 */
export function buildGatekeeperRegistry(
  env: Env,
): ReadonlyMap<string, GatekeeperService> {
  const gatekeepers = new Map<string, GatekeeperService>();
  for (const [bindingName, binding] of Object.entries(env)) {
    if (!bindingName.startsWith("GATEKEEPER_")) continue;
    const kind = bindingName.slice("GATEKEEPER_".length).toLowerCase();
    // SAFETY: every GATEKEEPER_* binding is a service binding to a Worker that
    // implements FeedGatekeeper; wrangler types them all as plain Fetchers.
    gatekeepers.set(kind, binding as GatekeeperService);
  }
  return gatekeepers;
}

export function getFeedGatekeeper(
  gatekeepers: ReadonlyMap<string, GatekeeperService>,
  kind: string,
): GatekeeperService {
  const gatekeeper = gatekeepers.get(kind);
  if (!gatekeeper) throw new Error(`Unknown feed gatekeeper: ${kind}`);
  return gatekeeper;
}
