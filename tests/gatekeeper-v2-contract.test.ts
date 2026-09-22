import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";
import { readdirSync, readFileSync } from "node:fs";
import { hashSourceConfig } from "@open-data-pt/contract";
import { INSTALLED } from "./catalog";

function workerConfig(name: string, bindings = false) {
  const config = {
    name,
    main: "tests/fixtures/gatekeeper-conformance-worker.ts",
    compatibility_date: "2026-09-09",
    compatibility_flags: ["nodejs_compat"],
    services: bindings ? [{ binding: "GK", service: "conformance-gatekeeper", entrypoint: "Gatekeeper" }] : [],
  };
  return { config };
}
const server = createTestHarness({
  workers: [workerConfig("gatekeeper-conformance", true), workerConfig("conformance-gatekeeper")],
});

beforeAll(async () => server.listen(), 60_000);
afterAll(async () => server.close(), 30_000);

describe("the Gatekeeper entrypoint exposes the normalized five-operation contract", () => {
  it("gives the Worker the five operations and no legacy RPC", () => {
    const factory = readFileSync("apps/gatekeeper/src/gatekeeper.ts", "utf8");
    for (const method of ["describe", "listFeedKinds", "resolveFeed", "collect", "exampleFeeds", "catalog"]) expect(factory).toContain(`async ${method}(`);
    expect(factory).not.toContain("async validateFeedConfig(");
    expect(factory).not.toContain("async collectHistory(");
    expect(readFileSync("apps/gatekeeper/src/worker.ts", "utf8")).toContain("gatekeeper<Env>(LIBRARIES)");
  });

  it.each(readdirSync("apps/gatekeeper/src", { recursive: true, encoding: "utf8" }).filter((path) => path.endsWith("deployment.ts")))(
    "%s calls the platform fetch rather than handing it over",
    (path) => {
      // The platform's fetch must be called as a function, never handed over as a bare reference: in workerd a detached
      // `fetch` throws "Illegal invocation", which Node's fetch does not, so only this check catches it before a deploy.
      expect(readFileSync(`apps/gatekeeper/src/${path}`, "utf8")).not.toMatch(/fetcher:\s*fetch\b/);
    },
  );

  // A library whose publishers are all held installs nothing, so the entrypoint offers it nothing to resolve;
  // `tests/feed-identity.test.ts` still resolves every example it lists.
  it("resolves a canonical example of every installing library through the real entrypoint over private Worker RPC", async () => {
    const response = await server.fetch("/conformance");
    expect(response.status, await response.clone().text()).toBe(200);
    const rows = await response.json<
      Array<{
        library: string;
        description: { kind: string; name: string };
        kindCount: number;
        resolved: { config: Record<string, string>; configHash: string; resourceKey: string; kind: string };
      }>
    >();
    expect(rows.map((row) => row.library)).toEqual([...new Set(INSTALLED.map((example) => example.config.source ?? ""))].toSorted());
    for (const row of rows) {
      expect(row.description.kind).toBeTruthy();
      expect(row.description.name).toBeTruthy();
      expect(row.kindCount).toBeGreaterThan(0);
      expect(row.resolved.configHash).toBe(await hashSourceConfig(row.resolved.config));
      // `<library>:<library>:<kind>:<digest>`: the library's name twice, once where the Worker's name used to be.
      expect(row.resolved.resourceKey).toMatch(new RegExp(`^${row.library}:${row.library}:[a-z0-9-]+:`));
      expect(row.resolved.kind).toMatch(new RegExp(`^${row.library}:[a-z0-9-]+$`));
      expect(row.resolved.config.source).toBe(row.library);
    }
  }, 30_000);
});
