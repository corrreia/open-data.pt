import type { Term } from "@open-data-pt/api";
import {
  NormalizedInputError,
  isJsonArray,
  isJsonObject,
  isJsonString,
  parseJson,
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
export const EMPTY_CATALOG: CatalogDescription = { publishers: [], licences: [], topics: [] };

/** What a feed says about itself that the catalog expands: whose it is, under what terms, and what it is about. */
export interface FeedTermKeys {
  publisher: string;
  licence: string;
  topics: readonly string[];
  attribution?: string;
}

/** A feed's keys, expanded for a reader. */
export interface FeedTerms {
  publisher: Term;
  licence: Term;
  topics: string[];
  attribution?: string;
}

/**
 * The catalog the Gatekeeper declared, as the kernel expands it for a reader.
 * A key the catalog no longer knows (a feed installed before a rename, until
 * the next sync) is served as itself rather than refused: the catalog stays
 * up, and the sync corrects it.
 */
export class Vocabulary {
  private readonly publishers: Map<string, CatalogPublisher>;
  private readonly licences: Map<string, CatalogLicence>;
  private readonly topics: Set<string>;

  constructor(catalog: CatalogDescription) {
    this.publishers = new Map(catalog.publishers.map((publisher) => [publisher.id, publisher]));
    this.licences = new Map(catalog.licences.map((licence) => [licence.id, licence]));
    this.topics = new Set(catalog.topics.map((topic) => topic.id));
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

  /** A feed's publisher and licence expanded, with its topics and attribution as it states them. */
  feedTerms(feed: FeedTermKeys, origin: string): FeedTerms {
    const terms: FeedTerms = { publisher: this.publisherRef(feed.publisher, origin), licence: this.licenceRef(feed.licence), topics: [...feed.topics] };
    if (feed.attribution !== undefined) terms.attribution = feed.attribution;
    return terms;
  }

  /**
   * The first key a feed names that this catalog does not declare, as the
   * sentence an error would say; `undefined` when it names only declared ones.
   * The Gatekeeper's word crosses RPC as plain strings, so a key outside its
   * catalog is a mistake, never a new entry.
   */
  unknownKey(feed: FeedTermKeys): string | undefined {
    if (!this.publishers.has(feed.publisher)) return `an unknown publisher: ${feed.publisher}`;
    if (!this.licences.has(feed.licence)) return `an unknown licence: ${feed.licence}`;
    const topic = feed.topics.find((key) => !this.topics.has(key));
    return topic === undefined ? undefined : `an unknown topic: ${topic}`;
  }
}

/**
 * The Gatekeeper's catalog, checked at the door: it crosses RPC as plain
 * strings, so every entry is rebuilt from its known fields, and one that is
 * malformed refuses the whole answer.
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
  return { publishers, licences, topics };
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
