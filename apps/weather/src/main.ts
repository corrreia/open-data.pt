import { readReservoirs, readStations } from "./data.ts";
import { type Layer, reservoirLayer, type Spot, TEMPERATURE_SCALE, temperatureLayer, waterLayer, windLayer } from "./layers.ts";
import { createMap, type MapScene } from "./scene.ts";
import { decodeTerrain, decodeWater, type TerrainManifest, type WaterManifest } from "./terrain/format.ts";

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`#${id} is missing from the page`);
  return found;
}

const canvas = document.querySelector("canvas");
const status = element("status");
const clock = element("clock");
const readout = element("readout");
const credits = element("credits");
const tip = element("tip");
const live = element("live");
const scale = element("scale");
const panel = document.querySelector("form");

const LISBON_TIME = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", weekday: "long", day: "numeric", month: "long" });
const HOUR = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit" });
const WHOLE = new Intl.NumberFormat("pt-PT");
/** IPMA's stations report on the hour and open-data.pt reads them hourly: asking more often than this learns nothing. */
const REFRESH_MS = 10 * 60_000;
/** How near the pointer must come to something, in pixels, to be told about it. */
const REACH = 22;

scale.style.background = `linear-gradient(90deg, ${TEMPERATURE_SCALE.map(([, colour]) => `#${colour.toString(16).padStart(6, "0")}`).join(", ")})`;
scale.dataset["low"] = `${TEMPERATURE_SCALE[0]?.[0]} °C`;
scale.dataset["high"] = `${TEMPERATURE_SCALE.at(-1)?.[0]} °C`;

/** The live layers, built again from fresh readings every few minutes. */
async function readLayers(map: MapScene, previous: Map<string, Layer>): Promise<Map<string, Layer>> {
  const now = new Date();
  const [stations, reservoirs] = await Promise.all([readStations(now), readReservoirs()]);
  for (const layer of previous.values()) layer.show(false);
  live.textContent = `${stations.length} estações do IPMA · ${reservoirs.length} albufeiras da APA · lido às ${HOUR.format(now)}`;
  return new Map([
    ["temperature", temperatureLayer(map, stations)],
    ["wind", windLayer(map, stations)],
    ["reservoirs", reservoirLayer(map, reservoirs)],
  ]);
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
    const sun = elevation > 0 ? `sol a ${Math.round(elevation)}° acima do horizonte` : elevation > -6 ? "crepúsculo" : "noite";
    clock.replaceChildren(`${LISBON_TIME.format(now)} · `, Object.assign(document.createElement("b"), { textContent: sun }));
  };
  tick();
  setInterval(tick, 30_000);

  map.onReading = (reading) => {
    // The height is a guess between survey marks, so it is given to the ten metres and marked as about.
    readout.textContent =
      reading === undefined
        ? ""
        : `${Math.abs(reading.latitude).toFixed(3)}° N  ${Math.abs(reading.longitude).toFixed(3)}° W\n≈ ${WHOLE.format(Math.round(reading.metres / 10) * 10)} m`;
  };

  // An attribution reads "publisher — work": name each publisher once, with the works drawn from.
  const marks = manifest.sources.reduce((sum, source) => (source.product === "dgt-caop-trocos" ? sum : sum + source.rows), 0);
  const works = new Map<string, string[]>();
  for (const source of manifest.sources) {
    const [publisher = source.attribution, work = source.title] = source.attribution.split(" — ");
    works.set(publisher, [...(works.get(publisher) ?? []), work]);
  }
  const publishers = [...works].map(([publisher, drawn]) => `${publisher} (${drawn.join("; ")})`).join(", ");
  credits.textContent = `Relevo interpolado entre ${WHOLE.format(marks)} vértices geodésicos e cumes, não é um modelo de elevação; temperatura interpolada entre estações. Dados: ${publishers}, CC BY; observações do IPMA; albufeiras da APA (SNIRH e InfoÁgua). Tudo via open-data.pt.`;
  status.hidden = true;

  // Rivers and lagoons are baked like the terrain; a build without them still draws everything else.
  const fixed = new Map<string, Layer>();
  const [aboutWater, waterBytes] = await Promise.all([fetch("/water.json"), fetch("/water.bin")]);
  if (aboutWater.ok && waterBytes.ok && aboutWater.headers.get("content-type")?.includes("json") === true) {
    // SAFETY: water.json is written by bake.ts from a WaterManifest and ships beside this script.
    fixed.set("water", waterLayer(map, decodeWater((await aboutWater.json()) as WaterManifest, await waterBytes.arrayBuffer())));
    const toggle = panel.querySelector<HTMLElement>("label[hidden]");
    if (toggle !== null) toggle.hidden = false;
  }

  let layers = new Map<string, Layer>(fixed);
  const shown = (name: string): boolean => new FormData(panel).has(name);
  const apply = (): void => {
    // The temperature paints the land itself, so it goes last: hiding another layer must not unpaint it.
    for (const [name, layer] of [...layers].toSorted(([a], [b]) => Number(a === "temperature") - Number(b === "temperature"))) layer.show(shown(name));
  };
  const refresh = async (): Promise<void> => {
    try {
      const read = await readLayers(map, new Map([...layers].filter(([name]) => !fixed.has(name))));
      layers = new Map([...fixed, ...read]);
      apply();
    } catch (error) {
      live.textContent = `Sem dados ao vivo: ${error instanceof Error ? error.message : "erro"}`;
    }
  };
  panel.addEventListener("change", apply);
  await refresh();
  setInterval(() => void refresh(), REFRESH_MS);

  canvas.addEventListener("pointermove", (event) => {
    let nearest: Spot | undefined;
    let reach = REACH;
    if (event.buttons === 0) {
      for (const [name, layer] of layers) {
        if (!shown(name)) continue;
        for (const spot of layer.spots()) {
          const at = map.toScreen(spot.point, spot.height);
          const distance = at === undefined ? Infinity : Math.hypot(at[0] - event.clientX, at[1] - event.clientY);
          if (distance < reach) [nearest, reach] = [spot, distance];
        }
      }
    }
    tip.hidden = nearest === undefined;
    if (nearest === undefined) return;
    tip.textContent = nearest.label;
    tip.style.left = `${event.clientX}px`;
    tip.style.top = `${event.clientY}px`;
  });
  canvas.addEventListener("pointerleave", () => (tip.hidden = true));
}

open().catch((error: Error) => {
  status.textContent = `Não foi possível desenhar o mapa: ${error.message}`;
});
