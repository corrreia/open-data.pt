import { readFireRisk, readMunicipalities, readUv } from "../api.ts";
import { css, FIRE_COLOURS, uvColour, uvName } from "../scales.ts";
import { choice, el, format } from "../ui.ts";
import { regionOf, type Section, type Stage } from "./section.ts";

/** Two daily indices IPMA forecasts: the sun's ultraviolet radiation, and the danger of rural fire in each municipality. */

function dot(colour: number, text: string): HTMLElement {
  const made = el("div", "mark index", text);
  made.style.setProperty("--level", css(colour));
  return made;
}

async function showUv(stage: Stage, body: HTMLElement): Promise<void> {
  const forecasts = await readUv();
  const dates = [...new Set(forecasts.map((each) => each.date))].filter((date) => date >= stage.today).toSorted();
  const list = el("div", "");
  const draw = (date: string): void => {
    const day = forecasts.filter((each) => each.date === date).toSorted((a, b) => b.uvIndex - a.uvIndex);
    stage.marks.set(day.map((each) => ({ longitude: each.longitude, latitude: each.latitude, element: dot(uvColour(each.uvIndex), format.number(Math.round(each.uvIndex))) })));
    list.replaceChildren(
      el(
        "table",
        "",
        el("thead", "", el("tr", "", el("th", "", "Local"), el("th", "figure", "Índice"), el("th", "", "Nível"), el("th", "figure", "Hora"))),
        el(
          "tbody",
          "",
          ...day.map((each) => {
            const level = el("span", "level", uvName(each.uvIndex));
            level.style.setProperty("--level", css(uvColour(each.uvIndex)));
            return el("tr", "", el("th", "", each.location), el("td", "figure", format.number(each.uvIndex)), el("td", "", level), el("td", "figure quiet", each.period ?? ""));
          }),
        ),
      ),
    );
  };
  stage.key.replaceChildren("Índice ultravioleta máximo previsto, e a hora em que se espera.");
  const first = dates[0];
  if (first === undefined) {
    stage.marks.set([]);
    body.replaceChildren(el("p", "empty", "O IPMA não tem previsão do índice ultravioleta para hoje."));
    return;
  }
  body.replaceChildren(
    choice(
      "Dia",
      dates.map((date) => [date, format.day(date, stage.today)] as const),
      first,
      draw,
    ),
    list,
  );
  draw(first);
}

async function showFire(stage: Stage, body: HTMLElement): Promise<void> {
  const [risks, municipalities] = await Promise.all([readFireRisk(), readMunicipalities()]);
  const names = new Map(municipalities.map((each) => [each.dtmn, each.municipio]));
  const dates = [...new Set(risks.map((each) => each.forecastDate))].filter((date) => date >= stage.today).toSorted();
  const list = el("div", "");
  const draw = (date: string): void => {
    const day = risks.filter((each) => each.forecastDate === date && regionOf(each.longitude) === "Continente");
    stage.marks.set(
      day.map((each) => {
        const mark = el("div", "mark fire");
        mark.style.setProperty("--level", css(FIRE_COLOURS[each.riskLevel] ?? 0x999999));
        mark.title = `${names.get(each.municipalityCode) ?? each.municipalityCode}: ${each.riskLabel}`;
        return { longitude: each.longitude, latitude: each.latitude, element: mark };
      }),
    );
    const levels = [...new Set(day.map((each) => each.riskLevel))].toSorted((a, b) => b - a);
    list.replaceChildren(
      ...levels.flatMap((level) => {
        const here = day.filter((each) => each.riskLevel === level);
        const title = el("span", "level", here[0]?.riskLabel ?? `${level}`);
        title.style.setProperty("--level", css(FIRE_COLOURS[level] ?? 0x999999));
        const places = here.map((each) => names.get(each.municipalityCode) ?? each.municipalityCode).toSorted((a, b) => a.localeCompare(b, "pt"));
        return [el("h3", "", title, ` ${here.length} ${here.length === 1 ? "concelho" : "concelhos"}`), el("p", "places", places.join(", "))];
      }),
    );
  };
  stage.key.replaceChildren("Perigo de incêndio rural previsto para cada concelho do continente.");
  const first = dates[0];
  if (first === undefined) {
    stage.marks.set([]);
    body.replaceChildren(el("p", "empty", "O IPMA não tem previsão de perigo de incêndio para hoje."));
    return;
  }
  body.replaceChildren(
    choice(
      "Dia",
      dates.map((date) => [date, format.day(date, stage.today)] as const),
      first,
      draw,
    ),
    list,
  );
  draw(first);
}

async function show(stage: Stage): Promise<void> {
  const body = el("div", "");
  stage.panel.replaceChildren(
    el("h2", "", "Índices"),
    el("p", "lede", "Duas previsões diárias do IPMA: a radiação ultravioleta do sol e o perigo de incêndio rural."),
    choice(
      "Índice",
      [
        ["uv", "Ultravioleta"],
        ["fire", "Perigo de incêndio"],
      ],
      "uv",
      (chosen) => void (chosen === "uv" ? showUv(stage, body) : showFire(stage, body)),
    ),
    body,
  );
  await showUv(stage, body);
}

export const RISKS: Section = { path: "indices", name: "UV e incêndio", show };
