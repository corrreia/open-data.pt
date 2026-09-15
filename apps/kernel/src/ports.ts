export interface StoredObject {
  body: ReadableStream<Uint8Array>;
}

/** Serving objects in R2: content-addressed record chunks and rolling windows. */
export interface SnapshotStore {
  putStream(
    objectKey: string,
    content: ReadableStream<Uint8Array> | Uint8Array,
    metadata: { contentType: string },
  ): Promise<void>;
  get(objectKey: string): Promise<StoredObject | undefined>;
  /** Delete many objects at once; one that is already gone is not an error. */
  delete(objectKeys: string[]): Promise<void>;
}
