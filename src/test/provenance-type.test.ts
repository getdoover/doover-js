import { expect } from "chai";
import { describe, it } from "mocha";

import type { SourceProvenance } from "../types/provenance";
import type { Aggregate } from "../types/common";

describe("SourceProvenance", () => {
  it("is structurally usable on existing data shapes (compile-time)", () => {
    const prov: SourceProvenance = {
      client: { id: "cloud", kind: "cloud" },
      retrievedAt: Date.now(),
      via: { transport: "rest", method: "aggregates.getAggregate", request: {}, startedAt: 0, durationMs: 1 },
    };
    const agg: Aggregate = { data: {}, attachments: [], __source: prov };
    expect(agg.__source?.client.kind).to.equal("cloud");
  });
});
