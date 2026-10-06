export interface StoredObject {
  body: ReadableStream<Uint8Array>;
}

/** Serving objects in R2: content-addressed record chunks and rolling windows. */
export interface SnapshotStore {
  putStream(objectKey: string, content: ReadableStream<Uint8Array> | Uint8Array, metadata: { contentType: string }): Promise<void>;
  get(objectKey: string): Promise<StoredObject | undefined>;
  /** Delete many objects at once; one that is already gone is not an error. */
  delete(objectKeys: string[]): Promise<void>;
}

/** String metadata stored beside a file, such as the digest of the terms it was written under. */
export type FileMetadata = Record<string, string>;

/** What is known about a stored file without reading it. */
export interface FileInfo {
  size: number;
  metadata: FileMetadata;
}

/** Part of a file: from `offset`, `length` bytes. */
export interface ByteRange {
  offset: number;
  length: number;
}

/** A stored file's bytes, or the range of them asked for. */
export interface StoredFile extends FileInfo {
  body: ReadableStream<Uint8Array>;
  /** The bytes the body holds: the whole file unless a range was asked for. */
  range: ByteRange;
}

/** A file being written in pieces; nothing is readable under its key until it is closed. */
export interface FileUpload {
  write(bytes: Uint8Array): Promise<void>;
  /** Store what was written; returns the file's size. */
  close(): Promise<number>;
  /** Give up, leaving whatever the key held before. */
  abort(): Promise<void>;
}

/**
 * Downloadable files in R2, written once in pieces too large to hold whole and
 * read back whole or by byte range: the Parquet exports.
 */
export interface FileStore {
  headFile(objectKey: string): Promise<FileInfo | undefined>;
  getFile(objectKey: string, range?: ByteRange): Promise<StoredFile | undefined>;
  uploadFile(objectKey: string, contentType: string, metadata: FileMetadata): FileUpload;
}
