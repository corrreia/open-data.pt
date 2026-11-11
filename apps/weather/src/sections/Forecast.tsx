import { Table } from "@cloudflare/kumo";
import { useState } from "react";
import { type CityForecast, readForecasts } from "../api.ts";
import { COMPASS, format } from "../format.ts";
import { known, regionOf, REGIONS } from "../regions.ts";
import { useMapLayer, useStage } from "../stage.tsx";
import { Failed, From, Heading, Nothing, Pending, Subheading, useRead } from "../ui.tsx";
import { WeatherIcon } from "../WeatherIcon.tsx";
import { datesFrom, Days } from "./Days.tsx";

/** The three-day forecast for the district capitals and the islands: IPMA's daily bulletin, on the map and as a table. */

function said(forecast: CityForecast): string {
  const wind = COMPASS.get(forecast.windDirection ?? "");
  return [
    `${forecast.city}: ${forecast.weatherType.toLowerCase()}`,
    `máxima ${format.degrees(forecast.maximumTemperature)}, mínima ${format.degrees(forecast.minimumTemperature)}`,
    ...(known(forecast.precipitationProbability) ? [`${Math.round(forecast.precipitationProbability)} % de probabilidade de chuva`] : []),
    ...(wind === undefined ? [] : [`vento ${(forecast.windSpeedClass ?? "").toLowerCase()} de ${wind.name}`]),
  ].join(", ");
}

function Cities(props: { region: string; forecasts: readonly CityForecast[] }) {
  return (
    <section className="grid gap-2">
      <Subheading>{props.region}</Subheading>
      <div className="overflow-x-auto">
        <Table aria-label={`Previsão: ${props.region}`}>
          <Table.Header>
            <Table.Row>
              <Table.Head>Local</Table.Head>
              <Table.Head className="text-end">Máx. e mín.</Table.Head>
              <Table.Head className="text-end">Chuva</Table.Head>
              <Table.Head>Vento</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {props.forecasts.map((forecast) => (
              <Table.Row key={forecast.cityId}>
                <Table.Cell>
                  <span className="flex items-center gap-2.5">
                    <WeatherIcon id={forecast.weatherTypeId} name={forecast.weatherType} decorative />
                    <span className="grid">
                      <span className="font-semibold text-kumo-strong">{forecast.city}</span>
                      <span className="text-xs text-kumo-subtle">{forecast.weatherType}</span>
                    </span>
                  </span>
                </Table.Cell>
                <Table.Cell className="text-end whitespace-nowrap tabular-nums">
                  <b className="font-semibold text-kumo-strong">{format.degrees(forecast.maximumTemperature)}</b>{" "}
                  <span className="text-kumo-subtle">{format.degrees(forecast.minimumTemperature)}</span>
                </Table.Cell>
                <Table.Cell className="text-end whitespace-nowrap tabular-nums">
                  {known(forecast.precipitationProbability) ? `${Math.round(forecast.precipitationProbability)} %` : "–"}
                </Table.Cell>
                <Table.Cell className="whitespace-nowrap">
                  <From point={forecast.windDirection} className="mr-1.5" />
                  {forecast.windSpeedClass ?? "–"}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </section>
  );
}

export function Forecast() {
  const { today } = useStage();
  const read = useRead(readForecasts);
  const forecasts = read.state === "ready" ? read.data : [];
  const dates = datesFrom(
    forecasts.map((forecast) => forecast.forecastDate),
    today,
  );
  const [chosen, setChosen] = useState<string>();
  const date = chosen !== undefined && dates.includes(chosen) ? chosen : dates[0];
  const day = forecasts.filter((forecast) => forecast.forecastDate === date).toSorted((a, b) => b.latitude - a.latitude);

  useMapLayer(
    () => ({
      legend: <p>Tempo previsto em cada capital de distrito, com a máxima e a mínima.</p>,
      marks: day.map((forecast) => ({
        id: forecast.cityId,
        longitude: forecast.longitude,
        latitude: forecast.latitude,
        detail: said(forecast),
        node: (
          <span className="flex items-center gap-1 rounded-full border border-kumo-line bg-kumo-base py-0.5 pr-2.5 pl-1 text-sm tabular-nums shadow-xs">
            <WeatherIcon id={forecast.weatherTypeId} name={forecast.weatherType} decorative className="size-6" />
            <b className="font-semibold text-kumo-strong">{format.degrees(forecast.maximumTemperature)}</b>
            <span className="text-xs text-kumo-subtle">{format.degrees(forecast.minimumTemperature)}</span>
          </span>
        ),
      })),
    }),
    [read.state, date],
  );

  return (
    <>
      <Heading title="Previsão">A previsão diária do IPMA para as capitais de distrito e as ilhas, para hoje e os dois dias seguintes.</Heading>
      {read.state === "loading" ? <Pending what="a previsão" /> : null}
      {read.state === "failed" ? <Failed what="a previsão" message={read.message} retry={read.retry} /> : null}
      {read.state === "ready" && date === undefined ? <Nothing>O IPMA ainda não publicou a previsão para hoje. Costuma sair de manhã cedo.</Nothing> : null}
      {date === undefined ? null : (
        <>
          <Days dates={dates} today={today} value={date} onChange={setChosen} />
          {REGIONS.map((region) => {
            const here = day.filter((forecast) => regionOf(forecast.longitude) === region);
            return here.length === 0 ? null : <Cities key={region} region={region} forecasts={here} />;
          })}
        </>
      )}
    </>
  );
}
