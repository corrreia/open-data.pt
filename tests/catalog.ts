import { readFileSync } from "node:fs";
import type { ExampleFeed, GatekeeperLibraries, LibraryDeployment } from "@open-data-pt/gatekeeper-shared";
import { loadLibraries, planTopics } from "../tools/packages";

/** Every topic Worker as `pnpm packages:sync` generates it: the libraries its feeds use. */
export const PLANS = await planTopics(await loadLibraries());

/** What a topic Worker installs: its cleared libraries' examples whose first topic is the Worker's. */
export function workerExamples(topic: string): ExampleFeed[] {
  const plan = PLANS.find((candidate) => candidate.topic === topic);
  if (!plan) throw new Error(`No Worker for ${topic}`);
  return plan.libraries.filter((library) => !library.held).flatMap((library) => library.examples.filter((example) => example.topics?.[0] === topic));
}

/** Every example the Registry installs, across all Workers. */
export const INSTALLED: ExampleFeed[] = PLANS.flatMap((plan) => workerExamples(plan.topic));

/** A Worker's deployed vars, read from its generated Wrangler config so a test never invents one. */
export function workerVars(topic: string): Record<string, string> {
  const text = readFileSync(new URL(`../packages/gatekeeper-${topic}/wrangler.jsonc`, import.meta.url), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");
  const config: { vars: Record<string, string> } = JSON.parse(text);
  return config.vars;
}

/** A Worker's libraries built the way it builds them, from its vars plus whatever else the caller hands over (secrets). */
export function workerLibraries(topic: string, extra: Record<string, string | undefined> = {}): GatekeeperLibraries {
  const plan = PLANS.find((candidate) => candidate.topic === topic);
  if (!plan) throw new Error(`No Worker for ${topic}`);
  const env = { ...workerVars(topic), ...extra };
  return new Map(
    plan.libraries.map((library) => {
      // SAFETY: `env` holds the Worker's generated vars, which include every var this library declares.
      const deployment = library.deployment as LibraryDeployment<Record<string, string | undefined>>;
      return [library.source, deployment.library(env)];
    }),
  );
}
