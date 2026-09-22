import { DATASETS, datasetEnabled, isDataset, type DatasetDescription } from "@open-data-pt/catalog";
import { buildLibrary, type ExampleFeed, type GatekeeperLibraries, type Library } from "@open-data-pt/gatekeeper";
import { LIBRARIES, library } from "@open-data-pt/gatekeeper/libraries";

/** Every library the Gatekeeper Worker carries, as `libraries.ts` lists them. */
export const CARRIED: readonly Library[] = LIBRARIES;

/** The names of the carried libraries, in the order the Worker carries them. */
export const CARRIED_NAMES: string[] = CARRIED.map((candidate) => candidate.deployment.source);

/** Every example one library lists, whether or not its publisher is enabled. */
export function libraryExamples(name: string): ExampleFeed[] {
  return [...library(name).examples];
}

/** Every example the Registry installs: what the carried libraries list, less the publishers held for permission. */
export const INSTALLED: ExampleFeed[] = CARRIED.flatMap((candidate) => candidate.examples.filter((example) => datasetEnabled(example.dataset)));

/** One library built the way the Worker builds it, from its declared vars plus whatever else the caller hands over (secrets). */
export function carriedLibraries(name: string, extra: Record<string, string | undefined> = {}): GatekeeperLibraries {
  return new Map([[name, buildLibrary(library(name).deployment, extra)]]);
}

/** What the catalog says about the dataset an example reads part of: its publisher, its terms, its topics. */
export function datasetOf(example: ExampleFeed): DatasetDescription {
  if (!isDataset(example.dataset)) throw new Error(`${example.slug} names an unknown dataset: ${example.dataset}`);
  return DATASETS[example.dataset];
}
