import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import {
  type Occurrences,
  readEarthquakes,
  readFloodAlerts,
  readHotspots,
  readLightning,
  readOccurrences,
  readReservoirs,
  readStations,
  readWarnings,
  type Reservoir,
  type Station,
} from "./data.ts";
import { happeningLayer, type Layer, reservoirLayer, type Spot, TEMPERATURE_SCALE, temperatureLayer, waterLayer, windLayer, windReadings } from "./layers.ts";
import { createMap, type MapScene } from "./scene.ts";
import { decodeTerrain, decodeWater, type TerrainManifest, type WaterManifest } from "./terrain/format.ts";
import { knowsDirections, windFlowLayer } from "./wind.ts";

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`#${id} is missing from the page`);
  return found;
}

const canvas = document.querySelector("canvas");
const panel = document.querySelector("form");
const status = element("status");
const boot = element("boot");
const time = element("time");
const readout = element("readout");
const tip = element("tip");
const live = element("live");
const scale = element("scale");
const stats = element("stats");
const compass = element("compass");

const LISBON_TIME = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", weekday: "short", day: "numeric", month: "short" });
const HOUR = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit" });
const WHOLE = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 0 });
const TENTH = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 1 });
/** IPMA's stations report on the hour and civil protection's list moves every few minutes: this keeps up with both. */
const REFRESH_MS = 5 * 60_000;
/** How near the pointer must come to something, in pixels, to be told about it. */
const REACH = 24;

scale.style.background = `linear-gradient(90deg, ${TEMPERATURE_SCALE.map(([, colour]) => `#${colour.toString(16).padStart(6, "0")}`).join(", ")})`;
scale.dataset["low"] = `${TEMPERATURE_SCALE[0]?.[0]} °C`;
scale.dataset["high"] = `${TEMPERATURE_SCALE.at(-1)?.[0]} °C`;

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
  /** What the panel says beside each layer's name. */
  counts: Map<string, string>;
}

function figure(name: string, value: string, unit: string, alert: boolean): HTMLElement {
  const box = document.createElement("div");
  if (alert) box.className = "alert";
  const amount = document.createElement("dd");
  amount.append(value, Object.assign(document.createElement("small"), { textContent: unit }));
  box.append(Object.assign(document.createElement("dt"), { textContent: name }), amount);
  return box;
}

/** The country in a handful of numbers, from the same readings the map draws. */
function summarize(stations: readonly Station[], reservoirs: readonly Reservoir[], occurrences: Occurrences, districtsWarned: number): void {
  const temperatures = stations.flatMap((station) => (station.temperature === undefined ? [] : [station.temperature]));
  const winds = stations.flatMap((station) => (station.windSpeed === undefined ? [] : [station.windSpeed]));
  const read = reservoirs.filter((reservoir) => reservoir.storedHm3 !== undefined);
  const stored = read.reduce((sum, reservoir) => sum + (reservoir.storedHm3 ?? 0), 0);
  const capacity = read.reduce((sum, reservoir) => sum + reservoir.capacityHm3, 0);
  const figures: HTMLElement[] = [];
  if (temperatures.length > 0) figures.push(figure("Temperatura", `${TENTH.format(Math.min(...temperatures))} a ${TENTH.format(Math.max(...temperatures))}`, "°C", false));
  if (winds.length > 0) figures.push(figure("Vento máximo", WHOLE.format(Math.max(...winds)), "km/h", false));
  if (capacity > 0) figures.push(figure("Albufeiras", WHOLE.format((stored / capacity) * 100), "% cheias", false));
  figures.push(figure("Ocorrências", WHOLE.format(occurrences.happenings.length), `${WHOLE.format(occurrences.personnel)} operacionais`, occurrences.fires > 0));
  if (districtsWarned > 0) figures.push(figure("Avisos IPMA", WHOLE.format(districtsWarned), "distritos", true));
  stats.replaceChildren(...figures);
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
  for (const layer of previous.layers.values()) layer.show(false);
  summarize(stations, reservoirs, occurrences, warnings.length);
  live.textContent = `Lido às ${HOUR.format(now)} em open-data.pt`;

  // With directions the wind is a flow; with speeds alone it can only be instruments turning.
  const flows = knowsDirections(stations);
  const wind = flows ? windFlowLayer(map, stations, map.bounds) : windLayer(map, stations);
  const readings = windReadings(map, stations);
  return {
    layers: new Map<string, Layer>([
      ["temperature", temperatureLayer(map, stations)],
      ["wind", flows ? { show: (visible) => wind.show(visible), spots: () => readings } : wind],
      ["reservoirs", reservoirLayer(map, reservoirs)],
      ["occurrences", happeningLayer(map, occurrences.happenings, 0.95, true)],
      ["lightning", happeningLayer(map, lightning, 0.45, false)],
      ["earthquakes", happeningLayer(map, earthquakes, 0.7, false)],
      ["floods", happeningLayer(map, floods, 1, true)],
      ["hotspots", happeningLayer(map, hotspots, 0.8, true)],
      ["warnings", happeningLayer(map, warnings, 2.2, false)],
    ]),
    counts: new Map([
      ["temperature", `${stations.filter((station) => station.temperature !== undefined).length}`],
      ["wind", flows ? "fluxo" : "só velocidade"],
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
  if (canvas === null || panel === null) throw new Error("the map's canvas or its layer panel is missing from the page");
  const [about, bytes] = await Promise.all([fetch("/terrain.json"), fetch("/terrain.bin")]);
  if (!about.ok || !bytes.ok) throw new Error(`terrain: ${about.status} ${bytes.status}`);
  // SAFETY: terrain.json is written by bake.ts from a TerrainManifest and ships beside this script.
  const manifest = (await about.json()) as TerrainManifest;
  const map = createMap(canvas, decodeTerrain(manifest, await bytes.arrayBuffer()));

  const tick = (): void => {
    const now = new Date();
    const elevation = map.light(now);
    const sun = elevation > 0 ? `sol a ${Math.round(elevation)}°` : elevation > -6 ? "crepúsculo" : "noite";
    time.textContent = `${LISBON_TIME.format(now)} · ${sun}`;
  };
  tick();
  setInterval(tick, 30_000);

  map.onReading = (reading) => {
    // The height is a guess between survey marks, so it is given to the ten metres and marked as about.
    readout.textContent =
      reading === undefined
        ? ""
        : `${Math.abs(reading.latitude).toFixed(3)}° N  ${Math.abs(reading.longitude).toFixed(3)}° W  ≈ ${WHOLE.format(Math.round(reading.metres / 10) * 10)} m`;
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
    const toggle = panel.querySelector<HTMLElement>("label[hidden]");
    if (toggle !== null) toggle.hidden = false;
  }

  let shown: Shown = { layers: new Map(), counts: new Map() };
  const all = (): Map<string, Layer> => new Map([...fixed, ...shown.layers]);
  const wanted = (name: string): boolean => new FormData(panel).has(name);
  const apply = (): void => {
    // The temperature paints the land itself, so it goes last: hiding another layer must not unpaint it.
    for (const [name, layer] of [...all()].toSorted(([a], [b]) => Number(a === "temperature") - Number(b === "temperature"))) layer.show(wanted(name));
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
  status.textContent = "A ler o país";
  await refresh();
  boot.classList.add("done");
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

  // On a phone the open panel would cover the country: it starts folded.
  const folding = document.querySelector("details");
  if (folding !== null && window.innerWidth < 600) folding.open = false;
}

open().catch((error: Error) => {
  status.textContent = `Não foi possível desenhar o mapa: ${error.message}`;
});
