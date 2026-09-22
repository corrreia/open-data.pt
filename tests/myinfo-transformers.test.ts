import { describe, expect, it } from "vitest";
import type { CanonicalRecord, ProductBuild, UnstampedResult } from "@open-data-pt/gatekeeper";
import { myInfoCollector, myInfoOperators } from "../apps/gatekeeper/src/sources/myinfo/collector";
import type { MyInfoDocument } from "../apps/gatekeeper/src/sources/myinfo/myinfo";
import { MyInfoTransformer } from "../apps/gatekeeper/src/sources/myinfo/transform";

const transformer = new MyInfoTransformer();

function run(document: MyInfoDocument): UnstampedResult {
  return transformer.transform(new TextEncoder().encode(JSON.stringify(document)));
}

function product(result: UnstampedResult, key: string): ProductBuild {
  const found = result.products.find((candidate) => candidate.productKey === key);
  if (!found) throw new Error(`No ${key} product`);
  return found;
}

function records(result: UnstampedResult, key: string): CanonicalRecord[] {
  const found = product(result, key);
  if (found.kind !== "record") throw new Error(`${key} is not a record product`);
  return found.records;
}

const NETWORK: MyInfoDocument = {
  feed: "network",
  operator: "BarraqueiroOeste",
  stops: [
    { stopId: "52582", stopCode: "41840", zoneId: "4491", name: "A.P.E.C.I.", longitude: -9.21006667, latitude: 39.05560556, lineKeys: ["55417|GOING", "55417|RETURN"] },
    { stopId: "52612", stopCode: "41604", zoneId: "4410", name: "Aboboreira, Lrg. Santo António", longitude: -9.29645167, latitude: 39.02242667, lineKeys: ["55417|GOING"] },
    { stopId: "99999", stopCode: null, zoneId: "4384", name: "Torres Vedras, Terminal", longitude: null, latitude: null, lineKeys: [] },
  ],
  lines: [
    { key: "55417|GOING", lineId: "55417", code: "720", name: "Torres Vedras - Venda do Pinheiro (Via Runa)", direction: "GOING" },
    { key: "55417|RETURN", lineId: "55417", code: "720", name: "Venda do Pinheiro - Torres Vedras (Via Runa)", direction: "RETURN" },
  ],
  zones: [
    { id: "4491", name: "A.P.E.C.I." },
    { id: "4384", name: "TORRES VEDRAS" },
  ],
};

const TRIPS = [
  { departure: "06:42", arrival: "07:05", duration: "00:23", routes: ["240"], transfer: null, frequency: "Dias úteis" },
  { departure: "7:32", arrival: "08:05", duration: "00:33", routes: ["243", "717"], transfer: "Casal Torre/7:52", frequency: "Dias úteis" },
  { departure: "09:13", arrival: "10:37", duration: "01:24", routes: ["221"], transfer: null, frequency: "Sábados" },
];

const TIMETABLE: MyInfoDocument = {
  feed: "timetable",
  operator: "BarraqueiroOeste",
  origin: { id: "4384", name: "TORRES VEDRAS" },
  destination: { id: "4325", name: "LISBOA" },
  trips: TRIPS,
};

describe("MYINFO transformer", () => {
  it("builds a stop table and a line table, each naming its own values once", () => {
    const result = run(NETWORK);
    expect(result.products.map((each) => [each.productKey, each.slug, each.role, each.updateMode])).toEqual([
      ["stops", "barraqueirooeste-stops", "reference", "authoritative-snapshot"],
      ["lines", "barraqueirooeste-lines", "reference", "authoritative-snapshot"],
    ]);
    // A stop keeps the keys of the lines calling there; their numbers and names are the line table's.
    const stopFields = product(result, "stops").schema.fields.map((each) => each.id);
    expect(stopFields).toEqual(["id", "code", "name", "zoneId", "zoneName", "latitude", "longitude", "lines"]);
    expect(stopFields).not.toContain("lineName");
  });

  it("gives every stop its position, its code, and the place a journey search calls it", () => {
    const stops = records(run(NETWORK), "stops");
    expect(stops[0]).toEqual({
      entityKey: "52582",
      payload: {
        id: "52582",
        code: "41840",
        name: "A.P.E.C.I.",
        zoneId: "4491",
        zoneName: "A.P.E.C.I.",
        latitude: 39.05560556,
        longitude: -9.21006667,
        lines: ["55417|GOING", "55417|RETURN"],
      },
    });
    // The portal leaves a stop's own zone name null; the journey search is where it is written.
    expect(stops[1]?.payload).toMatchObject({ zoneName: null, code: "41604" });
    expect(stops[2]?.payload).toMatchObject({ zoneName: "TORRES VEDRAS", code: null, latitude: null, longitude: null, lines: [] });
  });

  it("counts the stops each line calls at, which no stop states", () => {
    const lines = records(run(NETWORK), "lines");
    expect(lines).toEqual([
      {
        entityKey: "55417|GOING",
        payload: { id: "55417|GOING", lineId: "55417", code: "720", name: "Torres Vedras - Venda do Pinheiro (Via Runa)", direction: "outward", stops: 2 },
      },
      {
        entityKey: "55417|RETURN",
        payload: { id: "55417|RETURN", lineId: "55417", code: "720", name: "Venda do Pinheiro - Torres Vedras (Via Runa)", direction: "return", stops: 1 },
      },
    ]);
  });

  it("builds one departure table for the two places, named after them", () => {
    const result = run(TIMETABLE);
    const departures = product(result, "departures");
    expect(departures.slug).toBe("barraqueirooeste-torres-vedras-lisboa-departures");
    expect(departures.title).toBe("TORRES VEDRAS to LISBOA departures");
    // A search answers for one day, so it can add and correct departures but never retract them.
    expect(departures.updateMode).toBe("partial-snapshot");
    expect(departures.completeness).toBe("partial");
    expect(departures.schema.fields.map((each) => each.id)).toEqual(["id", "departure", "arrival", "minutes", "lines", "transfer", "days"]);
    expect(departures.schema.fields.find((each) => each.id === "minutes")?.unit).toBe("min");
  });

  it("identifies a departure by the days it runs, the time it leaves and the lines it uses", () => {
    const departures = records(run(TIMETABLE), "departures");
    expect(departures.map((each) => each.entityKey)).toEqual(["Dias úteis|06:42|240", "Dias úteis|07:32|243+717", "Sábados|09:13|221"]);
    expect(departures[0]?.payload).toEqual({
      id: "Dias úteis|06:42|240",
      departure: "06:42",
      arrival: "07:05",
      minutes: 23,
      lines: ["240"],
      transfer: null,
      days: "Dias úteis",
    });
    expect(departures[1]?.payload).toMatchObject({ departure: "07:32", minutes: 33, lines: ["243", "717"], transfer: "Casal Torre/7:52" });
    expect(departures[2]?.payload).toMatchObject({ minutes: 84, days: "Sábados" });
    // A collection is not an event: a timetable row carries no clock of its own.
    expect(departures.every((each) => each.eventTime === undefined)).toBe(true);
  });

  it("keeps one row for a journey the portal listed twice, and counts what it left out", () => {
    const result = run({ ...TIMETABLE, feed: "timetable", trips: [...TRIPS, TRIPS[0]!] });
    expect(records(result, "departures")).toHaveLength(3);
    expect(result.quality).toEqual({ acceptedRecords: 3, rejectedRecords: 1 });
  });

  it("leaves out a row it cannot read, and a whole document it cannot recognize", () => {
    const broken = { departure: "soon", arrival: "07:05", duration: "00:23", routes: ["240"], transfer: null, frequency: "Dias úteis" };
    expect(run({ ...TIMETABLE, feed: "timetable", trips: [broken] }).quality).toEqual({ acceptedRecords: 0, rejectedRecords: 1 });
    expect(() => transformer.transform(new TextEncoder().encode('{"feed":"prices","operator":"mare"}'))).toThrow(/Unsupported MYINFO feed/);
    expect(() => transformer.transform(new TextEncoder().encode('{"operator":"mare"}'))).toThrow(/feed and operator/);
  });

  it("normalizes the same document into the same products, whenever it is normalized", () => {
    expect(run(NETWORK)).toEqual(run(NETWORK));
    expect(run(TIMETABLE)).toEqual(run(TIMETABLE));
  });
});

describe("MYINFO collector", () => {
  it("reads the operators a Worker allows, ignoring blanks and spacing", () => {
    expect([...myInfoOperators(" BarraqueiroOeste , mare ,, ")]).toEqual(["BarraqueiroOeste", "mare"]);
  });

  it("claims no history, because the portals publish none", async () => {
    const collector = myInfoCollector({
      config: { feed: "network", operator: "mare" },
      apiOrigin: "https://myinfo.4cloud.pt",
      operators: "mare",
      fetcher: () => {
        throw new Error("no request expected");
      },
    });
    expect(collector.normalizer).toEqual({ id: "myinfo-portal", version: "1" });
    await expect(async () => collector.source(undefined, { kind: "history", cursor: { before: "2026-01-01T00:00:00.000Z" } }, new AbortController().signal)).rejects.toThrow(
      /no historical timetables/,
    );
  });
});
