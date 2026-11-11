import type { Mark } from "../map/marks.ts";
import type { MapScene } from "../map/scene.ts";

/** What a section is handed to show itself with. */
export interface Stage {
  map: MapScene;
  /** Replaces every mark on the map with these. */
  marks: { set(marks: readonly Mark[]): void };
  /** The column beside the map: the section's own piece of the page. */
  panel: HTMLElement;
  /** Under the map: what its colours or marks mean. */
  key: HTMLElement;
  /** Today's date in Lisbon, as IPMA writes dates. */
  today: string;
}

export interface Section {
  path: string;
  /** What the navigation calls it. */
  name: string;
  /** Reads what it needs and fills the stage. Called each time the section is opened. */
  show(stage: Stage): Promise<void>;
}

/** IPMA says a value is missing in more than one way. */
export const known = (value: number | null | undefined): value is number => value !== null && value !== undefined;

/** Which part of the country a place is in, by where it lies: the archipelagos are far out in the Atlantic. */
export function regionOf(longitude: number): "Continente" | "Madeira" | "Açores" {
  return longitude < -20 ? "Açores" : longitude < -12 ? "Madeira" : "Continente";
}
