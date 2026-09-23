import type { SourceConfig, StreamingTransform, StreamingTransformer, TransformContext } from "#/index";
import { TabularTransformer } from "./tabular";

/** The one translator this library ships: any CSV or JSON table, read generically. */
export const TABULAR = new TabularTransformer();

/**
 * The generic translator for a uData feed that names none of its own: tabular
 * formats get the tabular translator. A feed whose data needs a publisher's own
 * translator calls it from its file, and names it in `config.transformer`.
 * Raw-only documents, media, and coverages are intentionally unsupported.
 */
export function chooseTransformer(config: SourceConfig): StreamingTransformer {
  const named = config.transformer;
  if (named) {
    if (named !== "tabular") throw new Error(`The ${named} translator is its publisher's, called from its feed file`);
    return TABULAR;
  }
  const format = config.format?.toLowerCase();
  const kind = config.feed ?? "distribution";
  if (kind === "distribution" && (format === "csv" || format === "json")) return TABULAR;
  throw new Error("This source is not a normalized tabular product");
}

export function transformUdata(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform> {
  return chooseTransformer(context.feed.config).transform(body, context);
}
