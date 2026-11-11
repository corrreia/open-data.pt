/**
 * The weather, drawn. IPMA numbers its kinds of weather (`weatherTypeId`); each number is put
 * together here from a few parts: a sun, a cloud, drops, a bolt, flakes, mist.
 */

const SUN =
  '<circle cx="16" cy="16" r="5.5" class="sun"/><path class="rays" d="M16 4v3M16 25v3M4 16h3M25 16h3M7.5 7.5l2.1 2.1M22.4 22.4l2.1 2.1M7.5 24.5l2.1-2.1M22.4 9.6l2.1-2.1"/>';
const SMALL_SUN = '<circle cx="11" cy="11" r="4.2" class="sun"/><path class="rays" d="M11 2.8v2.2M2.8 11H5M5.2 5.2l1.6 1.6M16.8 5.2l-1.6 1.6M5.2 16.8l1.6-1.6"/>';
const CLOUD = '<path class="cloud" d="M10 23.5a5 5 0 0 1-.6-9.96 7 7 0 0 1 13.5 1.5A4.3 4.3 0 0 1 22.5 23.5z"/>';
const HIGH_CLOUD = '<path class="cloud" d="M10 20.5a5 5 0 0 1-.6-9.96 7 7 0 0 1 13.5 1.5A4.3 4.3 0 0 1 22.5 20.5z"/>';
const drops = (count: number): string => {
  const at = count === 1 ? [16] : count === 2 ? [13, 19] : [11, 16, 21];
  return `<path class="rain" d="${at.map((x) => `M${x} 23.5l-1.6 4.5`).join("")}"/>`;
};
const BOLT = '<path class="bolt" d="M17.5 21l-4 5h3l-1.5 4.5 5-6h-3l1.5-3.5z"/>';
const FLAKES = '<path class="snow" d="M12 24.5v4M10.3 25.5l3.4 2M13.7 25.5l-3.4 2M20 24.5v4M18.3 25.5l3.4 2M21.7 25.5l-3.4 2"/>';
const MIST = '<path class="mist" d="M6 12h20M4 17h24M7 22h18"/>';

/** What each of IPMA's weather types is made of. */
const GLYPHS = new Map<string, string>([
  ["1", SUN],
  ["2", SMALL_SUN + CLOUD],
  ["3", SMALL_SUN + CLOUD],
  ["25", SMALL_SUN + CLOUD],
  ["4", CLOUD],
  ["5", HIGH_CLOUD],
  ["24", CLOUD],
  ["27", CLOUD],
  ["6", SMALL_SUN + HIGH_CLOUD + drops(2)],
  ["7", SMALL_SUN + HIGH_CLOUD + drops(1)],
  ["8", SMALL_SUN + HIGH_CLOUD + drops(3)],
  ["9", HIGH_CLOUD + drops(2)],
  ["10", HIGH_CLOUD + drops(1)],
  ["11", HIGH_CLOUD + drops(3)],
  ["12", HIGH_CLOUD + drops(2)],
  ["13", HIGH_CLOUD + drops(1)],
  ["14", HIGH_CLOUD + drops(3)],
  ["15", HIGH_CLOUD + drops(1)],
  ["16", MIST],
  ["17", MIST],
  ["26", MIST],
  ["18", HIGH_CLOUD + FLAKES],
  ["21", HIGH_CLOUD + FLAKES],
  ["22", FLAKES],
  ["19", HIGH_CLOUD + BOLT],
  ["20", HIGH_CLOUD + BOLT + drops(1)],
  ["23", HIGH_CLOUD + BOLT + drops(1)],
]);

/** The drawing for one of IPMA's weather types, named for readers by IPMA's own words for it. */
export function weatherIcon(weatherTypeId: string, weatherType: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("class", "weather");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", weatherType);
  // The parts are constants of this file; nothing read from the network is written as markup.
  svg.innerHTML = GLYPHS.get(weatherTypeId) ?? CLOUD;
  return svg;
}
