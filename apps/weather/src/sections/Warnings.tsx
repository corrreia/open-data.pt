import { Table } from "@cloudflare/kumo";
import { readDistricts, readWarnings, type Warning } from "../api.ts";
import { format } from "../format.ts";
import { css, WARNING_LEVELS } from "../scales.ts";
import { useMapLayer } from "../stage.tsx";
import { Failed, Heading, Level, Nothing, Pending, Subheading, useRead } from "../ui.tsx";

/** The weather warnings in force and coming, by district and island group. */

/** IPMA's warning areas by their codes: the eighteen districts, and the parts of Madeira and the Azores it warns separately. */
const AREAS = new Map([
  ["AVR", "Aveiro"],
  ["BJA", "Beja"],
  ["BRG", "Braga"],
  ["BGC", "Bragança"],
  ["CBO", "Castelo Branco"],
  ["CBR", "Coimbra"],
  ["EVR", "Évora"],
  ["FAR", "Faro"],
  ["GDA", "Guarda"],
  ["LRA", "Leiria"],
  ["LSB", "Lisboa"],
  ["PTG", "Portalegre"],
  ["PTO", "Porto"],
  ["STM", "Santarém"],
  ["STB", "Setúbal"],
  ["VCT", "Viana do Castelo"],
  ["VRL", "Vila Real"],
  ["VIS", "Viseu"],
  ["MCN", "Madeira, costa norte"],
  ["MCS", "Madeira, costa sul"],
  ["MRM", "Madeira, regiões montanhosas"],
  ["MPS", "Porto Santo"],
  ["AOC", "Açores, grupo ocidental"],
  ["ACE", "Açores, grupo central"],
  ["AOR", "Açores, grupo oriental"],
]);

const ORDER = [...WARNING_LEVELS.keys()];
const worst = (warnings: readonly Warning[]): string => warnings.toSorted((a, b) => ORDER.indexOf(b.level) - ORDER.indexOf(a.level))[0]?.level ?? "yellow";
const count = (many: number): string => `${many} ${many === 1 ? "aviso" : "avisos"}`;

async function read() {
  const [warnings, districts] = await Promise.all([readWarnings(), readDistricts()]);
  return { warnings, districts };
}

export function Warnings() {
  const result = useRead(read);
  const now = Date.now();
  // Green is IPMA saying there is nothing to warn of; a warning that has ended is history.
  const standing = result.state === "ready" ? result.data.warnings.filter((warning) => WARNING_LEVELS.has(warning.level) && Date.parse(warning.endTime) > now) : [];
  const byArea = new Map<string, Warning[]>();
  for (const warning of standing) byArea.set(warning.areaCode, [...(byArea.get(warning.areaCode) ?? []), warning]);
  const areas = [...byArea].toSorted(([, a], [, b]) => ORDER.indexOf(worst(b)) - ORDER.indexOf(worst(a)));

  useMapLayer(
    () => ({
      legend: (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Avisos por distrito, na cor do mais grave:</span>
          {[...WARNING_LEVELS.values()].map((level) => (
            <Level key={level.name} colour={level.colour}>
              {level.name}
            </Level>
          ))}
        </p>
      ),
      marks: areas.flatMap(([code, list]) => {
        const name = AREAS.get(code) ?? code;
        const middle = result.state === "ready" ? result.data.districts.find((district) => district.distrito === name) : undefined;
        const level = WARNING_LEVELS.get(worst(list));
        if (middle === undefined || level === undefined) return [];
        return [
          {
            id: code,
            longitude: middle.longitude,
            latitude: middle.latitude,
            detail: `${name}: ${count(list.length)}, o mais grave ${level.name.toLowerCase()} (${list.map((warning) => warning.type.toLowerCase()).join(", ")})`,
            node: (
              <span
                className="grid h-7 min-w-7 place-items-center rounded-full border border-black/40 px-1.5 text-sm font-bold tabular-nums"
                style={{ background: css(level.colour), color: level.ink }}
              >
                {list.length}
              </span>
            ),
          },
        ];
      }),
    }),
    [result.state],
  );

  return (
    <>
      <Heading title="Avisos">
        {result.state !== "ready"
          ? "Os avisos meteorológicos do IPMA, por distrito e grupo de ilhas."
          : `${count(standing.length)} do IPMA em vigor ou previstos, em ${areas.length} áreas.`}
      </Heading>
      {result.state === "loading" ? <Pending what="os avisos" /> : null}
      {result.state === "failed" ? <Failed what="os avisos" message={result.message} retry={result.retry} /> : null}
      {result.state === "ready" && areas.length === 0 ? <Nothing>Não há avisos meteorológicos em vigor nem previstos.</Nothing> : null}
      {areas.map(([code, list]) => (
        <section key={code} className="grid gap-2">
          <Subheading>{AREAS.get(code) ?? code}</Subheading>
          <div className="overflow-x-auto">
            <Table aria-label={`Avisos: ${AREAS.get(code) ?? code}`}>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Nível</Table.Head>
                  <Table.Head>Aviso</Table.Head>
                  <Table.Head className="text-end">Período</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {list
                  .toSorted((a, b) => a.startTime.localeCompare(b.startTime))
                  .map((warning) => (
                    <Table.Row key={`${warning.type}:${warning.startTime}`}>
                      <Table.Cell className="align-top">
                        <Level colour={WARNING_LEVELS.get(warning.level)?.colour ?? 0x999999}>{WARNING_LEVELS.get(warning.level)?.name ?? warning.level}</Level>
                      </Table.Cell>
                      <Table.Cell className="align-top">
                        <span className="font-semibold text-kumo-strong">{warning.type}</span>
                        {warning.text === null ? null : <span className="block max-w-[46ch] text-xs text-kumo-subtle">{warning.text}</span>}
                      </Table.Cell>
                      <Table.Cell className="text-end align-top text-xs whitespace-nowrap text-kumo-subtle">
                        {Date.parse(warning.startTime) > now ? `de ${format.when(warning.startTime)}` : "em vigor"}
                        <br />
                        até {format.when(warning.endTime)}
                      </Table.Cell>
                    </Table.Row>
                  ))}
              </Table.Body>
            </Table>
          </div>
        </section>
      ))}
    </>
  );
}
