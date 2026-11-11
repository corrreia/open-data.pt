import { createMap } from "./scene.ts";
import { decodeTerrain, type TerrainManifest } from "./terrain/format.ts";

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

const LISBON_TIME = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", weekday: "long", day: "numeric", month: "long" });
const WHOLE = new Intl.NumberFormat("pt-PT");

async function open(): Promise<void> {
  if (canvas === null) throw new Error("the map's canvas is missing from the page");
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
  credits.textContent = `Costa, fronteira e distritos da CAOP. Relevo interpolado entre ${WHOLE.format(marks)} vértices geodésicos e cumes: não é um modelo de elevação. Dados: ${publishers}, CC BY, via open-data.pt.`;
  status.hidden = true;
}

open().catch((error: Error) => {
  status.textContent = `Não foi possível desenhar o mapa: ${error.message}`;
});
