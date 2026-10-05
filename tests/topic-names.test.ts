import { describe, expect, it } from "vitest";
import { TOPICS } from "@open-data-pt/gatekeeper";
import { TOPIC_NAMES } from "@open-data-pt/api";

/*
 * The Gatekeeper's catalog says which topics a feed carries; the site and the kernel's previews name
 * them in English and in Portuguese. A topic added to one vocabulary and not the other would show up
 * on Portuguese pages as its English key.
 */
describe("topic names", () => {
  it("names every topic of the catalog in both languages, and no topic the catalog does not have", () => {
    expect(Object.keys(TOPIC_NAMES).sort()).toEqual(Object.keys(TOPICS).sort());
  });
});
