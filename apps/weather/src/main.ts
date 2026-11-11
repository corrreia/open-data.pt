import "@fontsource-variable/archivo/wdth.css";
import { Marks } from "./map/marks.ts";
import { createMap } from "./map/scene.ts";
import { CLIMATE } from "./sections/climate.ts";
import { EARTH } from "./sections/earth.ts";
import { FORECAST } from "./sections/forecast.ts";
import { OBSERVATIONS } from "./sections/observations.ts";
import { RISKS } from "./sections/risks.ts";
import { SEA } from "./sections/sea.ts";
import type { Section, Stage } from "./sections/section.ts";
import { WARNINGS } from "./sections/warnings.ts";
import { decodeTerrain, decodeWater, type TerrainManifest, type WaterManifest } from "./terrain/format.ts";
import { el, lisbonToday } from "./ui.ts";

/** The site's sections, in the order of its navigation: one for each kind of thing IPMA publishes. */
const SECTIONS: Section[] = [FORECAST, WARNINGS, OBSERVATIONS, SEA, RISKS, EARTH, CLIMATE];

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`${selector} is missing from the page`);
  return found;
}

const panel = element("#panel");
const key = element("#key");
const nav = element("nav");
const clock = element("#clock");
const CLOCK = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

async function open(): Promise<void> {
  const canvas = document.querySelector("canvas");
  if (canvas === null) throw new Error("the map's canvas is missing from the page");
  const [about, bytes] = await Promise.all([fetch("/terrain.json"), fetch("/terrain.bin")]);
  if (!about.ok || !bytes.ok) throw new Error(`terrain: ${about.status} ${bytes.status}`);
  // SAFETY: terrain.json is written by bake.ts from a TerrainManifest and ships beside this script.
  const map = createMap(canvas, decodeTerrain((await about.json()) as TerrainManifest, await bytes.arrayBuffer()));
  const marks = new Marks(map, element("#marks"));
  element("#home").addEventListener("click", () => map.home());

  const tick = (): void => {
    map.light(new Date());
    clock.textContent = CLOCK.format(new Date());
  };
  tick();
  setInterval(tick, 60_000);

  // Rivers and lagoons are baked like the terrain; a build without them still draws everything else.
  const [aboutWater, waterBytes] = await Promise.all([fetch("/water.json"), fetch("/water.bin")]);
  if (aboutWater.ok && waterBytes.ok && aboutWater.headers.get("content-type")?.includes("json") === true) {
    // SAFETY: water.json is written by bake.ts from a WaterManifest and ships beside this script.
    map.addWater(decodeWater((await aboutWater.json()) as WaterManifest, await waterBytes.arrayBuffer()));
  }

  const links = new Map(
    SECTIONS.map((section) => {
      const link = el("a", "", section.name);
      link.href = `#/${section.path}`;
      return [section, link] as const;
    }),
  );
  nav.replaceChildren(...links.values());

  /** Counts the openings, so a section that finishes reading after the reader has moved on draws nothing. */
  let opening = 0;
  const route = async (): Promise<void> => {
    const path = location.hash.replace(/^#\/?/u, "");
    const section = SECTIONS.find((each) => each.path === path) ?? FORECAST;
    const mine = ++opening;
    for (const [each, link] of links) {
      if (each === section) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    document.title = `${section.name} · Tempo em Portugal`;
    map.paint(undefined);
    marks.set([]);
    // Each opening gets its own piece of the page. One that finishes reading after the reader has
    // moved on writes to a piece that is no longer on the page, and draws nothing on the map.
    const current = (): boolean => mine === opening;
    const stage: Stage = {
      map: { ...map, paint: (colourAt) => void (current() && map.paint(colourAt)) },
      marks: { set: (list) => void (current() && marks.set(list)) },
      panel: el("div", "", el("h2", "", section.name), el("p", "empty", "A ler open-data.pt…")),
      key: el("span", ""),
      today: lisbonToday(),
    };
    panel.replaceChildren(stage.panel);
    key.replaceChildren(stage.key);
    panel.scrollTop = 0;
    try {
      await section.show(stage);
    } catch (error) {
      stage.panel.replaceChildren(
        el("h2", "", section.name),
        el("p", "empty", `Não foi possível ler os dados: ${error instanceof Error ? error.message : "erro"}. Tente de novo dentro de momentos.`),
      );
    }
  };
  window.addEventListener("hashchange", () => void route());
  await route();
}

open().catch((error: Error) => {
  panel.replaceChildren(el("p", "empty", `Não foi possível abrir o mapa: ${error.message}`));
});
