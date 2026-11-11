import { readDischarges, readEarthquakes, readLightningHours } from "../api.ts";
import { lineChart } from "../chart.ts";
import { choice, el, format } from "../ui.ts";
import { known, regionOf, type Section, type Stage } from "./section.ts";

/** What IPMA's networks detected: the earthquakes of the last thirty days and the lightning of the last day. */

const DAY_MS = 86_400_000;

async function showQuakes(stage: Stage, body: HTMLElement): Promise<void> {
  const quakes = (await readEarthquakes()).toSorted((a, b) => b.time.localeCompare(a.time));
  stage.key.replaceChildren("Sismos dos últimos trinta dias. O círculo cresce com a magnitude.");
  stage.marks.set(
    quakes.flatMap((quake) => {
      if (!known(quake.magnitude)) return [];
      const mark = el("div", "mark quake");
      mark.style.setProperty("--size", `${6 + quake.magnitude * 5}px`);
      mark.title = `Magnitude ${format.number(quake.magnitude)}, ${quake.region ?? ""}, ${format.when(quake.time)}`;
      return [{ longitude: quake.longitude, latitude: quake.latitude, element: mark }];
    }),
  );
  body.replaceChildren(
    el("p", "lede", `${quakes.length} sismos registados pelo IPMA nos últimos trinta dias, no continente e nas ilhas, do mais recente para o mais antigo.`),
    el(
      "table",
      "",
      el("thead", "", el("tr", "", el("th", "figure", "Mag."), el("th", "", "Onde"), el("th", "figure", "Prof."), el("th", "figure", "Quando"))),
      el(
        "tbody",
        "",
        ...quakes.map((quake) =>
          el(
            "tr",
            "",
            el("td", "figure", el("b", "", known(quake.magnitude) ? format.number(quake.magnitude) : "–")),
            el("th", "", quake.region ?? regionOf(quake.longitude)),
            el("td", "figure quiet", format.measure(quake.depth, "km")),
            el("td", "figure quiet", format.when(quake.time)),
          ),
        ),
      ),
    ),
  );
}

async function showLightning(stage: Stage, body: HTMLElement): Promise<void> {
  const [discharges, hours] = await Promise.all([readDischarges(), readLightningHours()]);
  const now = Date.now();
  const recent = discharges.filter((each) => now - Date.parse(each.occurredAt) < DAY_MS);
  stage.key.replaceChildren("Descargas elétricas das últimas 24 horas. As mais recentes são as mais escuras.");
  stage.marks.set(
    recent.map((each) => {
      const mark = el("div", "mark strike");
      mark.style.opacity = String(1 - ((now - Date.parse(each.occurredAt)) / DAY_MS) * 0.75);
      mark.title = `${each.type === "in-cloud" ? "Dentro da nuvem" : "Nuvem-solo"}, ${format.when(each.occurredAt)}`;
      return { longitude: each.longitude, latitude: each.latitude, element: mark };
    }),
  );
  // Cloud-to-ground strikes over the mainland, hour by hour, for the last two days.
  const mainland = hours
    .filter((point) => point.seriesKey === "mainland:cloud-to-ground" && now - Date.parse(point.eventTime) < 2 * DAY_MS)
    .toSorted((a, b) => a.eventTime.localeCompare(b.eventTime));
  body.replaceChildren(
    el(
      "p",
      "lede",
      recent.length === 0
        ? "A rede do IPMA não localizou descargas elétricas nas últimas 24 horas."
        : `${recent.length} descargas elétricas localizadas pela rede do IPMA nas últimas 24 horas.`,
    ),
    ...(mainland.length < 2 ? [] : [el("h3", "", "Descargas nuvem-solo por hora, no continente"), lineChart(mainland, true, format.when)]),
  );
}

async function show(stage: Stage): Promise<void> {
  const body = el("div", "");
  stage.panel.replaceChildren(
    el("h2", "", "Sismos e trovoada"),
    choice(
      "Rede",
      [
        ["quakes", "Sismos"],
        ["lightning", "Trovoada"],
      ],
      "quakes",
      (chosen) => void (chosen === "quakes" ? showQuakes(stage, body) : showLightning(stage, body)),
    ),
    body,
  );
  await showQuakes(stage, body);
}

export const EARTH: Section = { path: "sismos-e-trovoada", name: "Sismos e trovoada", show };
