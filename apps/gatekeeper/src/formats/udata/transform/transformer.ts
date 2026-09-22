import type { StreamingTransform, TransformContext } from "../../../index";

/**
 * A translator from one source dialect into products. Pure and versioned; it
 * reads the source as a byte stream and hands rows out one at a time.
 */
export interface Transformer {
  readonly id: string;
  readonly version: string;
  transform(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform>;
}
