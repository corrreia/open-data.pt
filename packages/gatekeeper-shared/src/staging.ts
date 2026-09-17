/**
 * Where a Gatekeeper parks a source body before parsing it, for sources that
 * send no validators: the stored copy's digest says whether anything changed,
 * so an unchanged file is downloaded once and never parsed.
 */
export interface SourceStaging {
  /** Stores the body under the key and answers the stored content's digest. */
  store(key: string, body: ReadableStream<Uint8Array>, length: number): Promise<string>;
  /** Reads back what `store` put under the key. */
  read(key: string): Promise<ReadableStream<Uint8Array>>;
}

/**
 * Staging in an R2 bucket. R2 computes an MD5 checksum for every non-multipart
 * upload, so the digest costs no Worker CPU. A stream put needs a known length,
 * which `FixedLengthStream` gives the response body.
 */
export function r2Staging(bucket: R2Bucket): SourceStaging {
  return {
    async store(key, body, length) {
      const { readable, writable } = new FixedLengthStream(length);
      const [object] = await Promise.all([bucket.put(key, readable), body.pipeTo(writable)]);
      const md5 = object?.checksums.md5;
      if (!md5) throw new Error(`R2 stored ${key} without an MD5 checksum`);
      return `md5:${[...new Uint8Array(md5)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    },
    async read(key) {
      const object = await bucket.get(key);
      if (!object) throw new Error(`R2 lost the staged ${key}`);
      return object.body;
    },
  };
}
