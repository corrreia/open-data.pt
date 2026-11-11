import { readDistricts, readWarnings, type Warning } from "../api.ts";
import { css, WARNING_LEVELS } from "../scales.ts";
import { el, format } from "../ui.ts";
import type { Section, Stage } from "./section.ts";

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

function chip(level: string): HTMLElement {
  const made = el("span", "level", WARNING_LEVELS.get(level)?.name ?? level);
  made.style.setProperty("--level", css(WARNING_LEVELS.get(level)?.colour ?? 0x999999));
  return made;
}

async function show(stage: Stage): Promise<void> {
  const [warnings, districts] = await Promise.all([readWarnings(), readDistricts()]);
  const now = Date.now();
  // Green is IPMA saying there is nothing to warn of; a warning that has ended is history.
  const standing = warnings.filter((warning) => WARNING_LEVELS.has(warning.level) && Date.parse(warning.endTime) > now);
  const byArea = new Map<string, Warning[]>();
  for (const warning of standing) byArea.set(warning.areaCode, [...(byArea.get(warning.areaCode) ?? []), warning]);
  const areas = [...byArea].toSorted(([, a], [, b]) => ORDER.indexOf(worst(b)) - ORDER.indexOf(worst(a)));

  stage.key.replaceChildren("Cada distrito com aviso, na cor do mais grave. Os avisos das ilhas estão na lista.");
  stage.marks.set(
    areas.flatMap(([code, list]) => {
      const middle = districts.find((district) => district.distrito === AREAS.get(code));
      if (middle === undefined) return [];
      const mark = el("div", "mark warning", `${list.length}`);
      mark.style.setProperty("--level", css(WARNING_LEVELS.get(worst(list))?.colour ?? 0x999999));
      mark.title = `${AREAS.get(code) ?? code}: ${list.length} ${list.length === 1 ? "aviso" : "avisos"}`;
      return [{ longitude: middle.longitude, latitude: middle.latitude, element: mark }];
    }),
  );

  stage.panel.replaceChildren(
    el("h2", "", "Avisos"),
    el(
      "p",
      "lede",
      areas.length === 0
        ? "Não há avisos meteorológicos em vigor nem previstos."
        : `${standing.length} avisos meteorológicos do IPMA, em vigor ou previstos, em ${areas.length} áreas.`,
    ),
    ...areas.flatMap(([code, list]) => [
      el("h3", "", AREAS.get(code) ?? code),
      el(
        "table",
        "",
        el(
          "tbody",
          "",
          ...list
            .toSorted((a, b) => a.startTime.localeCompare(b.startTime))
            .map((warning) =>
              el(
                "tr",
                "",
                el("td", "", chip(warning.level)),
                el("th", "", warning.type, ...(warning.text === null ? [] : [el("small", "", warning.text)])),
                el("td", "period", Date.parse(warning.startTime) > now ? `de ${format.when(warning.startTime)}` : "em vigor", el("br", ""), `até ${format.when(warning.endTime)}`),
              ),
            ),
        ),
      ),
    ]),
  );
}

export const WARNINGS: Section = { path: "avisos", name: "Avisos", show };
