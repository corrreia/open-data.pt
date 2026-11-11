import { Select } from "@cloudflare/kumo";
import { useState } from "react";
import { readMunicipalDays, readMunicipalities } from "../api.ts";
import { Chart } from "../Chart.tsx";
import { format } from "../format.ts";
import { useMapLayer } from "../stage.tsx";
import { Failed, Heading, Nothing, Pending, Subheading, useRead } from "../ui.tsx";

/** The last weeks, day by day, in any municipality of the mainland: IPMA's daily temperature and rain. */

async function readPlaces() {
  const places = (await readMunicipalities()).flatMap((each) =>
    each.dtmn === undefined || each.municipio === undefined ? [] : [{ code: each.dtmn, name: each.municipio, longitude: each.longitude, latitude: each.latitude }],
  );
  return places.toSorted((a, b) => a.name.localeCompare(b.name, "pt"));
}

function Weeks(props: { code: string; name: string }) {
  const days = useRead(() =>
    Promise.all([
      readMunicipalDays("ipma-municipal-temperature", props.code, "maximum-temperature"),
      readMunicipalDays("ipma-municipal-temperature", props.code, "minimum-temperature"),
      readMunicipalDays("ipma-municipal-precipitation", props.code, "total-precipitation"),
    ]),
  );
  if (days.state === "loading") return <Pending what="as últimas semanas" />;
  if (days.state === "failed") return <Failed what="as últimas semanas" message={days.message} retry={days.retry} />;
  const [highs, lows, rain] = days.data;
  if (highs.length < 2 && lows.length < 2 && rain.length < 2) return <Nothing>O IPMA não tem valores diários recentes para {props.name}.</Nothing>;
  return (
    <>
      {highs.length < 2 ? null : (
        <section className="grid gap-2">
          <Subheading>Temperatura máxima, °C</Subheading>
          <Chart points={highs} bars={false} unit="°C" name="Temperatura máxima" time={format.shortDate} />
        </section>
      )}
      {lows.length < 2 ? null : (
        <section className="grid gap-2">
          <Subheading>Temperatura mínima, °C</Subheading>
          <Chart points={lows} bars={false} unit="°C" name="Temperatura mínima" time={format.shortDate} />
        </section>
      )}
      {rain.length < 2 ? null : (
        <section className="grid gap-2">
          <Subheading>Chuva por dia, mm</Subheading>
          <Chart points={rain} bars unit="mm" name="Chuva por dia" time={format.shortDate} />
        </section>
      )}
    </>
  );
}

export function Climate() {
  const read = useRead(readPlaces);
  const places = read.state === "ready" ? read.data : [];
  const [chosen, setChosen] = useState<string>();
  // Lisbon, when it is there, is where most readers will look first.
  const place = places.find((each) => each.code === chosen) ?? places.find((each) => each.name === "Lisboa") ?? places[0];

  useMapLayer(
    () => ({
      legend: <p>O concelho escolhido.</p>,
      marks:
        place === undefined
          ? []
          : [
              {
                id: place.code,
                longitude: place.longitude,
                latitude: place.latitude,
                detail: place.name,
                node: <span className="block rounded-sm bg-kumo-contrast px-2 py-0.5 text-sm font-semibold text-kumo-base">{place.name}</span>,
              },
            ],
    }),
    [read.state, place?.code],
  );

  return (
    <>
      <Heading title="Últimas semanas">A temperatura e a chuva de cada dia, em média no concelho, nas semanas que o IPMA publica.</Heading>
      {read.state === "loading" ? <Pending what="os concelhos" /> : null}
      {read.state === "failed" ? <Failed what="os concelhos" message={read.message} retry={read.retry} /> : null}
      {place === undefined ? null : (
        <>
          <Select
            label="Concelho"
            className="w-full max-w-xs"
            value={place.code}
            onValueChange={(value: string | null) => setChosen(value ?? undefined)}
            items={places.map((each) => ({ value: each.code, label: each.name }))}
          />
          <Weeks key={place.code} code={place.code} name={place.name} />
        </>
      )}
    </>
  );
}
