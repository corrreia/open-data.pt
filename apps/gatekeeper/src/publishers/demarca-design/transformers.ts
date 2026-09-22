import type { PublisherTransformers } from "#/catalog/define";
import { MunicipalAccessibilityTransformer } from "./municipal-accessibility";

/** DEMARCA's accessibility survey needs its own translator; the uData library applies it to the feed that names it. */
export const TRANSFORMERS: PublisherTransformers = {
  udata: { "municipal-accessibility": new MunicipalAccessibilityTransformer() },
};
