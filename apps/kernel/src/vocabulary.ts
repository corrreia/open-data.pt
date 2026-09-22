import type { Dataset as DatasetRef, Term } from "@open-data-pt/api";
import { DATASETS, LICENCES, PUBLISHERS, isDataset, isLicence, isPublisher } from "@open-data-pt/catalog";

/** A vocabulary entry as the public API serves it. */
export type VocabularyRef = Term;

/**
 * A publisher key, expanded for a reader. A key the vocabulary no longer
 * knows (a feed installed before a rename, until the next sync) is served as
 * itself rather than refused: the catalog stays up, and the sync corrects it.
 */
export function publisherRef(id: string, origin: string): VocabularyRef {
  if (!isPublisher(id)) return { id, name: id };
  const known = PUBLISHERS[id];
  const ref: VocabularyRef = { id, name: known.name };
  if ("url" in known) ref.url = known.url;
  if ("logo" in known) ref.logo = `${origin}/publishers/${id}.${known.logo}`;
  return ref;
}

export function licenceRef(id: string): VocabularyRef {
  if (!isLicence(id)) return { id, name: id };
  const known = LICENCES[id];
  return "url" in known ? { id, name: known.name, url: known.url, description: known.summary } : { id, name: known.name, description: known.summary };
}

/**
 * A dataset key, expanded for a reader: what the data is, who published it and
 * under what terms. A key the vocabulary no longer knows is served as itself,
 * the way an unknown publisher is, so one renamed entry never empties a page.
 */
export function datasetRef(id: string, origin: string): DatasetRef {
  if (!isDataset(id)) return { id, title: id, publisher: publisherRef(id, origin), licence: licenceRef("source-terms"), topics: [] };
  const known = DATASETS[id];
  const ref: DatasetRef = {
    id,
    title: known.title,
    description: known.description,
    publisher: publisherRef(known.publisher, origin),
    licence: licenceRef(known.licence),
    topics: [...known.topics],
  };
  if ("attribution" in known) ref.attribution = known.attribution;
  return ref;
}

/** Every dataset, expanded: what `/api/datasets` serves. */
export function datasetRefs(origin: string): DatasetRef[] {
  return Object.keys(DATASETS).map((id) => datasetRef(id, origin));
}
