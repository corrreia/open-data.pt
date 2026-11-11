import { readMunicipalDays, readMunicipalities } from "../api.ts";
import { lineChart } from "../chart.ts";
import { el, format } from "../ui.ts";
import type { Section, Stage } from "./section.ts";

/** The last weeks, day by day, in any municipality of the mainland: IPMA's daily temperature and rain. */

const SHORT = new Intl.DateTimeFormat("pt-PT", { timeZone: "UTC", day: "numeric", month: "short" });
const day = (time: string): string => SHORT.format(new Date(time));

async function show(stage: Stage): Promise<void> {
  const municipalities = (await readMunicipalities()).flatMap((each) =>
    each.dtmn === undefined || each.municipio === undefined ? [] : [{ code: each.dtmn, name: each.municipio, longitude: each.longitude, latitude: each.latitude }],
  );
  municipalities.sort((a, b) => a.name.localeCompare(b.name, "pt"));
  const charts = el("div", "");
  const select = el("select", "", ...municipalities.map((each) => Object.assign(el("option", "", each.name), { value: each.code })));
  select.setAttribute("aria-label", "Concelho");

  const draw = async (code: string): Promise<void> => {
    const place = municipalities.find((each) => each.code === code);
    if (place === undefined) return;
    const pin = el("div", "mark pin", place.name);
    stage.marks.set([{ longitude: place.longitude, latitude: place.latitude, element: pin }]);
    charts.replaceChildren(el("p", "empty", "A ler as últimas semanas…"));
    const [highs, lows, rain] = await Promise.all([
      readMunicipalDays("ipma-municipal-temperature", code, "maximum-temperature"),
      readMunicipalDays("ipma-municipal-temperature", code, "minimum-temperature"),
      readMunicipalDays("ipma-municipal-precipitation", code, "total-precipitation"),
    ]);
    if (select.value !== code) return;
    const parts: (Node | string)[] = [];
    if (highs.length > 1) parts.push(el("h3", "", "Temperatura máxima, °C"), lineChart(highs, false, day));
    if (lows.length > 1) parts.push(el("h3", "", "Temperatura mínima, °C"), lineChart(lows, false, day));
    if (rain.length > 1) parts.push(el("h3", "", "Chuva por dia, mm"), lineChart(rain, true, day));
    charts.replaceChildren(...(parts.length === 0 ? [el("p", "empty", `O IPMA não tem valores diários recentes para ${place.name}.`)] : parts));
  };

  select.addEventListener("change", () => void draw(select.value));
  stage.key.replaceChildren("O concelho escolhido.");
  stage.panel.replaceChildren(
    el("h2", "", "Últimas semanas"),
    el("p", "lede", `A temperatura e a chuva de cada dia, em média no concelho, nas semanas que o IPMA publica. Hoje é ${format.shortDay(stage.today)}.`),
    select,
    charts,
  );
  // Lisbon, when it is there, is where most readers will look first.
  select.value = municipalities.find((each) => each.name === "Lisboa")?.code ?? municipalities[0]?.code ?? "";
  await draw(select.value);
}

export const CLIMATE: Section = { path: "ultimas-semanas", name: "Últimas semanas", show };
