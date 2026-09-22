import { GatekeeperError } from "../../index";

/**
 * Identities a walk has already seen, so a feature repeated across pages cannot
 * make up the count of one dropped when the collection shifted underneath.
 *
 * The keys themselves are not kept. A national collection runs to a few hundred
 * thousand features, and holding every key as a string costs more memory than a
 * Worker should spend on a check — the land-use charter alone would want about
 * thirty megabytes. What is kept is a digest of each key, one number apiece, so
 * the cost per feature is fixed however long its identifier is.
 *
 * The digest is 53 bits, which is what a JavaScript number carries exactly. At
 * the largest collection this library reads the chance of two different keys
 * sharing one is about three in a million, and the consequence is a refused
 * collection rather than a wrong one: the walk stops and says the service
 * repeated a feature, which is the same thing it says when the service really
 * did.
 */
export class SeenIdentities {
  private readonly digests = new Set<number>();
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  /** Whether this identity has been seen before in this walk. */
  has(key: string): boolean {
    return this.digests.has(digest(key));
  }

  /** Record an identity, refusing a walk that outgrows what may be held. */
  add(key: string): void {
    if (this.digests.size >= this.limit) {
      throw new GatekeeperError(`OGC identity validation passed ${this.limit} features, which is more than one walk may hold`, "response-too-large");
    }
    this.digests.add(digest(key));
  }

  get size(): number {
    return this.digests.size;
  }
}

/**
 * Two 32-bit FNV-1a hashes of the same key, under different offsets, packed
 * into one 53-bit number. FNV is used rather than the package's own
 * `hashString` because that one is BigInt arithmetic per character, which is
 * far too slow for a few hundred thousand keys.
 */
export function digest(key: string): number {
  let low = 0x811c9dc5;
  let high = 0x01000193;
  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index);
    low = Math.imul(low ^ code, 0x01000193) >>> 0;
    high = Math.imul(high ^ code, 0x85ebca6b) >>> 0;
  }
  // 32 bits from one hash and 21 from the other: 53 exactly, which a number holds.
  return low * 2_097_152 + (high & 0x1f_ffff);
}
