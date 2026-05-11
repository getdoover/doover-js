import { expect } from "chai";
import { describe, it } from "mocha";

import { ProvenanceStamper, wrapSubclient } from "../client/provenance";

describe("ProvenanceStamper", () => {
  const stamper = new ProvenanceStamper({ id: "cloud", kind: "cloud", meta: { x: 1 } });

  it("stamps a plain object top-level", () => {
    const out = stamper.stampRest({ a: 1 }, { method: "x.y", request: { z: 2 }, startedAt: 0, durationMs: 5, status: 200 });
    expect(out).to.include({ a: 1 });
    expect(out.__source?.client.id).to.equal("cloud");
    expect(out.__source?.via).to.deep.include({ transport: "rest", method: "x.y", durationMs: 5, status: 200 });
  });

  it("stamps each element of an array", () => {
    const out = stamper.stampRest([{ a: 1 }, { a: 2 }], { method: "x.list", request: {}, startedAt: 0, durationMs: 1 });
    expect(out[0].__source?.client.kind).to.equal("cloud");
    expect(out[1].__source?.client.kind).to.equal("cloud");
  });

  it("stamps array-valued props one level deep (e.g. { results: [...] })", () => {
    const out = stamper.stampRest({ results: [{ a: 1 }], count: 1 }, { method: "x.batch", request: {}, startedAt: 0, durationMs: 1 });
    expect(out.__source?.client.id).to.equal("cloud");
    expect(out.results[0].__source?.client.id).to.equal("cloud");
  });

  it("leaves Blobs and primitives untouched", () => {
    const blob = new Blob(["x"]);
    expect(stamper.stampRest(blob, { method: "m", request: {}, startedAt: 0, durationMs: 1 })).to.equal(blob);
    expect(stamper.stampRest(undefined, { method: "m", request: {}, startedAt: 0, durationMs: 1 })).to.equal(undefined);
  });

  it("wrapSubclient stamps awaited results with subclient.method", async () => {
    const api = { thing: async () => ({ a: 1 }), sync: () => 42 };
    const wrapped = wrapSubclient(api, "channels", stamper);
    const r = await wrapped.thing();
    expect(r.__source?.via).to.include({ method: "channels.thing", transport: "rest" });
    expect(wrapped.sync()).to.equal(42); // sync passthrough
  });

  it("stampGatewayEvent stamps payload + nested aggregate/message", () => {
    const out = stamper.stampGatewayEvent(
      { author_id: "a", channel: { agent_id: "x", name: "c" }, aggregate: { data: {}, attachments: [] } },
      { event: "aggregateUpdate", sessionId: "s1" },
    );
    expect(out.__source?.via).to.deep.include({ transport: "gateway", event: "aggregateUpdate", sessionId: "s1" });
    expect(out.aggregate.__source?.via).to.deep.include({ transport: "gateway", event: "aggregateUpdate" });
  });
});
