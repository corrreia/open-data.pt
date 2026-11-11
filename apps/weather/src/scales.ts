/** Colour scales: a value to a colour, between named steps. */

export type Scale = readonly (readonly [value: number, colour: number])[];

/** The colour a value has on a scale, as 0xRRGGBB, blended between the steps either side of it. */
export function colourOn(scale: Scale, value: number): number {
  let below = scale[0] ?? [0, 0];
  for (const above of scale) {
    if (value <= above[0]) {
      const share = above[0] === below[0] ? 0 : (value - below[0]) / (above[0] - below[0]);
      const blend = (shift: number): number => Math.round(((below[1] >> shift) & 255) + (((above[1] >> shift) & 255) - ((below[1] >> shift) & 255)) * share);
      return (blend(16) << 16) | (blend(8) << 8) | blend(0);
    }
    below = above;
  }
  return below[1];
}

export const css = (colour: number): string => `#${colour.toString(16).padStart(6, "0")}`;

/** A scale as a strip of colour for a key, each step the same width whatever its value. */
export const strip = (scale: Scale): string => `linear-gradient(90deg, ${scale.map(([, colour]) => css(colour)).join(", ")})`;

export const TEMPERATURE: Scale = [
  [-5, 0x3b5a9a],
  [4, 0x6fa3cc],
  [11, 0xb7d6c8],
  [17, 0xf3ecc0],
  [23, 0xf2c06d],
  [30, 0xe2793f],
  [38, 0xb5342c],
  [44, 0x6b1a2c],
];

/** Dry is the colour of dry land on the map; rain goes through blue to the purple of a downpour. */
export const RAIN: Scale = [
  [0, 0xeeead8],
  [0.2, 0xcfe3e6],
  [1, 0x93c4e0],
  [4, 0x4f93cf],
  [10, 0x3560b5],
  [25, 0x5a3c9c],
  [50, 0x7d2070],
];

export const HUMIDITY: Scale = [
  [20, 0xdca55c],
  [40, 0xf0e8c4],
  [60, 0xb9d8c9],
  [80, 0x6fadcb],
  [100, 0x2f62a6],
];

export const WIND: Scale = [
  [0, 0xeef0e6],
  [10, 0xcfe6d4],
  [25, 0x8fcfb2],
  [45, 0xf1c453],
  [70, 0xe5683c],
  [100, 0x9c1f4f],
];

export const PRESSURE: Scale = [
  [985, 0x6a4c9c],
  [1000, 0x7fa6d6],
  [1013, 0xf0ecd6],
  [1025, 0xf0b96a],
  [1040, 0xc9562f],
];

/** Night and deep cloud are slate; full summer sun on the ground is about 3,600 kJ/m² in an hour. */
export const RADIATION: Scale = [
  [0, 0x8a97a3],
  [300, 0xb9c0bb],
  [900, 0xe9e2b5],
  [1800, 0xf5cf6c],
  [2700, 0xf2a044],
  [3600, 0xe25b2e],
];

/** The UV index as the World Health Organization colours it: low, moderate, high, very high, extreme. */
export function uvColour(index: number): number {
  return index < 3 ? 0x5aa84a : index < 6 ? 0xf2c200 : index < 8 ? 0xf07f13 : index < 11 ? 0xc8281f : 0x7b3794;
}

/** The ink that reads on the UV colour of an index. */
export const uvInk = (index: number): string => (index < 8 ? INK.dark : INK.light);

export function uvName(index: number): string {
  return index < 3 ? "baixo" : index < 6 ? "moderado" : index < 8 ? "elevado" : index < 11 ? "muito elevado" : "extremo";
}

/** IPMA's five classes of rural fire danger, 1 to 5, in the colours its own map uses. */
export const FIRE_COLOURS = [0x9a9a9a, 0x5aa84a, 0xf2e23a, 0xf07f13, 0xc8281f, 0x7a1414];

/** The ink that reads on a filled colour: dark on the light ones, white on the dark. */
export const INK = { dark: "#14212a", light: "#ffffff" };

/** IPMA's warning levels above green, mildest first, each with the ink that reads on it. */
export const WARNING_LEVELS = new Map([
  ["yellow", { colour: 0xf2c200, name: "Amarelo", ink: INK.dark }],
  ["orange", { colour: 0xf07f13, name: "Laranja", ink: INK.dark }],
  ["red", { colour: 0xc8281f, name: "Vermelho", ink: INK.light }],
]);
