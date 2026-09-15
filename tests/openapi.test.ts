import { readFileSync, readdirSync } from "node:fs";
import SwaggerParser from "@apidevtools/swagger-parser";
import { describe, expect, it } from "vitest";
import { openApiDocument, scalarReferenceHtml } from "../apps/kernel/src/openapi";
import { workerTopics } from "../tools/packages";

describe("public API contract", () => {
  it("is a valid OpenAPI document", async () => {
    const document = openApiDocument("https://open-data.pt");
    await expect(SwaggerParser.validate(document)).resolves.toBeDefined();
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths["/api/products"]).toBeDefined();
    expect(document.paths["/api/products/{slug}/events"]).toBeDefined();
    expect(document.paths["/api/products/{slug}/changes/range"]).toBeDefined();
    expect(document.paths["/api/products/{slug}/series/range"]).toBeDefined();
    for (const removed of ["/api/feeds/reconcile", "/api/catalog/baselines", "/api/feeds/{feedId}/late-records", "/api/transform-runs", "/api/feeds/{feedId}/transform-runs", "/api/usage", "/api/sync", "/api/policies", "/api/gatekeepers", "/api/feed-kinds", "/api/activity", "/api/feeds/{feedId}/acquisitions", "/api/feeds/{feedId}/backfill"]) expect(Object.keys(document.paths)).not.toContain(removed);
    expect(document.paths["/api/query"]).toBeUndefined();
    expect(document.paths["/api/products/{slug}/records/asof"]).toBeUndefined();
    expect(Object.keys(document.paths).some((path) => path.includes("artifact") || path.includes("replay"))).toBe(false);
    expect(Object.keys(document.paths).some((path) => path.includes("/v1/") || path.includes("/v2/"))).toBe(false);
  });

  it("documents a read-only API with its time queries and filters", () => {
    const document = openApiDocument("https://open-data.pt");
    const paths = Object.keys(document.paths);
    for (const path of ["/api", "/api/health", "/api/products/{slug}/series/changes/range"]) expect(paths).toContain(path);
    for (const removed of ["/api/bootstrap", "/api/config", "/api/feeds/{feedId}/collect", "/api/feeds/{feedId}/resume", "/api/feeds/{feedId}/enabled"]) expect(paths).not.toContain(removed);
    expect(new Set(Object.values(document.paths).flatMap((item) => Object.keys(item)))).toEqual(new Set(["get"]));
    expect(JSON.stringify(document)).not.toMatch(/operator|bearer/i);
    expect(document.paths["/api/products/{slug}/series/range"].get.parameters.map((parameter) => parameter.name)).toContain("knownAt");
    expect(document.paths["/api/products/{slug}/changes/range"].get.parameters.map((parameter) => parameter.name)).toContain("seriesKey");
    for (const path of ["/api/products/{slug}/records", "/api/products/{slug}.geojson"] as const) {
      expect(document.paths[path].get.parameters.map((parameter) => parameter.name)).toEqual(expect.arrayContaining(["where", "bbox"]));
    }
    expect(Object.keys(document.components.responses)).toContain("TooManyRequests");
    // Only the selected version is served; earlier ones live in the history endpoints.
    expect(document.paths["/api/products/{slug}/records"].get.parameters.map((parameter) => parameter.name)).not.toContain("version");
    expect(document.paths["/api/products"].get.responses["429"]).toEqual({ $ref: "#/components/responses/TooManyRequests" });
  });

  it("ships a static UI without push connections or timestamp cache busting", () => {
    const files = readdirSync("apps/site/src", { recursive: true, encoding: "utf8" }).filter((file) => /\.tsx?$/.test(file));
    expect(files.length).toBeGreaterThan(10);
    const source = files.map((file) => readFileSync(`apps/site/src/${file}`, "utf8")).join("\n");
    expect(source).not.toContain("new WebSocket");
    expect(source).not.toContain("/parties/");
    expect(source).not.toContain("_r=");
    expect(source).not.toContain("busted(");
    expect(source).not.toContain("transform-runs");
  });

  it("exposes no legacy transform or history RPC on Gatekeeper entrypoints", () => {
    const topics = workerTopics();
    expect(topics.length).toBeGreaterThan(0);
    for (const topic of topics) {
      const name = `gatekeeper-${topic}`;
      const index = readFileSync(`packages/${name}/src/index.ts`, "utf8");
      expect(index).not.toMatch(/async\s+transform\s*\(/);
      expect(index).not.toMatch(/async\s+collectHistory\s*\(/);
      const sources = readdirSync(`packages/${name}/src`).filter((file) => file.endsWith(".ts")).map((file) => readFileSync(`packages/${name}/src/${file}`, "utf8")).join("\n");
      expect(sources, name).toContain("collectNormalized");
    }
  });

  it("mounts Scalar against the published OpenAPI document", () => {
    const html = scalarReferenceHtml("test-nonce");
    expect(html).toContain("@scalar/api-reference@1.67.0");
    expect(html).toContain("url: '/openapi.json'");
    expect(html).toContain('nonce="test-nonce"');
  });
});
