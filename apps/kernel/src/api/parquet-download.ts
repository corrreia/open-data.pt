import { CADENCE_HEADER } from "#/api/cache";
import { NotFoundError, RequestError } from "#/api/errors";
import type { ProductDetail } from "#/registry/registry";
import type { ChunkObject } from "#/serving/chunks";
import { ObjectStore } from "#/serving/object-store";
import type { ByteRange, FileStore, SnapshotStore } from "#/serving/ports";
import type { ParquetSource } from "#/serving/parquet";

/** What a Parquet download reads: the chunks it is written from, and the R2 files it is kept in. */
export type ParquetStore = SnapshotStore & FileStore;

/**
 * `GET /api/products/{slug}.parquet`: a record product's current version as
 * one Parquet file. The first request for a version writes it to R2; every
 * later one, and every byte range DuckDB or a browser asks for, reads it from
 * there. The writer is loaded only here, so other requests never pay for it.
 */
export async function parquetDownload(request: Request, product: ProductDetail, store: ParquetStore, describe: () => Promise<ParquetSource>): Promise<Response> {
  const { PARQUET_MEDIA_TYPE, ParquetExports, ParquetTooLargeError } = await import("#/serving/parquet");
  const objects = new ObjectStore(store);
  const exports = new ParquetExports(store, async (key) => {
    const chunk = await objects.read<ChunkObject>(key);
    if (!chunk) throw new NotFoundError("A chunk of this product is missing; retry shortly");
    return chunk.rows;
  });
  const header = request.headers.get("Range");
  try {
    const download = await exports.download(product, describe, (size) => byteRange(header, size));
    const { file } = download;
    if (!file) return new Response(null, { status: 416, headers: { "Access-Control-Allow-Origin": "*", "Content-Range": `bytes */${download.size}` } });
    const partial = file.range.length !== file.size;
    const headers = new Headers({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Content-Length, Content-Range, ETag, Accept-Ranges",
      "Accept-Ranges": "bytes",
      "Content-Type": PARQUET_MEDIA_TYPE,
      "Content-Disposition": `attachment; filename="${product.slug}.parquet"`,
      "Content-Length": String(file.range.length),
      ETag: download.etag,
      // The edge keeps the whole file as long as the product's other current reads.
      [CADENCE_HEADER]: String(product.cadenceSeconds),
    });
    if (partial) headers.set("Content-Range", `bytes ${file.range.offset}-${file.range.offset + file.range.length - 1}/${file.size}`);
    return new Response(file.body, { status: partial ? 206 : 200, headers });
  } catch (error) {
    if (error instanceof ParquetTooLargeError) throw new RequestError(error.message, 413);
    throw error;
  }
}

/**
 * The one byte range a `Range` header asks for, clamped to the file; undefined
 * for no header or one this endpoint does not serve (several ranges, other
 * units), which is answered with the whole file.
 */
export function byteRange(header: string | null, size: number): ByteRange | "unsatisfiable" | undefined {
  const match = header === null ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return undefined;
  if (match[1] === "") {
    const suffix = Math.min(Number(match[2]), size);
    return suffix === 0 ? "unsatisfiable" : { offset: size - suffix, length: suffix };
  }
  const start = Number(match[1]);
  if (start >= size) return "unsatisfiable";
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (end < start) return undefined;
  return { offset: start, length: end - start + 1 };
}
