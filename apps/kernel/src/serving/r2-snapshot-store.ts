import { PartedUpload } from "#/serving/parted-upload";
import type { ByteRange, FileInfo, FileMetadata, FileStore, FileUpload, SnapshotStore, StoredFile } from "#/serving/ports";

export class R2SnapshotStore implements SnapshotStore, FileStore {
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

  async headFile(objectKey: string): Promise<FileInfo | undefined> {
    const object = await this.bucket.head(objectKey);
    return object ? { size: object.size, metadata: object.customMetadata ?? {} } : undefined;
  }

  async getFile(objectKey: string, range?: ByteRange): Promise<StoredFile | undefined> {
    const object = await this.bucket.get(objectKey, range ? { range } : undefined);
    if (!object) return undefined;
    return { body: object.body, size: object.size, metadata: object.customMetadata ?? {}, range: range ?? { offset: 0, length: object.size } };
  }

  uploadFile(objectKey: string, contentType: string, metadata: FileMetadata): FileUpload {
    const options = { httpMetadata: { contentType }, customMetadata: metadata };
    return new PartedUpload({
      put: async (bytes) => {
        await this.bucket.put(objectKey, bytes, options);
      },
      begin: async () => {
        const upload = await this.bucket.createMultipartUpload(objectKey, options);
        return {
          uploadPart: async (partNumber, bytes) => upload.uploadPart(partNumber, bytes),
          complete: async (parts) => {
            await upload.complete(parts);
          },
          abort: async () => upload.abort(),
        };
      },
    });
  }
}
