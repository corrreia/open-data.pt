import type { ExampleFeed } from "@open-data-pt/contract";

import type { StreamingTransformer } from "../library";

import type { Licence } from "./licences";
import type { Topic } from "./topics";

/*
 * What a publisher folder declares. A publisher is a folder under
 * `src/publishers/`, named for their key: its `index.ts` exports `PUBLISHER`,
 * its logo sits beside it as `logo.svg` or `logo.png`, the code that reads their
 * own API (when they have one) is a library folder beside that, and every
 * dataset of theirs is one file under `datasets/`, exporting `DATASET`. A
 * publisher whose data a shared format cannot read as it is brings its own
 * translator in `transformers.ts`, exporting `TRANSFORMERS`.
 *
 * Nothing here repeats what the folders already say: a publisher's key is its
 * folder's name, a dataset's key is its publisher's key and its file's name,
 * and a feed's dataset is the file it is written in.
 */

/** Who made the data: never the portal it was read from. */
export interface PublisherDefinition {
  /** The name as a heading shows it: an acronym and what it stands for, or the operator's name. */
  name: string;
  /** Their own site, not the portal the data was read from. */
  url?: string;
  /** Their mark's extension, when `logo.svg` or `logo.png` sits in the folder. Absent, their initials stand in for it. */
  logo?: "svg" | "png";
  /**
   * Whether we may republish what they publish. Absent means we may. `false`
   * holds every dataset and feed of theirs out of the catalog, so nothing of
   * theirs is polled or served, while their folder and their code stay and a
   * comment says what we are waiting for. Lifting a hold is one word.
   */
  enabled?: boolean;
}

/** One way a part of a dataset is read: which library, what configuration, how often. */
export type FeedDefinition = Omit<ExampleFeed, "dataset">;

/** One publisher's body of data, and the feeds that read it. */
export interface DatasetDefinition {
  title: string;
  description: string;
  /** The terms the publisher states for it, or `source-terms` when they state none. */
  licence: Licence;
  /** How the publisher asks to be credited, when they say. */
  attribution?: string;
  /** What the catalog groups and filters by. */
  topics: readonly Topic[];
  /**
   * The feeds that read it. Two feeds belong to one dataset when they describe
   * the same things, by the same identifiers, under the same terms. A feed that
   * is the whole of its dataset carries no title or description of its own.
   */
  feeds: readonly FeedDefinition[];
}

/**
 * Translators a publisher brings for their own data: by the library that
 * applies them, then by the name a feed's `transformer` configures. A name is
 * the publisher's to choose and must not clash with another publisher's.
 */
export interface PublisherTransformers {
  readonly [library: string]: { readonly [name: string]: StreamingTransformer };
}
