import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/b612-mono/latin-400.css";
import { readEarthquakes, readFloodAlerts, readHotspots, readLightning, readOccurrences, readReservoirs, readStations, readWarnings } from "./data.ts";
import { happeningLayer, type Layer, type Measure, measureLayer, MEASURES, reservoirLayer, type Spot, stationReadings, waterLayer } from "./layers.ts";
import { createMap, type MapScene } from "./scene.ts";
import { decodeTerrain, decodeWater, type TerrainManifest, type WaterManifest } from "./terrain/format.ts";
import { knowsDirections, windArrowLayer } from "./wind.ts";

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`#${id} is missing from the page`);
  return found;
}

const canvas = document.querySelector("canvas");
const panel = document.querySelector("form");
const time = element("time");
const readout = element("readout");
const tip = element("tip");
const live = element("live");
const scale = element("scale");
const compass = element("compass");
const legend = element("legend");
const fold = element("fold");

const LISBON_TIME = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", day: "numeric", month: "long" });
const HOUR = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit" });
const WHOLE = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 0 });
/** IPMA's stations report on the hour and civil protection's list moves every few minutes: this keeps up with both. */
const REFRESH_MS = 5 * 60_000;
/** How near the pointer must come to something, in pixels, to be told about it. */
const REACH = 24;

/** A measure's scale as a strip of colour, each step of it the same width whatever its value. */
function strip(measure: Measure): string {
  return `linear-gradient(90deg, ${measure.scale.map(([, colour]) => `#${colour.toString(16).padStart(6, "0")}`).join(", ")})`;
}

/** Shows the key of what the land is coloured by: its strip, with the value at every other step. */
function showKey(measure: Measure | undefined): void {
  scale.hidden = measure === undefined;
  if (measure === undefined) return;
  scale.style.background = strip(measure);
  const last = measure.scale.length - 1;
  scale.replaceChildren(
    ...measure.scale.flatMap(([value], index) => {
      if (index % 2 !== 0 && index !== last) return [];
      const figure = document.createElement("b");
      figure.textContent = index === last ? `${value} ${measure.unit}` : `${value}`;
      figure.style.left = `${(index / last) * 100}%`;
      return [figure];
    }),
  );
}

for (const input of document.querySelectorAll<HTMLInputElement>("#paints input")) {
  const measure = MEASURES.get(input.value);
  if (measure !== undefined) input.parentElement?.querySelector<HTMLElement>(".swatch")?.style.setProperty("--scale", strip(measure));
}

/** A source that fails leaves its layer empty; it does not take the others down with it. */
async function orNothing<Read>(read: Promise<Read>, nothing: Read): Promise<Read> {
  try {
    return await read;
  } catch {
    return nothing;
  }
}

interface Shown {
  layers: Map<string, Layer>;
  /** The land coloured by each thing the stations measure; one is shown at a time. */
  paints: Map<string, Layer>;
  /** What the legend says beside each layer's name. */
  counts: Map<string, string>;
}

/** Everything live, read afresh and drawn anew; the layers it replaces are taken off the map first. */
async function readLayers(map: MapScene, previous: Shown): Promise<Shown> {
  const now = new Date();
  const [stations, reservoirs, occurrences, lightning, earthquakes, floods, hotspots, warnings] = await Promise.all([
    readStations(now),
    orNothing(readReservoirs(), []),
    orNothing(readOccurrences(), { happenings: [], personnel: 0, fires: 0 }),
    orNothing(readLightning(now), []),
    orNothing(readEarthquakes(now), []),
    orNothing(readFloodAlerts(), []),
    orNothing(readHotspots(now), []),
    orNothing(readWarnings(now), []),
  ]);
  for (const layer of [...previous.layers.values(), ...previous.paints.values()]) layer.show(false);
  live.textContent = `Lido às ${HOUR.format(now)}`;

  // The wind is drawn only where the data says which way it blows; its speed is told to the pointer either way.
  const directed = knowsDirections(stations);
  const arrows = directed ? windArrowLayer(map, stations) : undefined;
  const readings = stationReadings(map, stations);
  return {
    layers: new Map<string, Layer>([
      ["wind", { show: (visible) => arrows?.show(visible), spots: () => [] }],
      // Nothing of its own is drawn: the stations are there for the pointer whatever else is shown.
      ["stations", { show: () => {}, spots: () => readings }],
      ["reservoirs", reservoirLayer(map, reservoirs)],
      ["warnings", happeningLayer(map, warnings, 2.4, true)],
      ["occurrences", happeningLayer(map, occurrences.happenings, 0.8, false)],
      ["lightning", happeningLayer(map, lightning, 0.55, false)],
      ["earthquakes", happeningLayer(map, earthquakes, 0.7, false)],
      ["floods", happeningLayer(map, floods, 1, false)],
      ["hotspots", happeningLayer(map, hotspots, 0.8, false)],
    ]),
    paints: new Map([...MEASURES].map(([name, measure]) => [name, measureLayer(map, stations, measure)])),
    counts: new Map([
      ["wind", directed ? "" : "sem direção"],
      // Read by the legend to offer the sun's radiation only once the product carries it.
      ["radiation", stations.some((station) => station.radiation !== undefined) ? "há" : ""],
      ["reservoirs", `${reservoirs.length}`],
      ["occurrences", `${occurrences.happenings.length}`],
      ["lightning", `${lightning.length}`],
      ["earthquakes", `${earthquakes.length}`],
      ["floods", `${floods.length}`],
      ["hotspots", `${hotspots.length}`],
      ["warnings", `${warnings.length}`],
    ]),
  };
}

async function open(): Promise<void> {
  if (canvas === null || panel === null) throw new Error("the map's canvas or its legend is missing from the page");
  const [about, bytes] = await Promise.all([fetch("/terrain.json"), fetch("/terrain.bin")]);
  if (!about.ok || !bytes.ok) throw new Error(`terrain: ${about.status} ${bytes.status}`);
  // SAFETY: terrain.json is written by bake.ts from a TerrainManifest and ships beside this script.
  const manifest = (await about.json()) as TerrainManifest;
  const map = createMap(canvas, decodeTerrain(manifest, await bytes.arrayBuffer()));

  const tick = (): void => {
    const now = new Date();
    map.light(now);
    time.textContent = LISBON_TIME.format(now);
  };
  tick();
  setInterval(tick, 30_000);

  map.onReading = (reading) => {
    // The height is a guess between survey marks, so it is given to the ten metres and marked as about.
    readout.textContent =
      reading === undefined
        ? ""
        : `${Math.abs(reading.latitude).toFixed(3)}° N ${Math.abs(reading.longitude).toFixed(3)}° W ≈ ${WHOLE.format(Math.round(reading.metres / 10) * 10)} m`;
  };

  const needle = compass.querySelector("svg");
  map.onFrame(() => {
    if (needle !== null) needle.style.transform = `rotate(${-map.bearing()}rad)`;
  });
  compass.addEventListener("click", () => map.faceNorth());

  // Rivers and lagoons are baked like the terrain; a build without them still draws everything else.
  const fixed = new Map<string, Layer>();
  const [aboutWater, waterBytes] = await Promise.all([fetch("/water.json"), fetch("/water.bin")]);
  if (aboutWater.ok && waterBytes.ok && aboutWater.headers.get("content-type")?.includes("json") === true) {
    // SAFETY: water.json is written by bake.ts from a WaterManifest and ships beside this script.
    fixed.set("water", waterLayer(map, decodeWater((await aboutWater.json()) as WaterManifest, await waterBytes.arrayBuffer())));
    const row = panel.querySelector<HTMLInputElement>('input[name="water"]')?.parentElement ?? null;
    if (row !== null) row.hidden = false;
  }

  let shown: Shown = { layers: new Map(), paints: new Map(), counts: new Map() };
  const all = (): Map<string, Layer> => new Map([...fixed, ...shown.layers]);
  const wanted = (name: string): boolean => name === "stations" || new FormData(panel).has(name);
  const apply = (): void => {
    for (const [name, layer] of all()) layer.show(wanted(name));
    // The land takes one colouring at a time: the others are put away first, and the relief is what is left with none.
    const paint = String(new FormData(panel).get("paint"));
    for (const [name, layer] of shown.paints) if (name !== paint) layer.show(false);
    shown.paints.get(paint)?.show(true);
    showKey(MEASURES.get(paint));
    const sun = panel.querySelector<HTMLInputElement>('input[value="radiation"]')?.parentElement;
    if (sun !== null && sun !== undefined) sun.hidden = shown.counts.get("radiation") !== "há";
    for (const input of panel.querySelectorAll("input")) {
      const count = input.parentElement?.querySelector("output");
      if (count !== null && count !== undefined) count.textContent = shown.counts.get(input.name) ?? "";
    }
  };
  const refresh = async (): Promise<void> => {
    try {
      shown = await readLayers(map, shown);
      apply();
    } catch (error) {
      live.textContent = `Sem dados ao vivo: ${error instanceof Error ? error.message : "erro"}`;
    }
  };
  panel.addEventListener("change", apply);
  await refresh();
  setInterval(() => void refresh(), REFRESH_MS);

  /** Says what is drawn nearest a place on the screen, within a reach in pixels, or puts the note away. */
  const tell = (clientX: number, clientY: number, within: number): void => {
    let nearest: Spot | undefined;
    let reach = within;
    for (const [name, layer] of all()) {
      if (!wanted(name)) continue;
      for (const spot of layer.spots()) {
        const at = map.toScreen(spot.point, spot.height);
        const distance = at === undefined ? Infinity : Math.hypot(at[0] - clientX, at[1] - clientY);
        if (distance < reach) [nearest, reach] = [spot, distance];
      }
    }
    tip.hidden = nearest === undefined;
    if (nearest === undefined) return;
    tip.textContent = nearest.label;
    tip.style.left = `${Math.min(clientX, window.innerWidth - 300)}px`;
    tip.style.top = `${clientY}px`;
  };
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    if (event.buttons === 0) tell(event.clientX, event.clientY, REACH);
    else tip.hidden = true;
  });
  canvas.addEventListener("pointerleave", () => (tip.hidden = true));
  // A finger has no hover: a tap asks what is there.
  canvas.addEventListener("click", (event) => tell(event.clientX, event.clientY, REACH * 1.4));

  // On a phone the legend is a sheet at the foot of the chart, folded until asked for.
  const setFolded = (folded: boolean): void => {
    legend.classList.toggle("folded", folded);
    fold.setAttribute("aria-expanded", String(!folded));
    fold.textContent = folded ? "Legenda" : "Fechar";
  };
  setFolded(window.innerWidth <= 700);
  fold.addEventListener("click", () => setFolded(!legend.classList.contains("folded")));
}

open().catch((error: Error) => {
  live.textContent = `Não foi possível desenhar a carta: ${error.message}`;
});
