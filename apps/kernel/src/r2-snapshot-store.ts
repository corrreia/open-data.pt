import type { SnapshotStore } from "./ports";

export class R2SnapshotStore implements SnapshotStore {
  constructor(private readonly bucket: R2Bucket) {}

  async putStream(objectKey: string, content: ReadableStream<Uint8Array> | Uint8Array, metadata: Parameters<SnapshotStore["putStream"]>[2]): Promise<void> {
    await this.bucket.put(objectKey, content, {
      httpMetadata: { contentType: metadata.contentType },
    });
  }

  async get(objectKey: string) {
    const object = await this.bucket.get(objectKey);
    return object ? { body: object.body } : undefined;
  }

  async delete(objectKeys: string[]): Promise<void> {
    // Deletes are free on R2, and one call takes up to 1,000 keys.
    for (let start = 0; start < objectKeys.length; start += 1000) await this.bucket.delete(objectKeys.slice(start, start + 1000));
  }
}
