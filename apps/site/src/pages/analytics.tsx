import { Badge, Empty, LayerCard, Loader, Tabs, TimeseriesChart } from "@cloudflare/kumo";
import { ChartBarIcon } from "@phosphor-icons/react";
import { useMemo, useState, type ReactNode } from "react";
import { ErrorNote, PageHead, SectionHead, StatTile, useDarkMode } from "../components/common";
import { mountPage } from "../components/mount";
import { Shell } from "../components/Shell";
import { ApiError, apiGet, productHref } from "../lib/api";
import { fetchProducts, licenceHref, publisherHref } from "../lib/catalog";
import { echarts } from "../lib/echarts";
import { fmt } from "../lib/format";
import { SERIES_COLORS } from "../lib/palette";
import { useQuery } from "../lib/query";
import type { AnalyticsReport } from "../lib/types";

const WINDOWS = [
  { value: "1", label: "24 hours" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

type View = "all" | "web" | "api" | "mcp";

const VIEWS: { value: View; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "web", label: "Website" },
  { value: "api", label: "API" },
  { value: "mcp", label: "MCP" },
];

/** Each line keeps its colour whatever else is drawn: surfaces on the overview, kinds of client on one surface. */
interface Line {
  id: string;
  label: string;
  slot: number;
  /** Which timeline rows the line sums. */
  takes: (row: { surface: string; kind: string }) => boolean;
}

const SURFACE_LINES: Line[] = [
  { id: "web", label: "Website pages", slot: 0, takes: (row) => row.surface === "web" },
  { id: "api", label: "API requests", slot: 1, takes: (row) => row.surface === "api" },
  { id: "mcp", label: "MCP messages", slot: 2, takes: (row) => row.surface === "mcp" },
];

const KIND_LINES: Line[] = [
  { id: "browsers", label: "Browsers", slot: 0, takes: (row) => row.kind === "browser" },
  { id: "scripts", label: "Scripts and apps", slot: 1, takes: (row) => row.kind === "library" || row.kind === "unknown" },
  { id: "machines", label: "AI agents and crawlers", slot: 2, takes: (row) => row.kind === "ai-agent" || row.kind === "crawler" },
];

const KIND_LABEL = new Map([
  ["browser", "Browser"],
  ["library", "Script"],
  ["ai-agent", "AI agent"],
  ["crawler", "Crawler"],
  ["unknown", "Unknown"],
]);

const SURFACE_NAME = new Map([
  ["web", "website"],
  ["api", "API"],
  ["mcp-read", "MCP"],
]);

/** Rows each list shows before "Show all". */
const SHOWN = 10;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Which surfaces a view counts requests on, and which it reads datasets and routes from. */
interface ViewSurfaces {
  counts: string[];
  reads: string[];
}

/** MCP's reads are the API calls its code runs made. */
function surfacesOf(view: View): ViewSurfaces {
  if (view === "all") return { counts: ["web", "api", "mcp", "docs", "discovery"], reads: ["web", "api", "mcp-read"] };
  if (view === "mcp") return { counts: ["mcp"], reads: ["mcp-read"] };
  return { counts: [view], reads: [view] };
}

const sum = (rows: { requests: number }[]) => rows.reduce((total, row) => total + row.requests, 0);

/** Rows summed under a key, largest first. */
function tally<T extends { requests: number }>(rows: T[], keyOf: (row: T) => string): { key: string; requests: number }[] {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(keyOf(row), (totals.get(keyOf(row)) ?? 0) + row.requests);
  return [...totals].map(([key, requests]) => ({ key, requests })).sort((a, b) => b.requests - a.requests || a.key.localeCompare(b.key));
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: "region" });
  } catch {
    return undefined;
  }
})();

function countryName(code: string): string {
  if (code === "T1") return "Tor network";
  if (code === "XX") return "Unknown";
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

function AnalyticsPage() {
  const [days, setDays] = useState("7");
  const [view, setView] = useState<View>("all");
  const report = useQuery(`analytics:${days}`, () => apiGet<AnalyticsReport>(`/api/analytics?days=${days}`), { staleMs: 5 * 60_000 });
  const products = useQuery("products", fetchProducts, { staleMs: 5 * 60_000 });
  const titles = useMemo(() => new Map((products.data ?? []).map((product) => [product.slug, product.title])), [products.data]);
  const disabled = report.error instanceof ApiError && report.error.status === 503;

  return (
    <Shell section="analytics">
      <PageHead eyebrow="Analytics" title="How open-data.pt is used">
        Requests to the website, the API and the MCP server, counted as they are answered. No cookies, no IP addresses and no visitor identifiers are kept: only what was asked for,
        by what kind of client, from which country. The numbers are refreshed every half hour and go back {report.data?.retentionDays ?? 90} days. The same data is at{" "}
        <a href={`/api/analytics?days=${days}`}>/api/analytics</a>.
      </PageHead>

      <section aria-label="What to show" className="flex flex-wrap items-end justify-between gap-4">
        <Tabs variant="underline" value={view} onValueChange={(value) => setView(VIEWS.find((each) => each.value === value)?.value ?? "all")} tabs={VIEWS} />
        <Tabs variant="segmented" value={days} onValueChange={(value) => setDays(String(value))} tabs={WINDOWS} />
      </section>

      {disabled ? (
        <Empty icon={<ChartBarIcon size={32} />} title="Analytics are not switched on yet" description="This deployment does not count its requests yet. Check back later." />
      ) : report.error ? (
        <ErrorNote error={report.error} />
      ) : !report.data ? (
        <div className="grid place-items-center py-16">
          <Loader size="lg" />
        </div>
      ) : (
        <Report report={report.data} view={view} titles={titles} />
      )}
    </Shell>
  );
}

function Report({ report, view, titles }: { report: AnalyticsReport; view: View; titles: Map<string, string> }) {
  const { counts, reads } = surfacesOf(view);
  const counted = <T extends { surface: string }>(rows: T[]) => rows.filter((row) => counts.includes(row.surface));
  const read = <T extends { surface: string }>(rows: T[]) => rows.filter((row) => reads.includes(row.surface));
  const window = WINDOWS.find((each) => Number(each.value) === report.days)?.label ?? `${report.days} days`;

  const clients = counted(report.clients);
  const kinds = tally(clients, (row) => row.kind);
  const people = sum(clients.filter((row) => row.kind === "browser"));
  const machines = sum(clients.filter((row) => row.kind === "ai-agent" || row.kind === "crawler"));

  const datasets = tally(
    read(report.subjects).filter((row) => row.route === "/product/" || row.route.startsWith("/api/products/")),
    (row) => row.subject,
  );
  const topics = tally(
    read(report.subjects).filter((row) => row.route === "/catalog/" || row.route === "/publisher/" || row.route === "/licence/"),
    (row) => `${row.route}|${row.subject}`,
  );
  const routes = read(report.routes)
    .filter((row) => view !== "all" || row.surface !== "mcp-read")
    .sort((a, b) => b.requests - a.requests);
  const countries = tally(counted(report.countries), (row) => row.country);
  const referrers = tally(counted(report.referrers), (row) => row.referrer);
  const outcomes = counted(report.outcomes);
  const cached = sum(outcomes.filter((row) => row.cache === "hit"));
  const cacheable = sum(outcomes.filter((row) => row.cache !== "none"));
  const failed = sum(outcomes.filter((row) => row.status === "5xx"));
  const limited = sum(outcomes.filter((row) => row.status === "429"));
  const markdown = sum(outcomes.filter((row) => row.surface === "web" && row.format === "markdown"));
  const total = sum(counted(report.timeline));

  return (
    <>
      <section aria-label="Totals" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3">
        {view === "all" ? (
          <>
            <StatTile label="Website pages" value={fmt.int(sum(report.timeline.filter((row) => row.surface === "web")))} note={`over the last ${window}`} />
            <StatTile label="API requests" value={fmt.int(sum(report.timeline.filter((row) => row.surface === "api")))} note="from outside this website" />
            <StatTile
              label="MCP messages"
              value={fmt.int(sum(report.timeline.filter((row) => row.surface === "mcp")))}
              note={`${fmt.int(sum(report.timeline.filter((row) => row.surface === "mcp-read")))} API reads by code runs`}
            />
            <StatTile
              label="People and machines"
              value={total ? `${Math.round((people / total) * 100)}%` : "—"}
              note={`from browsers; ${total ? Math.round((machines / total) * 100) : 0}% from AI agents and crawlers`}
            />
          </>
        ) : (
          <>
            <StatTile label={view === "web" ? "Page views" : view === "api" ? "Requests" : "Messages"} value={fmt.int(total)} note={`over the last ${window}`} />
            <StatTile label="Clients" value={fmt.int(clients.length)} note={`${fmt.int(kinds.length)} kinds`} />
            {view === "api" ? (
              <StatTile
                label="Served from the edge cache"
                value={cacheable ? `${Math.round((cached / cacheable) * 100)}%` : "—"}
                note={`${fmt.int(limited)} refused by the rate limit`}
              />
            ) : view === "web" ? (
              <StatTile label="Read as Markdown" value={fmt.int(markdown)} note="pages fetched by agents asking for text/markdown" />
            ) : (
              <StatTile label="API reads by code runs" value={fmt.int(sum(report.timeline.filter((row) => row.surface === "mcp-read")))} note="each execute run can read several" />
            )}
            <StatTile
              label="Server errors"
              value={fmt.int(failed)}
              tone={failed ? "warn" : undefined}
              note={total ? `${((failed / total) * 100).toFixed(2)}% of ${view === "web" ? "page views" : "requests"}` : undefined}
            />
          </>
        )}
      </section>

      <Timeline report={report} lines={view === "all" ? SURFACE_LINES : KIND_LINES} view={view} />

      <section aria-labelledby="who-title">
        <SectionHead eyebrow="Who" title="Clients" id="who-title">
          Named from each request's User-Agent. Scripts are HTTP libraries and command-line tools; AI agents fetch for an assistant or train one.
        </SectionHead>
        <div className="grid gap-4 lg:grid-cols-2">
          <Ranked
            title="Clients"
            rows={tally(clients, (row) => `${row.kind}|${row.name}`).map(({ key, requests }) => {
              const [kind = "", name = ""] = key.split("|");
              return { key, label: name, tag: KIND_LABEL.get(kind) ?? kind, requests };
            })}
          />
          <div className="grid content-start gap-4">
            <Ranked title="Kinds of client" rows={kinds.map(({ key, requests }) => ({ key, label: KIND_LABEL.get(key) ?? key, requests }))} />
            {view === "all" || view === "mcp" ? (
              <Ranked
                title="MCP calls"
                note="What assistants asked the MCP server for, and the names clients gave when they connected."
                rows={tally(report.mcp, (row) => (row.client ? `${row.call} · ${row.client}` : row.call)).map(({ key, requests }) => ({ key, label: key || "(other)", requests }))}
              />
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="what-title">
        <SectionHead eyebrow="What" title="Datasets and routes" id="what-title">
          {view === "mcp"
            ? "What MCP code runs read from the API."
            : view === "all"
              ? "Datasets opened on the website, read through the API or read by MCP code runs."
              : "What was asked for most."}
        </SectionHead>
        <div className="grid gap-4 lg:grid-cols-2">
          <Ranked title="Datasets" rows={datasets.map(({ key, requests }) => ({ key, label: titles.get(key) ?? key, href: productHref(key), requests }))} />
          <Ranked
            title={view === "web" ? "Pages" : "Routes"}
            note="Mean time to answer beside each."
            rows={routes.map((row) => ({
              key: `${row.surface}|${row.route}`,
              label: row.route,
              tag: view === "all" ? (SURFACE_NAME.get(row.surface) ?? row.surface) : undefined,
              detail: `${fmt.int(row.meanMs)} ms`,
              requests: row.requests,
              mono: true,
            }))}
          />
          {topics.length ? (
            <Ranked
              title="Topics, publishers and licences"
              rows={topics.map(({ key, requests }) => {
                const [route = "", id = ""] = key.split("|");
                const href = route === "/publisher/" ? publisherHref(id) : route === "/licence/" ? licenceHref(id) : `/catalog/?topic=${encodeURIComponent(id)}`;
                return { key, label: id, tag: route.replaceAll("/", ""), href, requests };
              })}
            />
          ) : null}
        </div>
      </section>

      <section aria-labelledby="where-title">
        <SectionHead eyebrow="Where" title="Countries and referrers" id="where-title">
          Countries as Cloudflare locates each client. Referrers are the sites visitors followed a link from, with AI assistants named.
        </SectionHead>
        <div className="grid gap-4 lg:grid-cols-2">
          <Ranked title="Countries" rows={countries.map(({ key, requests }) => ({ key, label: countryName(key), requests }))} />
          <Ranked title="Referrers" rows={referrers.map(({ key, requests }) => ({ key, label: key, requests }))} empty="No request came with a link from another site." />
        </div>
      </section>
    </>
  );
}

/** Requests per hour or day, one line each, with every empty bucket drawn as zero. */
function Timeline({ report, lines, view }: { report: AnalyticsReport; lines: Line[]; view: View }) {
  const dark = useDarkMode();
  const palette = dark ? SERIES_COLORS.dark : SERIES_COLORS.light;
  const step = report.resolution === "hour" ? HOUR : DAY;
  const rows = view === "all" ? report.timeline : report.timeline.filter((row) => row.surface === view);
  const buckets = useMemo(() => {
    const times: number[] = [];
    for (let time = Date.parse(report.from); time <= Date.parse(report.to); time += step) times.push(time);
    return times;
  }, [report.from, report.to, step]);
  const series = lines.map((line) => {
    const totals = new Map<number, number>();
    for (const row of rows) if (line.takes(row)) totals.set(Date.parse(row.time), (totals.get(Date.parse(row.time)) ?? 0) + row.requests);
    return { line, points: buckets.map((time): [number, number] => [time, totals.get(time) ?? 0]) };
  });
  const per = report.resolution === "hour" ? "hour" : "day";

  return (
    <section aria-labelledby="when-title">
      <SectionHead eyebrow="When" title={`Requests per ${per}`} id="when-title">
        {view === "all" ? "Website pages, API requests and MCP messages." : "By kind of client."}
        {report.resolution === "day" ? " Days are UTC days." : " Hours in your local time."}
      </SectionHead>
      <LayerCard>
        <LayerCard.Primary className="grid gap-3">
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm" aria-label="Legend">
            {series.map(({ line, points }) => (
              <li key={line.id} className="flex items-center gap-2 text-kumo-default">
                <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded-full" style={{ backgroundColor: palette[line.slot] }} />
                {line.label}
                <span className="font-mono text-xs text-kumo-subtle">{fmt.int(points.reduce((total, [, value]) => total + value, 0))}</span>
              </li>
            ))}
          </ul>
          <TimeseriesChart
            echarts={echarts}
            isDarkMode={dark}
            height={300}
            tooltipValueFormat={(value: number) => `${fmt.int(value)} requests`}
            yAxisTickFormat={(value: number) => fmt.compact(value)}
            ariaDescription={`Requests per ${per}: ${series.map(({ line }) => line.label).join(", ")}`}
            data={series.map(({ line, points }) => ({ name: line.label, color: palette[line.slot] ?? "#1b7a4f", data: points }))}
          />
          <details className="text-sm">
            <summary className="cursor-pointer text-kumo-subtle hover:text-kumo-strong">Show as a table</summary>
            <div className="mt-3 max-h-80 overflow-auto">
              <table className="w-full text-left tabular-nums">
                <thead className="sticky top-0 bg-kumo-base text-kumo-subtle">
                  <tr>
                    <th className="py-1 pr-4 font-medium">{report.resolution === "hour" ? "Hour" : "Day"}</th>
                    {series.map(({ line }) => (
                      <th key={line.id} className="py-1 pr-4 text-right font-medium">
                        {line.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((time, index) => (
                    <tr key={time} className="border-t border-kumo-hairline">
                      <td className="py-1 pr-4">{report.resolution === "hour" ? fmt.dateTime(time) : fmt.date(time)}</td>
                      {series.map(({ line, points }) => (
                        <td key={line.id} className="py-1 pr-4 text-right font-mono">
                          {fmt.int(points[index]?.[1] ?? 0)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </LayerCard.Primary>
      </LayerCard>
    </section>
  );
}

interface RankedRow {
  key: string;
  label: string;
  requests: number;
  href?: string;
  tag?: string | undefined;
  detail?: string;
  mono?: boolean;
}

/** A ranked list: each row's count, with a bar scaled to the largest. */
function Ranked({ title, rows, note, empty = "Nothing counted in this window." }: { title: string; rows: RankedRow[]; note?: ReactNode; empty?: string }) {
  const [all, setAll] = useState(false);
  const top = rows[0]?.requests ?? 0;
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <LayerCard className="min-w-0">
      <LayerCard.Secondary className="flex items-baseline justify-between gap-3">
        <span>{title}</span>
        <span className="font-mono text-[0.7rem] text-kumo-subtle">{fmt.int(rows.length)}</span>
      </LayerCard.Secondary>
      <LayerCard.Primary className="grid gap-2.5">
        {note ? <p className="text-xs text-kumo-subtle">{note}</p> : null}
        {rows.length === 0 ? (
          <p className="text-sm text-kumo-subtle">{empty}</p>
        ) : (
          <ol className="grid gap-2">
            {shown.map((row) => (
              <li key={row.key} className="grid gap-1">
                <div className="flex min-w-0 items-baseline gap-2 text-sm">
                  <span className={`min-w-0 truncate text-kumo-default ${row.mono ? "font-mono text-xs" : ""}`} title={row.label}>
                    {row.href ? (
                      <a href={row.href} className="hover:underline">
                        {row.label}
                      </a>
                    ) : (
                      row.label
                    )}
                  </span>
                  {row.tag ? <Badge variant="secondary">{row.tag}</Badge> : null}
                  <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-kumo-subtle">
                    {row.detail ? <span className="mr-3">{row.detail}</span> : null}
                    <span className="text-kumo-strong">{fmt.int(row.requests)}</span>
                  </span>
                </div>
                <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-kumo-recessed">
                  <div className="h-full rounded-full bg-kumo-brand" style={{ width: `${top ? Math.max(1, (row.requests / top) * 100) : 0}%` }} />
                </div>
              </li>
            ))}
          </ol>
        )}
        {rows.length > SHOWN ? (
          <button type="button" onClick={() => setAll(!all)} className="justify-self-start text-sm text-kumo-subtle hover:text-kumo-strong">
            {all ? "Show fewer" : `Show all ${fmt.int(rows.length)}`}
          </button>
        ) : null}
      </LayerCard.Primary>
    </LayerCard>
  );
}

mountPage(<AnalyticsPage />);
