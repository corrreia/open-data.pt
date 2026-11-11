import { describe, expect, it } from "vitest";
import { densify, Heights, Land, type Point, project, signedArea, simplify, stitchRings, unproject } from "../src/terrain/geometry.ts";

const SQUARE: Point[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe("stitchRings", () => {
  it("joins segments given in any order and direction into one ring", () => {
    const rings = stitchRings(
      [
        [
          [0, 0],
          [10, 0],
        ],
        [
          [0, 10],
          [10, 10],
        ],
        [
          [10, 0],
          [10, 5],
          [10, 10],
        ],
        [
          [0, 10],
          [0, 0],
        ],
      ],
      0.001,
    );
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
    expect(Math.abs(signedArea(rings[0] ?? []))).toBe(100);
  });

  it("leaves out a line that never closes", () => {
    expect(
      stitchRings(
        [
          [
            [0, 0],
            [10, 0],
          ],
          [
            [10, 0],
            [10, 10],
          ],
        ],
        0.001,
      ),
    ).toEqual([]);
  });
});

describe("simplify and densify", () => {
  it("drops points within the tolerance and keeps the ends and the corners", () => {
    expect(
      simplify(
        [
          [0, 0],
          [5, 0.01],
          [10, 0],
          [10, 10],
        ],
        0.1,
      ),
    ).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
  });

  it("leaves no two neighbours of a closed ring farther apart than the spacing", () => {
    const ring = densify(SQUARE, 3, true);
    expect(ring).toHaveLength(16);
    expect(Math.abs(signedArea(ring))).toBeCloseTo(100);
  });
});

describe("Land", () => {
  it("tells inside from outside, and a hole from the land around it", () => {
    const land = new Land([
      SQUARE,
      [
        [4, 4],
        [6, 4],
        [6, 6],
        [4, 6],
      ],
    ]);
    expect(land.has([1, 1])).toBe(true);
    expect(land.has([5, 5])).toBe(false);
    expect(land.has([11, 5])).toBe(false);
    expect(land.has([5, -1])).toBe(false);
  });
});

describe("Heights", () => {
  it("answers close to a measurement beside it and between measurements elsewhere", () => {
    const heights = new Heights();
    heights.add([0, 0], 0);
    heights.add([100, 0], 1000);
    expect(heights.at([100, 0.1])).toBeGreaterThan(990);
    expect(heights.at([50, 0])).toBeCloseTo(500);
    expect(heights.near([0.2, 0], 0.5)).toBe(true);
    expect(heights.near([2, 0], 0.5)).toBe(false);
  });
});

describe("project", () => {
  it("measures kilometres: Lisbon to Porto is about 274", () => {
    const lisbon = project([-9.1393, 38.7223]);
    const porto = project([-8.6291, 41.1579]);
    expect(Math.hypot(porto[0] - lisbon[0], porto[1] - lisbon[1])).toBeCloseTo(274, -1);
    expect(unproject(lisbon)[0]).toBeCloseTo(-9.1393);
    expect(unproject(lisbon)[1]).toBeCloseTo(38.7223);
  });
});
