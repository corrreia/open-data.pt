import { describe, expect, it } from "vitest";
import { FEEDS, PUBLISHERS, sourcesOf } from "@open-data-pt/gatekeeper/catalog";
import { LIBRARIES } from "#/libraries";
import { sourceHosts } from "#/publisher-client";

/** Every host a feed's config or a library's vars, as JSON, name: as an address or as a `host`. */
function hostsNamed(json: string): string[] {
  return [...json.matchAll(/https?:\/\/([^/"?#:]+)|"host":"([^"]+)"/g)].map((match) => match[1] ?? match[2] ?? "");
}

/**
 * A publisher's `sources` are the only hosts their feeds can reach, so a host
 * missing from them fails the feed on its first run. These catch the hosts the
 * code states; a redirect to one it does not state is caught by a live run.
 */
describe("publisher sources", () => {
  it("are declared by every publisher, once each", () => {
    for (const [key, publisher] of PUBLISHERS) {
      const hosts = sourceHosts(publisher.sources);
      expect(hosts.length, key).toBeGreaterThan(0);
      expect(new Set(hosts).size, key).toBe(hosts.length);
    }
  });

  it("name every host a feed's config and its library's vars send it to", () => {
    const missing: string[] = [];
    for (const feed of FEEDS) {
      const declared = new Set(sourceHosts(sourcesOf(feed.slug)));
      const deployment = LIBRARIES.find((library) => library.deployment.source === feed.config.source)?.deployment;
      for (const host of [...hostsNamed(JSON.stringify(feed.config)), ...hostsNamed(JSON.stringify(deployment?.vars ?? {}))])
        if (!declared.has(host)) missing.push(`${feed.slug}: ${host}`);
    }
    expect(missing).toEqual([]);
  });
});
