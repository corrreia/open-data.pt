import type { FileUpload } from "#/serving/ports";

/**
 * R2 takes a multipart upload only when every part but the last is the same
 * size, and at least 5 MiB. Eight keeps the buffer small and still allows files
 * of up to 80 GB in R2's 10,000 parts.
 */
export const PART_BYTES = 8 * 1024 * 1024;

/** A part R2 accepted, as completing the upload names it. */
export interface UploadedPart {
  partNumber: number;
  etag: string;
}

/** One multipart upload in progress. */
export interface MultipartSession {
  uploadPart(partNumber: number, bytes: Uint8Array): Promise<UploadedPart>;
  complete(parts: UploadedPart[]): Promise<void>;
  abort(): Promise<void>;
}

/** Where a parted upload ends: one plain write for a small file, a multipart upload for a large one. */
export interface UploadTarget {
  put(bytes: Uint8Array): Promise<void>;
  begin(): Promise<MultipartSession>;
}

/**
 * A file written in pieces of any size and stored in parts of exactly
 * `partBytes`. A file that never reaches one part is stored with a single
 * write; a larger one starts a multipart upload at its first full part, so at
 * most one part and the piece being added are ever held.
 */
export class PartedUpload implements FileUpload {
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private written = 0;
  private session: MultipartSession | undefined;
  private readonly parts: UploadedPart[] = [];

  constructor(
    private readonly target: UploadTarget,
    private readonly partBytes = PART_BYTES,
  ) {}

  async write(bytes: Uint8Array): Promise<void> {
    if (bytes.byteLength === 0) return;
    this.pending.push(bytes);
    this.pendingBytes += bytes.byteLength;
    this.written += bytes.byteLength;
    while (this.pendingBytes >= this.partBytes) await this.sendPart(this.take(this.partBytes));
  }

  async close(): Promise<number> {
    if (!this.session) {
      await this.target.put(this.take(this.pendingBytes));
      return this.written;
    }
    if (this.pendingBytes > 0) await this.sendPart(this.take(this.pendingBytes));
    await this.session.complete(this.parts);
    return this.written;
  }

  async abort(): Promise<void> {
    this.pending = [];
    this.pendingBytes = 0;
    await this.session?.abort();
  }

  private async sendPart(bytes: Uint8Array): Promise<void> {
    this.session ??= await this.target.begin();
    this.parts.push(await this.session.uploadPart(this.parts.length + 1, bytes));
  }

  /** The first `count` pending bytes as one array; whatever is left stays pending. */
  private take(count: number): Uint8Array {
    const out = new Uint8Array(count);
    let filled = 0;
    while (filled < count) {
      const head = this.pending[0]!;
      const used = Math.min(head.byteLength, count - filled);
      out.set(head.subarray(0, used), filled);
      filled += used;
      if (used === head.byteLength) this.pending.shift();
      else this.pending[0] = head.subarray(used);
    }
    this.pendingBytes -= count;
    return out;
  }
}
