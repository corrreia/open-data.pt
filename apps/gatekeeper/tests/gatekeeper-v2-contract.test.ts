import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";
import { readdirSync, readFileSync } from "node:fs";
import { INSTALLED } from "./catalog";
import type { ConformanceAnswer } from "./fixtures/gatekeeper-conformance-worker";
import { jsonAs } from "./support";

function workerConfig(name: string, bindings = false) {
  const config = {
    name,
    main: "apps/gatekeeper/tests/fixtures/gatekeeper-conformance-worker.ts",
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

describe("the Gatekeeper entrypoint exposes the three-operation contract", () => {
  it.each(readdirSync("apps/gatekeeper/src", { recursive: true, encoding: "utf8" }).filter((path) => path.endsWith("deployment.ts")))(
    "%s calls the platform fetch rather than handing it over",
    (path) => {
      // The platform's fetch must be called as a function, never handed over as a bare reference: in workerd a detached
      // `fetch` throws "Illegal invocation", which Node's fetch does not, so only this check catches it before a deploy.
      expect(readFileSync(`apps/gatekeeper/src/${path}`, "utf8")).not.toMatch(/fetcher:\s*fetch\b/);
    },
  );

  it("answers a kernel of the previous release with a retry, before reading the feed it names", async () => {
    // Deploys are per Worker: for a minute a kernel of one release asks a Gatekeeper of the other. A permanent failure
    // would rest every feed for hours.
    const response = await server.fetch("/previous-release");
    expect(await response.json()).toEqual({ kind: "failure", code: "protocol-mismatch", retryable: true, retryAfterSeconds: 60 });
  }, 30_000);

  // A library whose publishers are all held installs nothing, so the catalog carries nothing of it;
  // `feed-identity.test.ts` still resolves every feed the folders list.
  it("answers every installing library's feeds resolved, and a stable digest, through the real entrypoint over private Worker RPC", async () => {
    const response = await server.fetch("/conformance");
    expect(response.status, await response.clone().text()).toBe(200);
    const answer = jsonAs<ConformanceAnswer>(await response.text());
    expect(answer.versions[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(answer.versions[1]).toBe(answer.versions[0]);
    expect(answer.feeds.map((feed) => feed.slug).toSorted()).toEqual(INSTALLED.map((feed) => feed.slug).toSorted());
    const libraries = [...new Set(INSTALLED.map((feed) => feed.config.source ?? ""))].toSorted();
    expect([...new Set(answer.feeds.map((feed) => feed.library))].toSorted()).toEqual(libraries);
    for (const library of libraries) {
      const feeds = answer.feeds.filter((feed) => feed.library === library);
      expect(feeds.length, library).toBeGreaterThan(0);
      for (const feed of feeds) {
        // `<library>:<library>:<kind>:<digest>`: the library's name twice, once where the Worker's name used to be.
        expect(feed.resourceKey, feed.slug).toMatch(new RegExp(`^${library}:${library}:[a-z0-9-]+:`));
        expect(feed.configHash, feed.slug).toMatch(/^[0-9a-f]{64}$/);
        expect([true, false], feed.slug).toContain(feed.eventTimed);
      }
    }
  }, 60_000);
});
