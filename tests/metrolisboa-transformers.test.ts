import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { JsonObject, JsonValue, TransformContext } from "@open-data-pt/gatekeeper-shared";
import { METRO_FEEDS } from "../packages/gatekeeper-shared/src/sources/metrolisboa/metrolisboa";
import { MetroLisboaTransformer, bracketList, intervalSeconds, metroTimestamp } from "../packages/gatekeeper-shared/src/sources/metrolisboa/transform";
import { jsonAs } from "./support";

const transformer = new MetroLisboaTransformer();

/** A real answer's `resposta`, as captured on 2026-09-14. */
function resposta(name: string): JsonValue {
  return jsonAs<JsonObject>(readFileSync(new URL(`./fixtures/metrolisboa/${name}.json`, import.meta.url), "utf8")).resposta ?? null;
}

function document(value: JsonObject): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function context(feed: keyof typeof METRO_FEEDS, observedAt = "2026-09-14T08:00:00.000Z"): TransformContext {
  return { feed: { id: "feed_test", slug: feed, title: feed, description: feed, config: { feed }, semantics: METRO_FEEDS[feed].semantics }, observedAt };
}

function normalize(value: JsonObject, feed: keyof typeof METRO_FEEDS) {
  return transformer.transform(document(value), context(feed));
}

describe("Metro Lisboa normalizer", () => {
  it("reads the four lines' status, trimmed, with the operator's short state as written", () => {
    const result = normalize({ feed: "line-status", status: resposta("line-status") }, "line-status");
    const product = result.products[0];
    expect(product).toMatchObject({ productKey: "line-status", role: "current-state", updateMode: "authoritative-snapshot", completeness: "complete" });
    expect(product?.records?.map((record) => record.entityKey)).toEqual(["amarela", "azul", "verde", "vermelha"]);
    expect(product?.records?.[0]).toEqual({
      entityKey: "amarela",
      payload: { id: "amarela", line: "Amarela", status: "Ok", shortStatus: "normal", messageType: "0" },
    });
    // No source clock: the status is never dated by the poll.
    expect(product?.records?.every((record) => record.eventTime === undefined)).toBe(true);
  });

  it("reports a line closed for the night as closed, not as disrupted", () => {
    // As served at 01:30 Lisbon time on 2026-09-14.
    const status = {
      amarela: " Ok",
      azul: " Ok",
      verde: " Ok",
      vermelha: " Ok",
      tipo_msg_am: "0",
      tipo_msg_az: "0",
      tipo_msg_vd: "0",
      tipo_msg_vm: "0",
      azul_curta: "encerrada",
      amarela_curta: "encerrada",
      verde_curta: "encerrada",
      vermelha_curta: "encerrada",
    };
    const records = normalize({ feed: "line-status", status }, "line-status").products[0]?.records;
    expect(records?.map((record) => record.payload.shortStatus)).toEqual(["encerrada", "encerrada", "encerrada", "encerrada"]);
    expect(records?.every((record) => record.payload.status === "Ok" && !("normal" in record.payload))).toBe(true);
  });

  it("keeps a disruption's message, short state and message type", () => {
    const status = {
      amarela: " Circulação interrompida entre Rato e Marquês de Pombal.",
      amarela_curta: "perturbacao",
      tipo_msg_am: "2",
      azul: " Ok",
      azul_curta: "normal",
      tipo_msg_az: "0",
      verde: " Ok",
      verde_curta: "normal",
      tipo_msg_vd: "0",
      vermelha: " Ok",
      vermelha_curta: "normal",
      tipo_msg_vm: "0",
    };
    const record = normalize({ feed: "line-status", status }, "line-status").products[0]?.records?.[0];
    expect(record?.payload).toMatchObject({ status: "Circulação interrompida entre Rato e Marquês de Pombal.", shortStatus: "perturbacao", messageType: "2" });
  });

  it("turns every platform's next trains into one record dated by the operator's own clock, with its destination's name", () => {
    const waiting = resposta("waiting-times");
    const result = normalize({ feed: "waiting-times", waiting, destinations: resposta("destinations") }, "waiting-times");
    const product = result.products[0];
    expect(Array.isArray(waiting) && product?.records?.length).toBe(Array.isArray(waiting) ? waiting.length : -1);
    expect(result.quality.rejectedRecords).toBe(0);
    const first = product?.records?.find((record) => record.entityKey === "AL4RMO");
    expect(first).toMatchObject({
      eventTime: "2026-09-13T23:39:53.000Z",
      payload: {
        platform: "AL4RMO",
        stationId: "RM",
        train1: "21C",
        arrival1Seconds: 413,
        train2: "23C",
        arrival2Seconds: 1524,
        train3: "24C",
        arrival3Seconds: 2078,
        destinationId: "54",
        leavingService: false,
        units: 1,
      },
    });
    expect(first?.payload.destinationName).toEqual(expect.any(String));
    expect(product?.watermark).toBe(
      product?.records
        ?.map((record) => record.eventTime ?? "")
        .sort()
        .at(-1),
    );
  });

  it("rejects malformed and repeated platforms, keeps an unknown destination without a name, and reads missing trailing trains as empty", () => {
    const waiting = [
      { stop_id: "CG", cais: "P1", hora: "20260914120000", comboio: "1C", tempoChegada1: "90", destino: "999", sairServico: "1", UT: 2 },
      { stop_id: "CG", cais: "P1", hora: "20260914120000", comboio: "2C", tempoChegada1: 10, destino: "33" },
      { stop_id: "CG", hora: "20260914120000", comboio: "3C", tempoChegada1: 10 },
      { stop_id: "CG", cais: "P2", hora: "not a time", comboio: "4C", tempoChegada1: 10 },
      "not an object",
    ];
    const result = normalize({ feed: "waiting-times", waiting, destinations: [{ id_destino: "33", nome_destino: "Reboleira" }] }, "waiting-times");
    expect(result.quality).toEqual({ acceptedRecords: 1, rejectedRecords: 4 });
    expect(result.products[0]?.records?.[0]?.payload).toMatchObject({
      train1: "1C",
      arrival1Seconds: 90,
      train2: null,
      arrival2Seconds: null,
      destinationId: "999",
      destinationName: null,
      leavingService: true,
      units: 2,
    });
  });

  it("reads the empty list served outside service hours as a complete, empty snapshot", () => {
    const product = normalize({ feed: "waiting-times", waiting: [], destinations: [] }, "waiting-times").products[0];
    expect(product).toMatchObject({ records: [], completeness: "complete", updateMode: "authoritative-snapshot" });
    expect(product?.watermark).toBeUndefined();
  });

  it("converts Lisbon wall-clock times to UTC on both sides of the daylight-saving changes", () => {
    expect(metroTimestamp("20260914003953")).toBe("2026-09-13T23:39:53.000Z");
    expect(metroTimestamp("20260115120000")).toBe("2026-01-15T12:00:00.000Z");
    expect(metroTimestamp("20261024230000")).toBe("2026-10-24T22:00:00.000Z");
    expect(metroTimestamp("20261025120000")).toBe("2026-10-25T12:00:00.000Z");
    expect(metroTimestamp("20260329120000")).toBe("2026-03-29T11:00:00.000Z");
    for (const bad of ["20260230120000", "20260914250000", "2026091400395", "", undefined]) expect(metroTimestamp(bad)).toBeUndefined();
  });

  it("reads stations' coordinates as numbers and their bracketed lists as lists", () => {
    const result = normalize({ feed: "stations", stations: resposta("stations") }, "stations");
    const alameda = result.products[0]?.records?.find((record) => record.entityKey === "AM");
    expect(alameda?.payload).toMatchObject({ name: "Alameda", latitude: 38.7373, longitude: -9.13409, lines: ["Verde", "Vermelha"], zone: "L" });
    expect(alameda?.payload.urls).toHaveLength(2);
    expect(result.products[0]?.schema.fields.filter((field) => field.type === "latitude" || field.type === "longitude")).toHaveLength(2);
    expect(bracketList("[Azul]")).toEqual(["Azul"]);
    expect(bracketList("[]")).toEqual([]);
    const bad = normalize({ feed: "stations", stations: [{ stop_id: "XX", stop_name: "Nowhere", stop_lat: "91", stop_lon: "0" }] }, "stations");
    expect(bad.quality.rejectedRecords).toBe(1);
  });

  it("reads each headway band with its interval in seconds, keyed by line, day type and start", () => {
    const rows = resposta("headways-amarela-S");
    const result = normalize({ feed: "headways", headways: [{ line: "amarela", day: "S", rows }] }, "headways");
    const first = result.products[0]?.records?.[0];
    expect(first).toEqual({
      entityKey: "amarela:S:06:30:00",
      payload: {
        id: "amarela:S:06:30:00",
        line: "Amarela",
        lineId: "amarela",
        dayType: "weekday",
        start: "06:30:00",
        end: "07:14:59",
        interval: "07:30:00",
        intervalSeconds: 450,
        units: 2,
      },
    });
    expect(intervalSeconds("04:05:00")).toBe(245);
    expect(intervalSeconds("4:75:00")).toBeUndefined();
    expect(() => normalize({ feed: "headways", headways: [{ line: "rosa", day: "S", rows: [] }] }, "headways")).toThrow(/unknown line/);
  });

  it("is deterministic and independent of when it runs", () => {
    const value = { feed: "waiting-times", waiting: resposta("waiting-times"), destinations: resposta("destinations") };
    const early = transformer.transform(document(value), context("waiting-times", "2026-09-14T00:00:00.000Z"));
    const late = transformer.transform(document(value), context("waiting-times", "2026-09-15T12:00:00.000Z"));
    expect(late).toEqual(early);
  });
});
