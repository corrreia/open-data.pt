import { createContext, type DependencyList, type ReactNode, useContext, useEffect } from "react";
import type { Color } from "three";
import type { Point } from "./terrain/geometry.ts";

/** Something a section pins to a place on the map. */
export interface MapMark {
  id: string;
  longitude: number;
  latitude: number;
  /** What is drawn at the place. */
  node: ReactNode;
  /** What the mark says when it is pressed or read aloud: the place and its value, in words. */
  detail: string;
  /** Called when the mark is pressed, for a section that opens something about it. */
  onSelect?: () => void;
}

/** What a section puts on the map: its marks, the colour of the land, and what both mean. */
export interface MapLayer {
  marks: MapMark[];
  /** Colours the land by a value at each of its points; with none, the land shows its relief. */
  paint?: (point: Point, into: Color) => void;
  /** What the marks or colours mean, shown under the map. */
  legend: ReactNode;
}

export interface Stage {
  /** Today's date in Lisbon, as IPMA writes dates. */
  today: string;
  setLayer(layer: MapLayer): void;
}

export const StageContext = createContext<Stage | undefined>(undefined);

export function useStage(): Stage {
  const stage = useContext(StageContext);
  if (stage === undefined) throw new Error("a section was shown outside the page that holds the map");
  return stage;
}

/** Puts a section's layer on the map, and again whenever what it is made from changes. */
export function useMapLayer(make: () => MapLayer, deps: DependencyList): void {
  const stage = useStage();
  useEffect(() => {
    stage.setLayer(make());
    // The layer is rebuilt when what the section names as its sources changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
