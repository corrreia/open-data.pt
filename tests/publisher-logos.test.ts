import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PUBLISHERS, initials } from "@open-data-pt/catalog";

const DIRECTORY = new URL("../packages/catalog/publishers/", import.meta.url);

/** What a publisher's key claims is on disk, from the vocabulary. */
const claimed = new Map(
  Object.entries(PUBLISHERS)
    .filter(([, publisher]) => "logo" in publisher)
    .map(([key, publisher]) => [`${key}.${"logo" in publisher ? publisher.logo : ""}`, key]),
);

/** A mark's drawn size: a PNG says so in its header, an SVG in its viewBox. */
function drawnSize(file: string) {
  const bytes = readFileSync(new URL(file, DIRECTORY));
  if (file.endsWith(".png")) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  const head = bytes.toString("utf8", 0, 6000);
  const box = head.match(/viewBox\s*=\s*["']\s*([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)/);
  if (box?.[3] && box[4]) return { width: Number(box[3]), height: Number(box[4]) };
  const width = head.match(/width\s*=\s*["']([\d.]+)/);
  const height = head.match(/height\s*=\s*["']([\d.]+)/);
  return { width: Number(width?.[1] ?? 0), height: Number(height?.[1] ?? 0) };
}

const files = readdirSync(DIRECTORY).filter((name) => name !== "README.md");

describe("publisher logos", () => {
  it("names only files that exist, and every file is named", () => {
    expect(files.filter((file) => !claimed.has(file)).sort()).toEqual([]);
    expect([...claimed.keys()].filter((file) => !files.includes(file)).sort()).toEqual([]);
  });

  it("keeps every mark small enough to ship with the page", () => {
    expect(files.filter((file) => readFileSync(new URL(file, DIRECTORY)).byteLength > 48_000)).toEqual([]);
  });

  it("keeps every mark inside the shape the tile can draw", () => {
    // The tile is one height and at most 2.6 times as wide; past about eight to one
    // a wordmark is a smudge on it, and the publisher's initials read better.
    const unusable = files.filter((file) => {
      const { width, height } = drawnSize(file);
      return !(width > 0 && height > 0) || width / height > 8;
    });
    expect(unusable).toEqual([]);
  });

  it("draws every mark from this site alone, contacting nobody", () => {
    const external = files.filter((file) => {
      if (!file.endsWith(".svg")) return false;
      const text = readFileSync(new URL(file, DIRECTORY), "utf8");
      // An `xmlns` is a name, not an address a browser fetches; anything else is a request to a third party.
      return /(?:href|src|url\()\s*=?\s*["'(]?https?:/i.test(text);
    });
    expect(external).toEqual([]);
  });

  it("stands a publisher's initials in for the mark we do not have", () => {
    expect(initials("IPMA · Instituto Português do Mar e da Atmosfera")).toBe("IPMA");
    expect(initials("SNS Transparência")).toBe("SNS");
    expect(initials("CP")).toBe("CP");
    expect(initials("Câmara Municipal de Lisboa")).toBe("L");
    expect(initials("Banco de Portugal")).toBe("BP");
    expect(initials("Metro do Porto")).toBe("MP");
    expect(initials("Bora")).toBe("B");
    expect(initials("Maré")).toBe("M");
  });
});
