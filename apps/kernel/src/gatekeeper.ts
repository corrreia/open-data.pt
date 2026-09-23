import type { FeedGatekeeper } from "@open-data-pt/contract";

/** The Gatekeeper Worker behind the kernel's one service binding, which Wrangler types as a plain Fetcher. */
export function gatekeeperOf(env: Env): Service<FeedGatekeeper> {
  // SAFETY: GATEKEEPER is a service binding to the Worker that implements FeedGatekeeper over RPC.
  return env.GATEKEEPER as Service<FeedGatekeeper>;
}

/**
 * The Gatekeeper's catalog version, or `undefined` when it cannot say: one
 * released before the method existed, or one that did not answer. Neither is
 * an error here; the scheduled check still runs.
 */
export async function catalogVersionOf(env: Env): Promise<string | undefined> {
  try {
    return await gatekeeperOf(env).catalogVersion();
  } catch {
    return undefined;
  }
}
