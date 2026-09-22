import type { SourceConfig, StreamingTransform, TransformContext } from "../../../index";
import { MunicipalAccessibilityTransformer } from "./municipal-accessibility";
import { MunicipalWasteTransformer } from "./municipal-waste";
import { TabularTransformer } from "./tabular";
import type { Transformer } from "./transformer";

/** The translators this Gatekeeper ships, by the name a feed configures. */
interface TransformerRegistry {
  [name: string]: Transformer;
}

const TRANSFORMERS: TransformerRegistry = {
  "municipal-accessibility": new MunicipalAccessibilityTransformer(),
  "municipal-waste": new MunicipalWasteTransformer(),
  tabular: new TabularTransformer(),
};

/**
 * Pick the translator for a uData feed. `config.transformer` names one
 * explicitly; otherwise tabular formats get the generic tabular translator.
 * Raw-only documents, media, and coverages are intentionally unsupported.
 */
export function chooseTransformer(config: SourceConfig): Transformer {
  const named = config.transformer;
  if (named) {
    const transformer = TRANSFORMERS[named];
    if (!transformer) throw new Error(`Unknown uData transformer: ${named}`);
    return transformer;
  }
  const format = config.format?.toLowerCase();
  const kind = config.feed ?? "distribution";
  if (kind === "distribution" && (format === "csv" || format === "json")) return TRANSFORMERS.tabular!;
  throw new Error("This source is not a normalized tabular product");
}

export function listTransformers(): string[] {
  return Object.keys(TRANSFORMERS);
}

export function transformUdata(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform> {
  return chooseTransformer(context.feed.config).transform(body, context);
}
