import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generatedFiles, workerTopics } from "../tools/packages";

describe("generated Worker lists", () => {
  it.each(generatedFiles().map((file) => file.label))("%s matches tools/packages.ts", (label) => {
    const file = generatedFiles().find((candidate) => candidate.label === label)!;
    expect(readFileSync(file.path, "utf8"), `run \`pnpm packages:sync\``).toBe(file.expected);
  });

  it("names one Worker per catalog topic", () => {
    expect(workerTopics()).toEqual(["cities", "economy", "energy", "environment", "government", "health", "mobility", "society", "telecom"]);
  });
});
