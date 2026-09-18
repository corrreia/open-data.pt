import { buildLibrary, type ExampleFeed, type GatekeeperLibraries, type Library } from "@open-data-pt/gatekeeper-shared";
import { LIBRARIES, library } from "@open-data-pt/gatekeeper-shared/libraries";

/** Every library the Gatekeeper Worker carries, as `libraries.ts` lists them. */
export const CARRIED: readonly Library[] = LIBRARIES;

/** The names of the carried libraries, in the order the Worker carries them. */
export const CARRIED_NAMES: string[] = CARRIED.map((candidate) => candidate.deployment.source);

/** What one library installs: every example it lists, since a held library is not carried. */
export function libraryExamples(name: string): ExampleFeed[] {
  return [...library(name).examples];
}

/** Every example the Registry installs, across every carried library. */
export const INSTALLED: ExampleFeed[] = CARRIED.flatMap((candidate) => [...candidate.examples]);

/** One library built the way the Worker builds it, from its declared vars plus whatever else the caller hands over (secrets). */
export function carriedLibraries(name: string, extra: Record<string, string | undefined> = {}): GatekeeperLibraries {
  return new Map([[name, buildLibrary(library(name).deployment, extra)]]);
}
