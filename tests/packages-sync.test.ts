import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generatedFiles, loadLibraries, stalePackages, workerPackages } from "../tools/packages";

const FILES = await generatedFiles();

describe("generated Workers and the lists that name them", () => {
  it.each(FILES.map((file) => file.label))("%s matches tools/packages.ts", (label) => {
    const file = FILES.find((candidate) => candidate.label === label)!;
    expect(readFileSync(file.path, "utf8"), "run `pnpm packages:sync`").toBe(file.expected);
  });

  it("has a Worker package for every cleared library, and no other", async () => {
    expect(await stalePackages()).toEqual([]);
    const libraries = new Set((await loadLibraries()).map((library) => library.source));
    expect(workerPackages().filter((name) => !libraries.has(name))).toEqual([]);
  });

  it("runs under plain Node, which strips types but cannot run TypeScript-only syntax", () => {
    const result = spawnSync(process.execPath, ["tools/packages.ts", "--check"], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  }, 120_000);
});
