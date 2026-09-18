import { describe, expect, it } from "vitest";
import { resolveTopicFeed } from "@open-data-pt/gatekeeper-shared";
import { PLANS, workerExamples, workerLibraries } from "./catalog";

/**
 * A feed's resolved identity decides whether its epoch rotates and whether its
 * checkpoint is still its own (`resourceKey`, `kind`), and its ID derives from
 * its slug. This pins every example's identity to a fixture, so a change to
 * how Workers are laid out, or to how a library stamps its resource keys, is
 * seen for what it is: every feed re-walking its history from nothing.
 * Update the fixture (`vitest -u`) only for a change that is meant to do that.
 */
describe("every example's resolved identity", () => {
  it("is what it was", async () => {
    const identities: Record<string, { resourceKey: string; kind: string }> = {};
    for (const plan of PLANS) {
      const libraries = workerLibraries(plan.name);
      for (const example of workerExamples(plan.name)) {
        const resolved = await resolveTopicFeed(example.config, { gatekeeperKind: plan.name, libraries });
        identities[example.slug] = { resourceKey: resolved.resourceKey, kind: resolved.kind };
      }
    }
    const text = `${JSON.stringify(Object.fromEntries(Object.entries(identities).toSorted(([a], [b]) => a.localeCompare(b))), null, 2)}\n`;
    await expect(text).toMatchFileSnapshot("./fixtures/feed-identity.json");
  });
});
