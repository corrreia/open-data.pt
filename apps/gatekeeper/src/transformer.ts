import type { CanonicalField, FieldType, TransformContext, TransformResult } from "./index";

/** A transformer's own output: everything but the identity `runTransformer` stamps on it. */
export type UnstampedResult = Omit<TransformResult, "transformer">;

/** A translator from one source dialect into products. Pure and versioned. */
export interface Transformer {
  readonly id: string;
  readonly version: string;
  transform(bytes: Uint8Array, context: TransformContext): UnstampedResult | Promise<UnstampedResult>;
}

/** Stamp the translator's identity on its result so run logs can cite it. */
export async function runTransformer(transformer: Transformer, bytes: Uint8Array, context: TransformContext): Promise<TransformResult> {
  const result = await transformer.transform(bytes, context);
  return { ...result, transformer: { id: transformer.id, version: transformer.version } };
}

/**
 * One field of a product's canonical schema. The ID is the field's name unless
 * a source needs them to differ; `label` is what the pages show instead of it.
 */
export function field(id: string, type: FieldType, nullable: boolean, unit?: string, label?: string): CanonicalField {
  const canonical: CanonicalField = { id, name: id, type, nullable };
  if (unit) canonical.unit = unit;
  if (label) canonical.display = { label };
  return canonical;
}
