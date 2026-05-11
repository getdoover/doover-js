import { expect } from "chai";
import { describe, it } from "mocha";

import { ALL_CAPABILITIES } from "../client/capabilities";

describe("Capability", () => {
  it("ALL_CAPABILITIES has no duplicates and includes the core set", () => {
    expect(new Set(ALL_CAPABILITIES).size).to.equal(ALL_CAPABILITIES.length);
    for (const cap of [
      "agents.list",
      "channels.list",
      "channels.get",
      "channels.create",
      "channels.archive",
      "aggregates.get",
      "aggregates.put",
      "aggregates.patch",
      "messages.list",
      "messages.listHistorical",
      "messages.post",
      "gateway.subscribe",
      "gateway.realtime",
    ] as const) {
      expect(ALL_CAPABILITIES).to.include(cap);
    }
  });
});
