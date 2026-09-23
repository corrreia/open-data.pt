import { describe, expect, it } from "vitest";
import { resourceTitle } from "#/formats/ckan/transform";

describe("CKAN resource titles", () => {
  it("drops a trailing file format, whatever separates it", () => {
    expect(resourceTitle("Ciclovias - GeoJSON")).toBe("Ciclovias");
    expect(resourceTitle("Estação de comboios - GeoJSON")).toBe("Estação de comboios");
    expect(resourceTitle("Horários – CSV")).toBe("Horários");
    expect(resourceTitle("Paragens: shapefile")).toBe("Paragens");
    expect(resourceTitle("Árvores | XLSX")).toBe("Árvores");
  });

  it("keeps names where the format is part of the words, or is all there is", () => {
    expect(resourceTitle("Inventário Arbóreo")).toBe("Inventário Arbóreo");
    expect(resourceTitle("GeoJSON das praias")).toBe("GeoJSON das praias");
    expect(resourceTitle("API de estacionamento")).toBe("API de estacionamento");
    expect(resourceTitle("GeoJSON")).toBe("GeoJSON");
  });
});
