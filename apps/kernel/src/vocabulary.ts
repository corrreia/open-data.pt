import type { Dataset as DatasetRef, Term } from "@open-data-pt/api";
import {
  NormalizedInputError,
  UNSTATED_LICENCE,
  isJsonArray,
  isJsonObject,
  isJsonString,
  parseJson,
  type CatalogDataset,
  type CatalogDescription,
  type CatalogLicence,
  type CatalogPublisher,
  type CatalogTopic,
  type JsonObject,
  type JsonValue,
} from "@open-data-pt/contract";

/** A vocabulary entry as the public API serves it. */
export type VocabularyRef = Term;

/** What the Registry holds before the Gatekeeper has first answered: every key is served as itself. */
export const EMPTY_CATALOG: CatalogDescription = { publishers: [], licences: [], topics: [], datasets: [] };

/**
 * The catalog the Gatekeeper declared, as the kernel expands it for a reader.
 * A key the catalog no longer knows (a feed installed before a rename, until
 * the next sync) is served as itself rather than refused: the catalog stays
 * up, and the sync corrects it.
 */
export class Vocabulary {
  private readonly publishers: Map<string, CatalogPublisher>;
  private readonly licences: Map<string, CatalogLicence>;
  private readonly datasets: Map<string, CatalogDataset>;

  constructor(catalog: CatalogDescription) {
    this.publishers = new Map(catalog.publishers.map((publisher) => [publisher.id, publisher]));
    this.licences = new Map(catalog.licences.map((licence) => [licence.id, licence]));
    this.datasets = new Map(catalog.datasets.map((dataset) => [dataset.id, dataset]));
  }

  /** A dataset as the Gatekeeper declared it, or `undefined` when the catalog does not name it. */
  dataset(id: string): CatalogDataset | undefined {
    return this.datasets.get(id);
  }

  publisherRef(id: string, origin: string): VocabularyRef {
    const known = this.publishers.get(id);
    if (!known) return { id, name: id };
    const ref: VocabularyRef = { id, name: known.name };
    if (known.url !== undefined) ref.url = known.url;
    if (known.logo !== undefined) ref.logo = `${origin}/publishers/${id}.${known.logo}`;
    return ref;
  }

  licenceRef(id: string): VocabularyRef {
    const known = this.licences.get(id);
    if (!known) return { id, name: id };
    return known.url !== undefined ? { id, name: known.name, url: known.url, description: known.summary } : { id, name: known.name, description: known.summary };
  }

  /**
   * A dataset key, expanded for a reader: what the data is, who published it and
   * under what terms. A key the catalog no longer knows is served as itself,
   * the way an unknown publisher is, so one renamed entry never empties a page.
   */
  datasetRef(id: string, origin: string): DatasetRef {
    const known = this.datasets.get(id);
    if (!known) return { id, title: id, publisher: this.publisherRef(id, origin), licence: this.licenceRef(UNSTATED_LICENCE), topics: [] };
    const ref: DatasetRef = {
      id,
      title: known.title,
      description: known.description,
      publisher: this.publisherRef(known.publisher, origin),
      licence: this.licenceRef(known.licence),
      topics: [...known.topics],
    };
    if (known.attribution !== undefined) ref.attribution = known.attribution;
    return ref;
  }

  /** Every dataset, expanded: what `/api/datasets` serves. */
  datasetRefs(origin: string): DatasetRef[] {
    return [...this.datasets.keys()].map((id) => this.datasetRef(id, origin));
  }
}

/**
 * The Gatekeeper's catalog, checked at the door: it crosses RPC as plain
 * strings, so every entry is rebuilt from its known fields, and a dataset that
 * names a publisher, licence or topic the catalog does not declare is a
 * mistake that refuses the whole answer rather than a new entry.
 */
export function checkedCatalog(value: CatalogDescription): CatalogDescription {
  let parsed: JsonValue;
  try {
    parsed = parseJson(JSON.stringify(value));
  } catch {
    throw new NormalizedInputError("Gatekeeper returned an invalid catalog");
  }
  if (!isJsonObject(parsed)) throw new NormalizedInputError("Gatekeeper returned an invalid catalog");
  const publishers = entries(parsed.publishers, "publisher", (entry, id): CatalogPublisher => {
    const publisher: CatalogPublisher = { id, name: required(entry, "name", `publisher ${id}`) };
    const url = optional(entry, "url", `publisher ${id}`);
    if (url !== undefined) publisher.url = url;
    const logo = optional(entry, "logo", `publisher ${id}`);
    if (logo !== undefined) {
      if (logo !== "svg" && logo !== "png") throw new NormalizedInputError(`Gatekeeper catalog: publisher ${id} has a logo of unknown type ${logo}`);
      publisher.logo = logo;
    }
    return publisher;
  });
  const licences = entries(parsed.licences, "licence", (entry, id): CatalogLicence => {
    const licence: CatalogLicence = { id, name: required(entry, "name", `licence ${id}`), summary: required(entry, "summary", `licence ${id}`) };
    const url = optional(entry, "url", `licence ${id}`);
    if (url !== undefined) licence.url = url;
    return licence;
  });
  const topics = entries(parsed.topics, "topic", (entry, id): CatalogTopic => ({ id, name: required(entry, "name", `topic ${id}`) }));
  const known = { publisher: new Set(publishers.map(({ id }) => id)), licence: new Set(licences.map(({ id }) => id)), topic: new Set(topics.map(({ id }) => id)) };
  const datasets = entries(parsed.datasets, "dataset", (entry, id): CatalogDataset => {
    const subject = `dataset ${id}`;
    const topicKeys = entry.topics;
    if (!isJsonArray(topicKeys) || !topicKeys.every(isJsonString)) throw new NormalizedInputError(`Gatekeeper catalog: ${subject} has no list of topics`);
    const dataset: CatalogDataset = {
      id,
      title: required(entry, "title", subject),
      description: required(entry, "description", subject),
      publisher: required(entry, "publisher", subject),
      licence: required(entry, "licence", subject),
      topics: [...topicKeys],
    };
    const attribution = optional(entry, "attribution", subject);
    if (attribution !== undefined) dataset.attribution = attribution;
    if (!known.publisher.has(dataset.publisher)) throw new NormalizedInputError(`Gatekeeper catalog: ${subject} names an unknown publisher: ${dataset.publisher}`);
    if (!known.licence.has(dataset.licence)) throw new NormalizedInputError(`Gatekeeper catalog: ${subject} names an unknown licence: ${dataset.licence}`);
    const unknownTopic = dataset.topics.find((topic) => !known.topic.has(topic));
    if (unknownTopic !== undefined) throw new NormalizedInputError(`Gatekeeper catalog: ${subject} names an unknown topic: ${unknownTopic}`);
    return dataset;
  });
  return { publishers, licences, topics, datasets };
}

/** One list of the catalog, each entry an object with a unique non-empty `id`. */
function entries<Entry>(value: JsonValue | undefined, noun: string, read: (entry: JsonObject, id: string) => Entry): Entry[] {
  if (!isJsonArray(value)) throw new NormalizedInputError(`Gatekeeper catalog has no list of ${noun}s`);
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!isJsonObject(entry) || !isJsonString(entry.id) || entry.id.trim() === "") throw new NormalizedInputError(`Gatekeeper catalog has a ${noun} without an id`);
    if (seen.has(entry.id)) throw new NormalizedInputError(`Gatekeeper catalog lists the ${noun} ${entry.id} twice`);
    seen.add(entry.id);
    return read(entry, entry.id);
  });
}

function required(entry: JsonObject, field: string, subject: string): string {
  const value = entry[field];
  if (!isJsonString(value) || value.trim() === "") throw new NormalizedInputError(`Gatekeeper catalog: ${subject} has no ${field}`);
  return value;
}

function optional(entry: JsonObject, field: string, subject: string): string | undefined {
  const value = entry[field];
  if (value === undefined) return undefined;
  if (!isJsonString(value) || value.trim() === "") throw new NormalizedInputError(`Gatekeeper catalog: ${subject} has an invalid ${field}`);
  return value;
}
