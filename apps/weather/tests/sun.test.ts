import { describe, expect, it } from "vitest";
import { sunPosition } from "../src/sun.ts";

describe("sunPosition", () => {
  it("stands due south at its highest over Lisbon at the June solstice's solar noon", () => {
    // Solar noon in Lisbon on 2026-06-21 is 12:38 UTC; the sun's height then is 90° − 38.72° + 23.44°.
    const { elevation, azimuth } = sunPosition(new Date("2026-06-21T12:38:00Z"), -9.14, 38.72);
    expect(elevation).toBeCloseTo(74.7, 0);
    expect(Math.abs(azimuth - 180)).toBeLessThan(3);
  });

  it("is below the horizon at midnight and rises in the east", () => {
    expect(sunPosition(new Date("2026-11-11T00:00:00Z"), -9.14, 38.72).elevation).toBeLessThan(-40);
    const morning = sunPosition(new Date("2026-11-11T08:00:00Z"), -9.14, 38.72);
    expect(morning.elevation).toBeGreaterThan(0);
    expect(morning.azimuth).toBeGreaterThan(90);
    expect(morning.azimuth).toBeLessThan(150);
  });
});
