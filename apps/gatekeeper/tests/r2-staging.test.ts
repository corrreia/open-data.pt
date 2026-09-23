import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";
import { jsonAs } from "./support";

// workerd, not Node: FixedLengthStream and R2's own MD5 exist only there.
const server = createTestHarness({
  workers: [
    {
      config: {
        name: "r2-staging-test",
        main: "apps/gatekeeper/tests/fixtures/r2-staging-worker.ts",
        compatibility_date: "2026-09-09",
        compatibility_flags: ["nodejs_compat"],
        r2_buckets: [{ binding: "STAGING", bucket_name: "test-only-staging" }],
      },
    },
  ],
});

beforeAll(async () => server.listen(), 60_000);
afterAll(async () => server.close(), 30_000);

interface Staged {
  digest: string;
  bytes: number;
  sha: string;
}

function document(size: number, marker: string): Uint8Array {
  const bytes = new Uint8Array(size).fill(0x20);
  bytes.set(new TextEncoder().encode(marker));
  return bytes;
}

async function stage(bytes: Uint8Array): Promise<Staged> {
  const response = await server.fetch("/", { method: "POST", body: bytes, headers: { "content-length": String(bytes.length) } });
  expect(response.status, await response.clone().text()).toBe(200);
  return jsonAs<Staged>(await response.text());
}

describe("R2 source staging in the Workers runtime", () => {
  it("streams a large body into R2, answers R2's MD5 and reads the same bytes back", async () => {
    const first = document(5 * 1024 * 1024, "[1]");
    const staged = await stage(first);
    expect(staged).toEqual({ digest: `md5:${createHash("md5").update(first).digest("hex")}`, bytes: first.length, sha: createHash("sha256").update(first).digest("hex") });
    expect((await stage(first)).digest).toBe(staged.digest);
    expect((await stage(document(5 * 1024 * 1024, "[2]"))).digest).not.toBe(staged.digest);
  }, 60_000);
});
