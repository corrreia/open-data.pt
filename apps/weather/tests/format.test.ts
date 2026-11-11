import { describe, expect, it } from "vitest";
import { decodeTerrain, decodeWater } from "../src/terrain/format.ts";

describe("decodeTerrain", () => {
  it("turns stored steps back into kilometres and metres, and splits points from borders", () => {
    const stored = new Uint16Array([0, 0, 0, 100, 200, 5000, 300, 400, 10]);
    const terrain = decodeTerrain({ bakedAt: "", west: -10, south: 20, stepKm: 0.01, stepMetres: 0.1, points: 2, rings: [2], borders: [1], sources: [] }, stored.buffer);
    expect([...terrain.points]).toEqual([-10, 20, 0, -9, 22, 500]);
    expect([...terrain.borders]).toEqual([-7, 24, 1]);
  });
});

describe("decodeWater", () => {
  it("reads every river line and then every lagoon outline, each by its own length", () => {
    const stored = new Uint16Array([0, 0, 100, 0, 100, 100, 200, 200, 300, 200, 300, 300]);
    const water = decodeWater({ bakedAt: "", west: 0, south: 0, stepKm: 0.01, rivers: [2, 1], lagoons: [3], sources: [] }, stored.buffer);
    expect(water.rivers).toEqual([
      [
        [0, 0],
        [1, 0],
      ],
      [[1, 1]],
    ]);
    expect(water.lagoons).toEqual([
      [
        [2, 2],
        [3, 2],
        [3, 3],
      ],
    ]);
  });
});
