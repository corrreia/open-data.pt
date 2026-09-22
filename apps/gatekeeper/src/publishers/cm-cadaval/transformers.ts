import type { PublisherTransformers } from "../../catalog/define";
import { MunicipalWasteTransformer } from "./municipal-waste";

/** Cadaval's waste collection file needs its own translator; the uData library applies it to the feed that names it. */
export const TRANSFORMERS: PublisherTransformers = {
  udata: { "municipal-waste": new MunicipalWasteTransformer() },
};
