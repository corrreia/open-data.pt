import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PUBLISHERS } from "@open-data-pt/gatekeeper/catalog";
import { initials } from "../apps/site/src/lib/publisher-mark";

/** Every publisher is a folder here, with their mark beside their `index.ts` as `logo.<ext>`. */
const FOLDERS = new URL("../apps/gatekeeper/src/publishers/", import.meta.url);

/** A mark by the name the site serves it under, `<key>.<ext>`, and where it is in the key's folder. */
const markPath = (file: string) => {
  const dot = file.lastIndexOf(".");
  return new URL(`${file.slice(0, dot)}/logo${file.slice(dot)}`, FOLDERS);
};

/** What a publisher's `PUBLISHER` claims is on disk. */
const claimed = new Map([...PUBLISHERS].filter(([, publisher]) => publisher.logo !== undefined).map(([key, publisher]) => [`${key}.${publisher.logo ?? ""}`, key]));

/** A mark's drawn size: a PNG says so in its header, an SVG in its viewBox. */
function drawnSize(file: string) {
  const bytes = readFileSync(markPath(file));
  if (file.endsWith(".png")) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  const head = bytes.toString("utf8", 0, 6000);
  const box = head.match(/viewBox\s*=\s*["']\s*([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)/);
  if (box?.[3] && box[4]) return { width: Number(box[3]), height: Number(box[4]) };
  const width = head.match(/width\s*=\s*["']([\d.]+)/);
  const height = head.match(/height\s*=\s*["']([\d.]+)/);
  return { width: Number(width?.[1] ?? 0), height: Number(height?.[1] ?? 0) };
}

/** Every mark on disk, as `<key>.<ext>`: a folder's `logo.*`, whatever its `PUBLISHER` says. */
const files = readdirSync(FOLDERS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((folder) =>
    readdirSync(new URL(`${folder.name}/`, FOLDERS))
      .filter((name) => name.startsWith("logo."))
      .map((name) => `${folder.name}${name.slice("logo".length)}`),
  );

describe("publisher logos", () => {
  it("names only files that exist, and every file is named", () => {
    expect(files.filter((file) => !claimed.has(file)).sort()).toEqual([]);
    expect([...claimed.keys()].filter((file) => !files.includes(file)).sort()).toEqual([]);
  });

  it("keeps every mark small enough to ship with the page", () => {
    expect(files.filter((file) => readFileSync(markPath(file)).byteLength > 48_000)).toEqual([]);
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
      const text = readFileSync(markPath(file), "utf8");
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
