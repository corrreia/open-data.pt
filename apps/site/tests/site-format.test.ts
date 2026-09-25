import { describe, expect, it } from "vitest";
import { fmt, humanize } from "../src/lib/format";

/**
 * A source's own field holds whatever the source put in it. A value that looks like a timestamp and
 * is not one used to reach `Intl`, which throws on an invalid date: one odd row would blank the page
 * around it rather than show itself.
 */
describe("times a source wrote badly", () => {
  it("shows an impossible date as the source wrote it, rather than throwing", () => {
    expect(fmt.dateTime("2026-99-99T99:99")).toBe("2026-99-99T99:99");
    expect(fmt.date("not a date")).toBe("not a date");
    expect(fmt.time("half past four")).toBe("half past four");
    expect(fmt.cell("2026-99-99T99:99", "datetime")).toBe("2026-99-99T99:99");
  });

  it("still formats a real time, and still says nothing for nothing", () => {
    expect(fmt.dateTime("2026-09-20T18:30:00Z")).toMatch(/2026/);
    expect(fmt.dateTime(undefined)).toBe("—");
    expect(fmt.dateTime("")).toBe("—");
    expect(fmt.date(null)).toBe("—");
  });
});

describe("field names made readable", () => {
  it("spells ID and IP in capitals as whole words only, where a letter with an accent is part of a word", () => {
    expect(humanize("ipVersion")).toBe("IP Version");
    expect(humanize("station_id")).toBe("Station ID");
    expect(humanize("éip")).toBe("Éip");
    expect(humanize("tipo")).toBe("Tipo");
    expect(humanize("zip")).toBe("Zip");
  });
});
