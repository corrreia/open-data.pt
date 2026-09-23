import type { FeedGatekeeper } from "@open-data-pt/contract";

/** The Gatekeeper Worker behind the kernel's one service binding, which Wrangler types as a plain Fetcher. */
export function gatekeeperOf(env: Env): Service<FeedGatekeeper> {
  // SAFETY: GATEKEEPER is a service binding to the Worker that implements FeedGatekeeper over RPC.
  return env.GATEKEEPER as Service<FeedGatekeeper>;
}
