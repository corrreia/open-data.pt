import { writeFileSync } from "node:fs";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { kernelHarness, policy } from "./kernel-harness";

/**
 * The plan's phase 2 exit gate, run on demand: SCALE_ROWS=1000000 npx vitest run tests/scale.test.ts
 * It streams the rows lazily through the real collector, frame reader, engine and SQLite-backed
 * runner core, and samples the JavaScript heap. SQLite pages live outside the heap, as they do in
 * a Durable Object; the fake bucket keeps only chunk sizes so it does not dominate the measurement.
 */
const ROWS = Number(process.env.SCALE_ROWS ?? 0);

/** Live heap, not garbage awaiting collection: force a collection before each sample. */
function liveHeap(): number {
  setFlagsFromString("--expose-gc");
  // SAFETY: with --expose-gc set, a new context exposes V8's gc() as a zero-argument function.
  const collect = runInNewContext("gc") as () => void;
  collect();
  return process.memoryUsage().heapUsed;
}

describe.skipIf(ROWS === 0)("one large product at scale", () => {
  it(`collects ${ROWS} rows with bounded heap, then turns 1% changes into 1% revisions`, async () => {
    const h = await kernelHarness({ keepChunkBodies: false, keepLake: false, policy: policy({ timeoutSeconds: 3_600, maxRecords: ROWS + 10 }) });
    const record = (index: number, value: string) => ({ entityKey: `entity-${String(index).padStart(8, "0")}`, payload: { name: `Entity ${index}`, value, district: `D${index % 20}`, lat: 38 + (index % 1000) / 10_000, lon: -9 - (index % 700) / 10_000 } });
    let peak = 0;
    const baseline = liveHeap();
    const sampler = setInterval(() => { peak = Math.max(peak, liveHeap() - baseline); }, 250);
    const measure = async (value: (index: number) => string) => {
      h.source.generate = function* () { for (let index = 0; index < ROWS; index += 1) yield record(index, value(index)); };
      const puts = h.snapshots.chunkPuts().length;
      const started = Date.now();
      const outcome = await h.collect();
      return { outcome, seconds: (Date.now() - started) / 1000, chunkPuts: h.snapshots.chunkPuts().length - puts, peakHeapMiB: Math.round(peak / 1024 / 1024) };
    };
    try {
      const first = await measure(() => "v1");
      const firstPeak = first.peakHeapMiB;
      peak = 0;
      const second = await measure((index) => (index % 100 === 0 ? "v2" : "v1"));
      const report = { rows: ROWS, baseline: first, onePercent: second, lakeRows: h.lakeCount, manifestChunks: h.entry()?.rowCount === ROWS ? "all rows served" : h.entry()?.rowCount };
      console.log(JSON.stringify(report, null, 2));
      if (process.env.SCALE_REPORT) writeFileSync(process.env.SCALE_REPORT, JSON.stringify(report, null, 2));
      expect(first.outcome.revisions).toBe(ROWS);
      expect(second.outcome.revisions).toBe(ROWS / 100);
      expect(h.entry()?.rowCount).toBe(ROWS);
      expect(Math.max(firstPeak, second.peakHeapMiB)).toBeLessThan(64);
    } finally {
      clearInterval(sampler);
    }
  }, 1_800_000);
});
