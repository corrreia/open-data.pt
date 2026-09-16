import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";
import { readFileSync } from "node:fs";
import { hashSourceConfig } from "@open-data-pt/gatekeeper-shared";

const gatekeepers = ["cities", "energy", "environment", "health", "mobility", "statistics"];
const entrypoint = (name: string) => name[0]!.toUpperCase() + name.slice(1);
const ARCGIS_HOSTS = "services.arcgis.com,sniambgeoogc.apambiente.pt";
const OPENDATASOFT_HOSTS = "e-redes.opendatasoft.com,transparencia.sns.gov.pt";
const runtimeVars = {
  cities: { ARCGIS_ALLOWED_HOSTS: ARCGIS_HOSTS, CKAN_ALLOWED_HOSTS: "opendata.porto.digital,dadosabertos.cascais.pt", UDATA_ALLOWED_HOSTS: "dados.gov.pt" },
  energy: {
    REN_API_ORIGIN: "https://datahub.ren.pt",
    OMIE_API_ORIGIN: "https://www.omie.es",
    DGEG_API_ORIGIN: "https://precoscombustiveis.dgeg.gov.pt",
    OPENDATASOFT_ALLOWED_HOSTS: OPENDATASOFT_HOSTS,
  },
  environment: { IPMA_API_ORIGIN: "https://api.ipma.pt", ARCGIS_ALLOWED_HOSTS: ARCGIS_HOSTS },
  health: { OPENDATASOFT_ALLOWED_HOSTS: OPENDATASOFT_HOSTS },
  mobility: {
    CARRIS_API_ORIGIN: "https://api.carrismetropolitana.pt",
    METROLISBOA_API_ORIGIN: "https://lisboa-metro.open-data.pt",
    GTFS_ALLOWED_HOSTS: "api.carrismetropolitana.pt,opendata.porto.digital,dados.gov.pt",
    GBFS_ALLOWED_HOSTS: "data.lime.bike,mds.bird.co,gbfs.primelayer.pt,gbfs.nextbike.net",
  },
  statistics: { INE_API_ORIGIN: "https://www.ine.pt", BPSTAT_API_ORIGIN: "https://bpstat.bportugal.pt", EUROSTAT_API_ORIGIN: "https://ec.europa.eu" },
} satisfies Record<string, Record<string, string>>;
const services = gatekeepers.map((name) => ({ binding: `GK_${name.toUpperCase()}`, service: `conformance-${name}`, entrypoint: entrypoint(name) }));
function workerConfig(name: string, vars: Record<string, string> = {}, bindings = false) {
  const config = {
    name,
    main: "tests/fixtures/gatekeeper-conformance-worker.ts",
    compatibility_date: "2026-09-09",
    compatibility_flags: ["nodejs_compat"],
    vars,
    services: bindings ? services : [],
  };
  return { config };
}
const server = createTestHarness({
  workers: [workerConfig("gatekeeper-conformance", {}, true), ...gatekeepers.map((name) => workerConfig(`conformance-${name}`, runtimeVars[name]))],
});

beforeAll(async () => server.listen(), 60_000);
afterAll(async () => server.close(), 30_000);

describe("all Gatekeeper entrypoints expose the normalized five-operation contract", () => {
  it.each(gatekeepers)("%s exposes the five operations and no legacy RPC", (name) => {
    const source = readFileSync(`packages/gatekeeper-${name}/src/index.ts`, "utf8");
    for (const method of ["describe", "listFeedKinds", "resolveFeed", "collect", "exampleFeeds"]) expect(source).toContain(`async ${method}(`);
    expect(source).not.toContain("async validateFeedConfig(");
    expect(source).not.toContain("async collectHistory(");
    // The platform's fetch must be called as a function, never handed over as a bare reference: in workerd a detached
    // `fetch` throws "Illegal invocation", which Node's fetch does not, so only this check catches it before a deploy.
    expect(source, `${name} passes fetch unbound`).not.toMatch(/fetcher:\s*fetch\b/);
  });

  it("resolves a canonical example through every real entrypoint over private Worker RPC", async () => {
    const response = await server.fetch("/conformance");
    expect(response.status, await response.clone().text()).toBe(200);
    const rows = await response.json<
      Array<{
        binding: string;
        description: { kind: string; name: string };
        kindCount: number;
        resolved: { config: Record<string, string>; configHash: string; resourceKey: string; kind: string };
      }>
    >();
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.description.kind).toBeTruthy();
      expect(row.description.name).toBeTruthy();
      expect(row.kindCount).toBeGreaterThan(0);
      expect(row.resolved.configHash).toBe(await hashSourceConfig(row.resolved.config));
      // `<topic>:<library>:<kind>:<digest>`, so nothing collides between the libraries one Worker carries.
      expect(row.resolved.resourceKey).toMatch(/^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+:/);
      expect(row.resolved.kind).toMatch(/^[a-z0-9-]+:[a-z0-9-]+$/);
      expect(row.resolved.config.source).toBeTruthy();
    }
  }, 30_000);
});
