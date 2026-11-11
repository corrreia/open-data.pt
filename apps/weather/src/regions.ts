/** IPMA says a value is missing in more than one way. */
export const known = (value: number | null | undefined): value is number => value !== null && value !== undefined;

export const REGIONS = ["Continente", "Madeira", "Açores"] as const;
export type Region = (typeof REGIONS)[number];

/** Which part of the country a place is in, by where it lies: the archipelagos are far out in the Atlantic. */
export function regionOf(longitude: number): Region {
  return longitude < -20 ? "Açores" : longitude < -12 ? "Madeira" : "Continente";
}
