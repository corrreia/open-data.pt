import { type CityForecast, readForecasts } from "../api.ts";
import { weatherIcon } from "../icons.ts";
import { arrowFrom, choice, el, format } from "../ui.ts";
import { known, regionOf, type Section, type Stage } from "./section.ts";

/** The three-day forecast for the district capitals and the islands: IPMA's daily bulletin, on the map and as a table. */

const degrees = (value: number | null): string => (known(value) ? `${Math.round(value)}°` : "–");

function row(forecast: CityForecast): HTMLElement {
  const wind = el("td", "wind");
  const arrow = arrowFrom(forecast.windDirection);
  if (arrow !== undefined) wind.append(arrow);
  wind.append(forecast.windSpeedClass ?? "");
  return el(
    "tr",
    "",
    el("td", "icon", weatherIcon(forecast.weatherTypeId, forecast.weatherType)),
    el("th", "", forecast.city, el("small", "", forecast.weatherType)),
    el("td", "figure", el("b", "", degrees(forecast.maximumTemperature)), ` ${degrees(forecast.minimumTemperature)}`),
    el("td", "figure", known(forecast.precipitationProbability) ? `${Math.round(forecast.precipitationProbability)} %` : "–"),
    wind,
  );
}

function table(forecasts: readonly CityForecast[]): HTMLElement {
  const head = el("tr", "", el("th", ""), el("th", "", "Local"), el("th", "figure", "Máx. mín."), el("th", "figure", "Chuva"), el("th", "", "Vento"));
  head.firstElementChild?.setAttribute("aria-label", "Tempo");
  return el("table", "", el("thead", "", head), el("tbody", "", ...forecasts.toSorted((a, b) => b.latitude - a.latitude).map(row)));
}

async function show(stage: Stage): Promise<void> {
  const forecasts = await readForecasts();
  const dates = [...new Set(forecasts.map((forecast) => forecast.forecastDate))].filter((date) => date >= stage.today).toSorted();
  const body = el("div", "");

  const draw = (date: string): void => {
    const day = forecasts.filter((forecast) => forecast.forecastDate === date);
    body.replaceChildren(
      ...(["Continente", "Madeira", "Açores"] as const).flatMap((region) => {
        const here = day.filter((forecast) => regionOf(forecast.longitude) === region);
        return here.length === 0 ? [] : [el("h3", "", region), table(here)];
      }),
    );
    stage.marks.set(
      day.map((forecast) => ({
        longitude: forecast.longitude,
        latitude: forecast.latitude,
        element: el(
          "div",
          "mark forecast",
          weatherIcon(forecast.weatherTypeId, forecast.weatherType),
          el("b", "", degrees(forecast.maximumTemperature)),
          el("span", "", degrees(forecast.minimumTemperature)),
        ),
      })),
    );
  };

  const first = dates[0];
  stage.key.replaceChildren("Temperatura máxima e mínima previstas em cada capital de distrito.");
  if (first === undefined) {
    stage.panel.replaceChildren(el("h2", "", "Previsão"), el("p", "empty", "O IPMA ainda não publicou a previsão para hoje."));
    stage.marks.set([]);
    return;
  }
  stage.panel.replaceChildren(
    el("h2", "", "Previsão"),
    el("p", "lede", "A previsão diária do IPMA para as capitais de distrito e as ilhas, para hoje e os dois dias seguintes."),
    choice(
      "Dia",
      dates.map((date) => [date, format.day(date, stage.today)] as const),
      first,
      draw,
    ),
    body,
  );
  draw(first);
}

export const FORECAST: Section = { path: "", name: "Previsão", show };
