import { describe, expect, it } from "vitest";
import { colourOn, css, type Scale, uvName } from "../src/scales.ts";
import { regionOf } from "../src/regions.ts";

const SCALE: Scale = [
  [0, 0x000000],
  [10, 0xff8040],
];

describe("colourOn", () => {
  it("blends between the steps either side of a value and holds the ends beyond them", () => {
    expect(css(colourOn(SCALE, 5))).toBe("#804020");
    expect(colourOn(SCALE, -3)).toBe(0x000000);
    expect(colourOn(SCALE, 40)).toBe(0xff8040);
  });
});

describe("uvName", () => {
  it("names the index by the World Health Organization's classes", () => {
    expect([1, 3, 6, 8, 11].map(uvName)).toEqual(["baixo", "moderado", "elevado", "muito elevado", "extremo"]);
  });
});

describe("regionOf", () => {
  it("puts Lisbon on the mainland, Funchal in Madeira and Ponta Delgada in the Azores", () => {
    expect([-9.14, -16.9, -25.67].map(regionOf)).toEqual(["Continente", "Madeira", "Açores"]);
  });
});
