import type { MapScene } from "./scene.ts";

/**
 * What a section pins to the map: small pieces of the page, each kept over its place as the map
 * moves. Being page and not picture, they are sharp at any zoom, can be read by a screen reader,
 * and can be clicked.
 */

export interface Mark {
  longitude: number;
  latitude: number;
  element: HTMLElement;
}

export class Marks {
  readonly #map: MapScene;
  readonly #layer: HTMLElement;
  #marks: Mark[] = [];

  constructor(map: MapScene, layer: HTMLElement) {
    this.#map = map;
    this.#layer = layer;
    map.onMove(() => this.#place());
  }

  /** Replaces every mark on the map. */
  set(marks: readonly Mark[]): void {
    this.#marks = [...marks];
    this.#layer.replaceChildren(...marks.map((mark) => mark.element));
    this.#place();
  }

  #place(): void {
    // Marks are given most important first. One that would cover a mark already placed waits until
    // the map is zoomed in far enough for both to fit.
    const taken: [left: number, top: number, right: number, bottom: number][] = [];
    for (const mark of this.#marks) {
      const at = this.#map.toScreen(mark.longitude, mark.latitude);
      if (at === undefined) {
        mark.element.hidden = true;
        continue;
      }
      mark.element.hidden = false;
      const halfWide = mark.element.offsetWidth / 2;
      const halfTall = mark.element.offsetHeight / 2;
      const box: [number, number, number, number] = [at[0] - halfWide, at[1] - halfTall, at[0] + halfWide, at[1] + halfTall];
      // Dots are let touch; anything with words on it is kept clear of the others.
      const crowded = halfWide > 8 && taken.some((other) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1]);
      mark.element.hidden = crowded;
      if (crowded) continue;
      taken.push(box);
      mark.element.style.transform = `translate(${at[0].toFixed(1)}px, ${at[1].toFixed(1)}px) translate(-50%, -50%)`;
    }
  }
}
