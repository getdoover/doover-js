import { expect } from "chai";
import { describe, it } from "mocha";

import * as doover from "../index";
import type { DataClient, AgentScope, DataClientStatus, SourceProvenance } from "../index";

describe("public exports (Phase 1–3)", () => {
  it("exports LocalAgentClient", () => {
    expect(doover.LocalAgentClient).to.be.a("function");
  });

  it("exports MultiplexClient", () => {
    expect(doover.MultiplexClient).to.be.a("function");
  });

  it("exports the new capability/contract symbols", () => {
    expect(doover.ALL_CAPABILITIES).to.be.an("array");
    expect(doover.UnsupportedCapabilityError).to.be.a("function");
    expect(doover.AmbiguousWriteError).to.be.a("function");
  });

  it("type-only exports resolve (compile-time)", () => {
    // If any of these types are removed from the public index the import above
    // will fail at typecheck time (tsc --noEmit), catching broken type exports.
    const _prov: SourceProvenance = {
      client: { id: "cloud", kind: "cloud" },
      retrievedAt: 0,
      via: { transport: "rest", method: "test", request: {}, startedAt: 0, durationMs: 0 },
    };
    const _scope: AgentScope = { mode: "all" };
    const _status: Pick<DataClientStatus, "clientId" | "connected"> = {
      clientId: "cloud",
      connected: true,
    };
    // DataClient is an interface — reference it via a typed variable declaration.
    // We don't construct one; the assignment below is never reached at runtime.
    void (_prov as DataClient | typeof _prov);
    void _scope;
    void _status;
    expect(true).to.equal(true); // keep mocha happy
  });

  it("exports the full Phase-1..4 surface", () => {
    for (const name of ["ALL_CAPABILITIES", "UnsupportedCapabilityError", "AmbiguousWriteError", "LocalAgentClient", "MultiplexClient", "DooverClient"]) {
      expect((doover as Record<string, unknown>)[name], name).to.exist;
    }
  });
});
