import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";
import { readdirSync, readFileSync } from "node:fs";
import { hashSourceConfig } from "@open-data-pt/gatekeeper-shared";
import { workerPackages } from "../tools/packages";
import { workerVars } from "./catalog";

const gatekeepers = workerPackages();
const entrypoint = (name: string) => name[0]!.toUpperCase() + name.slice(1);
const runtimeVars = Object.fromEntries(gatekeepers.map((name) => [name, workerVars(name)]));
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
  it("gives every generated Worker the five operations and no legacy RPC", () => {
    const factory = readFileSync("packages/gatekeeper-shared/src/library-worker.ts", "utf8");
    for (const method of ["describe", "listFeedKinds", "resolveFeed", "collect", "exampleFeeds"]) expect(factory).toContain(`async ${method}(`);
    expect(factory).not.toContain("async validateFeedConfig(");
    expect(factory).not.toContain("async collectHistory(");
    for (const name of gatekeepers) expect(readFileSync(`packages/gatekeeper-${name}/src/index.ts`, "utf8")).toContain(`libraryGatekeeper<Env>(`);
  });

  it.each(readdirSync("packages/gatekeeper-shared/src", { recursive: true, encoding: "utf8" }).filter((path) => path.endsWith("worker.ts")))(
    "%s calls the platform fetch rather than handing it over",
    (path) => {
      // The platform's fetch must be called as a function, never handed over as a bare reference: in workerd a detached
      // `fetch` throws "Illegal invocation", which Node's fetch does not, so only this check catches it before a deploy.
      expect(readFileSync(`packages/gatekeeper-shared/src/${path}`, "utf8")).not.toMatch(/fetcher:\s*fetch\b/);
    },
  );

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
    expect(rows).toHaveLength(gatekeepers.length);
    for (const row of rows) {
      expect(row.description.kind).toBeTruthy();
      expect(row.description.name).toBeTruthy();
      expect(row.kindCount).toBeGreaterThan(0);
      expect(row.resolved.configHash).toBe(await hashSourceConfig(row.resolved.config));
      // `<library>:<library>:<kind>:<digest>`, the Worker's own kind before the library's resource key.
      expect(row.resolved.resourceKey).toMatch(/^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+:/);
      expect(row.resolved.kind).toMatch(/^[a-z0-9-]+:[a-z0-9-]+$/);
      expect(row.resolved.config.source).toBeTruthy();
    }
  }, 30_000);
});
