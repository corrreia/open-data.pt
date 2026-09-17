import { readFileSync } from "node:fs";
import type { ExampleFeed, GatekeeperLibraries, LibraryDeployment } from "@open-data-pt/gatekeeper-shared";
import { loadLibraries, planWorkers, type WorkerPlan } from "../tools/packages";

/** Every Gatekeeper Worker as `pnpm packages:sync` generates it: one library each. */
export const PLANS: WorkerPlan[] = await planWorkers(await loadLibraries());

function plan(library: string): WorkerPlan {
  const found = PLANS.find((candidate) => candidate.name === library);
  if (!found) throw new Error(`No Worker for ${library}`);
  return found;
}

/** What a library's Worker installs: every example of that library, since a held library has no Worker. */
export function workerExamples(library: string): ExampleFeed[] {
  return [...plan(library).library.examples];
}

/** Every example the Registry installs, across all Workers. */
export const INSTALLED: ExampleFeed[] = PLANS.flatMap((candidate) => workerExamples(candidate.name));

/** A Worker's deployed vars, read from its generated Wrangler config so a test never invents one. */
export function workerVars(library: string): Record<string, string> {
  const text = readFileSync(new URL(`../packages/gatekeeper-${library}/wrangler.jsonc`, import.meta.url), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");
  const config: { vars: Record<string, string> } = JSON.parse(text);
  return config.vars;
}

/** A Worker's library built the way it builds it, from its vars plus whatever else the caller hands over (secrets). */
export function workerLibraries(library: string, extra: Record<string, string | undefined> = {}): GatekeeperLibraries {
  const env = { ...workerVars(library), ...extra };
  // SAFETY: `env` holds the Worker's generated vars, which include every var this library declares.
  const deployment = plan(library).library.deployment as LibraryDeployment<Record<string, string | undefined>>;
  return new Map([[library, deployment.library(env)]]);
}
