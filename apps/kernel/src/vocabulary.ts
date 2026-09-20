import { LICENCES, PUBLISHERS, isLicence, isPublisher } from "@open-data-pt/gatekeeper-shared";

/** A vocabulary entry as the public API serves it: the key, its name, and its page when it has one. */
export interface VocabularyRef {
  id: string;
  name: string;
  url?: string;
  /** What a licence means; publishers need no description beyond their name. */
  description?: string;
  /** A publisher's mark, served from this site, to show beside their name. Absent for a publisher whose initials stand in for it. */
  logo?: string;
}

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
