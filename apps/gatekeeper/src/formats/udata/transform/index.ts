import type { SourceConfig, StreamingTransform, StreamingTransformer, TransformContext } from "../../../index";
import { TabularTransformer } from "./tabular";

/** The one translator this library ships: any CSV or JSON table, read generically. */
const TABULAR = new TabularTransformer();

/**
 * Pick the translator for a uData feed. `config.transformer` names one: the
 * generic `tabular`, or one a publisher brings in their own folder for data
 * that needs it. Otherwise tabular formats get the generic translator.
 * Raw-only documents, media, and coverages are intentionally unsupported.
 */
export function chooseTransformer(config: SourceConfig, publishers: ReadonlyMap<string, StreamingTransformer> = new Map()): StreamingTransformer {
  const named = config.transformer;
  if (named) {
    const transformer = named === "tabular" ? TABULAR : publishers.get(named);
    if (!transformer) throw new Error(`Unknown uData transformer: ${named}`);
    return transformer;
  }
  const format = config.format?.toLowerCase();
  const kind = config.feed ?? "distribution";
  if (kind === "distribution" && (format === "csv" || format === "json")) return TABULAR;
  throw new Error("This source is not a normalized tabular product");
}

export function transformUdata(
  body: ReadableStream<Uint8Array>,
  context: TransformContext,
  publishers: ReadonlyMap<string, StreamingTransformer> = new Map(),
): Promise<StreamingTransform> {
  return chooseTransformer(context.feed.config, publishers).transform(body, context);
}
