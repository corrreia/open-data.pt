import type { Term } from "@open-data-pt/api";
import { LICENCES, PUBLISHERS, isLicence, isPublisher } from "@open-data-pt/catalog";

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
