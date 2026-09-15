import type { JsonObject } from "@open-data-pt/gatekeeper-shared";

import { BLOB_BYTES, utf8Length } from "./blob-budget";
import { validateLakeRow, type LakeTable } from "./lake";

export type OutboxFlush = (table: LakeTable, rowsJson: string, rows: number) => Promise<void>;

/** Rows of one lake table not yet handed to the runner, and the UTF-8 size of their JSON array. */
class Pending {
  rows: string[] = [];
  bytes = 2;
}

/**
 * History rows waiting for Pipelines. They are grouped into blobs of at most
 * about 900 KB of UTF-8, so a batch with thousands of revisions costs a
 * handful of SQLite row writes, and no blob reaches the 2 MB SQLite value limit.
 */
export class OutboxBuffer {
  private readonly pending = new Map<LakeTable, Pending>([["records", new Pending()], ["points", new Pending()]]);
  private total = 0;

  constructor(private readonly flushBlob: OutboxFlush, private readonly maxBytes = BLOB_BYTES) {}

  get rows(): number {
    return this.total;
  }

  async add(table: LakeTable, row: JsonObject): Promise<void> {
    validateLakeRow(row, table);
    const json = JSON.stringify(row);
    const size = utf8Length(json) + 1;
    const pending = this.pending.get(table)!;
    // Close the blob before this row would overflow it; only a row larger than the budget travels alone.
    if (pending.rows.length > 0 && pending.bytes + size > this.maxBytes) await this.flush(table);
    pending.rows.push(json);
    pending.bytes += size;
    this.total += 1;
  }

  async close(): Promise<void> {
    await this.flush("records");
    await this.flush("points");
  }

  private async flush(table: LakeTable): Promise<void> {
    const pending = this.pending.get(table)!;
    if (pending.rows.length === 0) return;
    const rows = pending.rows;
    pending.rows = [];
    pending.bytes = 2;
    await this.flushBlob(table, `[${rows.join(",")}]`, rows.length);
  }
}
