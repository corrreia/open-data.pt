import { describe, expect, it } from "vitest";
import { initials } from "../src/lib/publisher-mark";

describe("a publisher's mark", () => {
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
