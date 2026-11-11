import { readSea, readShellfish, type SeaForecast, type ShellfishZone } from "../api.ts";
import { arrowFrom, choice, el, format } from "../ui.ts";
import { known, regionOf, type Section, type Stage } from "./section.ts";

/** The state of the sea along the coast for three days, and where shellfish may be gathered. */

const range = (low: number | null, high: number | null, unit: string): string =>
  !known(low) || !known(high) ? "–" : low === high ? `${format.number(low)} ${unit}` : `${format.number(low)} a ${format.number(high)} ${unit}`;

function row(sea: SeaForecast): HTMLElement {
  const waves = el("td", "wind");
  const arrow = arrowFrom(sea.waveDirection);
  if (arrow !== undefined) waves.append(arrow);
  waves.append(range(sea.waveHeightMin, sea.waveHeightMax, "m"));
  return el(
    "tr",
    "",
    el("th", "", sea.location.replace(/, Costa$/u, "")),
    waves,
    el("td", "figure", range(sea.wavePeriodMin, sea.wavePeriodMax, "s")),
    el("td", "figure", range(sea.seaSurfaceTemperatureMin, sea.seaSurfaceTemperatureMax, "°C")),
  );
}

/** IPMA's three states of a zone, with the class each is drawn in. */
const STATUS = new Map([
  ["OPEN", { name: "Aberta", look: "open" }],
  ["PARTIAL_OPEN", { name: "Aberta em parte", look: "partial" }],
  ["CLOSE", { name: "Fechada", look: "closed" }],
]);

function zone(shellfish: ShellfishZone): HTMLElement {
  const closed = shellfish.closedSpecies.map((species) => species.specie_c).join(", ");
  const status = STATUS.get(shellfish.status);
  const state = el("span", `state ${status?.look ?? ""}`, status?.name ?? shellfish.status);
  return el("tr", "", el("th", "", shellfish.name, ...(closed === "" ? [] : [el("small", "", `Interdita: ${closed}`)])), el("td", "", state));
}

async function show(stage: Stage): Promise<void> {
  const [sea, shellfish] = await Promise.all([readSea(), readShellfish().catch((): ShellfishZone[] => [])]);
  const dates = [...new Set(sea.map((each) => each.forecastDate))].filter((date) => date >= stage.today).toSorted();
  const body = el("div", "");

  const draw = (date: string): void => {
    const day = sea.filter((each) => each.forecastDate === date).toSorted((a, b) => b.latitude - a.latitude);
    body.replaceChildren(
      ...(["Continente", "Madeira", "Açores"] as const).flatMap((region) => {
        const here = day.filter((each) => regionOf(each.longitude) === region);
        return here.length === 0
          ? []
          : [
              el("h3", "", region),
              el(
                "table",
                "",
                el("thead", "", el("tr", "", el("th", "", "Costa"), el("th", "", "Ondulação"), el("th", "figure", "Período"), el("th", "figure", "Água"))),
                el("tbody", "", ...here.map(row)),
              ),
            ];
      }),
    );
    stage.marks.set(
      day.map((each) => {
        const mark = el("div", "mark sea");
        const arrow = arrowFrom(each.waveDirection);
        if (arrow !== undefined) mark.append(arrow);
        mark.append(el("b", "", known(each.waveHeightMax) ? `${format.number(each.waveHeightMax)} m` : "–"));
        mark.title = `${each.location}: ondas de ${range(each.waveHeightMin, each.waveHeightMax, "m")}`;
        return { longitude: each.longitude, latitude: each.latitude, element: mark };
      }),
    );
  };

  stage.key.replaceChildren("Altura máxima das ondas prevista em cada troço de costa, e de onde vêm.");
  const first = dates[0];
  const zones = shellfish.toSorted((a, b) => (b.latitude ?? 0) - (a.latitude ?? 0));
  stage.panel.replaceChildren(
    el("h2", "", "Mar"),
    el("p", "lede", "A previsão do IPMA para o estado do mar na costa: ondulação, período e temperatura da água."),
    ...(first === undefined
      ? [el("p", "empty", "O IPMA ainda não publicou a previsão do mar para hoje.")]
      : [
          choice(
            "Dia",
            dates.map((date) => [date, format.day(date, stage.today)] as const),
            first,
            draw,
          ),
          body,
        ]),
    ...(zones.length === 0
      ? []
      : [
          el("h3", "", "Apanha de bivalves"),
          el("p", "lede", "As zonas de produção de moluscos bivalves e as espécies cuja apanha o IPMA tem interdita."),
          el("table", "", el("tbody", "", ...zones.map(zone))),
        ]),
  );
  if (first === undefined) stage.marks.set([]);
  else draw(first);
}

export const SEA: Section = { path: "mar", name: "Mar", show };
