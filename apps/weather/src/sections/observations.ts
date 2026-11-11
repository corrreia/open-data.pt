import { readStationDay, readStations, type StationReading } from "../api.ts";
import { lineChart } from "../chart.ts";
import { colourOn, css, HUMIDITY, PRESSURE, RADIATION, RAIN, type Scale, strip, TEMPERATURE, WIND } from "../scales.ts";
import { Heights, project } from "../terrain/geometry.ts";
import { arrowFrom, choice, el, format } from "../ui.ts";
import { known, regionOf, type Section, type Stage } from "./section.ts";

/** What IPMA's stations measured in the last hour: one measure at a time, on the map and ranked, with each station's last day. */

interface Measure {
  /** The measure's name in the series keys of `ipma-observations`. */
  key: string;
  name: string;
  unit: string;
  scale: Scale;
  /** A sum over the hour is drawn as bars; a state at the hour as a line. */
  summed: boolean;
  of(station: StationReading): number | null;
}

const MEASURES: Measure[] = [
  { key: "temperature", name: "Temperatura", unit: "°C", scale: TEMPERATURE, summed: false, of: (station) => station.temperature },
  { key: "precipitation", name: "Chuva", unit: "mm", scale: RAIN, summed: true, of: (station) => station.precipitation },
  { key: "wind-speed", name: "Vento", unit: "km/h", scale: WIND, summed: false, of: (station) => station.windSpeed },
  { key: "humidity", name: "Humidade", unit: "%", scale: HUMIDITY, summed: false, of: (station) => station.humidity },
  { key: "pressure", name: "Pressão", unit: "hPa", scale: PRESSURE, summed: false, of: (station) => station.pressure },
  { key: "radiation", name: "Radiação solar", unit: "kJ/m²", scale: RADIATION, summed: true, of: (station) => station.radiation },
];

/** A station that has said nothing for this long is not telling us about now. */
const FRESH_MS = 3 * 3_600_000;

function key(measure: Measure): HTMLElement {
  const bar = el("i", "strip");
  bar.style.background = strip(measure.scale);
  const last = measure.scale.length - 1;
  return el(
    "div",
    "scale",
    el("span", "", `${measure.name}, na última hora. Entre estações a cor é interpolada pela distância: não conhece a altitude nem o mar.`),
    bar,
    el("span", "ticks", ...measure.scale.map(([value], index) => el("b", "", index === last ? `${value} ${measure.unit}` : `${value}`))),
  );
}

async function show(stage: Stage): Promise<void> {
  const now = Date.now();
  const stations = (await readStations()).filter((station) => now - Date.parse(station.observationTime) < FRESH_MS);
  const body = el("div", "");
  const detail = el("div", "detail");

  const open = async (station: StationReading, measure: Measure): Promise<void> => {
    detail.replaceChildren(el("h3", "", station.stationName), el("p", "empty", "A ler o último dia…"));
    const day = await readStationDay(station.stationId, measure.key);
    detail.replaceChildren(
      el("h3", "", station.stationName),
      el("p", "lede", `${measure.name} nas últimas 24 horas, ${measure.unit}. Leitura mais recente às ${format.hour(station.observationTime)}.`),
      day.length < 2 ? el("p", "empty", "Esta estação não tem leituras suficientes para um gráfico.") : lineChart(day, measure.summed, format.hour),
    );
    detail.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const draw = (measure: Measure): void => {
    const read = stations.flatMap((station) => {
      const value = measure.of(station);
      return known(value) ? [{ station, value }] : [];
    });
    detail.replaceChildren();

    // The land takes the measure's colour between the mainland's stations.
    const field = new Heights(40);
    for (const { station, value } of read) if (regionOf(station.longitude) === "Continente") field.add(project([station.longitude, station.latitude]), value);
    stage.map.paint(read.length === 0 ? undefined : (point, into) => void into.setHex(colourOn(measure.scale, field.at(point, 6, 12))));
    stage.key.replaceChildren(key(measure));

    stage.marks.set(
      read.map(({ station, value }) => {
        const mark = el("button", "mark station", format.number(value));
        mark.type = "button";
        mark.title = `${station.stationName}: ${format.measure(value, measure.unit)}`;
        if (measure.key === "wind-speed") {
          const arrow = arrowFrom(station.windDirection);
          if (arrow !== undefined) mark.prepend(arrow);
        }
        mark.addEventListener("click", () => void open(station, measure));
        return { longitude: station.longitude, latitude: station.latitude, element: mark };
      }),
    );

    const rows = read
      .toSorted((a, b) => b.value - a.value)
      .map(({ station, value }) => {
        const swatch = el("i", "swatch");
        swatch.style.background = css(colourOn(measure.scale, value));
        const name = el("button", "link", station.stationName);
        name.type = "button";
        name.addEventListener("click", () => void open(station, measure));
        return el(
          "tr",
          "",
          el("td", "", swatch),
          el("th", "", name),
          el("td", "figure", format.measure(value, measure.unit)),
          el("td", "figure quiet", format.hour(station.observationTime)),
        );
      });
    body.replaceChildren(
      detail,
      read.length === 0
        ? el("p", "empty", `Nenhuma estação comunicou ${measure.name.toLowerCase()} nas últimas três horas.`)
        : el(
            "table",
            "",
            el("thead", "", el("tr", "", el("th", ""), el("th", "", "Estação"), el("th", "figure", measure.name), el("th", "figure", "Hora"))),
            el("tbody", "", ...rows),
          ),
    );
  };

  const first = MEASURES[0];
  if (first === undefined) return;
  stage.panel.replaceChildren(
    el("h2", "", "Observações"),
    el("p", "lede", `O que ${stations.length} estações do IPMA mediram na última hora. Escolha uma estação, na lista ou no mapa, para ver o seu último dia.`),
    choice(
      "Medida",
      MEASURES.map((measure) => [measure.key, measure.name] as const),
      first.key,
      (chosen) => draw(MEASURES.find((measure) => measure.key === chosen) ?? first),
    ),
    body,
  );
  draw(first);
}

export const OBSERVATIONS: Section = { path: "observacoes", name: "Observações", show };
